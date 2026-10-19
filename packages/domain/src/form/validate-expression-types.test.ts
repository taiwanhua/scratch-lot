import { describe, expect, it } from "@jest/globals";

import { recheckRegexSafety } from "../form-regex-safety";
import { definitionOf, field } from "./form-test-support";
import type { DefinitionIssue } from "./issues";
import type { FieldDef } from "./types";
import { validateDefinition } from "./validate-definition";

const title = field("title", "text");
const qty = field("qty", "number");
const start = field("start", "date");
const end = field("end", "datetime");
const agree = field("agree", "boolean");
const tags = field("tags", "multiSelect");
const proof = field("proof", "upload");

const errorsOf = (...fields: FieldDef[]): DefinitionIssue[] =>
  validateDefinition(
    definitionOf([title, qty, start, end, agree, tags, proof, ...fields]),
    { regexSafety: recheckRegexSafety },
  ).errors;

describe("@repo/domain/form 檢查器:表達式型別", () => {
  it("型別都對得上 → 沒有錯誤(日期與日期時間互通、if 然後 / 否則同型別、in 清單)", () => {
    expect(
      errorsOf(
        field("days", "number", {
          valueSource: {
            kind: "computed",
            expr: { dateDiff: [{ var: "start" }, { var: "end" }, "hours"] },
          },
          visibleWhen: {
            and: [
              { var: "agree" },
              { in: ["sick", { var: "tags" }] },
              { "<": [{ var: "end" }, { now: [] }] },
            ],
          },
          readonlyWhen: { "!!": { var: "qty" } },
        }),
        field("label", "text", {
          valueSource: {
            kind: "computed",
            expr: { if: [{ var: "agree" }, "是", "否"] },
          },
        }),
      ),
    ).toEqual([]);
  });

  it("計算欄位公式的根要等於欄位型別(數字欄給文字 → 錯,定位到根)", () => {
    expect(
      errorsOf(
        field("total", "number", {
          valueSource: { kind: "computed", expr: { concat: ["a"] } },
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        code: "EXPR_TYPE_MISMATCH",
        location: {
          fieldKey: "total",
          exprSlot: "valueSource.expr",
          exprPath: "concat",
        },
      }),
    ]);
  });

  it("條件 / 自訂驗證的根要是是 / 否", () => {
    const [visible, custom] = errorsOf(
      field("note", "text", {
        visibleWhen: { var: "qty" },
        rules: { custom: { "+": [1, 2] } },
      }),
    );
    expect(visible).toMatchObject({
      code: "EXPR_TYPE_MISMATCH",
      location: { exprSlot: "visibleWhen", exprPath: "var" },
    });
    expect(custom).toMatchObject({
      code: "EXPR_TYPE_MISMATCH",
      location: { exprSlot: "rules.custom", exprPath: "+" },
    });
  });

  it("參數位置:比較兩邊不同型、加法放文字、dateDiff 放數字、上傳欄進表達式", () => {
    const codesAndPaths = errorsOf(
      field("a", "boolean", {
        valueSource: {
          kind: "computed",
          expr: { "==": [{ var: "qty" }, "5"] },
        },
      }),
      field("b", "number", {
        valueSource: { kind: "computed", expr: { "+": [{ var: "qty" }, "x"] } },
      }),
      field("c", "number", {
        valueSource: {
          kind: "computed",
          expr: { dateDiff: [{ var: "qty" }, { now: [] }] },
        },
      }),
      field("d", "text", {
        valueSource: { kind: "computed", expr: { concat: [{ var: "proof" }] } },
      }),
    ).map((issue) => [
      issue.code,
      issue.location.fieldKey,
      issue.location.exprPath,
    ]);
    expect(codesAndPaths).toEqual([
      ["EXPR_TYPE_MISMATCH", "a", "==.1"],
      ["EXPR_TYPE_MISMATCH", "b", "+.1"],
      ["EXPR_TYPE_MISMATCH", "c", "dateDiff.0.var"],
      ["EXPR_TYPE_MISMATCH", "d", "concat.0.var"],
    ]);
  });

  it("比較運算子兩邊的日期與日期時間可混比(都是時點);ISO 常數是日期時間;dateDiff 兩種都收", () => {
    const issues = errorsOf(
      field("late", "boolean", {
        valueSource: {
          kind: "computed",
          expr: { "<": [{ var: "start" }, { now: [] }] },
        },
      }),
      field("same", "boolean", {
        valueSource: {
          kind: "computed",
          expr: { "==": [{ var: "end" }, "2026-01-01T00:00:00.000Z"] },
        },
      }),
      field("gap", "number", {
        valueSource: {
          kind: "computed",
          expr: { dateDiff: [{ var: "start" }, { now: [] }, "minutes"] },
        },
      }),
    ).map((issue) => [
      issue.code,
      issue.location.fieldKey,
      issue.location.exprPath,
    ]);
    expect(issues).toEqual([]);
  });

  it("EXPR_DATE_DIFF_UNIT:單位只能是 days / hours / minutes", () => {
    expect(
      errorsOf(
        field("n", "number", {
          valueSource: {
            kind: "computed",
            expr: { dateDiff: [{ var: "start" }, { var: "end" }, "weeks"] },
          },
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        code: "EXPR_DATE_DIFF_UNIT",
        location: {
          fieldKey: "n",
          exprSlot: "valueSource.expr",
          exprPath: "dateDiff.2",
        },
      }),
    ]);
  });

  it("optionLabel 只能指選項 / 引用欄", () => {
    expect(
      errorsOf(
        field("t", "text", {
          valueSource: { kind: "computed", expr: { optionLabel: "qty" } },
        }),
      ).map((issue) => issue.code),
    ).toEqual(["EXPR_TYPE_MISMATCH"]);
  });

  it("形狀有錯的表達式不重複報型別錯", () => {
    expect(
      errorsOf(
        field("t", "boolean", {
          valueSource: { kind: "computed", expr: { regex: ["a"] } },
        }),
      ).map((issue) => issue.code),
    ).toEqual(["EXPR_UNKNOWN_OPERATOR"]);
  });
});
