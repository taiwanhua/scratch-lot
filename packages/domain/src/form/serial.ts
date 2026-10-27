import { localDateOf } from "./temporal";

/**
 * **單號**(依宣告的格式給的編號,例 `PU-202610-0001`):格式宣告、期間鍵與組字。
 * 取號(計數器、原子遞增)在 api 的 `SerialService`;這裡只放前後端共用的純邏輯
 * (api 取號後組字、admin 表單設計頁預覽)。
 *
 * - `prefix`:前綴,英數 0–10 字(可空)
 * - `period`:流水號多久重新起算 —— `none` 不重算、`year` 每年、`month` 每月(以**租戶時區**切)
 * - `digits`:流水號補零到幾位(1–10;超過不截斷)
 * - `separator`:段與段之間的分隔符,`-` `_` `/` `.` 或空字串;缺席 = `-`
 */

export const SERIAL_PERIODS = ["none", "year", "month"] as const;

export type SerialPeriod = (typeof SERIAL_PERIODS)[number];

export const SERIAL_SEPARATORS = ["-", "_", "/", ".", ""] as const;

export type SerialSeparator = (typeof SERIAL_SEPARATORS)[number];

export const DEFAULT_SERIAL_SEPARATOR: SerialSeparator = "-";

export const SERIAL_DIGITS = { min: 1, max: 10 } as const;

export const SERIAL_PREFIX_PATTERN = /^[A-Za-z0-9]{0,10}$/;

export interface SerialFormat {
  prefix: string;
  period: SerialPeriod;
  digits: number;
  /** 缺席 = `-`(`DEFAULT_SERIAL_SEPARATOR`)。 */
  separator?: SerialSeparator;
}

export interface SerialFormatIssue {
  /** 出錯的鍵(`""` = 整個格式不是物件)。 */
  path: string;
  detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 格式宣告的問題清單(空 = 合法)。 */
export function serialFormatIssues(raw: unknown): SerialFormatIssue[] {
  if (!isRecord(raw)) {
    return [{ path: "", detail: "單號格式必須是物件" }];
  }
  const issues: SerialFormatIssue[] = [];
  if (
    typeof raw.prefix !== "string" ||
    !SERIAL_PREFIX_PATTERN.test(raw.prefix)
  ) {
    issues.push({ path: "prefix", detail: "前綴只能是英數 0–10 字" });
  }
  if (!(SERIAL_PERIODS as readonly unknown[]).includes(raw.period)) {
    issues.push({ path: "period", detail: "期間只能是 none / year / month" });
  }
  if (
    typeof raw.digits !== "number" ||
    !Number.isInteger(raw.digits) ||
    raw.digits < SERIAL_DIGITS.min ||
    raw.digits > SERIAL_DIGITS.max
  ) {
    issues.push({
      path: "digits",
      detail: `位數是 ${String(SERIAL_DIGITS.min)}–${String(SERIAL_DIGITS.max)} 的整數`,
    });
  }
  if (
    raw.separator !== undefined &&
    raw.separator !== null &&
    !(SERIAL_SEPARATORS as readonly unknown[]).includes(raw.separator)
  ) {
    issues.push({
      path: "separator",
      detail: "分隔符只能是 - _ / . 或空字串",
    });
  }
  return issues;
}

/** 合法的格式 → 只留宣告的鍵(`separator` 缺席 / null 不存);不合法 → null。 */
export function normalizeSerialFormat(raw: unknown): SerialFormat | null {
  if (!isRecord(raw) || serialFormatIssues(raw).length > 0) {
    return null;
  }
  const format: SerialFormat = {
    prefix: raw.prefix as string,
    period: raw.period as SerialPeriod,
    digits: raw.digits as number,
  };
  if (raw.separator !== undefined && raw.separator !== null) {
    format.separator = raw.separator as SerialSeparator;
  }
  return format;
}

/**
 * 某時點落在哪個期間(計數器的 `period` 鍵,也是單號裡的期間段):
 * `none` → `"none"`、`year` → `"2026"`、`month` → `"202610"`(以 `timezone` 的當地日期切)。
 */
export function serialPeriodKeyOf(
  period: SerialPeriod,
  instant: number,
  timezone: string,
): string {
  if (period === "none") {
    return "none";
  }
  const { year, month } = localDateOf(instant, timezone);
  const yearText = String(year).padStart(4, "0");
  return period === "year"
    ? yearText
    : `${yearText}${String(month).padStart(2, "0")}`;
}

/** 組出單號:前綴、期間段(`none` 不出現)、補零的流水號,以分隔符相接(空的段略過)。 */
export function formatSerial(
  format: SerialFormat,
  periodKey: string,
  sequence: number,
): string {
  const parts = [
    format.prefix,
    format.period === "none" ? "" : periodKey,
    String(sequence).padStart(format.digits, "0"),
  ].filter((part) => part !== "");
  return parts.join(format.separator ?? DEFAULT_SERIAL_SEPARATOR);
}
