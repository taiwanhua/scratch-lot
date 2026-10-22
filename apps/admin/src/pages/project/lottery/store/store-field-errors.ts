import {
  type FieldErrorTexts,
  fieldErrorTextsOf,
  fieldErrorsByCodeOf,
} from "@/lib/base/field-errors";
import { storeErrorOf } from "@/lib/project/lottery/store-error";

/** `admin.lotteryStore` 的翻譯函式。 */
type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * 店面對話框每一欄的格式要求(REACT-18;規則正本 api `store/store-cash.service.ts`、
 * `store-shifts.service.ts`、`daily-close/`):送出前檢查沒過、或 api 只回欄位沒有原因時寫在欄位下的那一句。
 * 原因欄(`reasonKey` / `reasonNote`)的預設句在 `ReasonFields`。key 寫成字面值,死鍵掃描看得到。
 */
const FORMAT_TEXTS: Record<string, string> = {
  amount: "fieldErrors.positiveInteger",
  floatFromVault: "fieldErrors.nonNegativeInteger",
  scheduleEntryId: "fieldErrors.entry",
  accountId: "fieldErrors.required",
  reasonKey: "fieldErrors.reasonKey",
  reasonNote: "fieldErrors.reasonNote",
  reason: "fieldErrors.required",
  refundShift: "fieldErrors.required",
  lines: "fieldErrors.lines",
};

export const storeFormatText = (t: Translate, field: string): string =>
  t(FORMAT_TEXTS[field] ?? "fieldErrors.choose");

/** 送出前檢查沒過的欄位 → 各欄的格式要求。 */
export const storeFormatErrorsOf = <Field extends string>(
  invalid: readonly Field[],
  t: Translate,
): FieldErrorTexts<Field> =>
  fieldErrorTextsOf(invalid, invalid, (field) => storeFormatText(t, field));

/**
 * api 錯誤 → 欄位下的原因與對話框提示:細分過的碼(`AMOUNT_EXCEEDS_DRAWER`、`ENTRY_NOT_AVAILABLE`、
 * `PERIOD_CLOSED`…)寫原因,`VALIDATION_FAILED`(沒有原因)寫該欄的格式要求;有欄位錯誤時提示只放通用句。
 */
export const storeErrorTextsOf = <Field extends string>(
  error: unknown,
  formFields: readonly Field[],
  t: Translate,
): { texts: FieldErrorTexts<Field>; summary: string } =>
  fieldErrorsByCodeOf(storeErrorOf(error), formFields, {
    formatText: (field) => storeFormatText(t, field),
    codeText: (code) => t(`errors.${code}`),
  });
