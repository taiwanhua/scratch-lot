import type { FormFieldErrorLike } from "@/lib/base/form-engine/form-errors";

/**
 * 替換新增頁(叫貨單、進貨單、調貨單)顯示 api 回的欄位錯誤(`VALIDATION_FAILED` 的 `fieldErrors`,
 * `useFormDraft().error` 已由 `formErrorOf` 解析):單頭欄位標在對應欄位(`error` + `helperText`,
 * 同表單引擎 `FormRenderer` 用 api 的 `message`);明細(陣列欄位,含逐列 / 逐格的錯誤)集中顯示在明細區。
 */
export type FieldErrorSource = {
  fieldErrors?: readonly FormFieldErrorLike[];
} | null;

/** 單頭欄位的錯誤 → 欄位 props(沒有錯誤 = 不加;`fallbackHelperText` 是平常的說明)。 */
export const fieldErrorProps = (
  source: FieldErrorSource,
  fieldKey: string,
  fallbackHelperText?: string,
): { error?: boolean; helperText?: string } => {
  const message = source?.fieldErrors?.find(
    (item) => item.fieldKey === fieldKey && item.rowId === undefined,
  )?.message;
  if (message !== undefined) {
    return { error: true, helperText: message };
  }
  return fallbackHelperText === undefined
    ? {}
    : { helperText: fallbackHelperText };
};

/** 明細(陣列欄位)的錯誤訊息:整欄的(例:至少一列)與逐列 / 逐格的,去掉重複。 */
export const lineErrorMessagesOf = (
  source: FieldErrorSource,
  fieldKey: string,
): string[] => [
  ...new Set(
    (source?.fieldErrors ?? [])
      .filter((item) => item.fieldKey === fieldKey)
      .map((item) => item.message),
  ),
];
