import { optionLabelOf } from "./semantic";
import { temporalIsoOf } from "./temporal";
import type { FieldDef, FormDefinition, StoredValues } from "./types";

/**
 * 摘要槽快照(`form_submissions.summary`):送出時依該版 `summaryMap` 算,列表只讀它。
 */
export interface SubmissionSummary {
  title: string | null;
  /**
   * 時點(對日期欄 = 當地 00:00、對日期時間欄 = 那一刻;`summaryMap.date` 沒對欄位時 = 送出時間)。
   * `computeSummary` 回 ISO 字串;api 存進 Mongo 時是 `Date`(讀出時兩種都可能,輸出前用 `temporalIsoOf`)。
   */
  date: string | Date | null;
  /** 只有 `summaryMap.amount` 有對欄位時才有這個鍵(decimal 字串)。 */
  amount?: string | null;
}

export interface SummaryOptions {
  /** 送出時間(ISO);`summaryMap.date` 沒對欄位時用它。 */
  submittedAt: string;
}

/**
 * 算摘要:`title` 對到選項欄時存 label(不是 value);`values` 要是**已算好計算欄位**的存值。
 */
export function computeSummary(
  definition: Pick<FormDefinition, "fields" | "summaryMap">,
  values: StoredValues,
  options: SummaryOptions,
): SubmissionSummary {
  const byKey = new Map(definition.fields.map((field) => [field.key, field]));
  const fieldOf = (key: string | null | undefined): FieldDef | undefined =>
    key ? byKey.get(key) : undefined;

  const titleField = fieldOf(definition.summaryMap.title);
  const dateField = fieldOf(definition.summaryMap.date);
  const amountField = fieldOf(definition.summaryMap.amount);

  const summary: SubmissionSummary = {
    title: titleField ? titleOf(titleField, values[titleField.key]) : null,
    date: dateField
      ? temporalIsoOf(values[dateField.key])
      : temporalIsoOf(options.submittedAt),
  };
  if (amountField) {
    summary.amount = stringOrNull(values[amountField.key]);
  }
  return summary;
}

function titleOf(field: FieldDef, stored: unknown): string | null {
  if (field.type === "select") {
    return stringOrNull(optionLabelOf(field, stored));
  }
  return stringOrNull(stored);
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" ? String(value) : null;
}
