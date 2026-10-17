import type { FieldDef } from "@repo/domain/form";

/** 決定輸入元件的欄位屬性(型別、選項、元件;類別 / lookup 選項查詢要 key)。 */
export type TypedValueField = Pick<
  FieldDef,
  "key" | "label" | "type" | "options" | "widget" | "rules"
>;

/**
 * 值的形狀:
 * - `stored`:存值(Spec §5「值的存法」)—— 固定值、預設值、日期上下限;數字存十進位字串、
 *   類別 / lookup 選項存 `{ value, label }`
 * - `expression`:表達式常數(語意值)—— 數字存 number、選項存 value 字串(多選 = value 陣列)
 */
export type TypedValueShape = "stored" | "expression";
