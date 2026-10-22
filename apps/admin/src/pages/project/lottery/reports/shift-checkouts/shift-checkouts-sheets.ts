import { formatTemporal } from "@repo/domain/form";
import type { LotteryShiftCheckoutsReportQuery } from "@repo/graphql";

import type { SheetCell, SheetColumn } from "@/lib/project/reports/excel";
import {
  type ReportSheetBody,
  type ReportSheetContext,
  type ReportSheetSet,
  fullPathTranslator,
} from "@/lib/project/reports/report-registry";

export type ShiftCheckoutRow =
  LotteryShiftCheckoutsReportQuery["lotteryShiftCheckoutsReport"]["rows"][number];

type T = ReportSheetContext["t"];

const keyIn = (
  map: Readonly<Record<string, string>>,
  value: string,
  fallback: string,
): string => (Object.hasOwn(map, value) ? (map[value] ?? fallback) : fallback);

const STATUS_KEYS: Readonly<Record<string, string>> = {
  pending: "admin.lotteryReports.shiftCheckouts.status.pending",
  confirmed: "admin.lotteryReports.shiftCheckouts.status.confirmed",
  returned: "admin.lotteryReports.shiftCheckouts.status.returned",
};

const ROLE_KEYS: Readonly<Record<string, string>> = {
  leader: "admin.lotteryReports.shiftCheckouts.roles.leader",
  helper: "admin.lotteryReports.shiftCheckouts.roles.helper",
};

const money = { numFmt: "#,##0", align: "right" as const, width: 10 };

const columnsOf = (t: T, withStore: boolean): SheetColumn[] => [
  ...(withStore
    ? [
        {
          key: "store",
          header: t("admin.lotteryReports.shiftCheckouts.columns.store"),
          width: 10,
        },
      ]
    : []),
  {
    key: "date",
    header: t("admin.lotteryReports.shiftCheckouts.columns.date"),
    width: 8,
  },
  {
    key: "cashPoint",
    header: t("admin.lotteryReports.shiftCheckouts.columns.cashPoint"),
    width: 12,
  },
  {
    key: "leader",
    header: t("admin.lotteryReports.shiftCheckouts.columns.leader"),
    width: 10,
  },
  {
    key: "helpers",
    header: t("admin.lotteryReports.shiftCheckouts.columns.helpers"),
    width: 14,
  },
  {
    key: "task",
    header: t("admin.lotteryReports.shiftCheckouts.columns.task"),
    width: 24,
  },
  {
    key: "time",
    header: t("admin.lotteryReports.shiftCheckouts.columns.time"),
    width: 14,
  },
  {
    key: "expected",
    header: t("admin.lotteryReports.shiftCheckouts.columns.expected"),
    ...money,
  },
  {
    key: "counted",
    header: t("admin.lotteryReports.shiftCheckouts.columns.counted"),
    ...money,
  },
  {
    key: "difference",
    header: t("admin.lotteryReports.shiftCheckouts.columns.difference"),
    ...money,
  },
  {
    key: "reason",
    header: t("admin.lotteryReports.shiftCheckouts.columns.reason"),
    width: 18,
  },
  {
    key: "postClose",
    header: t("admin.lotteryReports.shiftCheckouts.columns.postClose"),
    ...money,
  },
  {
    key: "stocktake",
    header: t("admin.lotteryReports.shiftCheckouts.columns.stocktake"),
    width: 18,
  },
  {
    key: "status",
    header: t("admin.lotteryReports.shiftCheckouts.columns.status"),
    width: 8,
  },
];

/** 盤點欄:跳過盤點的永久標示「未盤點(跳過)」與沒盤完的「N 本未盤」並列。 */
export const stocktakeText = (row: ShiftCheckoutRow, t: T): string => {
  const parts: string[] = [];
  if (row.stocktakeMode === "skip") {
    parts.push(
      row.skipReason == null
        ? t("admin.lotteryReports.shiftCheckouts.stocktake.skipped")
        : t("admin.lotteryReports.shiftCheckouts.stocktake.skippedWithReason", {
            reason: row.skipReason,
          }),
    );
  }
  if (row.uncountedBooks > 0) {
    parts.push(
      t("admin.lotteryReports.shiftCheckouts.stocktake.uncounted", {
        count: row.uncountedBooks,
      }),
    );
  }
  return parts.join("、");
};

/** 任務內容:崗位 · 職責 · 執行任務(開班時的任務快照);未對應排班 → 「未對應排班」。 */
export const taskText = (row: ShiftCheckoutRow, t: T): string => {
  if (row.taskRole == null) {
    return t("admin.lotteryReports.shiftCheckouts.noTask");
  }
  return [
    row.taskPosition ?? "",
    t(
      keyIn(
        ROLE_KEYS,
        row.taskRole,
        "admin.lotteryReports.shiftCheckouts.roles.helper",
      ),
    ),
    row.taskName ?? "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
};

const rowOf = (
  row: ShiftCheckoutRow,
  context: ReportSheetContext,
  storeName: string,
): Readonly<Record<string, SheetCell>> => {
  const { timezone } = context;
  const t = fullPathTranslator(context.t);
  const time = (value: string) =>
    formatTemporal(value, { type: "monthDayTime", timezone }).split(
      " ",
      2,
    )[1] ?? "";
  return {
    store: storeName,
    date: formatTemporal(row.openedAt, { type: "monthDay", timezone }),
    cashPoint: row.cashPointName,
    leader: row.leader,
    helpers: row.helpers.join("、"),
    task: taskText(row, t),
    time: `${time(row.openedAt)} / ${time(row.submittedAt)}`,
    expected: row.expected,
    counted: row.counted,
    difference: row.difference,
    reason: row.diffReason ?? "",
    postClose: row.postClose === 0 ? null : row.postClose,
    stocktake: stocktakeText(row, t),
    status: t(
      keyIn(
        STATUS_KEYS,
        row.status,
        "admin.lotteryReports.shiftCheckouts.status.pending",
      ),
    ),
  };
};

/**
 * 班次結帳歷史報表的工作表(Excel 與預覽共用;Figma RE-05 `129:1512`):一班一列;
 * 全部分店合計多一欄「分店」,每家店一張只列自己的班。
 */
export const buildShiftCheckoutsSheets = (
  data: LotteryShiftCheckoutsReportQuery,
  context: ReportSheetContext,
): ReportSheetSet => {
  const { orgs } = context;
  const t = fullPathTranslator(context.t);
  const rows = data.lotteryShiftCheckoutsReport.rows;
  const nameOf = (orgId: string) =>
    orgs.find((org) => org.id === orgId)?.name ?? orgId;
  const sheetOf = (
    list: readonly ShiftCheckoutRow[],
    withStore: boolean,
  ): ReportSheetBody => ({
    columns: columnsOf(t, withStore),
    rows: list.map((row) => rowOf(row, context, nameOf(row.orgId))),
  });
  return {
    total: sheetOf(rows, true),
    branches: orgs.map((org) => ({
      orgId: org.id,
      ...sheetOf(
        rows.filter((row) => row.orgId === org.id),
        false,
      ),
    })),
  };
};
