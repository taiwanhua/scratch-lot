/**
 * 排序用的比較:只回「升冪」的結果,降冪由 TanStack Table 反轉。
 * 文字明給 `zh-Hant`(STRUCT-10):不跟著瀏覽器語系變,中文依筆畫、數字依數值。
 * 空值(`null` / `undefined`)一律排在最後,不論升降冪 —— 由呼叫端(`sortUndefined: "last"`)
 * 處理 `undefined`,`null` 在這裡先當成 `undefined` 看待。
 */
export const compareCellValues = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  return textOf(a).localeCompare(textOf(b), "zh-Hant", { numeric: true });
};

const textOf = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** `null` 視同 `undefined`,讓 TanStack 的 `sortUndefined` 一起把它排到最後。 */
export const sortableValueOf = (value: unknown): unknown => value ?? undefined;
