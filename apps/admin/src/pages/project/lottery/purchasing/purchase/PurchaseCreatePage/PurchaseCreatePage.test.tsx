import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { expectButtonOrder } from "@/test/button-order";

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
    // 動作列(REACT-16):[取消] → [存草稿] → [送出] 靠右
    expectButtonOrder(["取消", "存草稿", "送出"]);
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

  it("兌獎區:只列店內持有的;勾選 → 合計(兌獎金額 / 折抵 / 扣款 / 兌獎剩餘)與存值", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderPurchasePage({
      path: `${CREATE}?branch=org-store-a`,
    });
    const table = await screen.findByRole("table", { name: "兌獎紀錄" });
    // 夾具:店內持有 3 筆(500、100、1,000);已撤銷、已送兌的不列
    expect(await within(table).findAllByRole("checkbox")).toHaveLength(3);
    expect(within(table).getByText("RD-0218")).toBeInTheDocument();
    const scan = screen.getByRole("textbox", { name: "刷條碼加入" });
    await user.type(scan, "5164-1-056527-100-0-6{Enter}");
    await screen.findByRole("table", { name: /5164 發大財/ });
    await user.click(
      within(table).getByRole("checkbox", { name: "勾選 5164-056527-031" }),
    );
    await user.click(
      within(table).getByRole("checkbox", { name: "勾選 5164-056527-012" }),
    );
    expect(screen.getByText("兌獎金額(勾選 2 筆)")).toBeInTheDocument();
    // 點一列(勾選框以外)開兌獎紀錄詳情,不會改勾選
    await user.click(within(table).getByText("5164 · 056527 · #012"));
    const detail = await screen.findByRole("dialog", { name: /^兌獎紀錄/ });
    expect(within(detail).getByText("1,000 元")).toBeInTheDocument();
    await user.click(within(detail).getByRole("button", { name: "關閉" }));
    expect(screen.getByText("兌獎金額(勾選 2 筆)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const [sent] = formsFake.inputs.createAndSubmitFormSubmission;
    expect(sent.values).toMatchObject({
      redemptions: [
        expect.objectContaining({
          redemption: { id: "rd-031", label: "5164-056527-031" },
          prize_amount: 500,
        }),
        expect.objectContaining({
          redemption: { id: "rd-012", label: "5164-056527-012" },
          prize_amount: 1000,
        }),
      ],
    });
  });
  it("必填照受管表單;送出失敗時 api 回的欄位錯誤標在對應欄位、明細的顯示在明細區", async () => {
    const user = userEvent.setup();
    renderPurchasePage({
      path: `${CREATE}?branch=org-store-a`,
      forms: {
        failures: {
          CreateAndSubmitFormSubmission: {
            code: "VALIDATION_FAILED",
            extensions: {
              fields: ["dealer", "lines"],
              fieldErrors: [
                {
                  fieldKey: "dealer",
                  code: "REQUIRED",
                  message: "請選擇批購甲類",
                },
                {
                  fieldKey: "lines",
                  rowId: "r1",
                  columnKey: "rate",
                  code: "OUT_OF_RANGE",
                  message: "批購金額率要在 0–100 之間",
                },
                {
                  fieldKey: "redemptions",
                  rowId: "x1",
                  columnKey: "redemption",
                  code: "UNAVAILABLE",
                  message: "這筆兌獎紀錄已送兌",
                },
              ],
            },
          },
        },
      },
    });
    const dealer = await screen.findByRole("combobox", { name: /批購甲類/ });
    // 必填(受管表單:進貨分店、批購甲類、批購日期、扣款帳戶)
    expect(dealer).toHaveAttribute("aria-required", "true");
    expect(screen.getByRole("combobox", { name: /扣款帳戶/ })).toHaveAttribute(
      "aria-required",
      "true",
    );
    expect(
      screen.getByRole("combobox", { name: /本人批購/ }),
    ).not.toHaveAttribute("aria-required");
    // 批購受託人:本人批購 = 是時不必填;改成否 → 必填
    const trustee = () => screen.getByRole("combobox", { name: /批購受託人/ });
    expect(trustee()).not.toHaveAttribute("aria-required");
    await user.click(screen.getByRole("combobox", { name: /本人批購/ }));
    await user.click(await screen.findByRole("option", { name: "否" }));
    expect(trustee()).toHaveAttribute("aria-required", "true");
    const scan = screen.getByRole("textbox", { name: "刷條碼加入" });
    await user.type(scan, "5164-1-056527-100-0-6{Enter}");
    await screen.findByRole("table", { name: /5164 發大財/ });
    await user.click(screen.getByRole("button", { name: "送出" }));
    // 批購甲類欄:紅框(Mui-error)+ 訊息
    const message = await screen.findByText("請選擇批購甲類");
    expect(message).toHaveClass("Mui-error");
    expect(dealer.parentElement).toHaveClass("Mui-error");
    // 明細的錯誤顯示在明細區
    expect(screen.getByText("批購金額率要在 0–100 之間")).toBeInTheDocument();
    // 兌獎欄的錯誤顯示在兌獎區
    const redemptionCard = screen
      .getByRole("table", { name: "兌獎紀錄" })
      .closest<HTMLElement>(".MuiCard-root");
    expect(redemptionCard).not.toBeNull();
    expect(
      within(redemptionCard ?? document.body).getByText("這筆兌獎紀錄已送兌"),
    ).toBeInTheDocument();
  });

  it("整組批購金額率:改整組 → 同遊戲每一本都套用;之後改單本,整組框不跟著變", async () => {
    const user = userEvent.setup();
    renderPurchasePage({ path: `${CREATE}?branch=org-store-a` });
    const scan = await screen.findByRole("textbox", { name: "刷條碼加入" });
    for (const bookNo of ["056527", "056528", "056529"]) {
      await user.type(scan, `5164-1-${bookNo}-100-0-6{Enter}`);
    }
    const table = await screen.findByRole("table", { name: /5164 發大財/ });
    await waitFor(() => {
      expect(within(table).getAllByRole("row")).toHaveLength(4);
    });
    const group = screen.getByRole("spinbutton", {
      name: "5164 整組的批購金額率",
    });
    const rateOf = (bookNo: string) =>
      within(table).getByRole("spinbutton", {
        name: `本號 ${bookNo} 的批購金額率`,
      });
    await user.clear(group);
    await user.type(group, "90");
    expect(group).toHaveValue(90);
    for (const bookNo of ["056527", "056528", "056529"]) {
      expect(rateOf(bookNo)).toHaveValue(90);
    }
    // 改第 1 本:只有那一本變,整組框維持 90
    await user.clear(rateOf("056527"));
    await user.type(rateOf("056527"), "88");
    expect(rateOf("056527")).toHaveValue(88);
    expect(rateOf("056528")).toHaveValue(90);
    expect(group).toHaveValue(90);
  });

  it("改過整組率後再刷進同遊戲的新本沿用整組率;那個遊戲的本刪光後再刷,回到遊戲預設", async () => {
    const user = userEvent.setup();
    renderPurchasePage({ path: `${CREATE}?branch=org-store-a` });
    const scan = await screen.findByRole("textbox", { name: "刷條碼加入" });
    await user.type(scan, "5164-1-056527-100-0-6{Enter}");
    const group = await screen.findByRole("spinbutton", {
      name: "5164 整組的批購金額率",
    });
    await user.clear(group);
    await user.type(group, "90");
    await user.type(scan, "5164-1-056528-100-0-6{Enter}");
    const rateOf = async (bookNo: string) =>
      within(
        await screen.findByRole("table", { name: /5164 發大財/ }),
      ).findByRole("spinbutton", { name: `本號 ${bookNo} 的批購金額率` });
    expect(await rateOf("056528")).toHaveValue(90);
    for (const bookNo of ["056527", "056528"]) {
      const table = screen.getByRole("table", { name: /5164 發大財/ });
      await user.click(
        within(table).getAllByRole("button", { name: /^移除/ })[0],
      );
      await waitFor(() => {
        expect(screen.queryByText(bookNo)).toBeNull();
      });
    }
    await user.type(scan, "5164-1-056531-100-0-6{Enter}");
    expect(await rateOf("056531")).toHaveValue(92);
  });
});
