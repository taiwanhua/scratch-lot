import { describe, expect, it } from "@jest/globals";

import { recheckRegexSafety } from "../form-regex-safety";
import {
  applyDefaults,
  defaultDependenciesOf,
  defaultOrder,
  defaultValueOf,
  providerDefaultSourceOf,
} from "./defaults";
import { CTX, definitionOf, field } from "./form-test-support";
import type { DefinitionIssueCode } from "./issues";
import { filterVarValueOf } from "./lookup-filter";
import type { LookupProviderRegistry } from "./registry";
import type { FieldDef, StoredValues } from "./types";
import { validateDefinition } from "./validate-definition";

const title = field("title", "text");

const codesOf = (fields: FieldDef[]): DefinitionIssueCode[] =>
  validateDefinition(definitionOf([title, ...fields]), {
    regexSafety: recheckRegexSafety,
  }).errors.map((issue) => issue.code);

/** 引用欄 + 預設值公式。 */
const reference = (expr: FieldDef["visibleWhen"]) =>
  field("who", "reference", {
    source: { provider: "user", labelField: "name" },
    default: { kind: "expression", expr: expr ?? null },
  });

describe("@repo/domain/form 預設值:計算", () => {
  const qty = field("qty", "number", {
    default: { kind: "constant", value: 2 },
  });
  const price = field("price", "number", { precision: 1 });
  const total = field("budget", "number", {
    precision: 1,
    default: {
      kind: "expression",
      expr: { "*": [{ var: "qty" }, { var: "price" }] },
    },
  });
  const applicant = field("applicant", "reference", {
    source: { provider: "user", labelField: "name" },
    default: { kind: "expression", expr: { var: "ctx.user.id" } },
  });
  const due = field("due", "date", {
    default: { kind: "expression", expr: { now: [] } },
  });
  const fields = [total, qty, price, applicant, due];

  it("常數照型別收斂;公式依序算(後面的公式看得到前面的預設值);系統值填寫者 → { id, label: null }", () => {
    expect(
      applyDefaults(fields, { price: "1.5" }, CTX, { mode: "fill-empty" }),
    ).toEqual({
      price: "1.5",
      qty: "2",
      budget: "3.0",
      applicant: { id: "user-1", label: null },
      // CTX.now = 台北 3/1 09:00 → 當地 3/1 00:00
      due: "2026-02-28T16:00:00.000Z",
    });
  });

  it("fill-empty 不覆蓋送來的值;touched 的欄位不動", () => {
    const result = applyDefaults(fields, { qty: "5", price: "2" }, CTX, {
      mode: "fill-empty",
      touched: ["budget"],
    });
    expect(result.qty).toBe("5");
    expect(result.budget).toBeUndefined();
  });

  it("recompute:沒碰過的欄位依目前的值重算(覆蓋上一次的預設值)", () => {
    const first = applyDefaults(fields, { price: "1" }, CTX, {
      mode: "recompute",
    });
    expect(first.budget).toBe("2.0");
    const changed = applyDefaults(fields, { ...first, price: "4" }, CTX, {
      mode: "recompute",
    });
    expect(changed.budget).toBe("8.0");
    const touched = applyDefaults(
      fields,
      { ...first, price: "4", budget: "1.0" },
      CTX,
      { mode: "recompute", touched: ["budget"] },
    );
    expect(touched.budget).toBe("1.0");
  });

  it("沒有預設值 / 不是使用者填的欄位 → undefined", () => {
    expect(defaultValueOf(price, fields, {}, CTX)).toBeUndefined();
    const computed = field("c", "number", {
      valueSource: { kind: "computed", expr: 1 },
      default: { kind: "constant", value: 3 },
    });
    expect(defaultValueOf(computed, [computed], {}, CTX)).toBeUndefined();
  });
});

describe("@repo/domain/form 預設值:檢查器每種錯誤", () => {
  it("DEFAULT_NOT_ALLOWED:計算欄位 / 上傳欄設了預設值", () => {
    expect(
      codesOf([
        field("c", "number", {
          valueSource: { kind: "computed", expr: 1 },
          default: { kind: "constant", value: 1 },
        }),
      ]),
    ).toEqual(["DEFAULT_NOT_ALLOWED"]);
    expect(
      codesOf([
        field("proof", "upload", {
          default: { kind: "constant", value: null },
        }),
      ]),
    ).toEqual(["DEFAULT_NOT_ALLOWED"]);
  });

  it("DEFAULT_KIND_INVALID:單選用公式、引用用固定值", () => {
    expect(
      codesOf([
        field("kind", "select", {
          default: { kind: "expression", expr: "sick" },
        }),
        field("who", "reference", {
          source: { provider: "user", labelField: "name" },
          default: { kind: "constant", value: "user-1" },
        }),
      ]),
    ).toEqual(["DEFAULT_KIND_INVALID", "DEFAULT_KIND_INVALID"]);
  });

  it("DEFAULT_VALUE_INVALID:常數型別不對、單選 / 多選的值不在選項內", () => {
    expect(
      codesOf([
        field("qty", "number", { default: { kind: "constant", value: "abc" } }),
        field("kind", "select", {
          default: { kind: "constant", value: "unknown" },
        }),
        field("kinds", "multiSelect", {
          default: { kind: "constant", value: ["sick", "nope"] },
        }),
      ]),
    ).toEqual([
      "DEFAULT_VALUE_INVALID",
      "DEFAULT_VALUE_INVALID",
      "DEFAULT_VALUE_INVALID",
    ]);
    expect(
      codesOf([
        field("kinds", "multiSelect", {
          default: { kind: "constant", value: ["sick", "annual"] },
        }),
      ]),
    ).toEqual([]);
  });

  it("DEFAULT_SELF:預設值公式引用自己", () => {
    expect(
      codesOf([
        field("qty", "number", {
          default: { kind: "expression", expr: { "+": [{ var: "qty" }, 1] } },
        }),
      ]),
    ).toEqual(["DEFAULT_SELF"]);
  });

  it("DEFAULT_REFERENCE_INVALID:引用欄只能用填寫者 / 填寫者的組織", () => {
    expect(codesOf([reference({ var: "ctx.timezone" })])).toEqual([
      "DEFAULT_REFERENCE_INVALID",
    ]);
    expect(codesOf([reference({ var: "ctx.user.orgId" })])).toEqual([]);
  });

  it("EXPR_TYPE_MISMATCH(default.expr):公式根型別要等於欄位型別", () => {
    const report = validateDefinition(
      definitionOf([
        title,
        field("qty", "number", {
          default: { kind: "expression", expr: { concat: ["a", "b"] } },
        }),
      ]),
      { regexSafety: recheckRegexSafety },
    );
    expect(report.errors).toEqual([
      expect.objectContaining({
        code: "EXPR_TYPE_MISMATCH",
        location: {
          fieldKey: "qty",
          exprSlot: "default.expr",
          exprPath: "concat",
        },
      }),
    ]);
  });

  it("EXPR_CYCLE:兩個欄位的預設值互相引用", () => {
    expect(
      codesOf([
        field("a", "number", {
          default: { kind: "expression", expr: { var: "b" } },
        }),
        field("b", "number", {
          default: { kind: "expression", expr: { var: "a" } },
        }),
      ]),
    ).toEqual(["EXPR_CYCLE"]);
  });
});

describe("@repo/domain/form 預設值:來源提供的預設(provider)", () => {
  const site = field("site", "reference", {
    source: { provider: "org", labelField: "name" },
    default: { kind: "expression", expr: { var: "ctx.user.orgId" } },
  });
  const slot = field("slot", "reference", {
    source: { provider: "item", labelField: "name", filter: { enabled: true } },
    default: { kind: "provider", filter: { orgId: { var: "site" } } },
  });
  const fields = [slot, site];
  const byKey = new Map(fields.map((item) => [item.key, item]));
  const valueOf =
    (values: StoredValues) =>
    (key: string): ReturnType<typeof filterVarValueOf> =>
      filterVarValueOf(byKey.get(key), values[key]);

  it("依賴 = 預設值條件引用的欄位(+ 來源的連動篩選);排在被引用欄位的預設值之後", () => {
    expect(defaultDependenciesOf(slot)).toEqual(["site"]);
    expect(defaultOrder(fields).map((item) => item.key)).toEqual([
      "site",
      "slot",
    ]);
  });

  it("交給來源的描述:條件換成目前的值、併進固定條件;被引用欄位沒值 → null", () => {
    expect(
      providerDefaultSourceOf(slot, valueOf({ site: { id: "org-9" } })),
    ).toEqual({
      provider: "item",
      labelField: "name",
      filter: { enabled: true, orgId: "org-9" },
    });
    expect(providerDefaultSourceOf(slot, valueOf({}))).toBeNull();
    expect(providerDefaultSourceOf(site, valueOf({}))).toBeNull();
  });

  it("條件與來源的固定條件衝突、或條件不是連動條件 → null", () => {
    const clash = field("clash", "reference", {
      source: { provider: "item", labelField: "name", filter: { orgId: "x" } },
      default: { kind: "provider", filter: { orgId: { var: "site" } } },
    });
    expect(
      providerDefaultSourceOf(clash, valueOf({ site: { id: "org-9" } })),
    ).toBeNull();
    const fixed = field("fixed", "reference", {
      source: { provider: "item", labelField: "name" },
      default: {
        kind: "provider",
        filter: { orgId: "org-9" } as unknown as Record<
          string,
          { var: string }
        >,
      },
    });
    expect(providerDefaultSourceOf(fixed, valueOf({}))).toBeNull();
  });

  const providerDefault = (target: FieldDef, values: StoredValues) => {
    const source = providerDefaultSourceOf(target, valueOf(values));
    return source === null
      ? null
      : { id: `open-of-${String(source.filter?.orgId)}`, label: null };
  };

  it("值由呼叫端給(providerDefault);沒給 → 空;fill-empty 不覆蓋、recompute 跟著依賴變", () => {
    expect(
      applyDefaults(fields, {}, CTX, { mode: "fill-empty" }).slot,
    ).toBeNull();
    const first = applyDefaults(fields, {}, CTX, {
      mode: "fill-empty",
      providerDefault,
    });
    expect(first.slot).toEqual({ id: "open-of-org-1", label: null });
    expect(
      applyDefaults(fields, { slot: { id: "mine", label: "x" } }, CTX, {
        mode: "fill-empty",
        providerDefault,
      }).slot,
    ).toEqual({ id: "mine", label: "x" });
    const changed = applyDefaults(
      fields,
      { ...first, site: { id: "org-2", label: null } },
      CTX,
      { mode: "recompute", touched: ["site"], providerDefault },
    );
    expect(changed.slot).toEqual({ id: "open-of-org-2", label: null });
  });
});

/** 「來源提供的預設」帶某組條件的引用欄。 */
const slotWithFilter = (filter: Record<string, unknown>): FieldDef =>
  field("slot", "reference", {
    source: { provider: "item", labelField: "name" },
    default: {
      kind: "provider",
      filter: filter as Record<string, { var: string }>,
    },
  });

describe("@repo/domain/form 預設值:檢查器的來源提供的預設", () => {
  const providers: LookupProviderRegistry = {
    org: { fields: { name: "text" }, filterFields: { enabled: "boolean" } },
    item: {
      fields: { name: "text" },
      filterFields: { orgId: null, enabled: "boolean" },
      operatorDefault: true,
    },
  };
  const site = field("site", "reference", {
    source: { provider: "org", labelField: "name" },
  });
  const codesWith = (fields: FieldDef[]): DefinitionIssueCode[] =>
    validateDefinition(definitionOf([title, site, ...fields]), {
      regexSafety: recheckRegexSafety,
      lookupProviders: providers,
    }).errors.map((issue) => issue.code);

  it("來源有宣告就能選;條件照連動篩選的規則驗", () => {
    expect(
      codesWith([
        field("slot", "reference", {
          source: { provider: "item", labelField: "name" },
          default: { kind: "provider", filter: { orgId: { var: "site" } } },
        }),
      ]),
    ).toEqual([]);
    expect(
      codesWith([
        field("slot", "reference", {
          source: { provider: "item", labelField: "name" },
          default: { kind: "provider" },
        }),
      ]),
    ).toEqual([]);
  });

  it("DEFAULT_PROVIDER_UNSUPPORTED:來源沒有提供預設值", () => {
    expect(
      codesWith([
        field("who", "reference", {
          source: { provider: "org", labelField: "name" },
          default: { kind: "provider" },
        }),
      ]),
    ).toEqual(["DEFAULT_PROVIDER_UNSUPPORTED"]);
  });

  it("DEFAULT_KIND_INVALID:不是引用欄", () => {
    expect(
      codesWith([field("note", "text", { default: { kind: "provider" } })]),
    ).toEqual(["DEFAULT_KIND_INVALID"]);
  });

  it("LOOKUP_FILTER_VAR_INVALID:條件寫固定值、引用自己、不是來源的篩選欄位", () => {
    expect(codesWith([slotWithFilter({ orgId: "org-1" })])).toEqual([
      "LOOKUP_FILTER_VAR_INVALID",
    ]);
    expect(codesWith([slotWithFilter({ orgId: { var: "slot" } })])).toEqual([
      "LOOKUP_FILTER_VAR_INVALID",
    ]);
    expect(codesWith([slotWithFilter({ status: { var: "site" } })])).toEqual([
      "LOOKUP_FILTER_VAR_INVALID",
    ]);
  });
});
