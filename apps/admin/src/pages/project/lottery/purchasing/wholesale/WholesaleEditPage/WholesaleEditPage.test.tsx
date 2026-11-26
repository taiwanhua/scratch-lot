import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  returnedWholesale,
  wholesaleSubmissions,
} from "@/test/msw/project/lottery/wholesale-fixtures";

import { renderWholesalePage } from "../wholesale-test-support";

/** 批售單的替換編輯頁(規格 21.3):和新增頁同一個畫面、帶入原內容。 */
describe("批售單編輯頁", () => {
  it("被退回:帶入原內容(改過的率照舊)、可刪可加;送出帶原本的 rowId,讀不到的列原樣保留", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderWholesalePage({
      path: "/purchasing/wholesale/edit-page/doc-w5",
      forms: { submissions: [...wholesaleSubmissions(), returnedWholesale()] },
    });
    expect(
      await screen.findByRole("heading", { name: "編輯批售單 W-0005" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/有 1 列明細讀不到內容/)).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: /5164 發大財/ });
    expect(
      within(table).getByRole("spinbutton", {
        name: "本號 056611 的批購金額率",
      }),
    ).toHaveValue(93);
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: /批售客戶/ }),
      ).toHaveTextContent("好運彩券行 · 0223456789");
    });
    await user.click(
      within(table).getByRole("button", { name: "移除 056612" }),
    );
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(formsFake.inputs.submitFormSubmission).toHaveLength(1);
    });
    const [sent] = formsFake.inputs.submitFormSubmission;
    expect(sent.id).toBe("doc-w5");
    expect(sent.values).toMatchObject({
      customer: "wholesale-1",
      payment_mode: "collect_first",
      lines: [
        expect.objectContaining({
          rowId: "w5-1",
          book: { id: "book-w1", label: "5164-056611" },
          rate: 93,
        }),
        expect.objectContaining({ rowId: "w5-lost" }),
      ],
    });
  });

  it("草稿:存草稿沿用表單引擎", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderWholesalePage({
      path: "/purchasing/wholesale/edit-page/sub-w3",
    });
    expect(
      await screen.findByRole("heading", { name: "編輯批售單" }),
    ).toBeInTheDocument();
    const save = await screen.findByRole("button", { name: "存草稿" });
    await waitFor(() => {
      expect(save).toBeEnabled();
    });
    await user.type(screen.getByRole("textbox", { name: "備註" }), "下週取貨");
    await user.click(save);
    await waitFor(() => {
      expect(formsFake.inputs.saveFormDraft).toHaveLength(1);
    });
    expect(formsFake.inputs.saveFormDraft[0].values).toMatchObject({
      note: "下週取貨",
    });
  });
});
