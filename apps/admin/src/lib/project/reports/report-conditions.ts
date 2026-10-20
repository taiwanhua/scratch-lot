import { z } from "zod";

import {
  REPORT_PERIOD_KINDS,
  type ReportPeriodValue,
  normalizePeriod,
  reportPeriodRange,
} from "./report-period";
import {
  type ReportDefinition,
  type ReportExtraCondition,
  type ReportExtraValue,
  type ReportQueryInput,
  defaultExtraValue,
  extraConditionsFor,
} from "./report-registry";

/**
 * 「輸出報表」頁的條件:放網址(REACT-14,key `conditions`),換報表時保留能沿用的部分。
 * 網址裡的值可能來自別張報表、或被手改過,畫面一律先經 `resolveConditions` 整理成這張報表合法的條件。
 */
export const reportConditionsSchema = z
  .object({
    period: z.object({
      kind: z.enum(REPORT_PERIOD_KINDS),
      /** 期間起點 `YYYY-MM-DD`;空字串 = 今天所在的期間 */
      date: z.string(),
    }),
    orgIds: z.array(z.string()),
    extra: z.record(z.string(), z.union([z.boolean(), z.string()])),
  })
  .default({ period: { kind: "day", date: "" }, orgIds: [], extra: {} });

export type ReportConditionsState = z.infer<typeof reportConditionsSchema>;

/** 整理後、這張報表合法的條件。 */
export interface ResolvedReportConditions {
  period: ReportPeriodValue;
  orgIds: string[];
  /**
   * 這張報表**全部**其他條件的值(含只在別種期間類型出現的,切回來時值還在);
   * 送查詢時才依期間類型過濾(`reportQueryInputOf`)
   */
  extra: Record<string, ReportExtraValue>;
}

const extraValueOf = (
  condition: ReportExtraCondition,
  raw: ReportExtraValue | undefined,
): ReportExtraValue => {
  if (condition.type === "boolean") {
    return typeof raw === "boolean" ? raw : defaultExtraValue(condition);
  }
  return typeof raw === "string" &&
    condition.options.some((option) => option.value === raw)
    ? raw
    : defaultExtraValue(condition);
};

/**
 * 網址條件 → 這張報表合法的條件:期間類型不在這張報表的清單就換成第一種、日期整理成期間起點
 * (空的代入今天)、分店超過上限只留前面的、其他條件留這張報表有宣告的(值不合就用預設;
 * 只在別種期間類型出現的也留著,例:日的「對齊日結」切到週再切回日,勾選還在)。
 */
export const resolveConditions = (
  report: Pick<ReportDefinition, "conditions">,
  state: ReportConditionsState,
  today: string,
): ResolvedReportConditions => {
  const { conditions } = report;
  const kind = conditions.period.includes(state.period.kind)
    ? state.period.kind
    : (conditions.period[0] ?? "day");
  return {
    period: normalizePeriod({ kind, date: state.period.date }, today),
    orgIds: [...new Set(state.orgIds)].slice(0, conditions.orgs.max),
    extra: Object.fromEntries(
      conditions.extra.map((condition) => [
        condition.key,
        extraValueOf(condition, state.extra[condition.key]),
      ]),
    ),
  };
};

/**
 * 整理後的條件 → 報表查詢的 input(起訖換成租戶時區的時點;其他條件只送這種期間類型下有的);
 * 還沒選分店 → `null`(不能查)。
 */
export const reportQueryInputOf = (
  report: Pick<ReportDefinition, "conditions">,
  resolved: ResolvedReportConditions,
  timezone: string,
): ReportQueryInput | null => {
  const range = reportPeriodRange(resolved.period, timezone);
  if (range === null || resolved.orgIds.length === 0) return null;
  const extra = Object.fromEntries(
    extraConditionsFor(report.conditions, resolved.period.kind).map(
      (condition) => [
        condition.key,
        resolved.extra[condition.key] ?? defaultExtraValue(condition),
      ],
    ),
  );
  return {
    ...extra,
    periodKind: resolved.period.kind,
    from: range.from,
    to: range.to,
    orgIds: resolved.orgIds,
  };
};
