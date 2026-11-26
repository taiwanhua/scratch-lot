import { describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

// jsdom 不會畫 canvas:轉圖換成固定的 PNG(受測頁面必須在替身掛上之後才載入,先例 TransferViewPagePrint.test.tsx)
const PNG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const receiptPngOf = jest.fn<(node: HTMLElement) => Promise<Blob>>(() =>
  Promise.resolve(new Blob([PNG], { type: "image/png" })),
);
jest.unstable_mockModule(
  "@/lib/project/lottery/receipts/receipt-image",
  () => ({ receiptPngOf }),
);
const { default: userEvent } = await import("@testing-library/user-event");
const { HttpResponse } = await import("msw");
const { renderWholesalePage } = await import("../wholesale-test-support");
const { api, server } = await import("@/test/msw/server");
const { wholesaleSettlement } =
  await import("@/test/msw/project/lottery/wholesale-settlement-fixtures");

const VIEW = "/purchasing/wholesale/view-page";

const cutsOfPrints = () =>
  receiptPngOf.mock.calls.map(
    ([node]) => node.querySelectorAll("[data-receipt58-cut]").length,
  );

const lastPrintText = () =>
  receiptPngOf.mock.calls.at(-1)?.[0].textContent ?? "";

/** 等一下(確認「沒有」送出列印時,讓交易後的動作有時間跑完)。 */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 300);
  });

/**
 * 批售收款收據的列印(規格 21.8;驗算 #5;Figma RC-12):[收款] 選現金寫入成功後自動印兩聯
 * (第 1 聯 店鋪留存、第 2 聯 客戶留存;一次列印 = 一個列印工作),轉帳不印;檢視頁標頭 [列印] 印最近一筆現金收款。
 */
describe("批售單:批售收款收據", () => {
  it("審核中(還沒出貨):沒有批售出貨單的 [列印];收過現金 → 有「批售收款收據」[列印](最近一筆現金收款)", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderWholesalePage({
      path: `${VIEW}/doc-w1`,
      printing: {},
    });

    const label = await screen.findByText("批售收款收據");
    expect(screen.queryByText("批售出貨單")).toBeNull();
    const group = label.parentElement;
    if (group === null) throw new Error("找不到收款收據的列印按鈕");
    await waitFor(() => {
      expect(within(group).getByRole("button", { name: "列印" })).toBeEnabled();
    });
    await user.click(within(group).getByRole("button", { name: "列印" }));
    const dialog = await screen.findByRole("dialog", { name: "列印" });
    await user.click(within(dialog).getByRole("button", { name: "列印" }));

    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      refType: "lottery-wholesale-payment",
      refId: "cash-w1",
      documentName: "批售收款收據 W-0001(兩聯)",
    });
    const text = lastPrintText();
    expect(text).toContain("第 2 聯 · 客戶留存");
    expect(text).toContain("中山店 · 小金庫");
    expect(text).toContain("王小明");
    expect(text).toContain("20,000");
    expect(text).toContain("客戶簽名");
  });

  it("[收款] 選現金(驗算 #5)→ 寫入成功後自動印批售收款收據兩聯;選銀行 → 不印", async () => {
    receiptPngOf.mockClear();
    const user = userEvent.setup();
    const { printingFake } = renderWholesalePage({
      path: `${VIEW}/doc-w1`,
      printing: {},
    });
    const base = wholesaleSettlement("doc-w1", 0);
    if (base === null) throw new Error("缺 W-0001 的收付夾具");
    const [received] = base.records;
    // 還沒收:[收款] 先填 37,200
    const unpaid = { ...base, records: [] };
    let recorded = 0;
    server.use(
      api.query("LotterySettlement", () =>
        HttpResponse.json({ data: { lotterySettlement: { item: unpaid } } }),
      ),
      api.query("LotterySettlementAccounts", () =>
        HttpResponse.json({
          data: {
            lotterySettlementAccounts: {
              items: [
                {
                  __typename: "LotteryAccountsRef",
                  id: "account-1",
                  name: "台銀 中山分行 ····12345",
                },
              ],
              totalCount: 1,
            },
          },
        }),
      ),
      api.mutation("RecordLotterySettlement", ({ variables }) => {
        recorded += 1;
        const { input } = variables as {
          input: { method: string; handler: string | null; amount: number };
        };
        const id = `rec-new-${String(recorded)}`;
        return HttpResponse.json({
          data: {
            recordLotterySettlement: {
              recordId: id,
              item: {
                ...unpaid,
                records: [
                  {
                    ...received,
                    id,
                    method: input.method,
                    type:
                      input.method === "cash" ? "wholesale_in" : "wholesale",
                    cashPlace: input.method === "cash" ? "vault" : null,
                    accountLabel:
                      input.method === "cash"
                        ? null
                        : "台銀 中山分行 ····12345",
                    handler: input.handler,
                    amount: input.amount,
                  },
                ],
              },
            },
          },
        });
      }),
    );

    const receive = async (method: "現金" | "銀行") => {
      const [receiveButton] = await screen.findAllByRole("button", {
        name: "收款",
      });
      await user.click(receiveButton);
      const dialog = await screen.findByRole("dialog", { name: "收款" });
      await user.click(
        within(dialog).getByRole("combobox", { name: "付款方式" }),
      );
      await user.click(await screen.findByRole("option", { name: method }));
      const amount = within(dialog).getByRole("textbox", { name: /金額/ });
      await user.clear(amount);
      await user.type(amount, "20000");
      if (method === "現金") {
        await user.type(
          within(dialog).getByRole("textbox", { name: /經手人/ }),
          "王小明",
        );
      } else {
        await user.click(
          within(dialog).getByRole("combobox", { name: /帳戶/ }),
        );
        const [account] = await screen.findAllByRole("option");
        await user.click(account);
      }
      await user.click(within(dialog).getByRole("button", { name: "確認" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "收款" })).toBeNull();
      });
    };

    await receive("現金");
    await waitFor(() => {
      expect(printingFake?.created).toHaveLength(1);
    });
    expect(printingFake?.created[0]).toMatchObject({
      documentType: "lottery-wholesale-payment",
      refType: "lottery-wholesale-payment",
      refId: "rec-new-1",
      documentName: "批售收款收據 W-0001(兩聯)",
    });
    expect(cutsOfPrints()).toEqual([1]);
    const text = lastPrintText();
    expect(text).toContain("批售收款收據");
    expect(text).toContain("第 1 聯 · 店鋪留存");
    expect(text).toContain("第 2 聯 · 客戶留存");
    expect(text).toContain("好運彩券行");
    expect(text).toContain("中山店 · 小金庫");
    expect(text).toContain("20,000");

    await receive("銀行");
    expect(recorded).toBe(2);
    await settle();
    expect(printingFake?.created).toHaveLength(1);
  });
});
