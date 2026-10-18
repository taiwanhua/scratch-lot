import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { formFragment } from "@/test/msw/form-fixtures";
import { findSnackbarAlert } from "@/test/snackbar";

import {
  defaultDesignOptions,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

describe("表單管理:表單設定「允許存草稿」", () => {
  it("預設開;關掉 → updateForm 帶 allowDraft false,開關跟著關、提示只能直接送出", async () => {
    const { user, world } = renderFormsPage();

    const toggle = await screen.findByRole("switch", { name: "允許存草稿" });
    expect(toggle).toBeChecked();
    expect(
      screen.getByText("關掉後,新增 / 編輯頁不顯示 [存草稿],只能直接送出。"),
    ).toBeInTheDocument();

    await user.click(toggle);

    await waitFor(() => {
      expect(world.inputs.updateForm).toEqual([
        { key: "shopping_list", allowDraft: false },
      ]);
    });
    expect(await findSnackbarAlert()).toMatchObject({
      text: "已關閉存草稿,之後只能直接送出。",
      severity: "success",
    });
    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: "允許存草稿" }),
      ).not.toBeChecked();
    });
  });

  it("改不動的表單(abilities.canEdit false):看得到目前的設定,但不能切", async () => {
    renderFormsPage({
      ...defaultDesignOptions(),
      forms: [
        formFragment({
          allowDraft: false,
          abilities: {
            canEdit: false,
            canAssign: false,
            canSetEnabled: false,
            canFork: true,
          },
        }),
      ],
    });

    const toggle = await screen.findByRole("switch", { name: "允許存草稿" });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
  });
});
