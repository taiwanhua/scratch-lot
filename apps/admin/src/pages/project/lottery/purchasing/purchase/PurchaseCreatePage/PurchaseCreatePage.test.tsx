import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderPurchasePage } from "../purchase-test-support";

const CREATE = "/purchasing/purchase/create-page/purchase";

/**
 * 進貨單的替換新增頁(規格 8.2;Figma PU-05):刷條碼加一本、依遊戲分組、從叫貨單帶入、送出。
 */
describe("進貨單新增頁", () => {
  it("從採購清單帶入叫貨單:標題旁顯示「叫貨 5,已刷 0」;刷背面編號加一本 → 依遊戲分組、批購金額", async () => {
    const user = userEvent.setup();
    renderPurchasePage({
      path: `${CREATE}?requisition=R-0042&branch=org-store-a`,
    });
    expect(
      await screen.findByText("從叫貨單 R-0042 帶入:叫貨 5,已刷 0"),
    ).toBeInTheDocument();
    const scan = screen.getByRole("textbox", { name: "刷條碼加入" });
    await user.type(scan, "5164-1-056527-102-0-6{Enter}");
    expect(
      await screen.findByText("從叫貨單 R-0042 帶入:叫貨 5,已刷 1"),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /5164 發大財/ });
    expect(within(table).getByText("056527")).toBeInTheDocument();
    expect(within(table).getByText("102")).toBeInTheDocument();
    expect(within(table).getAllByText("18,400").length).toBeGreaterThan(0);
    // 5164 預計 30、已給 26、在途 4 → 這張進 1 本就超過,只警告、照樣可以送出(規格 7.6)
    expect(screen.getByText("5164 發大財:多 1 本")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送出" })).toBeEnabled();
  });

  it("正面條碼沒有遊戲代號:沒先選遊戲 → 提示;同一本刷兩次 → 提示已經在單上", async () => {
    const user = userEvent.setup();
    renderPurchasePage({ path: `${CREATE}?branch=org-store-a` });
    const scan = await screen.findByRole("textbox", { name: "刷條碼加入" });
    await user.type(scan, "0060116100{Enter}");
    expect(
      await screen.findByText("正面條碼沒有遊戲代號,請先選「正面條碼的遊戲」"),
    ).toBeInTheDocument();
    await user.clear(scan);
    await user.type(scan, "5201-1-060116-100-0-6{Enter}");
    await user.type(scan, "5201-1-060116-100-0-6{Enter}");
    expect(
      await screen.findByText("本號 060116 已經在這張單上"),
    ).toBeInTheDocument();
  });

  it("送出:存值帶單頭(扣款帳戶只有一個時自動帶入)與明細", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderPurchasePage({
      path: `${CREATE}?branch=org-store-a`,
    });
    const scan = await screen.findByRole("textbox", { name: "刷條碼加入" });
    await user.type(scan, "5164-1-056527-100-0-6{Enter}");
    await screen.findByRole("table", { name: /5164 發大財/ });
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const [sent] = formsFake.inputs.createAndSubmitFormSubmission;
    const values = sent.values ?? {};
    expect(values).toMatchObject({
      branch: "org-store-a",
      account: "acc-1",
      self_purchase: true,
      lines: [
        expect.objectContaining({
          book_no: "0056527",
          last_ticket_no: 100,
          tickets: 100,
          book_price: 20_000,
          rate: 92,
        }),
      ],
    });
  });
});
