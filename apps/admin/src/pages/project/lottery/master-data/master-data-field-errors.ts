import {
  CASH_POINT_NAME_MAX_LENGTH,
  DEFAULT_RATE_MAX,
  DEFAULT_RATE_MIN,
  GAME_NAME_MAX_LENGTH,
  MASTER_DATA_NOTE_MAX_LENGTH,
  TICKETS_PER_BOOK_MAX,
  TICKETS_PER_BOOK_MIN,
} from "@repo/domain/project/lottery-master-data";

import {
  type FieldErrorTexts,
  fieldErrorTextsOf,
  fieldErrorsByCodeOf,
} from "@/lib/base/field-errors";

import type { MasterDataError } from "./master-data-error";

/** `admin.lotteryMasterData` 的翻譯函式(帶變數)。 */
type Translate = (key: string, values?: Record<string, string>) => string;

const max = (value: number) => ({ max: String(value) });
const range = (min: number, upper: number) => ({
  min: String(min),
  max: String(upper),
});

/**
 * 檔案管理表單每一欄的格式要求(REACT-18;規則正本 api `games/game-validation.ts`、
 * `cash-points/cash-point-changes.ts`,上限在 `@repo/domain/project/lottery-master-data`):
 * 送出前檢查沒過、或 api 只回欄位沒有原因時寫在欄位下的那一句。遊戲與收銀點同名的欄位(名稱、備註)
 * 規則不同,各給一張表。key 寫成字面值,死鍵掃描看得到。
 */
const GAME_FORMAT_TEXTS: Record<string, [string, Record<string, string>?]> = {
  gameCode: ["fieldErrors.gameCode"],
  name: ["fieldErrors.requiredText", max(GAME_NAME_MAX_LENGTH)],
  status: ["fieldErrors.choose"],
  unitPrice: ["fieldErrors.positiveInteger"],
  ticketsPerBook: [
    "fieldErrors.integerRange",
    range(TICKETS_PER_BOOK_MIN, TICKETS_PER_BOOK_MAX),
  ],
  defaultRate: [
    "fieldErrors.integerRange",
    range(DEFAULT_RATE_MIN, DEFAULT_RATE_MAX),
  ],
  launchedAt: ["fieldErrors.date"],
  discontinuedAt: ["fieldErrors.date"],
  claimDeadline: ["fieldErrors.date"],
  color: ["fieldErrors.choose"],
  note: ["fieldErrors.maxLength", max(MASTER_DATA_NOTE_MAX_LENGTH)],
};

const CASH_POINT_FORMAT_TEXTS: Record<
  string,
  [string, Record<string, string>?]
> = {
  orgId: ["fieldErrors.required"],
  positionKey: ["fieldErrors.required"],
  name: ["fieldErrors.requiredText", max(CASH_POINT_NAME_MAX_LENGTH)],
  order: ["fieldErrors.order"],
  printerId: ["fieldErrors.choose"],
  enabled: ["fieldErrors.choose"],
  note: ["fieldErrors.maxLength", max(MASTER_DATA_NOTE_MAX_LENGTH)],
};

export type MasterDataForm = "game" | "cashPoint";

const FORMAT_TEXTS = {
  game: GAME_FORMAT_TEXTS,
  cashPoint: CASH_POINT_FORMAT_TEXTS,
} as const;

const formatTextOf = (
  t: Translate,
  form: MasterDataForm,
  field: string,
): string => {
  const [key, values] = FORMAT_TEXTS[form][field] ?? ["fieldErrors.choose"];
  return t(key, values);
};

/** 送出前檢查沒過的欄位 → 各欄的格式要求。 */
export const masterDataFormatErrorsOf = <Field extends string>(
  form: MasterDataForm,
  invalid: readonly Field[],
  t: Translate,
): FieldErrorTexts<Field> =>
  fieldErrorTextsOf(invalid, invalid, (field) => formatTextOf(t, form, field));

/**
 * 收銀點同時撞到崗位與名稱時 api 只帶一個原因(先判崗位),但兩欄都列在 `fields`:
 * 名稱欄改寫名稱重複的原因(api 只有名稱真的被占用時才把它列進來)。
 */
const DUPLICATE_CODE_OF_FIELD: Record<string, string> = {
  positionKey: "POSITION_DUPLICATE",
  name: "NAME_DUPLICATE",
};

/**
 * api 錯誤 → 欄位下的原因與頁面提示:細分過的碼(`GAME_CODE_DUPLICATE`、`GAME_IN_USE`、
 * `POSITION_DUPLICATE`…)寫原因,`VALIDATION_FAILED`(沒有原因)寫該欄的格式要求;
 * 有欄位錯誤時提示只放通用句。
 */
export const masterDataErrorTextsOf = <Field extends string>(
  form: MasterDataForm,
  error: MasterDataError,
  formFields: readonly Field[],
  t: Translate,
): { texts: FieldErrorTexts<Field>; summary: string } =>
  fieldErrorsByCodeOf(error, formFields, {
    formatText: (field) => formatTextOf(t, form, field),
    codeText: (code) => t(`errors.${code}`),
    codeOfField: (field, code) =>
      code === "POSITION_DUPLICATE" || code === "NAME_DUPLICATE"
        ? (DUPLICATE_CODE_OF_FIELD[field] ?? code)
        : code,
  });
