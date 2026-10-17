import { describe, expect, it } from "@jest/globals";

import { sectionCollapseOf } from "./layout";

const rows = [{ cols: [{ fieldKey: "title", span: 12 }] }];

describe("sectionCollapseOf:分區的收合設定補預設值", () => {
  it("舊定義沒有三個新欄位 → 不可收合、展開、不顯示摘要", () => {
    expect(
      sectionCollapseOf({ key: "basic", title: "基本資料", rows }),
    ).toEqual({
      collapsible: false,
      defaultCollapsed: false,
      summaryFieldKeys: [],
    });
  });

  it("可以收合時照設定", () => {
    expect(
      sectionCollapseOf({
        key: "basic",
        title: "基本資料",
        rows,
        collapsible: true,
        defaultCollapsed: true,
        summaryFieldKeys: ["title"],
      }),
    ).toEqual({
      collapsible: true,
      defaultCollapsed: true,
      summaryFieldKeys: ["title"],
    });
  });

  it("不可收合時,預設收合與摘要欄位一律不生效", () => {
    expect(
      sectionCollapseOf({
        key: "basic",
        title: "基本資料",
        rows,
        collapsible: false,
        defaultCollapsed: true,
        summaryFieldKeys: ["title"],
      }),
    ).toEqual({
      collapsible: false,
      defaultCollapsed: false,
      summaryFieldKeys: [],
    });
  });
});
