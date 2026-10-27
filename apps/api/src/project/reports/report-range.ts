import { GraphQLError } from "graphql";

/**
 * 輸出報表的範圍檢查(專案規格 11.4、18.4「範圍檢查」;正本 `docs/modules/project/reports.md`)。
 * 每張報表的查詢在讀資料前呼叫一次:期間類型不在這張報表允許的清單、分店數超過上限、
 * 或起訖長度超過那種期間的上限 → `VALIDATION_FAILED` + `reason: "RANGE_TOO_LARGE"`(GQL-04 不新增 code)。
 *
 * 期間的起訖由 admin 依租戶時區換成時點(日 / 週 / 月,迄不含);api 只收時點,不重算當地日期,
 * 所以長度上限多留一小時給夏令時間切換的那一天。
 */

/** 期間類型:日、週(星期日起)、月;沒有自訂區間。 */
export const REPORT_PERIOD_KINDS = ["day", "week", "month"] as const;

export type ReportPeriodKind = (typeof REPORT_PERIOD_KINDS)[number];

export const RANGE_TOO_LARGE = "RANGE_TOO_LARGE";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** 各期間類型的起訖長度上限:最長的那一種(月 = 31 天)再加一小時(夏令時間)。 */
const MAX_SPAN_MS: Readonly<Record<ReportPeriodKind, number>> = {
  day: MS_PER_DAY + MS_PER_HOUR,
  week: 7 * MS_PER_DAY + MS_PER_HOUR,
  month: 31 * MS_PER_DAY + MS_PER_HOUR,
};

/** 一次報表查詢帶來的範圍。 */
export interface ReportRangeInput {
  /** 期間類型(GraphQL 收字串,在這裡驗) */
  periodKind: string;
  /** 起(含)、迄(不含)的時點 */
  from: Date | string;
  to: Date | string;
  /** 選的分店 */
  orgIds: readonly string[];
}

/** 這張報表的限制(與 admin `registerReport` 的 `conditions.period` / `conditions.orgs.max` 同一組值)。 */
export interface ReportRangeRule {
  allowed: readonly ReportPeriodKind[];
  maxOrgs: number;
}

const rangeTooLarge = (message: string, fields: string[]): GraphQLError =>
  new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", reason: RANGE_TOO_LARGE, fields },
  });

const invalid = (message: string, fields: string[]): GraphQLError =>
  new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields },
  });

const instantOf = (value: Date | string): number =>
  value instanceof Date ? value.getTime() : Date.parse(value);

const isPeriodKind = (value: string): value is ReportPeriodKind =>
  (REPORT_PERIOD_KINDS as readonly string[]).includes(value);

/**
 * 檢查一次報表查詢的範圍;合格什麼都不做,不合格丟 `GraphQLError`:
 *
 * | 情況                                         | 結果                                                    |
 * | -------------------------------------------- | ------------------------------------------------------- |
 * | 期間類型不在 `allowed`(含不認得的字)         | `RANGE_TOO_LARGE`,`fields: ["periodKind"]`             |
 * | 分店數超過 `maxOrgs`                         | `RANGE_TOO_LARGE`,`fields: ["orgIds"]`                 |
 * | 起訖長度超過該期間類型的上限                 | `RANGE_TOO_LARGE`,`fields: ["from", "to"]`             |
 * | 沒選分店                                     | `VALIDATION_FAILED`(無 reason),`fields: ["orgIds"]`    |
 * | 起訖不是時點、或迄不晚於起                   | `VALIDATION_FAILED`(無 reason),`fields: ["from", "to"]` |
 *
 * 分店是否在操作者的可見範圍內不在這裡驗(看不到的分店由查詢自己依可見範圍略過或回 `NOT_FOUND`)。
 */
export function assertReportRange(
  input: ReportRangeInput,
  rule: ReportRangeRule,
): void {
  const { periodKind, orgIds } = input;
  if (!isPeriodKind(periodKind) || !rule.allowed.includes(periodKind)) {
    throw rangeTooLarge(
      `period kind "${periodKind}" is not allowed for this report`,
      ["periodKind"],
    );
  }
  if (orgIds.length === 0) {
    throw invalid("at least one org is required", ["orgIds"]);
  }
  if (orgIds.length > rule.maxOrgs) {
    throw rangeTooLarge(
      `at most ${String(rule.maxOrgs)} orgs, got ${String(orgIds.length)}`,
      ["orgIds"],
    );
  }
  const from = instantOf(input.from);
  const to = instantOf(input.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    throw invalid("from / to must be instants with from < to", ["from", "to"]);
  }
  if (to - from > MAX_SPAN_MS[periodKind]) {
    throw rangeTooLarge(`range is longer than one ${periodKind}`, [
      "from",
      "to",
    ]);
  }
}
