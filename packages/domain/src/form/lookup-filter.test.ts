import { describe, expect, it } from "@jest/globals";

import { recheckRegexSafety } from "../form-regex-safety";
import { arrayField, column } from "./array-test-support";
import { definitionOf, field } from "./form-test-support";
import type { DefinitionIssue } from "./issues";
import {
  filterScalarForField,
  filterVarValueOf,
  isFilterVarCompatible,
  lookupFilterVarsOf,
  resolveLookupSource,
  withoutLookupFilterVars,
} from "./lookup-filter";
import type { LookupProviderRegistry } from "./registry";
import type { FieldDef, LookupSourceDescriptor } from "./types";
import { validateDefinition } from "./validate-definition";

const PROVIDERS: LookupProviderRegistry = {
  user: { fields: { name: "text" }, filterFields: { enabled: "boolean" } },
  project_book: {
    fields: { name: "text", orgId: "text", bookAmount: "number" },
    filterFields: { orgId: "text", enabled: null },
  },
};

const linked = (fieldKey: string): LookupSourceDescriptor => ({
  provider: "project_book",
  labelField: "name",
  filter: { orgId: { var: fieldKey } },
});

const title = field("title", "text");
const shipOrg = field("ship_org", "reference", {
  source: { provider: "user", labelField: "name" },
});

function errorsOf(fields: FieldDef[], code: string): DefinitionIssue[] {
  return validateDefinition(definitionOf([title, ...fields]), {
    regexSafety: recheckRegexSafety,
    lookupProviders: PROVIDERS,
  }).errors.filter((issue) => issue.code === code);
}

describe("連動篩選(B2d)的純邏輯", () => {
  it("列出 `{ var }` 條件;固定條件不算", () => {
    expect(
      lookupFilterVarsOf({
        provider: "project_book",
        labelField: "name",
        filter: { enabled: true, orgId: { var: "ship_org" } },
      }),
    ).toEqual([{ filterField: "orgId", fieldKey: "ship_org" }]);
  });

  it("換成目前的值;被引用欄位沒有值 → null(查無)", () => {
    const source: LookupSourceDescriptor = {
      ...linked("ship_org"),
      filter: { enabled: true, orgId: { var: "ship_org" } },
    };
    expect(resolveLookupSource(source, () => "org-a")?.filter).toEqual({
      enabled: true,
      orgId: "org-a",
    });
    expect(resolveLookupSource(source, () => null)).toBeNull();
    expect(withoutLookupFilterVars(source).filter).toEqual({ enabled: true });
  });

  it("篩選值:引用給 id、單選給 value、數字給數字、空值為 null", () => {
    expect(filterVarValueOf(shipOrg, { id: "org-a", label: "A 店" })).toBe(
      "org-a",
    );
    expect(
      filterVarValueOf(field("kind", "select"), { value: "x", label: "X" }),
    ).toBe("x");
    expect(filterVarValueOf(field("qty", "number"), "12")).toBe(12);
    expect(filterVarValueOf(field("note", "text"), "")).toBeNull();
    expect(filterVarValueOf(shipOrg, null)).toBeNull();
  });

  it("前端送的篩選值依被引用欄位的型別收,型別不符當沒填", () => {
    expect(filterScalarForField(field("flag", "boolean"), true)).toBe(true);
    expect(filterScalarForField(field("flag", "boolean"), "abc")).toBeNull();
    expect(filterScalarForField(field("qty", "number"), "3")).toBeNull();
    expect(filterScalarForField(field("qty", "number"), 3)).toBe(3);
    expect(filterScalarForField(shipOrg, "org-a")).toBe("org-a");
    expect(filterScalarForField(shipOrg, 1)).toBeNull();
    expect(filterScalarForField(undefined, "x")).toBeNull();
  });

  it("型別相符:同型別、文字篩選欄收單選 / 引用;型別不明不擋", () => {
    expect(isFilterVarCompatible("text", "reference")).toBe(true);
    expect(isFilterVarCompatible("number", "text")).toBe(false);
    expect(isFilterVarCompatible(null, "number")).toBe(true);
    expect(isFilterVarCompatible("text", "date")).toBe(false);
  });
});

describe("檢查器:連動篩選", () => {
  it("引用欄位引用表單層欄位 → 沒有錯誤", () => {
    const book = field("book", "reference", { source: linked("ship_org") });
    expect(
      validateDefinition(definitionOf([title, shipOrg, book]), {
        regexSafety: recheckRegexSafety,
        lookupProviders: PROVIDERS,
      }).errors,
    ).toEqual([]);
  });

  it("明細子欄引用表單層欄位 → 沒有錯誤", () => {
    const lines = arrayField("lines", [
      column("book", "reference", { source: linked("ship_org") }),
    ]);
    expect(
      validateDefinition(definitionOf([title, shipOrg, lines]), {
        regexSafety: recheckRegexSafety,
        lookupProviders: PROVIDERS,
      }).errors,
    ).toEqual([]);
  });

  it("明細子欄引用同一列的其他子欄 → 擋下", () => {
    const lines = arrayField("lines", [
      column("store", "text"),
      column("book", "reference", { source: linked("store") }),
    ]);
    const [issue] = errorsOf([lines], "LOOKUP_FILTER_VAR_INVALID");
    expect(issue?.message).toContain("同一列");
    expect(issue?.location).toEqual({
      fieldKey: "lines",
      columnKey: "book",
      property: "source.filter.orgId",
    });
  });

  it("引用不存在的欄位 → 擋下", () => {
    const book = field("book", "reference", { source: linked("nowhere") });
    expect(errorsOf([book], "LOOKUP_FILTER_VAR_INVALID")).toHaveLength(1);
  });

  it("引用型別不符的欄位 → 擋下", () => {
    const amount = field("amount", "number");
    const book = field("book", "reference", { source: linked("amount") });
    const [issue] = errorsOf([amount, book], "LOOKUP_FILTER_VAR_TYPE");
    expect(issue?.location.fieldKey).toBe("book");
  });

  it("不能當篩選的欄位、選項來源 / 帶入規則用連動篩選 → 擋下", () => {
    const book = field("book", "reference", {
      source: {
        provider: "project_book",
        labelField: "name",
        filter: { bookAmount: { var: "ship_org" } },
      },
    });
    expect(errorsOf([shipOrg, book], "LOOKUP_FILTER_VAR_INVALID")).toHaveLength(
      1,
    );
    const lookupSelect = field("pick", "select", {
      options: { kind: "lookup", source: linked("ship_org") },
    });
    expect(
      errorsOf([shipOrg, lookupSelect], "LOOKUP_FILTER_VAR_INVALID"),
    ).toHaveLength(1);
  });
});
