import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WRONG_STORE_CODE } from "@/test/msw/project/lottery/purchase-handlers";

import { renderPurchasePage } from "../purchase-test-support";

const VIEW = "/purchasing/purchase/view-page/doc-p33";

/**
 * 進貨單的替換檢視頁(規格 8.2;Figma PU-06、PU-07、PU-11):點收區塊、送錯分店、結算區塊。
 */
describe("進貨單檢視頁", () => {
  it("點收區塊:依遊戲分組、「叫貨 5,已刷 4」;刷到單上的本 → 已點收,[完成這次點收] 可以按", async () => {
    const user = userEvent.setup();
    const { purchaseFake } = renderPurchasePage({ path: VIEW });
    expect(
      await screen.findByText("5164 發大財 · 200 元 · 叫貨 5,已刷 4"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/還有 1 本沒點收;核准前要全部點收/),
    ).toBeInTheDocument();
    const complete = screen.getByRole("button", { name: /完成這次點收/ });
    expect(complete).toBeDisabled();

    const scan = screen.getByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, "0056531099{Enter}");
    await waitFor(() => {
      expect(
        screen.getByText("5164 發大財 · 200 元 · 叫貨 5,已刷 5"),
      ).toBeInTheDocument();
    });
    expect(purchaseFake.scanned).toEqual(["0056531099"]);
    expect(
      screen.getByRole("button", { name: "完成這次點收(1 本)" }),
    ).toBeEnabled();
  });

  it("送錯分店:擋下並提示是哪一家店的哪一張單;[通知總部更正] → 通知建立者", async () => {
    const user = userEvent.setup();
    const { purchaseFake } = renderPurchasePage({ path: VIEW });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, `${WRONG_STORE_CODE}{Enter}`);
    const dialog = await screen.findByRole("dialog", {
      name: "這本不是送到這家店",
    });
    expect(
      within(dialog).getByText(
        "這本屬於「新竹店」的進貨單 #P-0033,請交給送貨人帶到新竹店,本店不用點收。",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "通知總部更正" }),
    );
    await waitFor(() => {
      expect(purchaseFake.notified).toEqual([WRONG_STORE_CODE]);
    });
  });

  it("刷到不在單上的本 → 顯示「這本不在這張進貨單上」", async () => {
    const user = userEvent.setup();
    renderPurchasePage({ path: VIEW });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, "0099999100{Enter}");
    expect(await screen.findByText("這本不在這張進貨單上")).toBeInTheDocument();
  });

  it("結算區塊:送出過的單顯示應付、已付與按鈕(有 settle 才能按)", async () => {
    renderPurchasePage({ path: VIEW });
    expect(
      await screen.findByRole("heading", { name: "結算" }),
    ).toBeInTheDocument();
    expect(screen.getByText("應付")).toBeInTheDocument();
  });
});
