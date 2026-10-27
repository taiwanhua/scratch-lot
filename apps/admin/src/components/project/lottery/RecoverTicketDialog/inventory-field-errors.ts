import {
  type FieldErrorTexts,
  fieldErrorTextsOf,
  fieldErrorsByCodeOf,
} from "@/lib/base/field-errors";
import { inventoryErrorOf } from "@/lib/project/lottery/inventory-error";

/** `admin.lotteryInventory` 的翻譯函式。 */
type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * 庫存管理對話框每一欄的格式要求(REACT-18;規則正本 api `lottery/tickets/`、`inventory/`):
 * 送出前檢查沒過、或 api 只回欄位沒有原因時寫在欄位下的那一句。原因欄(`reasonKey` / `reasonNote`)
 * 的預設句在 `ReasonFields`。key 寫成字面值,死鍵掃描看得到。
 */
const FORMAT_TEXTS: Record<string, string> = {
  orgId: "fieldErrors.store",
  reasonKey: "reason.keyError",
  reasonNote: "reason.noteError",
};

export const inventoryFormatText = (t: Translate, field: string): string =>
  t(FORMAT_TEXTS[field] ?? "fieldErrors.check");

/** 送出前檢查沒過的欄位 → 各欄的格式要求。 */
export const inventoryFormatErrorsOf = <Field extends string>(
  invalid: readonly Field[],
  t: Translate,
): FieldErrorTexts<Field> =>
  fieldErrorTextsOf(invalid, invalid, (field) => inventoryFormatText(t, field));

/**
 * api 錯誤 → 欄位下的原因與提示:細分過的碼(`RECOVER_TARGET_NOT_STORE` 等)寫原因,
 * `VALIDATION_FAILED`(沒有原因)寫該欄的格式要求;有欄位錯誤時提示只放通用句。
 */
export const inventoryErrorTextsOf = <Field extends string>(
  error: unknown,
  formFields: readonly Field[],
  t: Translate,
): { texts: FieldErrorTexts<Field>; summary: string } =>
  fieldErrorsByCodeOf(inventoryErrorOf(error), formFields, {
    formatText: (field) => inventoryFormatText(t, field),
    codeText: (code) => t(`errors.${code}`),
  });
