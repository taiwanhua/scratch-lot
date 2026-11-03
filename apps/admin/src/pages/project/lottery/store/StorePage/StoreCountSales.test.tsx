import { beforeEach, describe, expect, it } from "@jest/globals";
import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";

import { STORE_PERMISSIONS as P } from "@repo/domain/project/lottery";
import type { RecoverLotteryTicketsMutationVariables } from "@repo/graphql";

import { injectScan } from "@/hooks/base/useScanner/scanner-registry";
import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";
import {
  STORE_ALL_PERMISSIONS,
  sampleStoreBoard,
} from "@/test/msw/project/lottery/store-fixtures";
import { api, server } from "@/test/msw/server";
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

const scan = async (code: string) => {
  await sectionOf("店內櫃台");
  act(() => {
    injectScan(code);
  });
};

/** 張數店(或轉換中)的中山店看板。 */
const countBoard = (mode = "count") => ({
  board: sampleStoreBoard(STORE_A, "中山店", mode),
});

/**
 * 張數店的銷售(張數店規格 7.1–7.3、7.9、13.2、13.4;Figma CS-01a、CS-02a、CS-03、CS-03b、CS-06a、CS-06b、
 * CS-07a、CS-07b、CS-15):看板遊戲合計與「約」、[依張數標記售出]、刷到對號 / 找不到配對、[最近售出] 一次依張數
 * 一列與撤銷幾張、卡片格子只留三種操作與虛線圖例、店員尋回、班次結帳歷史多一欄。
 */
describe("店面管理:張數店的銷售", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    writeLocalCashPoint(STORE_A, "cp-counter");
  });

  it("看板:同遊戲一列「遊戲名 · 剩 N 張 · M 本」、卡片剩餘標「約」;標題列有 [依張數標記售出]", async () => {
    renderStore({ world: countBoard() });
    const counter = await sectionOf("店內櫃台");
    // 遊戲合計那一列(h4;卡片標題是另一層)
    expect(
      within(counter)
        .getAllByRole("heading", { name: "5164 發大財" })
        .some((node) => node.tagName === "H4"),
    ).toBe(true);
    expect(within(counter).getByText("剩 18 張 · 1 本")).toBeInTheDocument();
    expect(within(counter).getAllByText("約")).toHaveLength(4);
    expect(
      within(counter).getByRole("button", { name: "依張數標記售出" }),
    ).toBeInTheDocument();
    // 只在本機收銀點(店外攤位不是本機)
    const outdoor = await sectionOf("店外攤位");
    expect(
      within(outdoor).queryByRole("button", { name: "依張數標記售出" }),
    ).toBeNull();
  });

  it("轉換中不顯示 [依張數標記售出](9.2);編號店照舊(沒有遊戲合計、不標「約」)", async () => {
    const { unmount } = renderStore({ world: countBoard("converting") });
    const converting = await sectionOf("店內櫃台");
    expect(within(converting).getByText("剩 18 張 · 1 本")).toBeInTheDocument();
    expect(
      within(converting).queryByRole("button", { name: "依張數標記售出" }),
    ).toBeNull();
    unmount();
    renderStore();
    const numbered = await sectionOf("店內櫃台");
    expect(within(numbered).queryByText("約")).toBeNull();
    expect(
      within(numbered).queryByRole("button", { name: "依張數標記售出" }),
    ).toBeNull();
  });

  it("依張數標記售出:兩列遊戲 × 張數、原因預設「太忙沒刷」、合計;成功提示列出各遊戲與合計", async () => {
    const { user, salesFake } = renderStore({ world: countBoard() });
    const counter = await sectionOf("店內櫃台");
    await user.click(
      within(counter).getByRole("button", { name: "依張數標記售出" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "依張數標記售出",
    });
    expect(
      within(dialog).getByText("負責人 王小明 · 08:02 開班 · 這一班的錢"),
    ).toBeInTheDocument();
    expect(
      await within(dialog).findByRole("combobox", { name: /原因/ }),
    ).toHaveTextContent("太忙沒刷");
    await user.click(
      within(dialog).getByRole("button", { name: "第 1 列多一張" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "+ 加一列" }));
    // 第二列帶下一個還沒選的遊戲(同一個遊戲不能兩列)
    const [, second] = within(dialog).getAllByRole("combobox", {
      name: "遊戲",
    });
    expect(second).toHaveTextContent("5201 金好運(剩 35 張)");
    expect(within(dialog).getByText("3 張 · 500 元")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "標記售出" }));
    await waitFor(() => {
      expect(salesFake.inputs.countSale).toEqual([
        {
          orgId: STORE_A,
          localCashPointId: "cp-counter",
          lines: [
            { gameId: "game-5164", count: 2 },
            { gameId: "game-5201", count: 1 },
          ],
          reasonKey: "too-busy",
          reasonNote: null,
        },
      ]);
    });
    const toast = await findLatestSnackbar();
    expect(toast).toHaveTextContent("已依張數標記售出");
    expect(toast).toHaveTextContent(
      "5164 發大財 × 2 張、5201 金好運 × 1 張,合計 500",
    );
    // 看板的遊戲合計跟著少
    expect(await within(counter).findByText("剩 33 張 · 1 本")).toBeVisible();
  });

  it("[最近售出]:一次依張數賣出一列「遊戲 × N 張 · 依張數」→ [撤銷幾張] 撤 1 張,清單寫「已撤 1 張,剩 1 張」", async () => {
    const { user, salesFake } = renderStore({ world: countBoard() });
    const counter = await sectionOf("店內櫃台");
    await user.click(
      within(counter).getByRole("button", { name: "依張數標記售出" }),
    );
    const sale = await screen.findByRole("dialog", { name: "依張數標記售出" });
    await user.click(
      within(sale).getByRole("button", { name: "第 1 列多一張" }),
    );
    await user.click(within(sale).getByRole("button", { name: "標記售出" }));
    await findLatestSnackbar();
    await user.click(within(counter).getByRole("button", { name: "最近售出" }));
    const drawer = await screen.findByRole("presentation");
    expect(
      await within(drawer).findByText("5164 發大財 × 2 張 · 依張數"),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "撤銷幾張" }));
    const undo = await screen.findByRole("dialog", { name: "撤銷依張數售出" });
    expect(within(undo).getByText("最多 2 張")).toBeInTheDocument();
    expect(
      within(undo).getByText(/客人有退票的話請改用刷條碼撤銷/),
    ).toBeInTheDocument();
    await user.click(within(undo).getByRole("button", { name: "撤銷 1 張" }));
    await waitFor(() => {
      expect(salesFake.inputs.undoCount).toEqual([
        { orgId: STORE_A, refId: "count-1", count: 1 },
      ]);
    });
    expect(await findLatestSnackbar()).toHaveTextContent(
      "已撤銷 5164 發大財 1 張,扣回 200",
    );
    expect(
      await within(drawer).findByText("已撤 1 張,剩 1 張"),
    ).toBeInTheDocument();
  });

  it("刷到已售·未對號的張:本機收銀點有配對 → 對號後賣出,提示「已對號」(Figma CS-06a)", async () => {
    const { salesFake } = renderStore({
      world: countBoard(),
      sales: { unmatchedSoldTicketIds: ["b-5-t1"] },
    });
    await scan("0056528001");
    const toast = await findLatestSnackbar();
    expect(toast).toHaveTextContent("已售出");
    expect(toast).toHaveTextContent(
      "5164-056528-001 200 元 · 店內櫃台 · 已對號",
    );
    expect(salesFake.inputs.sell).toEqual([
      expect.objectContaining({
        tickets: [{ ticketId: "b-5-t1", version: 3 }],
      }),
    ]);
  });

  it("刷到已售·未對號的張、這台沒有配對 → 「不能銷售」寫原因並有 [送撤銷售出申請](Figma CS-06b)", async () => {
    const { user, salesFake } = renderStore({
      world: countBoard(),
      sales: { unmatchedSoldTicketIds: ["b-6-t1"] },
    });
    await scan("0071204001");
    const dialog = await screen.findByRole("dialog", { name: "不能銷售" });
    expect(
      within(dialog).getByText(
        "這張刮刮樂系統記為已售(未對號),但店內櫃台的這個遊戲已沒有未售的張可以對號。請送撤銷售出申請(原因:盤點錯誤)核准後再賣。",
      ),
    ).toBeInTheDocument();
    expect(
      await within(dialog).findByRole("button", { name: "送撤銷售出申請" }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "知道了" }));
    expect(salesFake.inputs.sell).toEqual([]);
  });

  it("展開卡片:未對號格子虛線、圖例「虛線 = 系統預設帶入的張號」;選未售只有 [標記售出](不能在格子移櫃 / 收回)", async () => {
    const { user } = renderStore({
      world: countBoard(),
      sales: { unmatchedSoldTicketIds: ["b-1-t1"] },
    });
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
    expect(
      await within(panel).findByText("虛線 = 系統預設帶入的張號"),
    ).toBeInTheDocument();
    expect(within(panel).getAllByText("已售·未對號").length).toBeGreaterThan(0);
    expect(
      within(panel).getByRole("button", { name: "#001 已售·未對號" }),
    ).toBeDisabled();
    await user.click(within(panel).getByRole("button", { name: "#080 未售" }));
    expect(
      within(panel).getByRole("button", { name: "標記售出" }),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "移櫃" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "收回" })).toBeNull();
  });

  it("店員尋回:只有 store.recover(沒有庫存管理)也能在看板尋回,視窗寫規格 7.9 的說明", async () => {
    renderStore({
      world: countBoard(),
      permissions: [P.view, P.sell, P.recover],
      sales: { lostTicketIds: ["b-1-t80"] },
    });
    server.use(
      api.mutation("RecoverLotteryTickets", ({ variables }) => {
        const { input } = variables as RecoverLotteryTicketsMutationVariables;
        return HttpResponse.json({
          data: {
            recoverLotteryTickets: {
              __typename: "LotteryInventoryActionPayload",
              count: input.tickets.length,
              lossCost: null,
            },
          },
        });
      }),
    );
    await scan("0056527080");
    const dialog = await screen.findByRole("dialog", { name: "尋回 1 張" });
    expect(
      within(dialog).getByText(
        "尋回後這張會記在本店庫存。請把實體票放進庫存;要賣的時候,用「拆本 / 上檯面」放到收銀台。",
      ),
    ).toBeInTheDocument();
  });

  it("班次結帳歷史:張數店多一欄「依張數標記售出」(Figma CS-15)", async () => {
    renderStore({
      world: countBoard(),
      path: "/store?tab=checkouts",
      permissions: [...STORE_ALL_PERMISSIONS],
    });
    expect(
      await screen.findByRole("columnheader", { name: "依張數標記售出" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("3 張 · 500")).toBeInTheDocument();
  });
});
