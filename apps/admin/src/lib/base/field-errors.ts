/**
 * 欄位錯誤的原因文案(REACT-18):欄位 → 寫在那一欄正下方(`helperText`)的一句話。
 * 沒有這個 key = 這一欄沒錯。
 */
export type FieldErrorTexts<Field extends string> = Partial<
  Record<Field, string>
>;

/**
 * 出錯的欄位 → 各欄的原因文案。送出前的檢查與 api `VALIDATION_FAILED` 的 `fields` 共用:
 *
 * - `textOf(欄位)` 由呼叫端決定那一欄寫什麼:api 帶了認得的原因(重複、被占用、狀態不合…)
 *   就寫原因的文案;沒有原因(格式錯、必填)就寫那一欄的格式要求(前端知道每一欄的規則)
 * - 不在 `formFields` 裡的欄位略過(例如 `id`、畫面上沒有的欄位);一欄都沒對到時回空物件,
 *   原因改寫在頁面的提示(`formErrorSummary`)
 */
export const fieldErrorTextsOf = <Field extends string>(
  fields: readonly string[] | undefined,
  formFields: readonly Field[],
  textOf: (field: Field) => string,
): FieldErrorTexts<Field> => {
  const texts: FieldErrorTexts<Field> = {};
  for (const field of fields ?? []) {
    if ((formFields as readonly string[]).includes(field)) {
      texts[field as Field] = textOf(field as Field);
    }
  }
  return texts;
};

/** 使用者改了某一欄 → 那一欄的錯誤清掉(其他欄照留)。 */
export const withoutFieldError = <Field extends string>(
  texts: FieldErrorTexts<Field>,
  field: Field,
): FieldErrorTexts<Field> => {
  if (!(field in texts)) {
    return texts;
  }
  return Object.fromEntries(
    Object.entries(texts).filter(([key]) => key !== field),
  ) as FieldErrorTexts<Field>;
};

export const hasFieldErrors = (texts: Partial<Record<string, string>>) =>
  Object.keys(texts).length > 0;

/**
 * 頁面提示(表單底部 / 對話框的 Alert、Snackbar)的文案:有欄位錯誤時一律通用句(`genericText`,
 * 例「資料未通過驗證,請檢查標示的欄位」),原因只寫在欄位下;沒有對到欄位的錯誤才寫原因(`otherText`)。
 */
export const formErrorSummary = (
  texts: Partial<Record<string, string>>,
  genericText: string,
  otherText: string,
): string => (hasFieldErrors(texts) ? genericText : otherText);

/**
 * 「`VALIDATION_FAILED` 依 `reason` 細分成本頁的碼」那種錯誤解讀(`parseAdminError` 的 `refine`,
 * 例:`VALIDATION_FAILED` + 重複的 reason 細分成 `CODE_DUPLICATE`)→ 欄位下的原因與頁面提示:
 *
 * - 碼還是 `VALIDATION_FAILED`(api 沒帶原因 = 格式錯 / 必填)→ 那一欄寫 `formatText(欄位)`
 * - 細分過的碼(重複、被占用…)→ 指到的欄位寫 `codeText(碼)`;同一個錯誤指到多欄、各欄原因不同時
 *   (例:兩欄同時撞重複)由 `codeOfField` 指定那一欄用哪個碼
 * - 提示:有欄位錯誤時 `codeText("VALIDATION_FAILED")`(通用句),否則 `codeText(碼)`
 */
export const fieldErrorsByCodeOf = <Field extends string>(
  error: { code: string; fields?: readonly string[] },
  formFields: readonly Field[],
  text: {
    formatText: (field: Field) => string;
    codeText: (code: string) => string;
    codeOfField?: (field: Field, code: string) => string;
  },
): { texts: FieldErrorTexts<Field>; summary: string } => {
  const texts = fieldErrorTextsOf(error.fields, formFields, (field) =>
    error.code === "VALIDATION_FAILED"
      ? text.formatText(field)
      : text.codeText(text.codeOfField?.(field, error.code) ?? error.code),
  );
  return {
    texts,
    summary: formErrorSummary(
      texts,
      text.codeText("VALIDATION_FAILED"),
      text.codeText(error.code),
    ),
  };
};
