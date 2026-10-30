import { describe, expect, it } from "@jest/globals";

import {
  listBuiltinColumnsOf,
  listTemplateFieldKeysOf,
  listTemplatePlaceholdersOf,
  renderListTemplate,
} from "./list-settings";

describe("列表內建欄開關", () => {
  it("沒存過或不是 boolean 的鍵 = 顯示;存了 false 就關", () => {
    expect(listBuiltinColumnsOf(null)).toEqual({
      form: true,
      status: true,
      createdBy: true,
    });
    expect(listBuiltinColumnsOf({ form: false, status: "no" })).toEqual({
      form: false,
      status: true,
      createdBy: true,
    });
  });
});

describe("組合欄模板", () => {
  it("佔位符分成槽、表單欄位與不認得的寫法", () => {
    expect(
      listTemplatePlaceholdersOf(
        "{{ serialNo }}:{{value.start_at}}–{{value.end_at}} {{applicant}} {{value.}} {{value.Bad-Key}}",
      ),
    ).toEqual([
      { kind: "slot", slot: "serialNo", format: null },
      { kind: "field", key: "start_at", format: null },
      { kind: "field", key: "end_at", format: null },
      { kind: "invalid", name: "applicant" },
      { kind: "invalid", name: "value." },
      { kind: "invalid", name: "value.Bad-Key" },
    ]);
  });

  it("日期佔位符可加格式字串(`|` 後面,token 對齊 dayjs);格式不合法或非日期槽加格式 = 不認得", () => {
    expect(
      listTemplatePlaceholdersOf(
        "{{value.start_at|HH:mm}}–{{ value.end_at | HH:mm }} {{date|YYYY/MM/DD}} {{value.at|YYYY-MM-DD[T]HH:mm:ss}}",
      ),
    ).toEqual([
      { kind: "field", key: "start_at", format: "HH:mm" },
      { kind: "field", key: "end_at", format: "HH:mm" },
      { kind: "slot", slot: "date", format: "YYYY/MM/DD" },
      { kind: "field", key: "at", format: "YYYY-MM-DD[T]HH:mm:ss" },
    ]);
    expect(
      listTemplatePlaceholdersOf(
        "{{value.a|}} {{value.a|time}} {{value.a|MMM}} {{value.a|-}} {{title|HH:mm}} {{value.Bad|HH:mm}}",
      ).map((one) => one.kind),
    ).toEqual([
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
    ]);
  });

  it("加了格式的欄位一樣算引用", () => {
    expect(listTemplateFieldKeysOf("{{value.a|HH:mm}}–{{value.a}}")).toEqual([
      "a",
    ]);
  });

  it("引用的欄位 key 去重、依第一次出現的順序", () => {
    expect(
      listTemplateFieldKeysOf(
        "{{value.end_at}} {{title}} {{value.start_at}} {{value.end_at}}",
      ),
    ).toEqual(["end_at", "start_at"]);
  });

  it("套模板:沒值的佔位符換空字串、不認得的寫法不呼叫 resolve,結果去頭尾空白", () => {
    const seen: string[] = [];
    const text = renderListTemplate(
      " {{value.start_at}}–{{value.end_at}}{{nope}} ",
      (placeholder) => {
        seen.push(
          placeholder.kind === "field" ? placeholder.key : placeholder.slot,
        );
        return placeholder.kind === "field" && placeholder.key === "start_at"
          ? "09:00"
          : null;
      },
    );
    expect(text).toBe("09:00–");
    expect(seen).toEqual(["start_at", "end_at"]);
    expect(
      renderListTemplate("{{title}}({{amount}})", (placeholder) =>
        placeholder.kind === "slot" ? `<${placeholder.slot}>` : null,
      ),
    ).toBe("<title>(<amount>)");
  });
});
