import type { FieldOptionLike } from "../field-manager-types";

/** 彈窗的表單值;數字欄位在表單裡一律是字串,送出前才轉(空字串 = 0)。 */
export interface FieldForm {
  label: string;
  value: string;
  order: string;
  description: string;
}

/** 編輯時由既有選項帶入,新增時空白(`order` 缺席 = 0,GQL-06)。 */
export const toFieldForm = (field?: FieldOptionLike): FieldForm => ({
  label: field?.label ?? "",
  value: field?.value ?? "",
  order: field === undefined ? "" : String(field.order),
  description: field?.description ?? "",
});
