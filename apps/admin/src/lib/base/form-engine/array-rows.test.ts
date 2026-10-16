import { describe, expect, it } from "@jest/globals";

import type { ArrayColumnDef, ArrayRowValue } from "@repo/domain/form";

import { insertRowBefore, moveRow } from "./array-rows";

const columns: ArrayColumnDef[] = [
  {
    key: "name",
    label: "品名",
    type: "text",
    widget: { kind: "textField" },
    valueSource: { kind: "input" },
  },
];

const rows = (): ArrayRowValue[] => [
  { rowId: "a", name: "蘋果" },
  { rowId: "b", name: "香蕉" },
  { rowId: "c", name: "芭樂" },
];

describe("insertRowBefore", () => {
  it("在指定列的上方插入一列空白列(新的 rowId),其餘列不動", () => {
    const next = insertRowBefore(rows(), "b", columns);

    expect(next.map((row) => row.name)).toEqual(["蘋果", null, "香蕉", "芭樂"]);
    expect(next[1]?.rowId).not.toMatch(/^[abc]$/u);
    expect(next.filter((row) => row !== next[1])).toEqual(rows());
  });

  it("找不到那一列時原樣回傳", () => {
    expect(insertRowBefore(rows(), "x", columns)).toEqual(rows());
  });
});

describe("moveRow", () => {
  it("上移 / 下移只換位置,rowId 與值不變", () => {
    expect(moveRow(rows(), "b", -1)).toEqual([
      { rowId: "b", name: "香蕉" },
      { rowId: "a", name: "蘋果" },
      { rowId: "c", name: "芭樂" },
    ]);
    expect(moveRow(rows(), "b", 1).map((row) => row.rowId)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("第一列上移、最後一列下移、找不到的列:原樣回傳", () => {
    expect(moveRow(rows(), "a", -1)).toEqual(rows());
    expect(moveRow(rows(), "c", 1)).toEqual(rows());
    expect(moveRow(rows(), "x", 1)).toEqual(rows());
  });
});
