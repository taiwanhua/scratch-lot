import { Types } from "mongoose";

import { localDayRange, parseLocalDate } from "@repo/domain/form";

import { validationError } from "../forms-error";

/**
 * 列表的日期區間條件(`FormSubmissionsInput.dateFrom` / `dateTo`):比對摘要槽「日期」`summary.date`
 * (存 Mongo `Date`;摘要沒對日期欄 = 送出時間)。當地日期含頭尾,以讀者的租戶時區切成半開時點區間
 * `[from 00:00, to 隔天 00:00)`;缺一邊 = 那一邊不限,兩邊都缺 = 不篩。格式不是 `YYYY-MM-DD` → `VALIDATION_FAILED`。
 * 起日晚於迄日不擋(查不到東西 = 空清單)。
 */
export function summaryDateFilterOf(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  timezone: string,
): Record<string, unknown> {
  const from = localDateInputOf(dateFrom, "dateFrom");
  const to = localDateInputOf(dateTo, "dateTo");
  if (from === null && to === null) {
    return {};
  }
  const bounds: Record<string, Date> = {};
  if (from !== null) {
    bounds.$gte = new Date(localDayRange(from, from, timezone).from);
  }
  if (to !== null) {
    bounds.$lt = new Date(localDayRange(to, to, timezone).to);
  }
  return { "summary.date": bounds };
}

function localDateInputOf(value: string | null | undefined, field: string) {
  const text = value?.trim() ?? "";
  if (text === "") {
    return null;
  }
  const date = parseLocalDate(text);
  if (date === null) {
    throw validationError(`${field} must be YYYY-MM-DD`, [field]);
  }
  return date;
}

/** 組織條件的 id;不是合法 ObjectId → `VALIDATION_FAILED`。 */
export function orgIdInputOf(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw validationError("orgId is not a valid id", ["orgId"]);
  }
  return new Types.ObjectId(value);
}
