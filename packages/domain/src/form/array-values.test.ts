import { describe, expect, it } from "@jest/globals";

import { arrayRowChanges } from "./array-diff";
import {
  arrayField,
  column,
  computedColumn,
  rowIdOf,
} from "./array-test-support";
import { CTX } from "./form-test-support";
import { semanticValuesOf } from "./semantic";
import type { StoredValues } from "./types";
import { normalizeFieldValue, validateArrayRules } from "./values";

const qty = column("qty", "number", { rules: { required: true, min: 1 } });
const note = column("note", "text");
const subtotal = computedColumn("subtotal", { "*": [{ var: "row.qty" }, 2] });
const items = arrayField("items", [qty, note, subtotal]);

function rulesOf(value: unknown, overrides: Partial<typeof items> = {}) {
  const field = { ...items, ...overrides };
  const stored: StoredValues = { items: value };
  return validateArrayRules(field, value, {
    semantic: semanticValuesOf([field], stored),
    ctx: CTX,
    fields: [field],
    stored,
  });
}

describe("明細列:值正規化", () => {
  it("子欄照型別正規化、定義外的鍵丟掉、列內公式子欄不收送來的值", () => {
    const result = normalizeFieldValue(items, [
      { rowId: rowIdOf(1), qty: 3, note: "a", subtotal: "999", extra: 1 },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [{ rowId: rowIdOf(1), qty: "3", note: "a", subtotal: null }],
    });
  });

  it("rowId 重複 → ARRAY_ROW_ID_INVALID", () => {
    const result = normalizeFieldValue(items, [
      { rowId: rowIdOf(1) },
      { rowId: rowIdOf(1) },
    ]);
    expect(result).toMatchObject({
      ok: false,
      issue: { fieldKey: "items", code: "ARRAY_ROW_ID_INVALID" },
    });
  });

  it("rowId 不是 UUID → ARRAY_ROW_ID_INVALID", () => {
    const result = normalizeFieldValue(items, [{ rowId: "row-1" }]);
    expect(result).toMatchObject({
      ok: false,
      issue: { code: "ARRAY_ROW_ID_INVALID" },
    });
  });

  it("子欄型別不對 → 錯誤定位到明細 key + rowId + 子欄 key", () => {
    const result = normalizeFieldValue(items, [
      { rowId: rowIdOf(7), qty: "很多" },
    ]);
    expect(result).toMatchObject({
      ok: false,
      issue: {
        fieldKey: "items",
        rowId: rowIdOf(7),
        columnKey: "qty",
        code: "TYPE_INVALID",
      },
    });
  });

  it("引用子欄收 `{ id, label }` 或 id 字串,存 `{ id, label }`;語意值是 id", () => {
    const refs = arrayField("lines", [
      column("store", "reference", {
        source: { provider: "user", labelField: "name" },
      }),
    ]);
    const result = normalizeFieldValue(refs, [
      { rowId: rowIdOf(1), store: { id: "u1", label: "甲店" } },
      { rowId: rowIdOf(2), store: "u2" },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { rowId: rowIdOf(1), store: { id: "u1", label: "甲店" } },
        { rowId: rowIdOf(2), store: { id: "u2", label: null } },
      ],
    });
    expect(
      semanticValuesOf([refs], { lines: result.ok ? result.value : null }),
    ).toEqual({
      lines: [
        { rowId: rowIdOf(1), store: "u1" },
        { rowId: rowIdOf(2), store: "u2" },
      ],
    });
    expect(
      normalizeFieldValue(refs, [{ rowId: rowIdOf(3), store: 42 }]),
    ).toMatchObject({
      ok: false,
      issue: { rowId: rowIdOf(3), columnKey: "store", code: "TYPE_INVALID" },
    });
  });

  it("空陣列收成 null", () => {
    expect(normalizeFieldValue(items, [])).toEqual({ ok: true, value: null });
  });
});

describe("明細列:列數與每格規則", () => {
  it("必填 = 至少一列", () => {
    expect(rulesOf(null, { rules: { required: true } })).toEqual([
      expect.objectContaining({ fieldKey: "items", code: "REQUIRED" }),
    ]);
  });

  it("空白列也算一列(必填看列存在,不看格有沒有值)", () => {
    const issues = rulesOf([{ rowId: rowIdOf(1), qty: "1" }], {
      rules: { required: true },
    });
    expect(issues.filter((issue) => issue.rowId === undefined)).toEqual([]);
  });

  it("列數不足 minRows → MIN_ROWS(表尾,只有 fieldKey)", () => {
    const issues = rulesOf([{ rowId: rowIdOf(1), qty: "1" }], {
      rules: { minRows: 2 },
    });
    expect(issues.map((issue) => [issue.code, issue.rowId])).toEqual([
      ["MIN_ROWS", undefined],
    ]);
  });

  it("列數超過 maxRows → MAX_ROWS", () => {
    const issues = rulesOf(
      [
        { rowId: rowIdOf(1), qty: "1" },
        { rowId: rowIdOf(2), qty: "1" },
      ],
      { rules: { maxRows: 1 } },
    );
    expect(issues.map((issue) => issue.code)).toEqual(["MAX_ROWS"]);
  });

  it("每格獨立錯誤:定位 rowId + 子欄 key", () => {
    const issues = rulesOf([
      { rowId: rowIdOf(1), qty: "0" },
      { rowId: rowIdOf(2), qty: null },
    ]);
    expect(
      issues.map((issue) => [issue.rowId, issue.columnKey, issue.code]),
    ).toEqual([
      [rowIdOf(1), "qty", "MIN"],
      [rowIdOf(2), "qty", "REQUIRED"],
    ]);
  });
});

describe("明細列:以 rowId 對列的修訂差異", () => {
  const before = [
    { rowId: rowIdOf(1), qty: "1", note: "a" },
    { rowId: rowIdOf(2), qty: "2", note: "b" },
    { rowId: rowIdOf(3), qty: "3", note: "c" },
  ];

  it("新增的列", () => {
    const after = [...before, { rowId: rowIdOf(4), qty: "4", note: "d" }];
    expect(arrayRowChanges(items, before, after)).toEqual([
      expect.objectContaining({ rowId: rowIdOf(4), kind: "added" }),
    ]);
  });

  it("刪除的列", () => {
    expect(arrayRowChanges(items, before, before.slice(0, 2))).toEqual([
      expect.objectContaining({ rowId: rowIdOf(3), kind: "removed" }),
    ]);
  });

  it("移動的列:兩列互換時標其中一列", () => {
    const after = [before[1], before[0], before[2]];
    expect(
      arrayRowChanges(items, before, after).map((change) => [
        change.rowId,
        change.isMoved,
      ]),
    ).toEqual([[rowIdOf(2), true]]);
  });

  it("移動的列:[a, b, c] → [c, a, b] 只有 c 是移動", () => {
    const after = [before[2], before[0], before[1]];
    expect(
      arrayRowChanges(items, before, after).map((change) => [
        change.rowId,
        change.isMoved,
      ]),
    ).toEqual([[rowIdOf(3), true]]);
  });

  it("改值的格(數字比數值)", () => {
    const after = [
      { ...before[0], qty: "1.0" },
      { ...before[1], note: "改" },
      before[2],
    ];
    expect(arrayRowChanges(items, before, after)).toEqual([
      expect.objectContaining({
        rowId: rowIdOf(2),
        kind: "kept",
        isMoved: false,
        changedColumns: ["note"],
      }),
    ]);
  });

  it("引用子欄:只在 id 變時列為改值(label 快照不同不算)", () => {
    const refs = arrayField("lines", [
      column("store", "reference", {
        source: { provider: "user", labelField: "name" },
      }),
    ]);
    const previous = [
      { rowId: rowIdOf(1), store: { id: "u1", label: "甲店" } },
      { rowId: rowIdOf(2), store: { id: "u2", label: "乙店" } },
    ];
    const next = [
      { rowId: rowIdOf(1), store: { id: "u1", label: "甲店(改名)" } },
      { rowId: rowIdOf(2), store: { id: "u3", label: "乙店" } },
    ];
    expect(arrayRowChanges(refs, previous, next)).toEqual([
      expect.objectContaining({
        rowId: rowIdOf(2),
        kind: "kept",
        changedColumns: ["store"],
      }),
    ]);
  });
});
