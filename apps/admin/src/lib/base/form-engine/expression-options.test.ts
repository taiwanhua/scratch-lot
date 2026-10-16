import { describe, expect, it } from "@jest/globals";

import { field } from "@/test/msw/form-fixtures";

import {
  conditionFieldsOf,
  initialExpressionOf,
  optionTargetAt,
  positionOptionsOf,
} from "./expression-options";
import { operationNode, withOperator } from "./expression-tree";

const fields = [
  field("qty", "數量", "number"),
  field("title", "標題", "text"),
  field("start", "開始日", "date"),
  field("agree", "同意", "boolean"),
  field("tags", "標籤", "multiSelect"),
  field("proof", "附件", "upload"),
  field("secret", "成本", "number", {
    permission: { show: true, edit: false },
  }),
];

const keysOf = (items: readonly { key: string }[]) =>
  items.map((item) => item.key);

describe("表達式選擇器:根節點依用途過濾(Spec 6a §5 表 B)", () => {
  it("條件的根:只有回是 / 否的運算與是 / 否欄位;常數與系統值不能單獨當根", () => {
    const root = positionOptionsOf(
      {
        expected: ["boolean"],
        usage: "condition",
        isRoot: true,
        allowNull: false,
        optionTarget: null,
      },
      fields,
    );
    expect(root.kinds).toEqual(["field", "operation"]);
    expect(keysOf(root.fields)).toEqual(["agree"]);
    expect(root.operators).toEqual(
      expect.arrayContaining(["==", ">", "and", "or", "!", "in", "if"]),
    );
    expect(root.operators).not.toContain("+");
    expect(root.operators).not.toContain("concat");
    expect(root.operators).not.toContain("dateDiff");
  });

  it("數字欄的公式根:數字欄、數字常數、回數字的運算;系統值只有型別對得上的(沒有)", () => {
    const root = positionOptionsOf(
      {
        expected: ["number"],
        usage: "formula",
        isRoot: true,
        allowNull: false,
        optionTarget: null,
      },
      fields,
    );
    expect(root.kinds).toEqual(["field", "constant", "operation"]);
    expect(keysOf(root.fields)).toEqual(["qty", "secret"]);
    expect(root.constants).toEqual(["number"]);
    expect(root.operators).toEqual(
      expect.arrayContaining(["+", "*", "dateDiff", "if"]),
    );
    expect(root.operators).not.toContain("==");
  });

  it("文字欄的公式根可單獨用系統值「填寫者 / 填寫者的組織」,不列時區;日期位置可用現在時間", () => {
    const text = positionOptionsOf(
      {
        expected: ["text"],
        usage: "formula",
        isRoot: true,
        allowNull: false,
        optionTarget: null,
      },
      fields,
    );
    expect(text.contexts).toEqual(["ctx.user.id", "ctx.user.orgId"]);
    const date = positionOptionsOf(
      {
        expected: ["date"],
        usage: "formula",
        isRoot: false,
        allowNull: false,
        optionTarget: null,
      },
      fields,
    );
    expect(date.contexts).toEqual(["ctx.now"]);
    expect(keysOf(date.fields)).toEqual(["start"]);
  });

  it("參數位置:加法只收數字;包含的第二個參數只收清單;上傳欄永遠不列", () => {
    const plus = positionOptionsOf(
      {
        expected: ["number"],
        usage: "condition",
        isRoot: false,
        allowNull: false,
        optionTarget: null,
      },
      fields,
    );
    expect(keysOf(plus.fields)).toEqual(["qty", "secret"]);
    const list = positionOptionsOf(
      {
        expected: ["list"],
        usage: "condition",
        isRoot: false,
        allowNull: false,
        optionTarget: null,
      },
      fields,
    );
    expect(keysOf(list.fields)).toEqual(["tags"]);
    expect(list.constants).toEqual(["list"]);
    const any = positionOptionsOf(
      {
        expected: null,
        usage: "condition",
        isRoot: false,
        allowNull: true,
        optionTarget: null,
      },
      fields,
    );
    expect(keysOf(any.fields)).not.toContain("proof");
    // 空值不是常數種類:比較的參數沒選 = 空值(空位)
    expect(any.constants).not.toContain("null");
  });

  it("條件不列受保護欄位;顯示條件不列自己", () => {
    expect(keysOf(conditionFieldsOf(fields, "qty", false))).toEqual([
      "title",
      "start",
      "agree",
      "tags",
      "proof",
    ]);
    expect(keysOf(conditionFieldsOf(fields, "qty", true))).toContain("qty");
  });

  it("起點:數字 → 相乘、文字 → 串接、是 / 否 → 等於;dateDiff 預設單位 days;同族換運算子保留參數", () => {
    expect(initialExpressionOf(["number"])).toEqual({ "*": [null, null] });
    expect(initialExpressionOf(["text"])).toEqual({ concat: [null, null] });
    expect(initialExpressionOf(["boolean"])).toEqual({ "==": [null, null] });
    expect(operationNode("dateDiff")).toEqual({
      dateDiff: [null, null, "days"],
    });
    expect(withOperator({ "==": [{ var: "qty" }, 1] }, "!=")).toEqual({
      "!=": [{ var: "qty" }, 1],
    });
    // 換到且 / 或:條件位置預設放「等於」比較
    expect(withOperator({ "==": [{ var: "qty" }, 1] }, "and")).toEqual({
      and: [{ "==": [null, null] }, { "==": [null, null] }],
    });
    expect(operationNode("if")).toEqual({
      if: [{ "==": [null, null] }, null, null],
    });
    expect(operationNode("dateAdd")).toEqual({
      dateAdd: [null, "after", 1, "days"],
    });
  });
});

const LEAVE_OPTIONS = {
  kind: "static" as const,
  items: [
    { value: "sick", label: "病假", order: 1, enabled: true },
    { value: "annual", label: "特休", order: 2, enabled: true },
  ],
};

describe("表達式選擇器:選項欄公式的根是「選項」(表 B)", () => {
  const leave = field("demo.form", "假別", "select", {
    options: LEAVE_OPTIONS,
  });
  const previous = field("previous", "上次假別", "select", {
    options: LEAVE_OPTIONS,
  });
  const other = field("category", "類別", "select", {
    options: { kind: "fieldCategory", key: "gender" },
  });
  const many = field("many", "多選假別", "multiSelect", {
    options: LEAVE_OPTIONS,
  });
  const note = field("note", "備註", "text");
  const all = [leave, previous, other, many, note];

  it("單選的根:只列 if、同選項來源的欄位、選項常數;串接 / 選項顯示名 / 文字不列", () => {
    const root = positionOptionsOf(
      {
        expected: ["option"],
        usage: "formula",
        isRoot: true,
        allowNull: false,
        optionTarget: leave,
      },
      all,
    );
    expect(root.operators).toEqual(["if"]);
    expect(keysOf(root.fields)).toEqual(["demo.form", "previous"]);
    expect(root.constants).toEqual(["option"]);
    expect(root.contexts).toEqual([]);
  });

  it("多選的根:選項(多個)常數、同來源的多選欄", () => {
    const root = positionOptionsOf(
      {
        expected: ["optionList"],
        usage: "formula",
        isRoot: true,
        allowNull: false,
        optionTarget: many,
      },
      all,
    );
    expect(root.operators).toEqual(["if"]);
    expect(keysOf(root.fields)).toEqual(["many"]);
    expect(root.constants).toEqual(["optionList"]);
  });

  it("目標選項欄往下傳:if 的然後 / 否則沿用;等於 / in 的另一邊是選項欄時從它的選項挑", () => {
    const position = {
      expected: ["option" as const],
      usage: "formula" as const,
      isRoot: true,
      allowNull: false,
      optionTarget: leave,
    };
    const args = [{ "==": [null, null] }, null, null];
    expect(optionTargetAt("if", 1, args, position, all)).toBe(leave);
    expect(optionTargetAt("if", 2, args, position, all)).toBe(leave);
    expect(optionTargetAt("if", 0, args, position, all)).toBeNull();
    const condition = { ...position, expected: ["boolean" as const] };
    expect(
      optionTargetAt("==", 1, [{ var: "previous" }, null], condition, all),
    ).toBe(previous);
    expect(
      optionTargetAt("in", 1, [{ var: "demo.form" }, []], condition, all),
    ).toBe(leave);
    expect(
      optionTargetAt("==", 1, [{ var: "note" }, null], condition, all),
    ).toBeNull();
    // 和選項欄比較的一邊:文字常數換成選項常數
    const compared = positionOptionsOf(
      { ...condition, expected: ["text"], isRoot: false, optionTarget: leave },
      all,
    );
    expect(compared.constants).toEqual(["option"]);
  });

  it("日期位置:常數有日期 / 日期時間,日期加減列在運算裡", () => {
    const date = positionOptionsOf(
      {
        expected: ["date", "datetime"],
        usage: "formula",
        isRoot: false,
        allowNull: false,
        optionTarget: null,
      },
      all,
    );
    expect(date.constants).toEqual(["date", "datetime"]);
    expect(date.operators).toEqual(expect.arrayContaining(["dateAdd", "if"]));
    expect(date.operators).not.toContain("date");
  });
});
