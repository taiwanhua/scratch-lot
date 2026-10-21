import { localDateOf, startOfLocalDay } from "../../form/temporal";

/**
 * 關帳 `lottery_period_closes`(專案規格 10.4、3.4 關帳逾期;正本 `docs/modules/project/accounts.md`「關帳」)。
 * api 的檢查 / 寫入、排程與 admin 的關帳分頁共用這裡的月份規則,不另寫日期換算(一律經 `form/temporal`)。
 *
 * - 範圍是**整個租戶**;依序關帳;只能關已結束的月份;不能重新開帳
 * - **永遠關到該月最後一刻**:月份的期間 = 當地 1 日 00:00(含)至 下月 1 日 00:00(不含),與按下的時間無關
 *   (10/31 23:59:59.999 的紀錄算 10 月)
 */

/** 月份文字 `YYYY-MM`。 */
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 關帳擋下的原因(api 的 `extensions.reason`;模組文件「錯誤碼」)。 */
export const PERIOD_CLOSE_REASONS = {
  /** 月份格式不對 / 輸入的確認月份和要關的月份不同 */
  invalid: "PERIOD_CLOSE_INVALID",
  /** 這個月還沒結束(本月、未來的月份) */
  notEnded: "PERIOD_NOT_ENDED",
  /** 這個月已經關帳(不能重關、不能重新開帳) */
  alreadyClosed: "PERIOD_ALREADY_CLOSED",
  /** 不是最早的未關帳月份(要依序關帳) */
  outOfOrder: "PERIOD_OUT_OF_ORDER",
  /** 那個月還有收銀班次沒結帳 */
  shiftsNotClosed: "PERIOD_SHIFTS_NOT_CLOSED",
  /** 那個月還有撤銷售出申請 / 現金更正單 / 結帳確認申請在審核中 */
  pendingDocuments: "PERIOD_PENDING_DOCUMENTS",
  /** 選的時間落在已關帳的月份(`assertPeriodOpen`:退款班次、現金更正位置、開班改選的排班) */
  periodClosed: "PERIOD_CLOSED",
} as const;

export type PeriodCloseReason =
  (typeof PERIOD_CLOSE_REASONS)[keyof typeof PERIOD_CLOSE_REASONS];

/** 月份列表的狀態:進行中(本月)/ 未關帳(已結束)/ 已關帳。 */
export const PERIOD_STATUSES = ["current", "open", "closed"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

/** 「擋的單據」的種類(規格 10.4 表):撤銷售出申請、現金更正單、結帳確認申請(交班 / 日結)。 */
export const PERIOD_PENDING_KINDS = [
  "sale_reversal",
  "cash_correction",
  "shift_checkout",
  "daily_close",
] as const;
export type PeriodPendingKind = (typeof PERIOD_PENDING_KINDS)[number];

interface Month {
  year: number;
  month: number;
}

function parse(text: string): Month | null {
  const matched = MONTH_PATTERN.exec(text);
  if (matched === null) {
    return null;
  }
  return { year: Number(matched[1]), month: Number(matched[2]) };
}

const format = ({ year, month }: Month): string =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;

/** 是不是合法的月份文字 `YYYY-MM`。 */
export function isPeriodMonth(text: unknown): text is string {
  return typeof text === "string" && parse(text) !== null;
}

/** 月份 ± N 個月(`2026-01` − 1 = `2025-12`);格式不對 → 丟 `RangeError`。 */
export function addPeriodMonths(month: string, amount: number): string {
  const parsed = parse(month);
  if (parsed === null) {
    throw new RangeError(`月份格式不對:${month}`);
  }
  const index = parsed.year * 12 + (parsed.month - 1) + Math.trunc(amount);
  const year = Math.floor(index / 12);
  return format({ year, month: index - year * 12 + 1 });
}

/** 兩個月份相差幾個月(`to − from`)。 */
export function periodMonthDiff(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  if (a === null || b === null) {
    throw new RangeError(`月份格式不對:${from} / ${to}`);
  }
  return b.year * 12 + b.month - (a.year * 12 + a.month);
}

/** 時點在租戶時區屬於哪個月份。 */
export function periodMonthOf(instant: number, timezone: string): string {
  const { year, month } = localDateOf(instant, timezone);
  return format({ year, month });
}

/**
 * 月份的期間(時點,ms):`start` = 當地 1 日 00:00(含),`end` = 下月 1 日 00:00(不含)。
 * 關帳「永遠關到該月最後一刻」:時點 < `end` 的紀錄都屬於這個月或更早。
 */
export function periodRangeOf(
  month: string,
  timezone: string,
): { start: number; end: number } {
  const parsed = parse(month);
  if (parsed === null) {
    throw new RangeError(`月份格式不對:${month}`);
  }
  const nextIndex = parsed.year * 12 + parsed.month;
  const next: Month = {
    year: Math.floor(nextIndex / 12),
    month: (nextIndex % 12) + 1,
  };
  return {
    start: startOfLocalDay({ ...parsed, day: 1 }, timezone),
    end: startOfLocalDay({ ...next, day: 1 }, timezone),
  };
}

/** 這個月份在 `now` 時已經結束(下月 1 日 00:00 已過)。 */
export function isPeriodEnded(
  month: string,
  now: number,
  timezone: string,
): boolean {
  return periodRangeOf(month, timezone).end <= now;
}

/**
 * 下一個要關的月份(依序關帳):最後一個已關帳月份的下一個;沒關過 → 起始月份(租戶開始使用的月份)。
 * 那個月還沒結束 → null(沒有可以關的月份)。
 */
export function nextClosableMonth(input: {
  lastClosed: string | null;
  firstMonth: string;
  now: number;
  timezone: string;
}): string | null {
  const candidate =
    input.lastClosed === null
      ? input.firstMonth
      : addPeriodMonths(input.lastClosed, 1);
  return isPeriodEnded(candidate, input.now, input.timezone) ? candidate : null;
}

/**
 * 月份列表(AC-06;新的在前):起始月份到本月,加上更早已關帳的月份。
 * 本月 = 進行中;已結束沒關 = 未關帳;有關帳紀錄 = 已關帳。
 */
export function periodMonthsOf(input: {
  firstMonth: string;
  closed: readonly string[];
  now: number;
  timezone: string;
}): { month: string; status: PeriodStatus }[] {
  const current = periodMonthOf(input.now, input.timezone);
  const closed = new Set(input.closed);
  const earliest = input.closed.reduce(
    (min, month) => (periodMonthDiff(min, month) < 0 ? month : min),
    input.firstMonth,
  );
  const rows: { month: string; status: PeriodStatus }[] = [];
  const count = periodMonthDiff(earliest, current);
  for (let offset = count; offset >= 0; offset -= 1) {
    const month = addPeriodMonths(earliest, offset);
    let status: PeriodStatus = "open";
    if (closed.has(month)) {
      status = "closed";
    } else if (month === current) {
      status = "current";
    }
    rows.push({ month, status });
  }
  return rows;
}
