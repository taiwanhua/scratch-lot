import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import type { FormDefinition } from "@repo/domain/form";

import {
  DEMO_FORM_ROUTES,
  SHOPPING_FORM_KEY,
  field,
  submissionFragment,
} from "@/test/msw/form-fixtures";
import { findLatestSnackbar } from "@/test/snackbar";

import { ROW_A, arrayDefinition, lineRow } from "./form-array-test-support";
import { renderShopping, shoppingForm } from "./form-module-test-support";

const CREATE_PATH = `${DEMO_FORM_ROUTES.createPage}/shopping_list`;

/**
 * 購物單多一個表單層引用「出貨分店」;明細多一個引用子欄「本」:篩選引用出貨分店(連動篩選 B2d),
 * 選定時把來源的 `price` 帶進同一列的「單價」(列內帶入 B2c)。
 */
const linkedDefinition = (): FormDefinition => {
  const base = arrayDefinition();
  return {
    ...base,
    fields: [
      field("ship", "出貨分店", "reference", {
        widget: { kind: "referencePicker" },
        source: { provider: "org", labelField: "name" },
      }),
      ...base.fields.map((candidate) =>
        candidate.key === "lines"
          ? {
              ...candidate,
              columns: [
                {
                  key: "book",
                  label: "本",
                  type: "reference" as const,
                  widget: { kind: "referencePicker" },
                  valueSource: { kind: "input" as const },
                  source: {
                    provider: "project_book",
                    labelField: "name",
                    filter: { orgId: { var: "ship" } },
                  },
                  prefill: {
                    mapping: [{ sourceField: "price", fieldKey: "price" }],
                  },
                },
                ...(candidate.columns ?? []),
              ],
            }
          : candidate,
      ),
    ],
    layout: {
      sections: base.layout.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              rows: [
                { cols: [{ fieldKey: "ship", span: 12 }] },
                ...section.rows,
              ],
            }
          : section,
      ),
    },
  };
};

const LOOKUP_RECORDS = [
  { id: "org-a", value: "org-a", label: "A 店", values: {} },
  { id: "org-b", value: "org-b", label: "B 店", values: {} },
  { id: "book-1", value: "book-1", label: "本一", values: { price: 30 } },
];

const renderLinked = () =>
  renderShopping({
    path: CREATE_PATH,
    world: {
      moduleForms: [shoppingForm],
      versions: { [`${SHOPPING_FORM_KEY}@1`]: linkedDefinition() },
      lookupRecords: LOOKUP_RECORDS,
    },
  });

const pick = async (
  user: ReturnType<typeof renderLinked>["user"],
  combobox: HTMLElement,
  label: string,
) => {
  await user.click(combobox);
  await user.click(await screen.findByRole("option", { name: label }));
};

describe("連動篩選與列內帶入(填寫)", () => {
  it("出貨分店沒填 → 明細的「本」停用並提示先填;填了才查,查詢一併送出貨分店的值", async () => {
    const { user, world } = renderLinked();
    await user.click(await screen.findByRole("button", { name: "+ 新增一列" }));
    const book = within(lineRow(0)).getByRole("combobox", { name: "本" });
    expect(book).toBeDisabled();
    expect(within(lineRow(0)).getByText("請先填「出貨分店」")).toBeVisible();

    await pick(
      user,
      screen.getByRole("combobox", { name: "出貨分店" }),
      "A 店",
    );
    await waitFor(() => {
      expect(
        within(lineRow(0)).getByRole("combobox", { name: "本" }),
      ).toBeEnabled();
    });
    await user.click(within(lineRow(0)).getByRole("combobox", { name: "本" }));
    await screen.findByRole("option", { name: "本一" });
    expect(world.inputs.formLookup).toContainEqual(
      expect.objectContaining({
        target: { fieldKey: "lines.book" },
        filterValues: { ship: "org-a" },
      }),
    );
  });

  it("選定「本」→ 同列的單價被帶入(覆蓋);之後手動改,送出保留手動值", async () => {
    const { user, world } = renderLinked();
    await user.type(
      await screen.findByRole("textbox", { name: "品項" }),
      "調貨",
    );
    await pick(
      user,
      screen.getByRole("combobox", { name: "出貨分店" }),
      "A 店",
    );
    await user.click(screen.getByRole("button", { name: "+ 新增一列" }));
    const row = within(lineRow(0));
    await user.type(row.getByRole("textbox", { name: "品名" }), "週刊");
    const price = row.getByRole("textbox", { name: "單價" });
    await user.type(price, "99");
    await pick(user, row.getByRole("combobox", { name: "本" }), "本一");
    // 改選會覆蓋同列目標
    await waitFor(() => {
      expect(row.getByRole("textbox", { name: "單價" })).toHaveValue("30");
    });
    await user.clear(row.getByRole("textbox", { name: "單價" }));
    await user.type(row.getByRole("textbox", { name: "單價" }), "35");

    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(world.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const lines = world.inputs.createAndSubmitFormSubmission[0]?.values
      ?.lines as Record<string, unknown>[];
    expect(lines[0]?.book).toEqual({ id: "book-1", label: "本一" });
    expect(lines[0]?.price).toBe("35");
  });

  it("出貨分店改值 → 清空所有列依賴它的「本」並提示列數", async () => {
    const { user } = renderLinked();
    await pick(
      user,
      await screen.findByRole("combobox", { name: "出貨分店" }),
      "A 店",
    );
    await user.click(screen.getByRole("button", { name: "+ 新增一列" }));
    await user.click(screen.getByRole("button", { name: "+ 新增一列" }));
    for (const index of [0, 1]) {
      await pick(
        user,
        within(lineRow(index)).getByRole("combobox", { name: "本" }),
        "本一",
      );
    }
    expect(
      within(lineRow(1)).getByRole("combobox", { name: "本" }),
    ).toHaveValue("本一");

    await pick(
      user,
      screen.getByRole("combobox", { name: "出貨分店" }),
      "B 店",
    );
    const notice = await findLatestSnackbar();
    expect(notice).toHaveTextContent("已清空 2 列的「本」");
    for (const index of [0, 1]) {
      expect(
        within(lineRow(index)).getByRole("combobox", { name: "本" }),
      ).toHaveValue("");
    }
  });
});

/** 另加「分店代碼」(文字)與表單層引用「主本」(篩選引用分店代碼),以及一條帶入規則把來源的 name 帶進分店代碼。 */
const prefillDefinition = (): FormDefinition => {
  const base = linkedDefinition();
  return {
    ...base,
    fields: [
      field("store_code", "分店代碼", "text"),
      field("main_book", "主本", "reference", {
        widget: { kind: "referencePicker" },
        source: {
          provider: "project_book",
          labelField: "name",
          filter: { code: { var: "store_code" } },
        },
      }),
      ...base.fields,
    ],
    layout: {
      sections: base.layout.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              rows: [
                {
                  cols: [
                    { fieldKey: "store_code", span: 6 },
                    { fieldKey: "main_book", span: 6 },
                  ],
                },
                ...section.rows,
              ],
            }
          : section,
      ),
    },
    prefills: [
      {
        label: "從使用者帶入",
        source: { provider: "user", labelField: "name" },
        mapping: [{ sourceField: "name", fieldKey: "store_code" }],
      },
    ],
  };
};

describe("連動篩選:值變動的其他入口與既有單據", () => {
  it("帶入規則改了被引用欄位 → 也清空依賴它的引用欄並提示", async () => {
    const { user } = renderShopping({
      path: CREATE_PATH,
      world: {
        moduleForms: [shoppingForm],
        versions: { [`${SHOPPING_FORM_KEY}@1`]: prefillDefinition() },
        lookupRecords: [
          ...LOOKUP_RECORDS,
          {
            id: "user-9",
            value: "user-9",
            label: "阿明",
            values: { name: "B2" },
          },
        ],
      },
    });
    await user.type(
      await screen.findByRole("textbox", { name: "分店代碼" }),
      "A1",
    );
    await pick(user, screen.getByRole("combobox", { name: "主本" }), "本一");
    expect(screen.getByRole("combobox", { name: "主本" })).toHaveValue("本一");

    await user.click(screen.getByRole("button", { name: "帶入資料" }));
    const dialog = await screen.findByRole("dialog", { name: "帶入資料" });
    await user.click(await within(dialog).findByText("阿明"));
    await user.click(within(dialog).getByRole("button", { name: "帶入" }));

    expect(
      await screen.findByRole("textbox", { name: "分店代碼" }),
    ).toHaveValue("B2");
    const notice = await findLatestSnackbar();
    expect(notice).toHaveTextContent("已清空「主本」");
    expect(screen.getByRole("combobox", { name: "主本" })).toHaveValue("");
  });

  it("編輯既有單據打開時不清空依賴欄(只在改值時清)", async () => {
    renderShopping({
      path: `${DEMO_FORM_ROUTES.editPage}/sub-1`,
      world: {
        moduleForms: [shoppingForm],
        versions: { [`${SHOPPING_FORM_KEY}@1`]: linkedDefinition() },
        lookupRecords: LOOKUP_RECORDS,
        submissions: [
          submissionFragment({
            values: {
              ship: { id: "org-a", label: "A 店" },
              item: "調貨",
              lines: [
                {
                  rowId: ROW_A,
                  book: { id: "book-1", label: "本一" },
                  name: "週刊",
                  qty: "1",
                  price: "30",
                  subtotal: "30",
                },
              ],
              total: "30",
            },
            abilities: {
              canEdit: true,
              canSaveDraft: true,
              canDelete: true,
              canEditField: ["ship", "item", "lines"],
              canWithdraw: false,
              canVoid: false,
              canCopy: false,
            },
          }),
        ],
      },
    });
    await screen.findByRole("table", { name: "明細" });
    expect(
      within(lineRow(0)).getByRole("combobox", { name: "本" }),
    ).toHaveValue("本一");
    expect(screen.getByRole("combobox", { name: "出貨分店" })).toHaveValue(
      "A 店",
    );
  });
});
