import { describe, expect, it } from "@jest/globals";

import {
  ALLOW_CUSTOM_WIDGETS,
  DEFAULT_WIDGET_REGISTRY,
  type FieldDef,
} from "@repo/domain/form";

import { field } from "@/test/msw/form-fixtures";

import { propertySectionsOf } from "./property-sections";

const sectionsOf = (target: FieldDef) =>
  propertySectionsOf(
    target,
    DEFAULT_WIDGET_REGISTRY[target.type],
    ALLOW_CUSTOM_WIDGETS,
  );

describe("屬性面板依型別(Spec 6a §5 表 A)", () => {
  it("單行文字:長度、格式 / 正則、自訂驗證;沒有元件下拉、沒有數值 / 日期範圍", () => {
    expect(sectionsOf(field("name", "名稱", "text"))).toMatchObject({
      widget: false,
      valueSource: true,
      lengthRange: true,
      textFormat: true,
      numberRange: false,
      dateRange: false,
      custom: true,
      readonlyWhen: true,
    });
  });

  it("多行文字有列數、長度,沒有格式;數字有單位與數值範圍", () => {
    expect(
      sectionsOf(
        field("note", "備註", "multiline", { widget: { kind: "textArea" } }),
      ),
    ).toMatchObject({ widgetRows: true, lengthRange: true, textFormat: false });
    expect(
      sectionsOf(
        field("qty", "數量", "number", { widget: { kind: "number" } }),
      ),
    ).toMatchObject({
      widgetUnit: true,
      numberRange: true,
      lengthRange: false,
    });
  });

  it("是否:有元件下拉(開關 / 勾選框)、沒有自訂驗證", () => {
    expect(
      sectionsOf(
        field("ok", "同意", "boolean", { widget: { kind: "switch" } }),
      ),
    ).toMatchObject({ widget: true, custom: false, readonlyWhen: true });
  });

  it("上傳與引用不顯示值來源;上傳沒有預設值與自訂驗證,引用要設資料來源", () => {
    expect(
      sectionsOf(
        field("proof", "附件", "upload", { widget: { kind: "upload" } }),
      ),
    ).toMatchObject({ valueSource: false, defaultValue: false, custom: false });
    expect(
      sectionsOf(
        field("who", "指定人", "reference", {
          widget: { kind: "referencePicker" },
        }),
      ),
    ).toMatchObject({
      valueSource: false,
      referenceSource: true,
      custom: true,
    });
  });

  it("單選:只有可搜尋才有「允許清單外的值」;值來源是公式 / 固定值時隱藏它與鎖定條件、預設值", () => {
    const store = field("store", "店家", "select", {
      widget: { kind: "autocomplete" },
    });
    expect(sectionsOf(store)).toMatchObject({
      options: true,
      allowCustom: true,
      readonlyWhen: true,
      defaultValue: true,
    });
    expect(
      sectionsOf({ ...store, widget: { kind: "dropdown" } }).allowCustom,
    ).toBe(false);
    expect(
      sectionsOf({ ...store, valueSource: { kind: "constant", value: "px" } }),
    ).toMatchObject({
      allowCustom: false,
      readonlyWhen: false,
      defaultValue: false,
      options: true,
    });
  });

  it("日期時間:有日期上下限、預設值;上傳:檔型 / 大小上限,沒有預設值", () => {
    expect(
      sectionsOf(
        field("start_at", "開始時間", "datetime", {
          widget: { kind: "dateTimePicker" },
        }),
      ),
    ).toMatchObject({
      dateRange: true,
      numberRange: false,
      defaultValue: true,
      uploadLimits: false,
    });
    expect(
      sectionsOf(
        field("proof", "附件", "upload", { widget: { kind: "upload" } }),
      ),
    ).toMatchObject({
      uploadLimits: true,
      defaultValue: false,
      valueSource: false,
      dateRange: false,
    });
  });
});
