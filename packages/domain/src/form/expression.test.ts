import { describe, expect, it } from "@jest/globals";

import { computeAll } from "./compute";
import {
  ExpressionError,
  evaluateCondition,
  evaluateExpression,
} from "./expression";
import { MAX_EXPRESSION_DEPTH } from "./expression-shape";
import { CTX, field } from "./form-test-support";
import { semanticValuesOf } from "./semantic";
import type { Expression } from "./types";

const evaluate = (expr: Expression, values: Record<string, unknown> = {}) =>
  evaluateExpression(expr, { values, ctx: CTX });

describe("@repo/domain/form 表達式:var 取語意值", () => {
  const fields = [
    field("leave_type", "select"),
    field("tags", "multiSelect"),
    field("approver", "reference"),
    field("proof", "upload"),
  ];
  const stored = {
    leave_type: { value: "sick", label: "病假" },
    tags: [{ value: "a", label: "甲" }, "b"],
    approver: { id: "user-9", label: "王小明" },
    proof: {
      path: "uploads/x.pdf",
      name: "x.pdf",
      size: 1,
      contentType: "application/pdf",
    },
  };
  const semantic = semanticValuesOf(fields, stored);

  it("select 存 { value, label } 時,leave_type == 'sick' 直接成立", () => {
    expect(
      evaluateCondition(
        { "==": [{ var: "leave_type" }, "sick"] },
        { values: semantic, ctx: CTX },
      ),
    ).toBe(true);
  });

  it("multiSelect → value[]、reference → id、upload → name", () => {
    expect(semantic).toEqual({
      leave_type: "sick",
      tags: ["a", "b"],
      approver: "user-9",
      proof: "x.pdf",
    });
    expect(
      evaluateCondition(
        { in: ["b", { var: "tags" }] },
        { values: semantic, ctx: CTX },
      ),
    ).toBe(true);
  });

  it("optionLabel 取顯示名:存的 label 或靜態選項定義的 label", () => {
    const input = { values: semantic, ctx: CTX, fields, stored };
    expect(evaluateExpression({ optionLabel: "leave_type" }, input)).toBe(
      "病假",
    );
    const staticStored = { leave_type: "annual" };
    expect(
      evaluateExpression(
        { optionLabel: "leave_type" },
        { ...input, stored: staticStored },
      ),
    ).toBe("特休");
  });
});

describe("@repo/domain/form 表達式:上下文 ctx.* 與擴充函式", () => {
  it("ctx.user.id / ctx.user.orgId / ctx.timezone 走上下文", () => {
    expect(evaluate({ var: "ctx.user.id" })).toBe("user-1");
    expect(evaluate({ var: "ctx.user.orgId" })).toBe("org-1");
    expect(evaluate({ var: "ctx.timezone" })).toBe("Asia/Taipei");
  });

  it("ctx.user.orgIds(所屬組織全部)/ ctx.tenant.id 走上下文,可用於 in", () => {
    expect(evaluate({ var: "ctx.user.orgIds" })).toEqual(["org-1"]);
    expect(evaluate({ var: "ctx.tenant.id" })).toBe("tenant-1");
    expect(evaluate({ in: ["org-1", { var: "ctx.user.orgIds" }] })).toBe(true);
    expect(evaluate({ in: ["org-2", { var: "ctx.user.orgIds" }] })).toBe(false);
  });

  it("now 注入:回 ctx.now,不是真正的現在", () => {
    expect(evaluate({ now: [] })).toBe(CTX.now);
  });

  it("dateDiff 以租戶時區的日曆日計(台北 3/1 09:00 到 3/3 00:00 = 2 天)", () => {
    expect(
      evaluate({ dateDiff: [{ now: [] }, "2026-03-02T16:00:00.000Z"] }),
    ).toBe("2");
    expect(
      evaluate({ dateDiff: [{ var: "start" }, "2026-03-02T16:00:00.000Z"] }),
    ).toBeNull();
  });

  it("concat 串接,空值當空字串", () => {
    expect(evaluate({ concat: ["A", { var: "missing" }, 1] })).toBe("A1");
  });
});

describe("@repo/domain/form 表達式:數值", () => {
  it("中間過程不取位,只有最終結果取 precision:(1/3)*3 → 1.00", () => {
    const total = field("total", "number", {
      precision: 2,
      valueSource: {
        kind: "computed",
        expr: { "*": [{ "/": [1, 3] }, 3] },
      },
    });
    expect(computeAll([total], { values: {}, ctx: CTX })).toEqual({
      total: "1.00",
    });
  });

  it("decimal 字串的存值可算、可比(10 > 9 不是字典序)", () => {
    expect(evaluate({ "+": [{ var: "a" }, "0.2"] }, { a: "0.1" })).toBe("0.3");
    expect(
      evaluateCondition(
        { ">": [{ var: "qty" }, 9] },
        { values: { qty: "10" }, ctx: CTX },
      ),
    ).toBe(true);
  });

  it("除以零與空值 → null", () => {
    expect(evaluate({ "/": [1, 0] })).toBeNull();
    expect(evaluate({ "*": [{ var: "qty" }, 2] }, { qty: null })).toBeNull();
  });

  it("computed 依賴拓樸排序:total_tax 引用 total,宣告順序相反也算得出來", () => {
    const fields = [
      field("total_tax", "number", {
        precision: 0,
        valueSource: {
          kind: "computed",
          expr: { "*": [{ var: "total" }, "1.05"] },
        },
      }),
      field("total", "number", {
        precision: 2,
        valueSource: {
          kind: "computed",
          expr: { "*": [{ var: "qty" }, { var: "unit_price" }] },
        },
      }),
      field("qty", "number"),
      field("unit_price", "number", { precision: 2 }),
    ];
    expect(
      computeAll(fields, {
        values: { qty: "3", unit_price: "33.33" },
        ctx: CTX,
      }),
    ).toEqual({ total: "99.99", total_tax: "105" });
  });
});

describe("@repo/domain/form 表達式:限制", () => {
  it("未知運算子(含正則類)在求值前就拒絕", () => {
    expect(() => evaluate({ regex: ["a", "b"] })).toThrow(ExpressionError);
    expect(() => evaluate({ map: [[1], { var: "" }] })).toThrow(
      ExpressionError,
    );
  });

  it("var 只能讀欄位 key 或 ctx.*", () => {
    expect(() => evaluate({ var: "$form" })).toThrow(ExpressionError);
    expect(() => evaluate({ var: "ctx.secret" })).toThrow(ExpressionError);
  });

  it(`深度超過 ${String(MAX_EXPRESSION_DEPTH)} 拒絕`, () => {
    let deep: Expression = 1;
    for (let level = 0; level <= MAX_EXPRESSION_DEPTH; level += 1) {
      deep = { "+": [deep, 1] };
    }
    expect(() => evaluate(deep)).toThrow(/TOO_DEEP/);
  });

  it("節點超過 200 拒絕", () => {
    expect(() =>
      evaluate({ "+": Array.from({ length: 200 }, () => 1) }),
    ).toThrow(/TOO_MANY_NODES/);
  });
});

describe("@repo/domain/form 表達式:文字比較與存值收斂", () => {
  it("文字的 < / > 是字碼比較(與 JSONLogic 原生相同,不吃語系)", () => {
    expect(
      evaluateCondition({ "<": ["B", "a"] }, { values: {}, ctx: CTX }),
    ).toBe(true);
    expect(
      evaluateCondition(
        { "<": ["2026-02-28", "2026-03-01"] },
        {
          values: {},
          ctx: CTX,
        },
      ),
    ).toBe(true);
  });

  it("date 型別的計算結果收斂成租戶時區當天 00:00 的 ISO(now 是此刻)", () => {
    // CTX.now = 2026-03-01T01:00Z,台北是 3/1 09:00
    expect(
      computeAll(
        [
          field("today", "date", {
            valueSource: { kind: "computed", expr: { now: [] } },
          }),
        ],
        {
          values: {},
          ctx: CTX,
        },
      ),
    ).toEqual({ today: "2026-02-28T16:00:00.000Z" });
  });

  it("number 的固定值依 precision 取位", () => {
    expect(
      computeAll(
        [
          field("rate", "number", {
            precision: 2,
            valueSource: { kind: "constant", value: "1.005" },
          }),
        ],
        { values: {}, ctx: CTX },
      ),
    ).toEqual({ rate: "1.01" });
  });
});
