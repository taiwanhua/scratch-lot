import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  demoCategoryFieldsAsRoot,
  genderFields,
} from "@/test/msw/field-fixtures";

import {
  findRowOf,
  optionsPanel,
  renderPage,
  selectCategory,
} from "./field-manager-test-support";

/** 根組織視角 = api 對種子列回 `canToggleEnabled: true`(前端不再自己推視角)。 */
const rootView = {
  fieldsByCategory: {
    "cat-gender": genderFields,
    "cat-demo": demoCategoryFieldsAsRoot,
  },
};

/**
 * 種子選項的唯讀規則(`docs/modules/field-manager.md`):
 * 種子只能切 `enabled`,而那是**全域**開關 —— 只有根組織切得動,租戶視角下唯讀。
 */
describe("欄位管理頁:種子選項與根組織視角", () => {
  it("非根組織視角:種子列的開關唯讀、不給編輯;自己加的選項照常可切", async () => {
    const { user: actor, fake } = renderPage();
    await selectCategory(actor, "示範分類");

    const seedRow = await findRowOf("主食");
    expect(
      within(seedRow).getByRole("switch", { name: "啟用「主食」" }),
    ).toBeDisabled();
    expect(within(seedRow).getByText("由系統管理員維護")).toBeInTheDocument();
    expect(
      within(seedRow).queryByRole("button", { name: "編輯" }),
    ).not.toBeInTheDocument();

    // 自己這一層加的:開關可切、也給編輯
    const ownSwitch = within(await findRowOf("炸物")).getByRole("switch", {
      name: "啟用「炸物」",
    });
    expect(ownSwitch).toBeEnabled();
    await actor.click(ownSwitch);

    await waitFor(() => {
      expect(fake.inputs.setFieldEnabled).toHaveLength(1);
    });
    expect(fake.inputs.setFieldEnabled[0]).toEqual({
      id: "f-fried",
      enabled: false,
    });
  });

  it("根組織視角:種子列的開關可切,送出後清單重查", async () => {
    const { user: actor, fake } = renderPage({ world: rootView });
    await selectCategory(actor, "示範分類");
    const seedSwitch = within(await findRowOf("主食")).getByRole("switch", {
      name: "啟用「主食」",
    });
    const callsBefore = fake.calls.fields;

    expect(seedSwitch).toBeEnabled();
    await actor.click(seedSwitch);

    await waitFor(() => {
      expect(fake.inputs.setFieldEnabled).toHaveLength(1);
    });
    expect(fake.inputs.setFieldEnabled[0]).toEqual({
      id: "f-staple",
      enabled: false,
    });
    await waitFor(() => {
      expect(fake.calls.fields).toBeGreaterThan(callsBefore);
    });
    await waitFor(() => {
      expect(
        within(optionsPanel()).getByRole("switch", { name: "啟用「主食」" }),
      ).not.toBeChecked();
    });
  });

  it("api 擋下種子開關時顯示原因(fail-closed 在後端)", async () => {
    const { user: actor } = renderPage({
      world: { ...rootView, failures: { SetFieldEnabled: "FORBIDDEN" } },
    });
    await selectCategory(actor, "示範分類");

    await actor.click(
      within(await findRowOf("主食")).getByRole("switch", {
        name: "啟用「主食」",
      }),
    );

    expect(
      await screen.findByText(
        "全域選項由系統管理員統一維護,你的組織不能變更它。",
      ),
    ).toBeInTheDocument();
  });

  it("編輯自己加的選項:值唯讀,只送名稱 / 排序 / 描述", async () => {
    const { user: actor, fake } = renderPage();
    await selectCategory(actor, "示範分類");

    await actor.click(
      within(await findRowOf("炸物")).getByRole("button", { name: "編輯" }),
    );

    expect(screen.getByLabelText("值(value)")).toBeDisabled();
    await actor.clear(screen.getByLabelText("選項名稱 *"));
    await actor.type(screen.getByLabelText("選項名稱 *"), "炸類");
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.updateField).toHaveLength(1);
    });
    expect(fake.inputs.updateField[0]).toEqual({
      id: "f-fried",
      label: "炸類",
      order: 4,
      description: "本組織自訂",
    });
    expect(await within(optionsPanel()).findByText("炸類")).toBeInTheDocument();
  });
});
