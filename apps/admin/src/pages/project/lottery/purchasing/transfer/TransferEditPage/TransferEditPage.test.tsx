import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";

import {
  returnedTransfer,
  returnedTransferReceiving,
  shortTransfer,
  shortTransferReceiving,
} from "@/test/msw/project/lottery/transfer-edit-fixtures";
import { transferSubmissions } from "@/test/msw/project/lottery/transfer-fixtures";
import { api, server } from "@/test/msw/server";

import { renderTransferPage } from "../transfer-test-support";

/**
 * 調貨單的替換編輯頁(規格 8.4):和新增頁同一個畫面、帶入原內容;已出貨(在途)/ 已點收的列鎖住並標示,
 * 沒出貨的列可改可刪;存草稿 / 送出沿用表單引擎。
 */
describe("調貨單編輯頁", () => {
  it("被退回:已點收 / 在途的列鎖住並標示(在途的可以移除)、出貨與收貨分店鎖住;沒出貨的列可刪;送出帶原本的 rowId 扣掉刪的", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderTransferPage({
      path: "/purchasing/transfer/edit-page/doc-t12",
      forms: { submissions: [...transferSubmissions(), returnedTransfer()] },
    });
    server.use(
      api.query("LotteryTransferReceiving", () =>
        HttpResponse.json({
          data: { lotteryTransferReceiving: returnedTransferReceiving() },
        }),
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "編輯調貨單 T-0012" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/已點收的本不能修改或移除;在途\(已出貨\)的本不能修改/),
    ).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: /^調貨明細/ });
    const [, received, inTransit, pending] = within(table).getAllByRole("row");
    expect(within(received).getByText("已點收")).toBeInTheDocument();
    expect(within(received).queryByRole("button")).toBeNull();
    expect(within(inTransit).getByText("在途")).toBeInTheDocument();
    expect(within(inTransit).queryByRole("textbox")).toBeNull();
    expect(within(inTransit).queryByRole("spinbutton")).toBeNull();
    // 在途的列不能改,但可以移除(路上遺失 → 送出後變待查)
    expect(
      within(inTransit).getByRole("button", { name: "移除 056542" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /5164 發大財.*已點收 1 \/ 3/ }),
    ).toBeInTheDocument();
    await user.click(
      within(pending).getByRole("button", { name: "移除 056543" }),
    );
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(formsFake.inputs.submitFormSubmission).toHaveLength(1);
    });
    const [sent] = formsFake.inputs.submitFormSubmission;
    expect(sent.id).toBe("doc-t12");
    expect(sent.values).toMatchObject({
      from_branch: "org-store-a",
      to_branch: "org-store-b",
      lines: [
        expect.objectContaining({
          rowId: "t12-1",
          book: { id: "book-t12-1", label: "5164-056541" },
          mode: "whole",
          tickets: 100,
          amount: 20_000,
          rate: 92,
        }),
        expect.objectContaining({ rowId: "t12-2", amount: 20_000 }),
      ],
    });
    expect(sent.values?.lines as unknown[]).toHaveLength(2);
  });

  it("少張處理:部分點收的選張列展開格子,已點收的鎖住、沒到的取消勾選;送出前確認「054、055、056 這 3 張會變成待查」,送出剩下的張與重算的金額", async () => {
    const user = userEvent.setup();
    const { formsFake } = renderTransferPage({
      path: "/purchasing/transfer/edit-page/doc-t13",
      forms: { submissions: [...transferSubmissions(), shortTransfer()] },
    });
    server.use(
      api.query("LotteryTransferReceiving", () =>
        HttpResponse.json({
          data: { lotteryTransferReceiving: shortTransferReceiving() },
        }),
      ),
    );
    const table = await screen.findByRole("table", { name: /^調貨明細/ });
    expect(within(table).getByText("部分點收 9 / 12")).toBeInTheDocument();
    // 部分點收的列不能整列移除
    expect(
      within(table).queryByRole("button", { name: "移除 060112" }),
    ).toBeNull();
    await user.click(
      within(table).getByRole("button", { name: "移除沒到的張" }),
    );
    const grid = await screen.findByRole("group", { name: "張數格子" });
    expect(
      within(grid).getByRole("button", { name: "#045 已點收" }),
    ).toBeDisabled();
    for (const no of ["054", "055", "056"]) {
      await user.click(
        within(grid).getByRole("button", { name: `#${no} 在途` }),
      );
    }
    expect(
      screen.getByText("保留在途 0 張;沒到 3 張(送出後變待查)"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "送出" }));
    const dialog = await screen.findByRole("dialog", {
      name: "沒到的張會變成待查",
    });
    expect(
      within(dialog).getByText("054、055、056 這 3 張會變成待查,確定?"),
    ).toBeInTheDocument();
    expect(formsFake.inputs.submitFormSubmission).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "確定送出" }));
    await waitFor(() => {
      expect(formsFake.inputs.submitFormSubmission).toHaveLength(1);
    });
    const [sent] = formsFake.inputs.submitFormSubmission;
    expect(sent.values).toMatchObject({
      lines: [
        expect.objectContaining({
          rowId: "t13-1",
          mode: "partial",
          ticket_nos: "045-053",
          tickets: 9,
          amount: 1800,
          rate: 92,
        }),
      ],
    });
  });

  it("草稿:帶入原本的一列,可改可刪", async () => {
    renderTransferPage({ path: "/purchasing/transfer/edit-page/sub-t9" });
    expect(
      await screen.findByRole("heading", { name: "編輯調貨單 T-0009" }),
    ).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: /^調貨明細/ });
    expect(within(table).getByText("056501")).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "移除 056501" }),
    ).toBeInTheDocument();
  });
});
