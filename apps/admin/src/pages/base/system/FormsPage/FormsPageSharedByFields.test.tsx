import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import type { FormDefinition } from "@repo/domain/form";
import { FormVersionStatus } from "@repo/graphql";

import {
  SHOPPING_FORM_KEY,
  field,
  formFragment,
  shoppingDefinition,
  versionFragment,
} from "@/test/msw/form-fixtures";
import { findSnackbarAlert } from "@/test/snackbar";

import { preloadFormsPage, renderFormsPage } from "./forms-page-test-support";

preloadFormsPage();

/** 購物單加兩個組織引用欄(進貨分店、收貨分店)與一個使用者引用欄(不能選)。 */
const withOrgFields = (): FormDefinition => {
  const base = shoppingDefinition();
  const org = (key: string, label: string) =>
    field(key, label, "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "org", labelField: "name" },
    });
  return {
    ...base,
    fields: [
      ...base.fields,
      org("branch", "進貨分店"),
      org("to_branch", "收貨分店"),
      field("owner", "負責人", "reference", {
        widget: { kind: "referencePicker" },
        source: { provider: "user", labelField: "name" },
      }),
    ],
    layout: {
      sections: [
        ...base.layout.sections,
        {
          key: "branches",
          title: "分店",
          rows: [
            {
              cols: [
                { fieldKey: "branch", span: 6 },
                { fieldKey: "to_branch", span: 6 },
              ],
            },
            { cols: [{ fieldKey: "owner", span: 12 }] },
          ],
        },
      ],
    },
  };
};

const optionsWith = (overrides: Parameters<typeof formFragment>[0] = {}) => ({
  forms: [formFragment(overrides)],
  versions: {
    [SHOPPING_FORM_KEY]: [
      versionFragment(withOrgFields(), {
        id: `ver-${SHOPPING_FORM_KEY}-1`,
        version: 1,
        status: FormVersionStatus.Published,
        changelog: "第一版",
        publishedAt: "2026-09-20T08:00:00.000Z",
      }),
    ],
  },
});

describe("表單管理:表單設定「依欄位共用」", () => {
  it("列出目前發布版的組織欄位(使用者引用欄不列);勾選 → updateForm 帶 sharedByFieldKeys;取消 → 移掉", async () => {
    const { user, world } = renderFormsPage(optionsWith());

    const branch = await screen.findByRole("checkbox", { name: "進貨分店" });
    expect(
      screen.getByRole("checkbox", { name: "收貨分店" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("checkbox", { name: "負責人" }),
    ).not.toBeInTheDocument();
    expect(branch).not.toBeChecked();

    await user.click(branch);
    await waitFor(() => {
      expect(world.inputs.updateForm).toEqual([
        { key: "shopping_list", sharedByFieldKeys: ["branch"] },
      ]);
    });
    expect(await findSnackbarAlert()).toMatchObject({
      text: "已更新依欄位共用設定。",
      severity: "success",
    });
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "進貨分店" })).toBeChecked();
    });

    await user.click(screen.getByRole("checkbox", { name: "收貨分店" }));
    await waitFor(() => {
      expect(world.inputs.updateForm.at(-1)).toEqual({
        key: "shopping_list",
        sharedByFieldKeys: ["branch", "to_branch"],
      });
    });
    await user.click(screen.getByRole("checkbox", { name: "進貨分店" }));
    await waitFor(() => {
      expect(world.inputs.updateForm.at(-1)).toEqual({
        key: "shopping_list",
        sharedByFieldKeys: ["to_branch"],
      });
    });
  });

  it("改不動的表單:看得到目前的設定(這一版沒有的欄位以 key 列出),但不能勾", async () => {
    renderFormsPage(
      optionsWith({
        sharedByFieldKeys: ["branch", "old_branch"],
        abilities: {
          canEdit: false,
          canAssign: false,
          canSetEnabled: false,
          canFork: true,
        },
      }),
    );

    const branch = await screen.findByRole("checkbox", { name: "進貨分店" });
    expect(branch).toBeChecked();
    expect(branch).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "old_branch" })).toBeChecked();
  });

  it("表單沒有組織欄位、也沒設定:不顯示這個設定", async () => {
    renderFormsPage();

    await screen.findByRole("combobox", { name: "作廢原因" });
    expect(screen.queryByText("依欄位共用")).not.toBeInTheDocument();
  });
});
