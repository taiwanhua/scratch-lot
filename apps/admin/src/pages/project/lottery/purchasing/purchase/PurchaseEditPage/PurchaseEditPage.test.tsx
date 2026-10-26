import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  returnedPurchase,
  returnedPurchaseReceiving,
} from "@/test/msw/project/lottery/purchase-edit-fixtures";
import { purchaseSubmissions } from "@/test/msw/project/lottery/purchase-fixtures";

import { renderPurchasePage } from "../purchase-test-support";

const EDIT = "/purchasing/purchase/edit-page/doc-p35";

const renderReturned = () =>
  renderPurchasePage({
    path: EDIT,
    forms: { submissions: [...purchaseSubmissions(), returnedPurchase()] },
    purchase: { receiving: returnedPurchaseReceiving() },
  });

/**
 * 進貨單的替換編輯頁(規格 8.2「打錯 → 退回修改沒點收的列」):和新增頁同一個畫面、帶入原內容;
 * 已點收的列鎖住並標「已點收」,沒點收的列可改可刪;存草稿 / 送出沿用表單引擎。
 */
describe("進貨單編輯頁", () => {
  it("被退回:帶入單頭與明細;已點收的列鎖住、標「已點收」,組標題「已點收 1 / 2」;進貨分店不能換", async () => {
    renderReturned();
    expect(
      await screen.findByRole("heading", { name: "編輯進貨單 P-0035" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/這張單被退回修改/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "已點收的本不能修改;送出後會回到點收,由進貨分店點收剩下的本",
      ),
    ).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: /5164 發大財/ });
    const [, received, pending] = within(table).getAllByRole("row");
    expect(within(received).getByText("056527")).toBeInTheDocument();
    expect(within(received).getByText("已點收")).toBeInTheDocument();
    expect(within(received).queryByRole("spinbutton")).toBeNull();
    expect(within(received).queryByRole("button")).toBeNull();
    expect(
      within(pending).getByRole("spinbutton", {
        name: "本號 056531 的批購金額率",
      }),
    ).toHaveValue(92);
    expect(
      within(pending).getByRole("button", { name: "移除 056531" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /5164 發大財.*已點收 1 \/ 2/ }),
    ).toBeInTheDocument();
    // 正面條碼的遊戲一直顯示(同新增頁)
    expect(
      screen.getByRole("combobox", { name: "正面條碼的遊戲" }),
    ).toBeInTheDocument();
  });

  it("改沒點收的列、再刷新的本 → 送出帶原本的 rowId(已點收的列原樣)與單頭", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderReturned();
    const table = await screen.findByRole("table", { name: /5164 發大財/ });
    await user.click(
      within(table).getByRole("button", { name: "移除 056531" }),
    );
    const scan = screen.getByRole("textbox", { name: "刷條碼加入" });
    await user.type(scan, "5164-1-056532-100-0-6{Enter}");
    await waitFor(() => {
      expect(screen.getByText("056532")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(formsFake.inputs.saveFormDraft).toHaveLength(1);
    });
    const [saved] = formsFake.inputs.saveFormDraft;
    expect(saved.id).toBe("doc-p35");
    expect(saved.values).toMatchObject({
      branch: "org-store",
      dealer: "dealer-a",
      note: "第一批",
      lines: [
        expect.objectContaining({
          rowId: "row-1",
          book_no: "0056527",
          last_ticket_no: 99,
          rate: 92,
        }),
        expect.objectContaining({ book_no: "0056532" }),
      ],
    });
    await user.click(await screen.findByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(formsFake.inputs.submitFormSubmission).toHaveLength(1);
    });
    expect(formsFake.inputs.submitFormSubmission[0]?.id).toBe("doc-p35");
  });

  it("草稿:沒有點收,每一列都可改可刪", async () => {
    renderPurchasePage({
      path: "/purchasing/purchase/edit-page/sub-p34",
      purchase: {
        receiving: { ...returnedPurchaseReceiving(), groups: [] },
      },
    });
    expect(
      await screen.findByRole("heading", { name: "編輯進貨單 P-0034" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/已點收的本不能修改/)).toBeNull();
  });
});
