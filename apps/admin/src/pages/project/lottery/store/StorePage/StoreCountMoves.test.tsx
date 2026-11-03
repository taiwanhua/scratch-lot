import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";
import { sampleStoreBoard } from "@/test/msw/project/lottery/store-fixtures";
import { findLatestSnackbar } from "@/test/snackbar";

import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";

/** 收銀點那一區(標題列 + 卡片)。 */
const sectionOf = async (name: string): Promise<HTMLElement> => {
  const heading = await screen.findByRole("heading", { name });
  const section = heading.closest<HTMLElement>(".MuiCard-root")?.parentElement;
  if (section == null) {
    throw new Error(`找不到收銀點:${name}`);
  }
  return section;
};

/** 展開店內櫃台 5164 發大財那張卡片(本號 056527)。 */
const expandCounterCard = async (user: UserEvent): Promise<HTMLElement> => {
  const counter = await sectionOf("店內櫃台");
  const card = within(counter)
    .getAllByText("5164 發大財")
    .map((node) => node.closest<HTMLElement>("button"))
    .find((node) => node !== null);
  if (card == null) {
    throw new Error("找不到卡片");
  }
  await user.click(card);
  return within(counter).findByLabelText("5164 發大財 · 本號 056527");
};

/** 張數店(或轉換中)的中山店看板;`pausedGameIds` = 全店重刷中的遊戲(null = 補點編號中)。 */
const countBoard = (mode = "count", pausedGameIds: (string | null)[] = []) => {
  const board = sampleStoreBoard(STORE_A, "中山店", mode);
  board.movePauses = pausedGameIds.map((gameId) => ({
    __typename: "LotteryStoreMovePause" as const,
    gameId,
  }));
  return { board };
};

/**
 * 張數店的收回與移櫃(張數店規格 7.6、7.7、8.5、9.2、13.1、13.2、13.4;Figma CS-02a / 02b、CS-04、CS-05a / 05b、
 * ST-10-2b;驗收 16.6 R1、R2):卡片底部 [收回] [刷條碼移櫃] [依張數移櫃]、刷到不能移的當下說原因、對號標「已對號」、
 * 依張數移櫃、全店重刷中暫停移櫃、轉換中沒有依張數移櫃;編號店的移櫃視窗也能刷條碼或手輸張號。
 */
describe("店面管理:張數店的收回與移櫃", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    writeLocalCashPoint(STORE_A, "cp-counter");
  });

  it("卡片底部有 [收回] [刷條碼移櫃] [依張數移櫃];轉換中沒有 [依張數移櫃](9.2)", async () => {
    const { user } = renderStore({ world: countBoard() });
    const panel = await expandCounterCard(user);
    for (const name of ["收回", "刷條碼移櫃", "依張數移櫃"]) {
      expect(within(panel).getByRole("button", { name })).toBeEnabled();
    }
  });

  it("轉換中:卡片底部只有 [收回] [刷條碼移櫃]", async () => {
    const { user } = renderStore({ world: countBoard("converting") });
    const panel = await expandCounterCard(user);
    expect(within(panel).getByRole("button", { name: "收回" })).toBeEnabled();
    expect(
      within(panel).getByRole("button", { name: "刷條碼移櫃" }),
    ).toBeEnabled();
    expect(
      within(panel).queryByRole("button", { name: "依張數移櫃" }),
    ).toBeNull();
  });

  it("R1 [收回]:刷到能收回的加進清單、要對號的標「已對號」、不能收回的當下說原因;送出刷的張(source: scan、來源台)", async () => {
    const { user, salesFake } = renderStore({
      world: countBoard(),
      sales: { unmatchedSoldTicketIds: ["b-1-t1"] },
    });
    const panel = await expandCounterCard(user);
    await user.click(within(panel).getByRole("button", { name: "收回" }));
    const dialog = await screen.findByRole("dialog", { name: "收回到庫存" });
    expect(
      within(dialog).getByText("從店內櫃台收回到庫存 · 這台的任何遊戲都可以刷"),
    ).toBeInTheDocument();
    const input = within(dialog).getByRole("textbox", {
      name: "刷條碼、相機或手輸張號",
    });
    await user.type(input, "056527-080{Enter}");
    expect(
      await within(dialog).findByText("5164 發大財 · 本號 056527 · #080"),
    ).toBeInTheDocument();
    await user.type(input, "056527-001{Enter}");
    expect(
      await within(dialog).findByText("5164 發大財 · 本號 056527 · #001"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("已對號")).toBeInTheDocument();
    await user.type(input, "056527-010{Enter}");
    expect(
      await within(dialog).findByText(
        /^#010 已售\(店內櫃台 .+ 賣出\),不能收回$/,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("已刷 2 張")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "收回 2 張" }));
    await waitFor(() => {
      expect(salesFake.inputs.recall).toEqual([
        {
          orgId: STORE_A,
          tickets: [
            { ticketId: "b-1-t80", version: 3 },
            { ticketId: "b-1-t1", version: 3 },
          ],
          source: "scan",
          fromCashPointId: "cp-counter",
        },
      ]);
    });
  });

  it("R2 [刷條碼移櫃]:選移到哪台、刷到的張移過去;移除清單的張不送", async () => {
    const { user, salesFake } = renderStore({ world: countBoard() });
    const panel = await expandCounterCard(user);
    await user.click(within(panel).getByRole("button", { name: "刷條碼移櫃" }));
    const dialog = await screen.findByRole("dialog", { name: "刷條碼移櫃" });
    const input = within(dialog).getByRole("textbox", {
      name: "刷條碼、相機或手輸張號",
    });
    await user.type(input, "056527-090{Enter}");
    await user.type(input, "056527-091{Enter}");
    await user.click(
      await within(dialog).findByRole("button", { name: "移除 #091" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "移櫃 1 張" }));
    await waitFor(() => {
      expect(salesFake.inputs.move).toEqual([
        {
          orgId: STORE_A,
          tickets: [{ ticketId: "b-1-t90", version: 3 }],
          source: "scan",
          fromCashPointId: "cp-counter",
          toCashPointId: "cp-outdoor",
        },
      ]);
    });
  });

  it("R2 [依張數移櫃]:上方帶入來源台與遊戲、最多 = 這台這個遊戲的總剩餘;成功提示寫從哪台移幾張到哪台", async () => {
    const { user, salesFake } = renderStore({ world: countBoard() });
    const panel = await expandCounterCard(user);
    await user.click(within(panel).getByRole("button", { name: "依張數移櫃" }));
    const dialog = await screen.findByRole("dialog", { name: "依張數移櫃" });
    expect(
      within(dialog).getByText("從店內櫃台移出 · 這台這個遊戲剩 35 張(1 本)"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("最多 35 張")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "多一張" }));
    await user.click(within(dialog).getByRole("button", { name: "多一張" }));
    expect(
      within(dialog).getByText(
        "拿任意 3 張放到店外攤位就好,張號由系統預設帶入;之後刷到實體會自動更正。",
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "移櫃" }));
    await waitFor(() => {
      expect(salesFake.inputs.moveByCount).toEqual([
        {
          orgId: STORE_A,
          fromCashPointId: "cp-counter",
          toCashPointId: "cp-outdoor",
          gameId: "game-5164",
          count: 3,
        },
      ]);
    });
    expect(await findLatestSnackbar()).toHaveTextContent(
      "已從 店內櫃台 移 3 張遊戲 5164 發大財 到 店外攤位",
    );
  });

  it("8.5:遊戲全店重刷中 → 這個遊戲的兩個移櫃按鈕變灰並寫原因,[收回] 照常", async () => {
    const { user } = renderStore({ world: countBoard("count", ["game-5164"]) });
    const panel = await expandCounterCard(user);
    expect(
      within(panel).getByRole("button", { name: "刷條碼移櫃" }),
    ).toBeDisabled();
    expect(
      within(panel).getByRole("button", { name: "依張數移櫃" }),
    ).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "收回" })).toBeEnabled();
    expect(
      within(panel).getByText("遊戲 5164 發大財 全店重刷中,暫停移櫃"),
    ).toBeInTheDocument();
  });

  it("ST-10-2b(兩種店共用):編號店的移櫃視窗也能刷條碼或手輸張號加進部分張數;不是這台這一本的當下說明", async () => {
    const { user, salesFake } = renderStore();
    const counter = await sectionOf("店內櫃台");
    const card = within(counter)
      .getAllByText("5164 發大財")
      .map((node) => node.closest<HTMLElement>("button"))
      .find((node) => node !== null);
    if (card == null) {
      throw new Error("找不到卡片");
    }
    await user.click(card);
    const panel = await within(counter).findByLabelText(
      "5164 發大財 · 本號 056527",
    );
    await user.click(
      await within(panel).findByRole("button", { name: "#080 未售" }),
    );
    await user.click(within(panel).getByRole("button", { name: "移櫃" }));
    const dialog = await screen.findByRole("dialog", { name: "移櫃" });
    const input = within(dialog).getByRole("textbox", {
      name: "刷條碼或手輸張號",
    });
    await user.type(input, "056528-081{Enter}");
    expect(
      within(dialog).getByText("#081 不在店內櫃台檯面上的這一本"),
    ).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "056527-081{Enter}");
    expect(
      within(dialog).getByRole("radio", { name: /部分張數.*2 張/ }),
    ).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "移櫃" }));
    await waitFor(() => {
      expect(salesFake.inputs.move[0]?.tickets).toEqual([
        { ticketId: "b-1-t80", version: 3 },
        { ticketId: "b-1-t81", version: 3 },
      ]);
    });
  });

  it("SC3 / S11 拆本:拆過又收回的本先問手上實際張數;多了、少太多擋下;少 1 張要點出 1 個號碼(Figma CS-08a / 08b / 08c)", async () => {
    const { user, salesFake } = renderStore({ world: countBoard() });
    const counter = await sectionOf("店內櫃台");
    await user.click(
      within(counter).getByRole("button", { name: "拆本 / 上檯面" }),
    );
    const pick = await screen.findByRole("dialog", {
      name: "拆本 / 上檯面 · 選本",
    });
    await user.click(
      await within(pick).findByRole("radio", {
        name: /5201 金好運 · 本號 060117/,
      }),
    );
    await user.click(within(pick).getByRole("button", { name: "下一步" }));
    const wizard = await screen.findByRole("dialog", {
      name: "上檯面 · 5201 金好運 · 本號 060117",
    });
    expect(
      within(wizard).getByText("系統記在本店庫存 22 張"),
    ).toBeInTheDocument();
    const next = within(wizard).getByRole("button", { name: "下一步" });
    const actual = within(wizard).getByRole("textbox", {
      name: "手上這本實際有幾張",
    });
    expect(next).toBeDisabled();
    await user.type(actual, "24");
    expect(
      within(wizard).getByText("多了 2 張,請先盤點庫存。"),
    ).toBeInTheDocument();
    expect(next).toBeDisabled();
    await user.clear(actual);
    await user.type(actual, "17");
    expect(
      within(wizard).getByText("少了 5 張,請先盤點庫存或檢查是不是報錯張。"),
    ).toBeInTheDocument();
    expect(next).toBeDisabled();
    await user.clear(actual);
    await user.type(actual, "21");
    expect(
      within(wizard).getByText(
        "比系統少 1 張:請在下面點出手上沒有的 1 個號碼(標跳號)才能拆。",
      ),
    ).toBeInTheDocument();
    expect(next).toBeDisabled();
    await user.click(within(wizard).getByRole("button", { name: "#102 未售" }));
    expect(next).toBeEnabled();
    await user.click(next);
    await user.click(
      within(wizard).getByRole("button", { name: "確認上檯面" }),
    );
    await waitFor(() => {
      expect(salesFake.inputs.split[0]).toMatchObject({
        bookId: "b-reopen",
        skippedTicketNos: ["102"],
        actualCount: 21,
      });
    });
  });
});
