import { BANK_ACCOUNT_LIMITS } from "@repo/domain/project/lottery-accounts";

import {
  type FieldErrorTexts,
  fieldErrorTextsOf,
  fieldErrorsByCodeOf,
} from "@/lib/base/field-errors";
import { accountsErrorOf } from "@/lib/project/lottery/accounts-error";

/** 金額顯示(千分位)。 */
export const moneyText = (value: number): string =>
  value.toLocaleString("en-US");

/**
 * 按鈕的字(`admin.lotteryAccounts.settlement.buttons.*`):付款方 out = 付款、in = 收到退款;
 * 收款方 in = 收款、out = 退款。
 */
export const buttonLabelKey = (
  role: "payer" | "payee",
  button: "out" | "in",
): string => `settlement.buttons.${role}.${button}`;

/** `admin.lotteryAccounts` 的翻譯函式(帶變數)。 */
type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * 收付 / 沖正視窗每一欄的格式要求(REACT-18;規則正本 api `settlement/`;文案沿用帳戶的
 * `fieldErrors.*`)。key 寫成字面值,死鍵掃描看得到。
 */
const FORMAT_TEXTS: Record<string, [string, Record<string, string>?]> = {
  amount: ["fieldErrors.positiveInteger"],
  accountId: ["fieldErrors.required"],
  cashSource: ["fieldErrors.choose"],
  handler: ["fieldErrors.required"],
  method: ["fieldErrors.choose"],
  reason: [
    "fieldErrors.requiredText",
    { max: String(BANK_ACCOUNT_LIMITS.summary) },
  ],
};

const settlementFormatText = (t: Translate, field: string): string => {
  const [key, values] = FORMAT_TEXTS[field] ?? ["fieldErrors.choose"];
  return t(key, values);
};

/** 送出前檢查沒過的欄位 → 各欄的格式要求。 */
export const settlementFormatErrorsOf = <Field extends string>(
  invalid: readonly Field[],
  t: Translate,
): FieldErrorTexts<Field> =>
  fieldErrorTextsOf(invalid, invalid, (field) =>
    settlementFormatText(t, field),
  );

/**
 * api 錯誤 → 欄位下的原因與視窗提示(REACT-18):細分過的碼(帳戶不能用、沒有開著的班、超過小金庫……)
 * 寫在指到的欄位下,`VALIDATION_FAILED` 寫格式要求;有欄位錯誤時提示只放通用句。
 */
export const settlementErrorTextsOf = <Field extends string>(
  error: unknown,
  formFields: readonly Field[],
  t: Translate,
): { texts: FieldErrorTexts<Field>; summary: string } =>
  fieldErrorsByCodeOf(accountsErrorOf(error), formFields, {
    formatText: (field) => settlementFormatText(t, field),
    codeText: (code) => t(`errors.${code}`),
  });
