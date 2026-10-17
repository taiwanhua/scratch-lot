import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  findSnackbar,
  findSnackbarAlert,
  querySnackbar,
} from "@/test/snackbar";

import {
  findRowOf,
  renderPage,
  selectCategory,
} from "./field-manager-test-support";

/**
 * 操作結果提示(#376):欄位管理頁的成功與失敗各一案。
 * 「一律跳一則」的規則在 `docs/standards/react/data-fetching.md` DATA-06。
 */
describe("欄位管理頁的操作結果提示", () => {
  it("新增選項成功 → 跳一則成功提示,可以手動關掉", async () => {
    const { user: actor } = renderPage();
    await selectCategory(actor, "示範分類");
    await findRowOf("炸物");

    await actor.click(screen.getByRole("button", { name: "+ 新增自訂選項" }));
    await actor.type(screen.getByLabelText("選項名稱 *"), "湯麵");
    await actor.type(screen.getByLabelText("值(value) *"), "noodle");
    await actor.click(screen.getByRole("button", { name: "新增" }));

    expect(await findSnackbarAlert()).toEqual({
      text: "已新增選項。",
      severity: "success",
    });

    // 4 秒到之前也關得掉(`closeLabel`)
    const snackbar = await findSnackbar();
    await actor.click(within(snackbar).getByRole("button", { name: "關閉" }));
    await waitFor(() => {
      expect(querySnackbar()).not.toBeInTheDocument();
    });
  });

  it("切換啟用失敗 → 跳一則失敗提示,頁面上那一條錯誤仍然留著", async () => {
    const { user: actor } = renderPage({
      world: { failures: { SetFieldEnabled: "FORBIDDEN" } },
    });
    await selectCategory(actor, "示範分類");

    await actor.click(
      within(await findRowOf("炸物")).getByRole("switch", {
        name: "啟用「炸物」",
      }),
    );

    const message = "全域選項由系統管理員統一維護,你的組織不能變更它。";
    expect(await findSnackbarAlert()).toEqual({
      text: message,
      severity: "error",
    });
    // Snackbar 不取代頁面上的錯誤顯示:兩者並存(DATA-06)—— 同一份文案會出現兩次
    expect(screen.getAllByText(message)).toHaveLength(2);
  });
});
