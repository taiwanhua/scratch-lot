import { describe, expect, it } from "@jest/globals";

import type { FieldDef, FormDefinition } from "@repo/domain/form";

import { fieldReferences, sectionReferences } from "./field-references";

const linked = (fieldKey: string) => ({
  provider: "project_book",
  labelField: "name",
  filter: { orgId: { var: fieldKey } },
});

const fields: FieldDef[] = [
  {
    key: "ship",
    label: "出貨分店",
    type: "reference",
    widget: { kind: "referencePicker" },
    valueSource: { kind: "input" },
    source: { provider: "org", labelField: "name" },
  },
  {
    key: "main_book",
    label: "主本",
    type: "reference",
    widget: { kind: "referencePicker" },
    valueSource: { kind: "input" },
    source: linked("ship"),
  },
  {
    key: "lines",
    label: "明細",
    type: "array",
    widget: { kind: "table" },
    valueSource: { kind: "input" },
    columns: [
      {
        key: "book",
        label: "本",
        type: "reference",
        widget: { kind: "referencePicker" },
        valueSource: { kind: "input" },
        source: linked("ship"),
      },
    ],
  },
];

const definition: FormDefinition = {
  fields,
  layout: { sections: [] },
  summaryMap: {},
  prefills: [],
};

describe("刪欄位的確認清單:連動篩選", () => {
  it("表單層引用欄與明細引用子欄的 `{ var }` 引用都列出", () => {
    expect(fieldReferences(definition, "ship")).toEqual([
      { kind: "lookupFilter", fieldKey: "main_book" },
      { kind: "lookupFilter", fieldKey: "lines", columnKey: "book" },
    ]);
    expect(fieldReferences(definition, "main_book")).toEqual([]);
  });

  it("連同欄位刪除的分區:一起刪掉的引用欄不列", () => {
    expect(sectionReferences(definition, ["ship", "main_book"])).toEqual([
      { kind: "lookupFilter", fieldKey: "lines", columnKey: "book" },
    ]);
  });
});
