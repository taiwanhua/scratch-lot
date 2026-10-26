import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  AMBIGUOUS_FRONT_CODE,
  WRONG_STORE_CODE,
} from "@/test/msw/project/lottery/purchase-handlers";

import { renderPurchasePage } from "../purchase-test-support";

const VIEW = "/purchasing/purchase/view-page/doc-p33";

/**
 * 進貨單的替換檢視頁(規格 8.2;Figma PU-06、PU-07、PU-11):點收區塊、送錯分店、結算區塊。
 */
describe("進貨單檢視頁", () => {
  it("點收區塊:依遊戲分組、組標題「已點收 4 / 5」;刷到單上的本 → 已點收,[完成這次點收] 可以按", async () => {
    const user = userEvent.setup();
    const { purchaseFake } = renderPurchasePage({ path: VIEW });
    expect(
      await screen.findByRole("heading", {
        name: /5164 發大財 · 200 元.*已點收 4 \/ 5/,
      }),
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
        screen.getByRole("heading", {
          name: /5164 發大財 · 200 元.*已點收 5 \/ 5/,
        }),
      ).toBeInTheDocument();
    });
    expect(purchaseFake.scanned).toEqual(["0056531099"]);
    expect(
      screen.getByRole("button", { name: "完成這次點收(1 本)" }),
    ).toBeEnabled();
  });

  it("正面條碼對到多款遊戲同本號 → 擋下、出現「正面條碼的遊戲」;選了遊戲 → 照所選的遊戲再確認、點收成功後收起", async () => {
    const user = userEvent.setup();
    const { purchaseFake } = renderPurchasePage({ path: VIEW });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    // 平常不顯示遊戲選單
    expect(
      screen.queryByRole("combobox", { name: "正面條碼的遊戲" }),
    ).toBeNull();
    await user.type(scan, `${AMBIGUOUS_FRONT_CODE}{Enter}`);
    expect(
      await screen.findByText("這個本號有多款遊戲,請刷背面編號或選遊戲"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "正面條碼的遊戲" }));
    expect(
      await screen.findByRole("option", { name: "5201 金好運" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "5164 發大財" }));
    await waitFor(() => {
      expect(purchaseFake.pickedGameIds).toEqual([null, "game-5164"]);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("combobox", { name: "正面條碼的遊戲" }),
      ).toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "完成這次點收(1 本)" }),
    ).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "刷條碼點收" })).toHaveValue("");
  });

  it("選了遊戲但點收失敗 → 再刷別的碼時不帶舊的遊戲,選單收起", async () => {
    const user = userEvent.setup();
    const { purchaseFake } = renderPurchasePage({ path: VIEW });
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, `${AMBIGUOUS_FRONT_CODE}{Enter}`);
    await user.click(
      await screen.findByRole("combobox", { name: "正面條碼的遊戲" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "5201 金好運" }),
    );
    expect(await screen.findByText("這本已經點收過了")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "正面條碼的遊戲" }),
    ).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "刷條碼點收" });
    await user.clear(input);
    await user.type(input, "0099999100{Enter}");
    await waitFor(() => {
      expect(purchaseFake.scanGameIds).toEqual([null, "game-5201", null]);
    });
    expect(
      screen.queryByRole("combobox", { name: "正面條碼的遊戲" }),
    ).toBeNull();
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

  it("勾選的兌獎紀錄:點一列開兌獎紀錄詳情(讀得到這張進貨單就看得到;這裡不能撤銷)", async () => {
    const user = userEvent.setup();
    renderPurchasePage({ path: VIEW });
    const table = await screen.findByRole("table", { name: "兌獎紀錄" });
    expect(within(table).getByText("RD-0215")).toBeInTheDocument();
    await user.click(within(table).getByText("5150 · 042210 · #083"));
    const dialog = await screen.findByRole("dialog", { name: /^兌獎紀錄/ });
    expect(within(dialog).getByText("RD-0215")).toBeInTheDocument();
    expect(
      within(dialog).getByText("已送兌(進貨單 P-0033)"),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "撤銷兌獎" }),
    ).toBeNull();
  });
});
