import { DEALER_TEXT_LIMITS } from "@repo/domain/project/lottery";

import {
  type FieldErrorTexts,
  fieldErrorTextsOf,
} from "@/lib/base/field-errors";

import { type DealersError, dealersErrorKey } from "./dealers-error";

/** `admin.lotteryDealers` 的翻譯函式(帶變數)。 */
type Translate = (key: string, values?: Record<string, string>) => string;

const max = (value: number) => ({ max: String(value) });

/**
 * 經銷商與關係人表單每一欄的格式要求(REACT-18;規則正本 api `dealer-validation.ts`,
 * 規格 5.2、5.3;長度上限 `DEALER_TEXT_LIMITS`):api 只回欄位、沒有原因時寫在欄位下的那一句。key 寫成字面值,死鍵掃描看得到。
 */
const FORMAT_TEXTS: Record<string, [string, Record<string, string>?]> = {
  type: ["form.fieldErrors.choose"],
  licenseNo: ["form.fieldErrors.licenseNo"],
  name: ["form.fieldErrors.requiredText", max(DEALER_TEXT_LIMITS.name)],
  status: ["form.fieldErrors.choose"],
  licenseApprovedAt: ["form.fieldErrors.requiredDate"],
  licenseExpiresAt: ["form.fieldErrors.requiredDate"],
  lastPurchaseBaseDate: ["form.fieldErrors.date"],
  lastSelfPurchaseBaseDate: ["form.fieldErrors.date"],
  coSalesDealer: ["form.fieldErrors.choose"],
  agents: ["form.fieldErrors.choose"],
  trustees: ["form.fieldErrors.choose"],
  introducers: ["form.fieldErrors.choose"],
  storeOrgId: ["form.fieldErrors.choose"],
  storeName: ["form.fieldErrors.maxLength", max(DEALER_TEXT_LIMITS.storeName)],
  businessAddress: [
    "form.fieldErrors.maxLength",
    max(DEALER_TEXT_LIMITS.businessAddress),
  ],
  storePhone: ["form.fieldErrors.digits", max(DEALER_TEXT_LIMITS.storePhone)],
  terminalNo: [
    "form.fieldErrors.maxLength",
    max(DEALER_TEXT_LIMITS.terminalNo),
  ],
  rentFee: ["form.fieldErrors.rentFee"],
  rentCycle: ["form.fieldErrors.choose"],
  rentStartMonth: ["form.fieldErrors.choose"],
  rentDueDay: ["form.fieldErrors.rentDueDay"],
  nationalId: ["form.fieldErrors.nationalId"],
  birthday: ["form.fieldErrors.date"],
  phone: ["form.fieldErrors.digits", max(DEALER_TEXT_LIMITS.phone)],
  mobile: ["form.fieldErrors.digits", max(DEALER_TEXT_LIMITS.mobile)],
  email: ["form.fieldErrors.email", max(DEALER_TEXT_LIMITS.email)],
  mailingAddress: [
    "form.fieldErrors.maxLength",
    max(DEALER_TEXT_LIMITS.mailingAddress),
  ],
  residentialAddress: [
    "form.fieldErrors.maxLength",
    max(DEALER_TEXT_LIMITS.residentialAddress),
  ],
  residentialSameAsMailing: ["form.fieldErrors.choose"],
  note: ["form.fieldErrors.maxLength", max(DEALER_TEXT_LIMITS.note)],
  shareOrgs: ["form.fieldErrors.choose"],
  roles: ["form.fieldErrors.roles"],
  quarter: ["form.fieldErrors.choose"],
  signedAt: ["form.fieldErrors.requiredDate"],
};

/** 一欄的格式要求文案(表單上沒登記的欄位退回「請重新選擇 / 填寫」)。 */
export const dealerFormatText = (t: Translate, field: string): string => {
  const [key, values] = FORMAT_TEXTS[field] ?? ["form.fieldErrors.choose"];
  return t(key, values);
};

/**
 * api 錯誤 → 欄位下的原因:有認得的 `reason`(重複、人數上限、被占用…)就寫原因,
 * 沒有就寫該欄的格式要求。`toFormKey` 把 api 的欄位名換成表單 key(關聯欄位不同名)。
 */
export const dealerFieldErrorsOf = <Field extends string>(
  error: DealersError,
  formFields: readonly Field[],
  t: Translate,
  toFormKey: (field: string) => string | null = (field) => field,
): FieldErrorTexts<Field> =>
  fieldErrorTextsOf(
    (error.fields ?? [])
      .map((field) => toFormKey(field))
      .filter((field): field is string => field !== null),
    formFields,
    (field) =>
      error.reason === undefined
        ? dealerFormatText(t, field)
        : t(`errors.${dealersErrorKey(error)}`),
  );
