import { describe, expect, it } from "@jest/globals";

import type { ArrayColumnDef, FieldDef } from "@repo/domain/form";

import { pickReferenceIn } from "./array-rows";
import {
  clearLinkedReferences,
  filterLinkValuesOf,
  filterValuesFor,
  linkedReferencesOf,
  missingLinksOf,
} from "./filter-links";

const linkedSource = {
  provider: "project_book",
  labelField: "name",
  filter: { orgId: { var: "ship" } },
};

const book: ArrayColumnDef = {
  key: "book",
  label: "本",
  type: "reference",
  widget: { kind: "referencePicker" },
  valueSource: { kind: "input" },
  source: linkedSource,
  prefill: { mapping: [{ sourceField: "amount", fieldKey: "amount" }] },
};
const amount: ArrayColumnDef = {
  key: "amount",
  label: "金額",
  type: "number",
  precision: 0,
  widget: { kind: "number" },
  valueSource: { kind: "input" },
};

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
    source: linkedSource,
  },
  {
    key: "lines",
    label: "明細",
    type: "array",
    widget: { kind: "table" },
    valueSource: { kind: "input" },
    columns: [book, amount],
  },
];

const links = linkedReferencesOf(fields);
const ref = (id: string) => ({ id, label: id });

describe("連動篩選(B2d)填寫端", () => {
  it("列出依賴的引用欄(表單層與明細子欄)與被引用欄位的目前值", () => {
    expect(links.map((link) => [link.fieldKey, link.columnKey])).toEqual([
      ["main_book", undefined],
      ["lines", "book"],
    ]);
    const values = filterLinkValuesOf(fields, links, { ship: ref("org-a") });
    expect(values.ship).toEqual({ value: "org-a", label: "出貨分店" });
    const vars = links[0]?.vars ?? [];
    expect(filterValuesFor(vars, values)).toEqual({ ship: "org-a" });
    expect(missingLinksOf(vars, values)).toEqual([]);
    expect(
      missingLinksOf(vars, filterLinkValuesOf(fields, links, { ship: null })),
    ).toEqual(["出貨分店"]);
  });

  it("被引用欄位改值 → 清空表單層引用欄與每一列的引用子欄,回清了幾列", () => {
    const before = {
      ship: ref("org-a"),
      main_book: ref("b1"),
      lines: [
        { rowId: "r1", book: ref("b1"), amount: "3" },
        { rowId: "r2", book: null, amount: "1" },
        { rowId: "r3", book: ref("b2"), amount: "2" },
      ],
    };
    const { values, cleared } = clearLinkedReferences(
      fields,
      links,
      before,
      { ...before, ship: ref("org-b") },
      "ship",
    );
    expect(values.main_book).toBeNull();
    expect(values.lines).toEqual([
      { rowId: "r1", book: null, amount: "3" },
      { rowId: "r2", book: null, amount: "1" },
      { rowId: "r3", book: null, amount: "2" },
    ]);
    expect(cleared).toEqual([{ label: "主本" }, { label: "本", rows: 2 }]);
  });

  it("篩選值沒變(同一個 id、label 不同)或改的是別欄 → 不清(編輯既有單據打開也不清)", () => {
    const before = { ship: ref("org-a"), main_book: ref("b1") };
    expect(
      clearLinkedReferences(
        fields,
        links,
        before,
        { ...before, ship: { id: "org-a", label: "改名" } },
        "ship",
      ).cleared,
    ).toEqual([]);
    expect(
      clearLinkedReferences(
        fields,
        links,
        before,
        { ...before, main_book: ref("b2") },
        "main_book",
      ).values.main_book,
    ).toEqual(ref("b2"));
  });
});

describe("列內帶入(B2c)", () => {
  it("選定時寫引用值並把來源欄位帶入同一列(覆蓋);被省略的來源欄位不動、別列不動", () => {
    const rows = [
      { rowId: "r1", book: null, amount: "9" },
      { rowId: "r2", book: null, amount: "1" },
    ];
    expect(
      pickReferenceIn(rows, "r1", book, [book, amount], ref("b1"), {
        amount: 30,
      }),
    ).toEqual([
      { rowId: "r1", book: ref("b1"), amount: "30" },
      { rowId: "r2", book: null, amount: "1" },
    ]);
    expect(
      pickReferenceIn(rows, "r1", book, [book, amount], ref("b1"), {})[0],
    ).toEqual({ rowId: "r1", book: ref("b1"), amount: "9" });
  });
});
