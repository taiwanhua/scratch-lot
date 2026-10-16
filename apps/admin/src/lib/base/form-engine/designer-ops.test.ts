import { describe, expect, it } from "@jest/globals";

import type { FormDefinition } from "@repo/domain/form";

import { field } from "@/test/msw/form-fixtures";

import { toDesignDefinition, toFormDefinition } from "./design-definition";
import {
  fieldKeyProblemOf,
  removeField,
  unplacedFields,
  updateField,
} from "./designer-ops";

/** 舊草稿:兩個欄位都叫 `qty`(改 key 到一半存下來的那種)。 */
const duplicated = (): FormDefinition => ({
  fields: [
    field("qty", "數量", "number"),
    field("qty", "數量(重複)", "number"),
    field("item", "品項", "text"),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "基本",
        rows: [
          {
            cols: [
              { fieldKey: "qty", span: 6 },
              { fieldKey: "qty", span: 6 },
            ],
          },
          { cols: [{ fieldKey: "item", span: 12 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "item" },
  prefills: [],
});

describe("設計器以內部 id 當欄位身分(key 只是資料)", () => {
  it("載入時配 id:key 重複的兩個欄位各有自己的 id,版面格依序對上", () => {
    const design = toDesignDefinition(duplicated());
    const first = design.fields.at(0);
    const second = design.fields.at(1);
    expect(first?._id).not.toBe(second?._id);
    const cols = design.layout.sections[0]?.rows[0]?.cols ?? [];
    expect(cols.map((col) => col._id)).toEqual([first?._id, second?._id]);
    expect(unplacedFields(design)).toEqual([]);
  });

  it("key 重複時刪第二個:只刪那一個,欄位數少一、另一個還在版面上", () => {
    const design = toDesignDefinition(duplicated());
    const second = design.fields.at(1)?._id ?? "";
    const next = toFormDefinition(removeField(design, second));
    expect(next.fields.map((item) => item.label)).toEqual(["數量", "品項"]);
    expect(next.layout.sections[0]?.rows[0]?.cols).toEqual([
      { fieldKey: "qty", span: 6 },
    ]);
  });

  it("改 key 只改那一個欄位與它的版面格;輸出丟掉內部 id", () => {
    const design = toDesignDefinition(duplicated());
    const second = design.fields.at(1);
    const next = toFormDefinition(
      updateField(design, second?._id ?? "", {
        ...field("qty_2", "數量(重複)", "number"),
      }),
    );
    expect(next.fields.map((item) => item.key)).toEqual([
      "qty",
      "qty_2",
      "item",
    ]);
    expect(
      next.layout.sections[0]?.rows[0]?.cols.map((col) => col.fieldKey),
    ).toEqual(["qty", "qty_2"]);
    expect(JSON.stringify(next)).not.toContain("_id");
  });

  it("改 key 當場擋:格式、保留字、與別的欄位重複;自己原本的 key 不算重複", () => {
    const design = toDesignDefinition(duplicated());
    const item = design.fields.at(2)?._id ?? "";
    expect(fieldKeyProblemOf(design, item, "Item")).toBe("format");
    expect(fieldKeyProblemOf(design, item, "status")).toBe("reserved");
    expect(fieldKeyProblemOf(design, item, "qty")).toBe("duplicate");
    expect(fieldKeyProblemOf(design, item, "item")).toBeNull();
    expect(fieldKeyProblemOf(design, item, "item_name")).toBeNull();
  });
});
