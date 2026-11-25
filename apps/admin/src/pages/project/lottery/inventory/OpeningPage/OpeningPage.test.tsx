import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ALL_INVENTORY_PERMISSIONS } from "@/test/msw/project/lottery/inventory-fixtures";
import { masterDataOrgs } from "@/test/msw/project/lottery/master-data-fixtures";
import {
  OPENING_PERMISSION,
  type OpeningScanResult,
  openingCandidate,
} from "@/test/msw/project/lottery/opening-handlers";

import { renderInventory } from "../inventory-test-support";

const { storeA } = masterDataOrgs;
const PATH = `/inventory/opening-page?org=${storeA.id}`;

const scanOf = (
  topTicketNo: string,
  candidate = openingCandidate(),
): OpeningScanResult => ({
  __typename: "LotteryOpeningScanPayload",
  bookNo: "0056601",
  topTicketNo,
  hasGameCode: true,
  candidates: [candidate],
});

const renderOpening = (options: Parameters<typeof renderInventory>[0] = {}) =>
  renderInventory({
    path: PATH,
    openingPage: true,
    permissions: [...ALL_INVENTORY_PERMISSIONS, OPENING_PERMISSION],
    ...options,
  });

/** 刷條碼列輸入一個碼後按 Enter。 */
const scan = async (
  user: ReturnType<typeof renderOpening>["user"],
  code: string,
) => {
  const field = await screen.findByRole("textbox", { name: "刷條碼建檔" });
  await user.type(field, `${code}{Enter}`);
};

/** 期初建檔頁(Figma OP-01–05;期初建檔規格 3)。走正式的頁面登記、路由與殼,只有 api 是假的。 */
describe("期初建檔頁", () => {
  it("刷到手上最上面那張 047:001–046 預先標好 → 分放預設本機收銀點 → 確認框勾「我已對過實體」才能建檔", async () => {
    const { user, opening } = renderOpening({
      scans: { "556-056601-047": scanOf("047") },
    });
    expect(
      await screen.findByText("同一款遊戲,請先登記先賣的那本"),
    ).toBeInTheDocument();
    await scan(user, "556-056601-047");
    expect(
      await screen.findByText("556 好運 · 本號 056601"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "#046 已售(導入前已賣出)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "#047 未售" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "下一步" }));
    const summary =
      "迄號 100:導入前已賣出 46 · 跳號 0 · 在手上 54(檯面 店內櫃台 54)";
    expect(await screen.findByText(summary)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "建檔" }));
    const dialog = await screen.findByRole("dialog", {
      name: "建檔 556-056601?",
    });
    const submit = within(dialog).getByRole("button", { name: "建檔" });
    expect(submit).toBeDisabled();
    await user.click(
      within(dialog).getByRole("checkbox", { name: "我已對過實體" }),
    );
    await user.click(submit);
    await waitFor(() => {
      expect(opening.inputs.create).toHaveLength(1);
    });
    const [input] = opening.inputs.create;
    expect(input).toMatchObject({
      orgId: storeA.id,
      gameId: "g-556",
      bookNo: "0056601",
      lastTicketNo: 100,
      rate: 92,
      skippedTicketNos: [],
    });
    expect(input.soldTicketNos).toHaveLength(46);
    expect(input.placements).toEqual([
      {
        cashPointId: "cp-counter",
        ticketNos: Array.from({ length: 54 }, (_, index) =>
          String(index + 47).padStart(3, "0"),
        ),
      },
    ]);
    const list = await screen.findByRole("table", { name: "這家店已建檔的本" });
    expect(await within(list).findByText("46 / 54")).toBeInTheDocument();
    expect(within(list).getByText("檯面 店內櫃台 54")).toBeInTheDocument();
  });

  it("原封的本(刷 001):① 0 張 → ③ 預設庫存", async () => {
    const { user } = renderOpening({
      scans: { "556-056602-001": { ...scanOf("001"), bookNo: "0056602" } },
    });
    await scan(user, "556-056602-001");
    await user.click(await screen.findByRole("button", { name: "下一步" }));
    expect(
      await screen.findByText(
        "迄號 100:導入前已賣出 0 · 跳號 0 · 在手上 100(庫存 100)",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "建檔" })).toBeEnabled();
  });

  it("迄號 101 的拆過的本:跳號沒標滿 → 「還有 1 張跳號沒標」,[建檔] 停用", async () => {
    const { user } = renderOpening({
      scans: { "556-056601-047": scanOf("047") },
    });
    await scan(user, "556-056601-047");
    const last = await screen.findByRole("textbox", { name: "迄號" });
    await user.clear(last);
    await user.type(last, "101");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(
      await screen.findByText(/迄號 101 比標準張數多 1 張/u),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByText("還有 1 張跳號沒標")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "建檔" })).toBeDisabled();
  });

  it("擋下:已在系統裡附 [本的詳情];在進貨單上帶單號;停售只提示", async () => {
    const { user } = renderOpening({
      scans: {
        exists: scanOf(
          "047",
          openingCandidate({ block: "exists", bookId: "b-1" }),
        ),
        purchase: scanOf(
          "047",
          openingCandidate({ block: "on_purchase", serialNo: "P-0031" }),
        ),
        stopped: scanOf("047", openingCandidate({ discontinued: true })),
      },
    });
    await scan(user, "exists");
    expect(await screen.findByText("這本已經在系統裡")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "本的詳情" }),
    ).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "刷條碼建檔" }));
    await scan(user, "purchase");
    expect(
      await screen.findByText("這本在進貨單 #P-0031,請在進貨單點收"),
    ).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "刷條碼建檔" }));
    await scan(user, "stopped");
    expect(await screen.findByText("這款遊戲已停售")).toBeInTheDocument();
    expect(screen.getByText("556 好運 · 本號 056601")).toBeInTheDocument();
  });

  it("已結束的店:顯示「已結束(日期 誰)」,沒有刷條碼列與 [作廢]", async () => {
    renderOpening({
      openings: {
        [storeA.id]: {
          bookCount: 0,
          closedAt: "2026-11-30T02:00:00.000Z",
          closedBy: "王總部",
        },
      },
    });
    expect(
      await screen.findByText("這家店的期初建檔已結束(11/30 王總部)"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "刷條碼建檔" }),
    ).not.toBeInTheDocument();
  });

  it("[作廢]:已有銷售的本停用", async () => {
    renderOpening({
      openings: {
        [storeA.id]: {
          bookCount: 1,
          books: [
            {
              __typename: "LotteryOpeningBook",
              bookId: "ob-sold",
              bookKey: "556-0056603",
              gameCode: "556",
              gameName: "好運",
              bookNo: "0056603",
              lastTicketNo: "100",
              openingSoldCount: 10,
              inHandCount: 90,
              places: [],
              openedBy: null,
              openingAt: "2026-11-25T01:12:00.000Z",
              voidable: false,
            },
          ],
        },
      },
    });
    expect(
      await screen.findByRole("button", { name: "作廢 556-056603" }),
    ).toBeDisabled();
  });

  it("[作廢]:還沒有其他動作的本確認後送出、清單拿掉", async () => {
    const { user, opening } = renderOpening({
      scans: { "556-056601-047": scanOf("047") },
    });
    await scan(user, "556-056601-047");
    await user.click(await screen.findByRole("button", { name: "下一步" }));
    await user.click(await screen.findByRole("button", { name: "建檔" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "建檔" }));
    const voidButton = await screen.findByRole("button", {
      name: "作廢 556-056601",
    });
    await user.click(voidButton);
    const confirm = await screen.findByRole("dialog", {
      name: "作廢 556-056601?",
    });
    await user.click(within(confirm).getByRole("button", { name: "作廢" }));
    await waitFor(() => {
      expect(opening.inputs.void).toEqual(["ob-1"]);
    });
    expect(await screen.findByText("還沒有建檔的本")).toBeInTheDocument();
  });
});
