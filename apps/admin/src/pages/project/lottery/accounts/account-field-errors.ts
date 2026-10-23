import { BANK_ACCOUNT_LIMITS } from "@repo/domain/project/lottery-accounts";

import {
  type FieldErrorTexts,
  fieldErrorTextsOf,
  fieldErrorsByCodeOf,
} from "@/lib/base/field-errors";
import type { AccountsError } from "@/lib/project/lottery/accounts-error";

/** `admin.lotteryAccounts` 的翻譯函式(帶變數)。 */
type Translate = (key: string, values?: Record<string, string>) => string;

const max = (value: number) => ({ max: String(value) });

/**
 * 帳戶管理表單每一欄的格式要求(REACT-18;規則正本 api `bank-accounts.service.ts` 的 `checkValues`、
 * `bank-transactions.service.ts` 的 `parseRecordInput`,長度上限 `BANK_ACCOUNT_LIMITS`):
 * 送出前檢查沒過、或 api 只回欄位沒有原因時寫在欄位下的那一句。key 寫成字面值,死鍵掃描看得到。
 */
const FORMAT_TEXTS: Record<string, [string, Record<string, string>?]> = {
  bankCode: ["fieldErrors.bankCode"],
  branchName: ["fieldErrors.maxLength", max(BANK_ACCOUNT_LIMITS.branchName)],
  accountNo: ["fieldErrors.requiredText", max(BANK_ACCOUNT_LIMITS.accountNo)],
  accountName: [
    "fieldErrors.requiredText",
    max(BANK_ACCOUNT_LIMITS.accountName),
  ],
  openingBalance: ["fieldErrors.integer"],
  openingDate: ["fieldErrors.requiredDate"],
  shareOrgs: ["fieldErrors.choose"],
  type: ["fieldErrors.choose"],
  direction: ["fieldErrors.required"],
  refId: ["fieldErrors.required"],
  amount: ["fieldErrors.positiveInteger"],
  occurredAt: ["fieldErrors.requiredTime"],
  branchOrgId: ["fieldErrors.required"],
  summary: ["fieldErrors.summary", max(BANK_ACCOUNT_LIMITS.summary)],
  reason: ["fieldErrors.requiredText", max(BANK_ACCOUNT_LIMITS.summary)],
};

export const accountFormatText = (t: Translate, field: string): string => {
  const [key, values] = FORMAT_TEXTS[field] ?? ["fieldErrors.choose"];
  return t(key, values);
};

/** 送出前檢查沒過的欄位 → 各欄的格式要求。 */
export const accountFormatErrorsOf = <Field extends string>(
  invalid: readonly Field[],
  t: Translate,
): FieldErrorTexts<Field> =>
  fieldErrorTextsOf(invalid, invalid, (field) => accountFormatText(t, field));

/**
 * api 錯誤 → 欄位下的原因與對話框提示:細分過的碼(`BANK_ACCOUNT_DUPLICATE` 等,`accountsErrorOf` 由
 * `reason` 細分)寫原因,`VALIDATION_FAILED`(沒有原因)寫該欄的格式要求;有欄位錯誤時提示只放通用句。
 */
export const accountErrorTextsOf = <Field extends string>(
  error: AccountsError,
  formFields: readonly Field[],
  t: Translate,
): { texts: FieldErrorTexts<Field>; summary: string } =>
  fieldErrorsByCodeOf(error, formFields, {
    formatText: (field) => accountFormatText(t, field),
    codeText: (code) => t(`errors.${code}`),
  });
