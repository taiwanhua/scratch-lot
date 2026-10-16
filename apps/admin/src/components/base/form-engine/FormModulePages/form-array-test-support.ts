import { afterEach, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import type { ArrayColumnDef, FormDefinition } from "@repo/domain/form";

import {
  SHOPPING_FORM_KEY,
  field,
  submissionFragment,
} from "@/test/msw/form-fixtures";

import { shoppingForm } from "./form-module-test-support";

/**
 * 明細列(`array`)畫面測試的共用夾具(TEST-08):購物單換成「品項 + 明細(品名 / 數量 / 單價 / 小計)+ 總價」,
 * 明細最多 2 列、小計是列內公式、總價是 `sumOf(明細, 小計)`。
 */
export const ROW_A = "00000000-0000-4000-8000-00000000000a";
export const ROW_B = "00000000-0000-4000-8000-00000000000b";

const numberColumn = (
  key: string,
  label: string,
  overrides: Partial<ArrayColumnDef> = {},
): ArrayColumnDef => ({
  key,
  label,
  type: "number",
  precision: 0,
  widget: { kind: "number" },
  valueSource: { kind: "input" },
  ...overrides,
});

export const arrayDefinition = (): FormDefinition => ({
  fields: [
    field("item", "品項", "text", { rules: { required: true } }),
    field("lines", "明細", "array", {
      widget: { kind: "table" },
      rules: { required: false, maxRows: 2 },
      columns: [
        {
          key: "name",
          label: "品名",
          type: "text",
          widget: { kind: "textField" },
          valueSource: { kind: "input" },
          rules: { required: true },
        },
        numberColumn("qty", "數量"),
        numberColumn("price", "單價"),
        numberColumn("subtotal", "小計", {
          valueSource: {
            kind: "computed",
            expr: { "*": [{ var: "row.qty" }, { var: "row.price" }] },
          },
        }),
      ],
    }),
    field("total", "總價", "number", {
      precision: 0,
      widget: { kind: "number" },
      valueSource: { kind: "computed", expr: { sumOf: ["lines", "subtotal"] } },
    }),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "採購內容",
        rows: [
          { cols: [{ fieldKey: "item", span: 12 }] },
          { cols: [{ fieldKey: "lines", span: 12 }] },
          { cols: [{ fieldKey: "total", span: 6 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "item", date: null, amount: "total" },
  prefills: [],
});

export const arrayRuntimeOptions = () => ({
  moduleForms: [shoppingForm],
  versions: { [`${SHOPPING_FORM_KEY}@1`]: arrayDefinition() },
});

/**
 * 同 `arrayDefinition`,另加「不附明細」勾選框:勾了明細就被顯示條件隱藏(總價應當成空明細算)。
 */
export const hideableArrayDefinition = (): FormDefinition => {
  const base = arrayDefinition();
  return {
    ...base,
    fields: [
      field("skip_lines", "不附明細", "boolean", {
        widget: { kind: "checkbox" },
      }),
      ...base.fields.map((candidate) =>
        candidate.key === "lines"
          ? { ...candidate, visibleWhen: { "!": [{ var: "skip_lines" }] } }
          : candidate,
      ),
    ],
    layout: {
      sections: base.layout.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              rows: [
                { cols: [{ fieldKey: "skip_lines", span: 12 }] },
                ...section.rows,
              ],
            }
          : section,
      ),
    },
  };
};

export const hideableArrayRuntimeOptions = () => ({
  moduleForms: [shoppingForm],
  versions: { [`${SHOPPING_FORM_KEY}@1`]: hideableArrayDefinition() },
});

/** 已完成的一筆:兩列明細。 */
export const arraySubmission = () =>
  submissionFragment({
    values: {
      item: "採買",
      lines: [
        { rowId: ROW_A, name: "蘋果", qty: "2", price: "30", subtotal: "60" },
        { rowId: ROW_B, name: "香蕉", qty: "1", price: "15", subtotal: "15" },
      ],
      total: "75",
    },
    abilities: {
      canEdit: true,
      canDelete: true,
      canEditField: ["item", "lines"],
      canWithdraw: false,
      canVoid: false,
      canCopy: false,
    },
  });

/** 明細的表格(桌機畫法)。 */
export const linesTable = () => screen.getByRole("table", { name: "明細" });

/** 表格第 `index` 列(0 起算,不含表頭)。 */
export const lineRow = (index: number) =>
  within(linesTable()).getAllByRole("row")[index + 1];

/**
 * 模擬手機寬(< sm):`matchMedia` 替身讓 `max-width` 查詢成立;測試結束還原(jsdom 本來沒有 `matchMedia`)。
 */
export const restoreViewportAfterEach = (): void => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "matchMedia");
  });
};

export const setMobileViewport = (): void => {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: () => false,
    }),
  });
};
