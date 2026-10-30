import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import type { FormDefinition } from "@repo/domain/form";

import {
  SHOPPING_FORM_KEY,
  field,
  versionFragment,
} from "@/test/msw/form-fixtures";
import { BASE_LOOKUP_PROVIDERS } from "@/test/msw/lookup-provider-fixtures";

import {
  addField,
  defaultDesignOptions,
  findDesigner,
  openSelect,
  pickOption,
  preloadFormsPage,
  renderFormsPage,
  selectField,
} from "./forms-page-test-support";

preloadFormsPage();

/** 小草稿:一個文字欄、一個靜態選項的單選、一個引用(屬性面板的預設值分支各一)。 */
const defaultsDraft = (): FormDefinition => ({
  fields: [
    field("item", "品項", "text"),
    field("kind", "假別", "select", {
      widget: { kind: "dropdown" },
      options: {
        kind: "static",
        items: [
          { value: "sick", label: "病假", order: 1, enabled: true },
          { value: "annual", label: "特休", order: 2, enabled: true },
        ],
      },
    }),
    field("who", "申請人", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "user", labelField: "name" },
    }),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "基本",
        rows: [
          { cols: [{ fieldKey: "item", span: 12 }] },
          { cols: [{ fieldKey: "kind", span: 12 }] },
          { cols: [{ fieldKey: "who", span: 12 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "item" },
  prefills: [],
});

const renderDefaults = () => {
  const options = defaultDesignOptions();
  return renderFormsPage({
    ...options,
    versions: {
      [SHOPPING_FORM_KEY]: [
        versionFragment(defaultsDraft(), { baseVersion: 1 }),
        ...(options.versions?.[SHOPPING_FORM_KEY] ?? []).slice(1),
      ],
    },
  });
};

const savedFields = async (
  user: ReturnType<typeof renderFormsPage>["user"],
  world: ReturnType<typeof renderFormsPage>["world"],
) => {
  await user.click(screen.getByRole("button", { name: "存草稿" }));
  await waitFor(() => {
    expect(world.inputs.saveFormVersionDraft).toHaveLength(1);
  });
  return world.inputs.saveFormVersionDraft.at(0)?.fields ?? [];
};

describe("表單管理:預設值、上傳上限、刪除草稿", () => {
  // 分成三案:全套並行時設計器頁的單一案例接近 15 秒上限(TEST-08)
  it("文字欄的預設值:不設 / 固定值 / 公式,固定值存進 default", async () => {
    const { user, world } = renderDefaults();
    await findDesigner();
    await selectField(user, "品項", "item");
    expect(await openSelect(user, "預設值")).toEqual([
      "不設",
      "固定值",
      "公式",
    ]);
    await user.click(screen.getByRole("option", { name: "固定值" }));
    await user.type(
      await screen.findByRole("textbox", { name: "預設的值" }),
      "牛奶",
    );

    const fields = await savedFields(user, world);
    expect(fields.find((item) => item.key === "item")).toMatchObject({
      default: { kind: "constant", value: "牛奶" },
    });
  });

  it("單選的預設值從選項挑(靜態清單)", async () => {
    const { user, world } = renderDefaults();
    await findDesigner();
    await selectField(user, "假別", "kind");
    expect(await openSelect(user, "預設值")).toEqual(["不設", "病假", "特休"]);
    await user.click(screen.getByRole("option", { name: "特休" }));

    const fields = await savedFields(user, world);
    expect(fields.find((item) => item.key === "kind")).toMatchObject({
      default: { kind: "constant", value: "annual" },
    });
  });

  it("引用欄的預設值只列系統值(填寫者 / 填寫者的組織)", async () => {
    const { user, world } = renderDefaults();
    await findDesigner();
    await selectField(user, "申請人", "who");
    expect(await openSelect(user, "預設值")).toEqual([
      "不設",
      "填寫者",
      "填寫者的組織",
    ]);
    await user.click(screen.getByRole("option", { name: "填寫者" }));

    const fields = await savedFields(user, world);
    expect(fields.find((item) => item.key === "who")).toMatchObject({
      default: { kind: "expression", expr: { var: "ctx.user.id" } },
    });
  });

  it("引用欄的來源有提供預設值:多一個「來源提供的預設」,條件選「篩選欄位 = 表單上的哪一欄」", async () => {
    const options = defaultDesignOptions();
    const draft = defaultsDraft();
    const { user, world } = renderFormsPage({
      ...options,
      lookupProviders: [
        ...BASE_LOOKUP_PROVIDERS,
        {
          key: "project_slot",
          name: "時段",
          isBase: false,
          operatorDefault: true,
          labelField: "name",
          valueField: "id",
          filterFields: ["orgId"],
          fields: [{ key: "name", type: "text", label: "名稱" }],
        },
      ],
      versions: {
        [SHOPPING_FORM_KEY]: [
          versionFragment(
            {
              ...draft,
              fields: [
                ...draft.fields,
                field("site", "站點", "reference", {
                  widget: { kind: "referencePicker" },
                  source: { provider: "org", labelField: "name" },
                }),
                field("slot", "時段", "reference", {
                  widget: { kind: "referencePicker" },
                  source: { provider: "project_slot", labelField: "name" },
                }),
              ],
              layout: {
                sections: [
                  {
                    key: "basic",
                    title: "基本",
                    rows: [
                      ...(draft.layout.sections[0]?.rows ?? []),
                      { cols: [{ fieldKey: "site", span: 12 }] },
                      { cols: [{ fieldKey: "slot", span: 12 }] },
                    ],
                  },
                ],
              },
            },
            { baseVersion: 1 },
          ),
          ...(options.versions?.[SHOPPING_FORM_KEY] ?? []).slice(1),
        ],
      },
    });
    await findDesigner();
    await selectField(user, "時段", "slot");
    expect(await openSelect(user, "預設值")).toEqual([
      "不設",
      "填寫者",
      "填寫者的組織",
      "來源提供的預設",
    ]);
    await user.click(screen.getByRole("option", { name: "來源提供的預設" }));
    const conditions = await screen.findByRole("group", {
      name: "預設值的條件(選填)",
    });
    await pickOption(user, "orgId 等於", "站點(site)", conditions);

    const fields = await savedFields(user, world);
    expect(fields.find((item) => item.key === "slot")).toMatchObject({
      default: { kind: "provider", filter: { orgId: { var: "site" } } },
    });
  });

  it("多選的預設值從靜態選項挑多個", async () => {
    const options = defaultDesignOptions();
    const draft = defaultsDraft();
    const { user, world } = renderFormsPage({
      ...options,
      versions: {
        [SHOPPING_FORM_KEY]: [
          versionFragment(
            {
              ...draft,
              fields: [
                ...draft.fields,
                field("tags", "標籤", "multiSelect", {
                  widget: { kind: "checkboxGroup" },
                  options: {
                    kind: "static",
                    items: [
                      { value: "a", label: "甲", order: 1, enabled: true },
                      { value: "b", label: "乙", order: 2, enabled: true },
                      { value: "c", label: "丙", order: 3, enabled: true },
                    ],
                  },
                }),
              ],
              layout: {
                sections: draft.layout.sections.map((section) => ({
                  ...section,
                  rows: [
                    ...section.rows,
                    { cols: [{ fieldKey: "tags", span: 12 }] },
                  ],
                })),
              },
            },
            { baseVersion: 1 },
          ),
          ...(options.versions?.[SHOPPING_FORM_KEY] ?? []).slice(1),
        ],
      },
    });
    await findDesigner();
    await selectField(user, "標籤", "tags");
    expect(await openSelect(user, "預設值")).toEqual(["甲", "乙", "丙"]);
    await user.click(screen.getByRole("option", { name: "甲" }));
    await user.click(screen.getByRole("option", { name: "丙" }));
    await user.keyboard("{Escape}");

    const fields = await savedFields(user, world);
    expect(fields.find((item) => item.key === "tags")).toMatchObject({
      default: { kind: "constant", value: ["a", "c"] },
    });
  });

  it("類別選項的預設值用填寫時的選擇器挑(選項以草稿查)", async () => {
    const options = defaultDesignOptions();
    const draft = defaultsDraft();
    const { user, world } = renderFormsPage(
      {
        ...options,
        versions: {
          [SHOPPING_FORM_KEY]: [
            versionFragment(
              {
                ...draft,
                fields: draft.fields.map((item) =>
                  item.key === "kind"
                    ? {
                        ...item,
                        options: { kind: "fieldCategory", key: "leave-type" },
                      }
                    : item,
                ),
              },
              { baseVersion: 1 },
            ),
            ...(options.versions?.[SHOPPING_FORM_KEY] ?? []).slice(1),
          ],
        },
      },
      undefined,
      {
        fieldOptions: {
          kind: [
            { value: "sick", label: "病假" },
            { value: "annual", label: "特休" },
          ],
        },
      },
    );
    await findDesigner();
    await selectField(user, "假別", "kind");
    await pickOption(user, "預設值", "特休");

    const fields = await savedFields(user, world);
    expect(fields.find((item) => item.key === "kind")).toMatchObject({
      default: {
        kind: "constant",
        value: expect.objectContaining({ value: "annual" }),
      },
    });
  });

  it("值來源改成固定值:預設值區塊消失、定義裡的預設值一併拿掉", async () => {
    const { user, world } = renderDefaults();
    await findDesigner();
    await selectField(user, "品項", "item");
    await pickOption(user, "預設值", "固定值");
    await user.type(
      await screen.findByRole("textbox", { name: "預設的值" }),
      "牛奶",
    );
    await pickOption(user, "值的來源", "固定值");
    expect(screen.queryByRole("combobox", { name: "預設值" })).toBeNull();

    const fields = await savedFields(user, world);
    expect(fields.find((item) => item.key === "item")?.default).toBeNull();
  });

  it("上傳欄的檔型 / 大小上限存進 rules.accept / maxSizeMb", async () => {
    const { user, world } = renderDefaults();
    await addField(user, "上傳");
    // 預設全勾(= 平台允許的全部);取消 PNG
    await pickOption(user, "允許的檔型", "PNG 圖片");
    await user.keyboard("{Escape}");
    await user.type(
      screen.getByRole("spinbutton", { name: "大小上限(MB)" }),
      "5",
    );

    const fields = await savedFields(user, world);
    const rules = fields.at(-1)?.rules as
      { accept?: string[]; maxSizeMb?: number } | undefined;
    expect(rules?.maxSizeMb).toBe(5);
    expect(rules?.accept).toContain("application/pdf");
    expect(rules?.accept).not.toContain("image/png");
  });

  it("版本面板「刪除草稿」:確認後帶讀到的 draftRevision 刪掉,清單不再有草稿", async () => {
    const { user, world } = renderDefaults();
    await user.click(await screen.findByRole("tab", { name: "表單版本" }));
    const table = await screen.findByRole("table", { name: "版本清單" });
    await user.click(
      await within(table).findByRole("button", { name: "刪除草稿" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "刪除草稿?" });
    await user.click(within(dialog).getByRole("button", { name: "刪除" }));

    await waitFor(() => {
      expect(world.inputs.deleteFormVersionDraft).toEqual([
        { formKey: SHOPPING_FORM_KEY, expectedDraftRevision: 1 },
      ]);
    });
    await waitFor(() => {
      expect(
        within(table).queryByRole("button", { name: "刪除草稿" }),
      ).toBeNull();
    });
  });
});
