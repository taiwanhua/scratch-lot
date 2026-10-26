import { formatTemporal } from "@repo/domain/form";
import type { LotteryOperationsReportQuery } from "@repo/graphql";

import type { SheetData, SheetSection } from "@/lib/project/reports/excel";
import {
  type ReportSheetBody,
  type ReportSheetContext,
  type ReportSheetSet,
  fullPathTranslator,
} from "@/lib/project/reports/report-registry";

import {
  type OperationsStore,
  type T,
  operationsSectionsOf,
} from "./operations-rows";
import { compareSectionOf } from "./operations-rows-more";
import { totalStoreOf } from "./operations-total";

const dayText = (value: string, timezone: string) =>
  formatTemporal(value, { type: "monthDay", timezone });
const timeText = (value: string, timezone: string) =>
  formatTemporal(value, { type: "monthDayTime", timezone });
const dateTimeText = (value: string | Date, timezone: string) =>
  formatTemporal(value, { type: "datetime", timezone });

/** 一家店的期間說明(對齊日結:實際期間;當天沒日結:改用整天的標示)。 */
export const storePeriodNote = (
  store: Pick<OperationsStore, "period">,
  t: T,
  timezone: string,
  storeName?: string,
): string | null => {
  const { period } = store;
  if (period.alignment === "dailyClose") {
    return t("admin.lotteryReports.operations.items.alignedPeriod", {
      from: timeText(period.from, timezone),
      to: timeText(period.to, timezone),
    });
  }
  if (period.alignment === "fullDay") {
    return t("admin.lotteryReports.operations.items.fullDayNote", {
      store: storeName ?? t("admin.lotteryReports.operations.items.thisStore"),
      date: dayText(period.from, timezone),
    });
  }
  return null;
};

const KIND_KEYS = {
  day: "admin.lotteryReports.operations.sheet.kinds.day",
  week: "admin.lotteryReports.operations.sheet.kinds.week",
  month: "admin.lotteryReports.operations.sheet.kinds.month",
} as const;

/**
 * 工作表最上面三列(Excel 凍結、每頁重複;預覽排在表格上方):
 * ① 報表名稱 · 分店;② 期間 · 日報 / 週報 / 月報 · 對齊日結的說明 · 已關帳 / 尚未關帳;③ 產出時間 · 產出人 · 金額單位
 */
const headerNotesOf = (
  store: OperationsStore,
  name: string,
  alignment: readonly (string | null)[],
  context: ReportSheetContext,
  t: T,
): string[] => {
  const { timezone, input } = context;
  const closed =
    store.notes.openMonths.length === 0
      ? t("admin.lotteryReports.operations.items.monthClosed")
      : t("admin.lotteryReports.operations.items.monthOpen");
  return [
    t("admin.lotteryReports.operations.sheet.title", { store: name }),
    [
      t("admin.lotteryReports.operations.sheet.period", {
        from: dateTimeText(input.from, timezone),
        to: dateTimeText(input.to, timezone),
      }),
      t(KIND_KEYS[input.periodKind]),
      ...alignment.filter((note): note is string => note !== null),
      closed,
    ].join(" · "),
    t("admin.lotteryReports.operations.sheet.generated", {
      at: dateTimeText(context.generatedAt, timezone),
      by: context.generatedBy,
    }),
  ];
};

const bodyOf = (
  notes: string[],
  sections: SheetSection[],
): ReportSheetBody => ({ notes, columns: [], rows: [], sections });

/**
 * 查詢結果 → 工作表(Excel 與預覽共用;使用者 10/26 定案「預覽和 Excel 同一份表格」):全部分店合計 +
 * 每家店一張,每張都是分段表格(每區塊一張小表);選兩家以上另加「分店比較」。沒有 `reports.show-cost`
 * (api 回 null)的成本列與欄不放。
 */
export const buildOperationsSheets = (
  data: LotteryOperationsReportQuery,
  context: ReportSheetContext,
): ReportSheetSet => {
  const { timezone, orgs } = context;
  const t = fullPathTranslator(context.t);
  const report = data.lotteryOperationsReport;
  const nameOf = (orgId: string) =>
    orgs.find((org) => org.id === orgId)?.name ?? orgId;
  const total = totalStoreOf(report.stores);
  const totalName = t("admin.lotteryReports.totalSheet");
  const extras: SheetData[] =
    report.stores.length > 1
      ? [
          {
            name: t("admin.lotteryReports.operations.sheet.compareName"),
            ...bodyOf(
              headerNotesOf(
                total,
                t("admin.lotteryReports.operations.sheet.compareName"),
                [],
                context,
                t,
              ),
              [
                compareSectionOf(
                  report.stores.map((store) => ({
                    name: nameOf(store.orgId),
                    store,
                  })),
                  total,
                  t,
                ),
              ],
            ),
          },
        ]
      : [];
  return {
    total: bodyOf(
      headerNotesOf(
        total,
        totalName,
        report.stores.map((store) =>
          store.period.alignment === "fullDay"
            ? storePeriodNote(store, t, timezone, nameOf(store.orgId))
            : null,
        ),
        context,
        t,
      ),
      operationsSectionsOf(total, t),
    ),
    branches: report.stores.map((store) => ({
      orgId: store.orgId,
      ...bodyOf(
        headerNotesOf(
          store,
          nameOf(store.orgId),
          [storePeriodNote(store, t, timezone)],
          context,
          t,
        ),
        operationsSectionsOf(store, t),
      ),
    })),
    extras,
  };
};
