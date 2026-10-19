import {
  type FieldDef,
  type StoredValues,
  type SubmissionSummary,
  arrayColumnsOf,
  arrayRowsOf,
  toInstant,
} from "@repo/domain/form";

/**
 * 日期 / 日期時間的存法:兩者都是時點,Mongo 存 `Date`(和 `createdAt` 同型別)。
 *
 * - domain 的正規化 / 計算 / 摘要一律回 ISO 字串(JSON 形,前後端共用);api 寫進 Mongo 前在這裡換成 `Date`:
 *   `SubmissionValuesService` 的結果(`values`、`revisions[].values` 都由它產生)與摘要槽 `summary.date`
 * - 讀出來是 `Date`:domain 的函式都收(`toInstant`);GraphQL `values`(JSONObject)回應時由 `Date#toJSON`
 *   序列化成 ISO 字串;`String` 欄位(摘要槽)輸出前用 domain 的 `temporalIsoOf`
 */

/**
 * 值裡的日期 / 日期時間欄換成 `Date`(不是時點的照舊;回新物件)。明細列的日期 / 日期時間子欄逐列換
 * (`fields` 傳子欄定義遞迴一次)。
 */
export function withStoredTemporals(
  fields: readonly FieldDef[],
  values: StoredValues,
): StoredValues {
  const stored: StoredValues = { ...values };
  for (const field of fields) {
    if (field.type === "array" && Array.isArray(stored[field.key])) {
      const columns = arrayColumnsOf(field);
      stored[field.key] = arrayRowsOf(stored[field.key]).map((row) => ({
        ...withStoredTemporals(columns, row),
        rowId: row.rowId,
      }));
      continue;
    }
    if (field.type !== "date" && field.type !== "datetime") {
      continue;
    }
    const instant = toInstant(stored[field.key]);
    if (instant !== null) {
      stored[field.key] = new Date(instant);
    }
  }
  return stored;
}

/** 摘要槽的存法:`date` 換成 `Date`(不是時點 → null)。 */
export function storedSummaryOf(summary: SubmissionSummary): SubmissionSummary {
  const instant = toInstant(summary.date);
  return { ...summary, date: instant === null ? null : new Date(instant) };
}
