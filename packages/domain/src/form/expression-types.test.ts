import { describe, expect, it } from "@jest/globals";

import { recheckRegexSafety } from "../form-regex-safety";
import { evaluateExpression } from "./expression";
import { EXPRESSION_OPERATORS, scanExpression } from "./expression-shape";
import {
  OPERATOR_SIGNATURES,
  expectedTypesAt,
  fieldTypeLookupOf,
  inferExpressionType,
  isOperatorAccepted,
  isTypeAccepted,
  paramSpecAt,
} from "./expression-types";
import { CTX, definitionOf, field } from "./form-test-support";
import { validateDefinition } from "./validate-definition";

const fields = [
  field("qty", "number"),
  field("title", "text"),
  field("start", "date"),
  field("tags", "multiSelect"),
  field("agree", "boolean"),
  field("proof", "upload"),
  field("approver", "reference"),
];
const typeOf = fieldTypeLookupOf(fields);

describe("@repo/domain/form 表達式型別表", () => {
  it("每個白名單運算子(var 以外)都有簽章", () => {
    const operators = EXPRESSION_OPERATORS.filter((item) => item !== "var");
    const signed = new Set(Object.keys(OPERATOR_SIGNATURES));
    expect(signed.size).toBe(operators.length);
    for (const operator of operators) {
      expect(signed.has(operator)).toBe(true);
    }
  });

  it("欄位型別:多選 = 選項(多個)、引用 = 文字、上傳不可進表達式", () => {
    expect(typeOf("qty")).toBe("number");
    expect(typeOf("tags")).toBe("optionList");
    expect(typeOf("approver")).toBe("text");
    expect(typeOf("proof")).toBeNull();
    expect(typeOf("missing")).toBeNull();
  });

  it("推斷回傳型別:運算看簽章、if 看「然後」、系統值有固定型別", () => {
    expect(inferExpressionType({ "+": [1, 2] }, typeOf)).toBe("number");
    expect(inferExpressionType({ ">": [{ var: "qty" }, 1] }, typeOf)).toBe(
      "boolean",
    );
    expect(
      inferExpressionType({ if: [{ var: "agree" }, null, "x"] }, typeOf),
    ).toBe("text");
    expect(inferExpressionType({ var: "ctx.now" }, typeOf)).toBe("datetime");
    expect(inferExpressionType({ var: "ctx.user.id" }, typeOf)).toBe("text");
    expect(inferExpressionType("2026-01-01T00:00:00.000Z", typeOf)).toBe(
      "datetime",
    );
    expect(inferExpressionType("2026-01-01", typeOf)).toBe("text");
    expect(inferExpressionType(["a"], typeOf)).toBe("list");
    expect(inferExpressionType(null, typeOf)).toBeNull();
  });

  it("位置過濾:加法只收數字、日期與日期時間互通、條件根只收回是 / 否的運算", () => {
    expect(isTypeAccepted("number", ["number"])).toBe(true);
    expect(isTypeAccepted("text", ["number"])).toBe(false);
    expect(isTypeAccepted("datetime", ["date"])).toBe(true);
    expect(isOperatorAccepted(">", ["boolean"])).toBe(true);
    expect(isOperatorAccepted("+", ["boolean"])).toBe(false);
    expect(isOperatorAccepted("if", ["boolean"])).toBe(true);
    expect(isOperatorAccepted("now", ["date"])).toBe(true);
  });

  it("參數期望:比較的右邊跟左邊同型別;if 的然後 = 節點被期望的型別;dateDiff 第三參數是單位", () => {
    expect(
      expectedTypesAt("==", 1, [{ var: "qty" }, null], ["boolean"], typeOf),
    ).toEqual(["number"]);
    expect(
      expectedTypesAt("if", 1, [null, null, null], ["text"], typeOf),
    ).toEqual(["text"]);
    expect(
      expectedTypesAt("dateDiff", 0, [null, null], ["number"], typeOf),
    ).toEqual(["date", "datetime"]);
    expect(paramSpecAt("dateDiff", 2)).toEqual({ kind: "dateUnit" });
    expect(paramSpecAt("+", 5)).toEqual({ kind: "types", types: ["number"] });
    expect(paramSpecAt("!", 1)).toBeNull();
  });
});

describe("dateDiff 第三參數(單位):選擇器先產生,計算與檢查器不因多一個參數出錯", () => {
  const expr = {
    dateDiff: [{ var: "start" }, "2026-01-10T16:00:00.000Z", "days"],
  };

  it("形狀檢查沒有問題、計算照日曆日差", () => {
    expect(scanExpression(expr).issues).toEqual([]);
    expect(
      evaluateExpression(expr, {
        values: { start: "2025-12-31T16:00:00.000Z" },
        ctx: CTX,
      }),
    ).toBe("10");
  });

  it("檢查器不報錯", () => {
    const report = validateDefinition(
      definitionOf([
        field("title", "text"),
        field("start", "date"),
        field("days", "number", {
          valueSource: { kind: "computed", expr },
        }),
      ]),
      { regexSafety: recheckRegexSafety },
    );
    expect(report.errors).toEqual([]);
  });
});
