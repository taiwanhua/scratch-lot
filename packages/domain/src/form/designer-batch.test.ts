import { describe, expect, it } from "@jest/globals";

import { recheckRegexSafety } from "../form-regex-safety";
import { computeAll } from "./compute";
import { evaluateCondition, evaluateExpression } from "./expression";
import { isSameOptionSource } from "./expression-types";
import { definitionOf, field } from "./form-test-support";
import type { DefinitionIssue } from "./issues";
import { semanticValuesOf } from "./semantic";
import type { Expression, ExpressionContext, FieldDef } from "./types";
import { validateDefinition } from "./validate-definition";
import { requiredIssueOf, validateFieldRules } from "./values";

/** 台北 2026-09-26 14:30 */
const CTX: ExpressionContext = {
  now: "2026-09-26T06:30:00.000Z",
  timezone: "Asia/Taipei",
  user: { id: "user-1", orgId: "org-1", orgIds: ["org-1"] },
  tenant: { id: "tenant-1" },
};

/** 台北 2026-09-26 00:00 */
const TAIPEI_0926 = "2026-09-25T16:00:00.000Z";

const evaluate = (
  expr: Expression,
  fields: readonly FieldDef[] = [],
  values: Record<string, unknown> = {},
) =>
  evaluateExpression(expr, {
    values: semanticValuesOf(fields, values),
    ctx: CTX,
    fields,
    stored: values,
  });

describe("@repo/domain/form dateAdd(起, 方向, 數量, 單位)", () => {
  const paid = field("paid_on", "date");
  const at = field("at", "datetime");
  const fields = [paid, at];
  const values = { paid_on: TAIPEI_0926, at: "2026-09-26T06:30:00.000Z" };

  it.each([
    ["days", "after", 3, "2026-09-28T16:00:00.000Z"],
    ["days", "before", 1, "2026-09-24T16:00:00.000Z"],
    ["weeks", "after", 2, "2026-10-09T16:00:00.000Z"],
    ["months", "before", 1, "2026-08-25T16:00:00.000Z"],
    ["years", "after", 1, "2027-09-25T16:00:00.000Z"],
  ])("日期起 %s %s %i → 當地 00:00 的 ISO", (unit, direction, amount, iso) => {
    expect(
      evaluate(
        { dateAdd: [{ var: "paid_on" }, direction, amount, unit] },
        fields,
        values,
      ),
    ).toBe(iso);
  });

  it("日期時間起回時點(時分不變)", () => {
    expect(
      evaluate(
        { dateAdd: [{ var: "at" }, "after", 1, "days"] },
        fields,
        values,
      ),
    ).toBe("2026-09-27T06:30:00.000Z");
  });

  it("月底溢出取該月最後一天(1/31 + 1 個月 = 2/28)", () => {
    expect(
      evaluate(
        {
          dateAdd: [{ date: "2026-01-30T16:00:00.000Z" }, "after", 1, "months"],
        },
        fields,
        values,
      ),
    ).toBe("2026-02-27T16:00:00.000Z");
  });

  it("數量可以是運算結果;不認得的方向 / 單位、非整數數量 → null", () => {
    expect(
      evaluate(
        { dateAdd: [{ var: "paid_on" }, "after", { "+": [1, 1] }, "days"] },
        fields,
        values,
      ),
    ).toBe("2026-09-27T16:00:00.000Z");
    expect(
      evaluate(
        { dateAdd: [{ var: "paid_on" }, "later", 1, "days"] },
        fields,
        values,
      ),
    ).toBeNull();
    expect(
      evaluate(
        { dateAdd: [{ var: "paid_on" }, "after", 1, "hours"] },
        fields,
        values,
      ),
    ).toBeNull();
    expect(
      evaluate(
        { dateAdd: [{ var: "paid_on" }, "after", 1.5, "days"] },
        fields,
        values,
      ),
    ).toBeNull();
  });

  it("日期欄公式收斂成當地 00:00(computeAll)", () => {
    const due = field("due_on", "date", {
      valueSource: {
        kind: "computed",
        expr: { dateAdd: [{ now: [] }, "after", 7, "days"] },
      },
    });
    expect(computeAll([due], { values: {}, ctx: CTX }).due_on).toBe(
      "2026-10-02T16:00:00.000Z",
    );
  });
});

describe("@repo/domain/form 日期與日期時間混比(換成當地日再比)", () => {
  const paid = field("paid_on", "date");
  const at = field("at", "datetime");
  const fields = [paid, at];
  const values = { paid_on: TAIPEI_0926, at: "2026-09-26T09:00:00.000Z" };
  const condition = (expr: Expression) =>
    evaluateCondition(expr, {
      values: semanticValuesOf(fields, values),
      ctx: CTX,
      fields,
      stored: values,
    });

  it("付款日 = 今天 14:30(現在時間)→ 相等;< / > 不成立、<= / >= 成立", () => {
    expect(condition({ "==": [{ var: "paid_on" }, { now: [] }] })).toBe(true);
    expect(condition({ "!=": [{ var: "paid_on" }, { now: [] }] })).toBe(false);
    expect(condition({ "<": [{ var: "paid_on" }, { now: [] }] })).toBe(false);
    expect(condition({ ">=": [{ now: [] }, { var: "paid_on" }] })).toBe(true);
  });

  it("日期時間欄 vs 日期常數也換成日;兩邊都是日期時間仍比時點", () => {
    expect(condition({ "==": [{ var: "at" }, { date: TAIPEI_0926 }] })).toBe(
      true,
    );
    expect(condition({ "==": [{ var: "at" }, { now: [] }] })).toBe(false);
    expect(condition({ "<": [{ now: [] }, { var: "at" }] })).toBe(true);
  });

  it("巢狀在 and / if 裡的比較也改寫;空值照原運算子(== null)", () => {
    expect(
      condition({
        and: [
          { "==": [{ var: "paid_on" }, { now: [] }] },
          { if: [{ "<=": [{ var: "paid_on" }, { var: "at" }] }, true, false] },
        ],
      }),
    ).toBe(true);
    expect(
      evaluateCondition(
        { "==": [{ var: "paid_on" }, { now: [] }] },
        { values: { paid_on: null }, ctx: CTX, fields, stored: {} },
      ),
    ).toBe(false);
  });
});

describe("@repo/domain/form 固定值照型別正規化", () => {
  it("是 / 否只收布林、多選收陣列、日期收斂成當地 00:00、數字取位", () => {
    const fields = [
      field("flag", "boolean", {
        valueSource: { kind: "constant", value: true },
      }),
      field("bad_flag", "boolean", {
        valueSource: { kind: "constant", value: "true" },
      }),
      field("tags", "multiSelect", {
        valueSource: { kind: "constant", value: ["sick"] },
      }),
      field("day", "date", {
        valueSource: { kind: "constant", value: "2026-09-26T10:00:00+08:00" },
      }),
      field("rate", "number", {
        precision: 1,
        valueSource: { kind: "constant", value: 1.25 },
      }),
    ];
    expect(computeAll(fields, { values: {}, ctx: CTX })).toEqual({
      flag: true,
      bad_flag: null,
      tags: ["sick"],
      day: TAIPEI_0926,
      rate: "1.3",
    });
  });
});

describe("@repo/domain/form 是 / 否欄位必填 = 必須勾選", () => {
  const agree = field("agree", "boolean", { rules: { required: true } });
  const input = { semantic: {}, ctx: CTX, fields: [agree], stored: {} };

  it("false 擋(REQUIRED)、true 過;不必填時 false 照過", () => {
    expect(validateFieldRules(agree, false, input)?.code).toBe("REQUIRED");
    expect(validateFieldRules(agree, true, input)).toBeNull();
    expect(
      validateFieldRules({ ...agree, rules: {} }, false, input),
    ).toBeNull();
  });
});

const leave = field("absence", "select");
const sameSource = field("previous_leave", "select");
const otherSource = field("category", "select", {
  options: { kind: "fieldCategory", key: "leave-types" },
});
const note = field("note", "text");
const tags = field("tags", "multiSelect");

const errorsOf = (...fields: FieldDef[]): DefinitionIssue[] =>
  validateDefinition(
    definitionOf([note, leave, sameSource, otherSource, tags, ...fields]),
    { regexSafety: recheckRegexSafety },
  ).errors;

const formula = (
  key: string,
  type: "select" | "multiSelect",
  expr: Expression,
) => field(key, type, { valueSource: { kind: "computed", expr } });

const due = (expr: Expression) =>
  field("due", "date", { valueSource: { kind: "computed", expr } });

const codesOf = (issues: readonly DefinitionIssue[]) =>
  issues.map((issue) => issue.code);

describe("@repo/domain/form 檢查器:選項欄公式的根是「選項」", () => {
  it("收 if(然後 / 否則是選項常數或同來源欄位)、同來源欄位、選項常數", () => {
    expect(
      errorsOf(
        formula("pick", "select", {
          if: [
            { "==": [{ var: "note" }, "x"] },
            "sick",
            { var: "previous_leave" },
          ],
        }),
        formula("copy", "select", { var: "previous_leave" }),
        formula("fixed", "select", "annual"),
        formula("many", "multiSelect", ["sick", "annual"]),
      ),
    ).toEqual([]);
  });

  it("concat / optionLabel / 文字欄 / 不同來源的欄位都不收", () => {
    const issues = errorsOf(
      formula("a", "select", { concat: ["si", "ck"] }),
      formula("b", "select", { optionLabel: "absence" }),
      formula("c", "select", { var: "note" }),
      formula("d", "select", { var: "category" }),
      formula("e", "select", { if: [true, "sick", { var: "note" }] }),
    );
    expect(codesOf(issues)).toEqual([
      "EXPR_TYPE_MISMATCH",
      "EXPR_TYPE_MISMATCH",
      "EXPR_TYPE_MISMATCH",
      "EXPR_TYPE_MISMATCH",
      "EXPR_TYPE_MISMATCH",
    ]);
    expect(issues.map((issue) => issue.location.fieldKey)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("靜態選項的常數要在清單內;多選要是陣列;類別選項只驗字串", () => {
    const issues = errorsOf(
      formula("x", "select", "unknown"),
      formula("y", "multiSelect", "sick"),
      formula("z", "multiSelect", ["sick", "nope"]),
      field("w", "select", {
        options: { kind: "fieldCategory", key: "leave-types" },
        valueSource: { kind: "computed", expr: "anything" },
      }),
    );
    expect(codesOf(issues)).toEqual([
      "EXPR_OPTION_UNKNOWN",
      "EXPR_TYPE_MISMATCH",
      "EXPR_OPTION_UNKNOWN",
    ]);
  });

  it("條件裡的選項欄照舊能和文字常數 / 文字欄比、放進 in", () => {
    expect(
      errorsOf(
        field("flag", "boolean", {
          visibleWhen: {
            and: [
              { "==": [{ var: "absence" }, "sick"] },
              { "==": [{ var: "absence" }, { var: "note" }] },
              { in: [{ var: "absence" }, ["sick"]] },
              { in: ["sick", { var: "tags" }] },
            ],
          },
        }),
      ),
    ).toEqual([]);
  });
});

describe("@repo/domain/form 檢查器:dateAdd 與日期常數", () => {
  it("合法:日期欄 / 日期常數 / now 當起,回日期;日期與日期時間可混比", () => {
    expect(
      errorsOf(
        field("start", "date"),
        due({ dateAdd: [{ var: "start" }, "after", 3, "days"] }),
        field("later", "datetime", {
          valueSource: {
            kind: "computed",
            expr: { dateAdd: [{ now: [] }, "before", 1, "years"] },
          },
          visibleWhen: { ">": [{ now: [] }, { date: TAIPEI_0926 }] },
        }),
      ),
    ).toEqual([]);
  });

  it("未知方向 / 單位 → EXPR_DATE_ADD_ARG;數量不是數字、起不是日期 → EXPR_TYPE_MISMATCH", () => {
    expect(
      codesOf(
        errorsOf(
          due({ dateAdd: [{ now: [] }, "after", 1, "hours"] }),
          field("d2", "date", {
            valueSource: {
              kind: "computed",
              expr: { dateAdd: [{ now: [] }, "soon", 1, "days"] },
            },
          }),
          field("d3", "date", {
            valueSource: {
              kind: "computed",
              expr: { dateAdd: [{ now: [] }, "after", "1", "days"] },
            },
          }),
          field("d4", "date", {
            valueSource: {
              kind: "computed",
              expr: { dateAdd: [{ var: "note" }, "after", 1, "days"] },
            },
          }),
        ),
      ),
    ).toEqual([
      "EXPR_DATE_ADD_ARG",
      "EXPR_DATE_ADD_ARG",
      "EXPR_TYPE_MISMATCH",
      "EXPR_TYPE_MISMATCH",
    ]);
  });

  it("日期常數的參數要是 ISO(形狀錯誤)", () => {
    expect(codesOf(errorsOf(due({ date: "2026-09-26" })))).toEqual([
      "EXPR_INVALID",
    ]);
  });
});

const fixed = (key: string, type: FieldDef["type"], value: unknown) =>
  field(key, type, { valueSource: { kind: "constant", value } });

describe("@repo/domain/form 檢查器:固定值要是該型別的合法值(CONSTANT_VALUE_INVALID)", () => {
  it('是 / 否給字串 "true"、多選給字串、日期給 YYYY-MM-DD → 報錯並定位到 valueSource.value', () => {
    const issues = errorsOf(
      fixed("flag", "boolean", "true"),
      fixed("many", "multiSelect", "sick"),
      fixed("day", "date", "2026-09-26"),
    );
    expect(codesOf(issues)).toEqual([
      "CONSTANT_VALUE_INVALID",
      "CONSTANT_VALUE_INVALID",
      "CONSTANT_VALUE_INVALID",
    ]);
    expect(issues.map((issue) => issue.location)).toEqual([
      { fieldKey: "flag", property: "valueSource.value" },
      { fieldKey: "many", property: "valueSource.value" },
      { fieldKey: "day", property: "valueSource.value" },
    ]);
  });

  it("正確型別不報;靜態選項外的值報「必須從選項裡挑」", () => {
    expect(
      errorsOf(
        fixed("flag", "boolean", true),
        fixed("many", "multiSelect", ["sick"]),
        fixed("day", "date", TAIPEI_0926),
      ),
    ).toEqual([]);
    const [issue] = errorsOf(fixed("one", "select", "nope"));
    expect(issue?.code).toBe("CONSTANT_VALUE_INVALID");
    expect(issue?.message).toContain("必須從選項裡挑");
  });
});

describe("@repo/domain/form 檢查器:比較兩邊都沒選(EXPR_COMPARISON_EMPTY)", () => {
  it("「或」裡一個空比較 → 錯誤;一邊有值的判空(== null)合法", () => {
    const issues = errorsOf(
      field("flag", "boolean", {
        visibleWhen: {
          or: [{ "==": [{ var: "note" }, "x"] }, { "==": [null, null] }],
        },
        readonlyWhen: { "==": [{ var: "note" }, null] },
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "EXPR_COMPARISON_EMPTY",
        location: expect.objectContaining({
          fieldKey: "flag",
          exprSlot: "visibleWhen",
          exprPath: "or.1.==",
        }),
      }),
    ]);
  });
});

describe("@repo/domain/form 同一個選項來源(isSameOptionSource)", () => {
  it("值為 undefined 的鍵與 labelTemplate 不算差別;顯示欄不同算不同", () => {
    const source = { provider: "user", labelField: "name" };
    expect(
      isSameOptionSource(
        { options: { kind: "lookup", source } },
        {
          options: {
            kind: "lookup",
            source: {
              ...source,
              valueField: undefined,
              labelTemplate: "{{name}}",
            },
          },
        },
      ),
    ).toBe(true);
    expect(
      isSameOptionSource(
        { options: { kind: "lookup", source } },
        {
          options: {
            kind: "lookup",
            source: { ...source, labelField: "email" },
          },
        },
      ),
    ).toBe(false);
  });
});

describe("@repo/domain/form requiredIssueOf", () => {
  it("是 / 否:null 與 false 都是「必須勾選」;計算欄算成空是「無法計算」", () => {
    const agree = field("agree", "boolean", { rules: { required: true } });
    expect(requiredIssueOf(agree, null)?.message).toBe("「agree」必須勾選");
    expect(requiredIssueOf(agree, false)?.message).toBe("「agree」必須勾選");
    expect(requiredIssueOf(agree, true)).toBeNull();
    expect(
      requiredIssueOf(
        { ...agree, valueSource: { kind: "computed", expr: null } },
        null,
      )?.code,
    ).toBe("NOT_COMPUTABLE");
  });
});
