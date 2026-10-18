import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { findSnackbarAlert, querySnackbar } from "@/test/snackbar";

import { renderPage, rowOf } from "./user-manager-test-support";

/**
 * 操作結果提示:使用者管理頁的成功與失敗各一案。
 * 「一律跳一則」的規則在 `docs/standards/react/data-fetching.md` DATA-06。
 */
describe("使用者管理頁的操作結果提示", () => {
  it("停用成功 → 跳「已停用這位使用者。」", async () => {
    const { user: actor, fake } = renderPage();

    await screen.findByText("王小明");
    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "停用" }),
    );
    // 一開始不該有提示(還沒送出)
    expect(querySnackbar()).toBeNull();
    await actor.click(
      screen.getByRole("button", { name: "停用", hidden: false }),
    );

    await waitFor(() => {
      expect(fake.inputs.setUserEnabled).toHaveLength(1);
    });
    expect(await findSnackbarAlert()).toEqual({
      text: "已停用這位使用者。",
      severity: "success",
    });
  });

  /**
   * i18n 死鍵測試抓到的 —— 表單的 `t` 是 `admin.userManager.form`,
   * 以前寫 `t("feedback.createSuccess")` 查的是不存在的 `form.feedback.*`,提示直接露出 key。
   */
  it("新增成功 → 跳「已新增使用者。」", async () => {
    const { user: actor, fake } = renderPage();

    await screen.findByText("何家華");
    await actor.click(screen.getByRole("button", { name: "新增使用者" }));
    await actor.click(
      await screen.findByRole("radio", { name: /直接設定初始密碼/ }),
    );
    await actor.type(screen.getByLabelText("登入帳號 *"), "newbie");
    await actor.type(screen.getByLabelText("姓名 *"), "新人");
    await actor.type(
      screen.getByLabelText("Email *"),
      "newbie@cookhome.online",
    );
    await actor.type(await screen.findByLabelText("初始密碼 *"), "secret-1234");
    await actor.click(screen.getByRole("button", { name: "新增" }));

    await waitFor(() => {
      expect(fake.inputs.createUser).toHaveLength(1);
    });
    expect(await findSnackbarAlert()).toEqual({
      text: "已新增使用者。",
      severity: "success",
    });
  });

  it("停用失敗 → 跳失敗提示,彈窗內原本那一條錯誤仍然留著", async () => {
    const { user: actor } = renderPage({
      world: { failures: { SetUserEnabled: "OWNER_PROTECTED" } },
    });

    await screen.findByText("王小明");
    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "停用" }),
    );
    await actor.click(
      screen.getByRole("button", { name: "停用", hidden: false }),
    );

    const message = "頂層組織的擁有者受保護,這個動作被拒絕。";
    expect(await findSnackbarAlert()).toEqual({
      text: message,
      severity: "error",
    });
    // Snackbar 不取代彈窗內的錯誤顯示:兩者並存(DATA-06)。只比全頁文字數不準 ——
    // 彈窗開著時 provider 另有一份補念的 live region,所以直接在彈窗裡找那一條
    expect(within(screen.getByRole("dialog")).getByText(message)).toBeVisible();
  });
});
