import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { formFragment } from "@/test/msw/form-fixtures";
import { findSnackbarAlert } from "@/test/snackbar";

import {
  defaultDesignOptions,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

describe("表單管理:表單設定「作廢原因」", () => {
  it("預設不設定(自由填寫);選一個欄位管理類別 → updateForm 帶 voidReasonCategoryKey;改回不設定 → null", async () => {
    const { user, world } = renderFormsPage();

    const select = await screen.findByRole("combobox", { name: "作廢原因" });
    expect(select).toHaveTextContent("不設定(自由填寫)");

    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: /示範分類/ }));

    await waitFor(() => {
      expect(world.inputs.updateForm).toEqual([
        { key: "shopping_list", voidReasonCategoryKey: "demo-category" },
      ]);
    });
    expect(await findSnackbarAlert()).toMatchObject({
      text: "已更新作廢原因設定。",
      severity: "success",
    });
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "作廢原因" }),
      ).toHaveTextContent(/示範分類/);
    });

    await user.click(screen.getByRole("combobox", { name: "作廢原因" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "不設定(自由填寫)",
      }),
    );
    await waitFor(() => {
      expect(world.inputs.updateForm.at(-1)).toEqual({
        key: "shopping_list",
        voidReasonCategoryKey: null,
      });
    });
  });

  it("改不動的表單:看得到目前的設定(停用 / 不在清單的類別以 key 顯示),但不能改", async () => {
    renderFormsPage({
      ...defaultDesignOptions(),
      forms: [
        formFragment({
          voidReasonCategoryKey: "retired-category",
          abilities: {
            canEdit: false,
            canAssign: false,
            canSetEnabled: false,
            canFork: true,
          },
        }),
      ],
    });

    const select = await screen.findByRole("combobox", { name: "作廢原因" });
    expect(select).toHaveTextContent("retired-category");
    expect(select).toHaveAttribute("aria-disabled", "true");
  });
});
