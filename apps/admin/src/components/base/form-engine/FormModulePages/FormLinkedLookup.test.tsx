import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import type { FormDefinition } from "@repo/domain/form";

import {
  DEMO_FORM_ROUTES,
  SHOPPING_FORM_KEY,
  field,
} from "@/test/msw/form-fixtures";
import { findLatestSnackbar } from "@/test/snackbar";

import { arrayDefinition, lineRow } from "./form-array-test-support";
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

describe("連動篩選與列內帶入(《底座規格》3.2 B2c / B2d,填寫)", () => {
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
