import { formatTemporal } from "@repo/domain/form";
import type { LotteryOperationsReportQuery } from "@repo/graphql";

import type { SheetColumn } from "@/lib/project/reports/excel";
import {
  type ReportSheetBody,
  type ReportSheetContext,
  type ReportSheetSet,
  fullPathTranslator,
} from "@/lib/project/reports/report-registry";

import {
  type OperationsStore,
  type T,
  operationsRowsOf,
} from "./operations-rows";
import { totalStoreOf } from "./operations-total";

const columnsOf = (t: T): SheetColumn[] => [
  {
    key: "block",
    header: t("admin.lotteryReports.operations.items.columns.block"),
    width: 14,
  },
  {
    key: "item",
    header: t("admin.lotteryReports.operations.items.columns.item"),
    width: 30,
  },
  {
    key: "count",
    header: t("admin.lotteryReports.operations.items.columns.count"),
    width: 10,
    numFmt: "#,##0",
    align: "right",
  },
  {
    key: "amount",
    header: t("admin.lotteryReports.operations.items.columns.amount"),
    width: 14,
    numFmt: "#,##0",
    align: "right",
  },
  {
    key: "note",
    header: t("admin.lotteryReports.operations.items.columns.note"),
    width: 30,
  },
];

const dayText = (value: string, timezone: string) =>
  formatTemporal(value, { type: "monthDay", timezone });
const timeText = (value: string, timezone: string) =>
  formatTemporal(value, { type: "monthDayTime", timezone });

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

/**
 * 查詢結果 → 工作表(Excel 與預覽共用):每家店一張 + 全部分店合計。表頭說明放對齊日結的期間 / 改用整天的標示、
 * 已關帳 / 尚未關帳。沒有 `reports.show-cost`(api 回 null)的成本與毛利列不放。
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
  let closedNote: string | null = null;
  if (context.input.periodKind === "month") {
    closedNote = report.stores.every(
      (store) => store.notes.openMonths.length === 0,
    )
      ? t("admin.lotteryReports.operations.items.monthClosed")
      : t("admin.lotteryReports.operations.items.monthOpen");
  }
  const columns = columnsOf(t);
  const sheetOf = (
    store: OperationsStore,
    notes: (string | null)[],
  ): ReportSheetBody => ({
    columns,
    notes: notes.filter((note): note is string => note !== null),
    rows: operationsRowsOf(store, t),
  });
  return {
    total: sheetOf(totalStoreOf(report.stores), [
      ...report.stores.map((store) =>
        store.period.alignment === "fullDay"
          ? storePeriodNote(store, t, timezone, nameOf(store.orgId))
          : null,
      ),
      closedNote,
    ]),
    branches: report.stores.map((store) => ({
      orgId: store.orgId,
      ...sheetOf(store, [storePeriodNote(store, t, timezone), closedNote]),
    })),
  };
};
