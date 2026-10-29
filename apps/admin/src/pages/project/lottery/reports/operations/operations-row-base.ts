import type { LotteryOperationsReportQuery } from "@repo/graphql";

import {
  SHEET_ROW_KEYS,
  type SheetCell,
  type SheetColumn,
  type SheetRow,
} from "@/lib/base/reports/excel";
import type { ReportSheetContext } from "@/lib/base/reports/report-registry";

export type OperationsReport =
  LotteryOperationsReportQuery["lotteryOperationsReport"];
export type OperationsStore = OperationsReport["stores"][number];

export type T = ReportSheetContext["t"];

/** 數字欄的格式:千分位、負數紅字(預覽也是負數紅字)。 */
export const NUMBER_FORMAT = "#,##0;[Red]-#,##0";

export const numberColumn = (
  key: string,
  header: string,
  width = 12,
): SheetColumn => ({
  key,
  header,
  width,
  numFmt: NUMBER_FORMAT,
  align: "right",
});

export const textColumn = (
  key: string,
  header: string,
  width = 28,
): SheetColumn => ({ key, header, width });

/** 一列(值依欄位 key;`undefined` 當空格)。 */
export const line = (
  values: Readonly<Record<string, SheetCell | undefined>>,
): SheetRow =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value ?? null]),
  );

/** 合計列(粗體)。 */
export const totalLine = (
  values: Readonly<Record<string, SheetCell | undefined>>,
): SheetRow => ({ ...line(values), [SHEET_ROW_KEYS.emphasis]: "total" });

/** 比率列(Excel `0.0%`、預覽「8.0%」)。 */
export const percentLine = (
  values: Readonly<Record<string, SheetCell | undefined>>,
): SheetRow => ({ ...line(values), [SHEET_ROW_KEYS.format]: "percent" });

/** 有成本權限(api 沒權限時成本回 null)。 */
export const hasCost = (store: OperationsStore): boolean =>
  store.sales.cost != null;

/** 負號(0 不加負號:Excel 不會出現 -0)。 */
export const negate = (value: number | null | undefined): number | null =>
  value == null || value === 0 ? (value ?? null) : -value;

export const POST_CLOSE_KEYS: Readonly<Record<string, string>> = {
  redemption: "admin.lotteryReports.operations.postClose.redemption",
  stocktake: "admin.lotteryReports.operations.postClose.stocktake",
  refund: "admin.lotteryReports.operations.postClose.refund",
  cashCorrection: "admin.lotteryReports.operations.postClose.cashCorrection",
  other: "admin.lotteryReports.operations.postClose.other",
};

export const BANK_TYPE_KEYS: Readonly<Record<string, string>> = {
  deposit: "admin.lotteryReports.operations.bankTypes.deposit",
  withdrawal: "admin.lotteryReports.operations.bankTypes.withdrawal",
  redemption_income:
    "admin.lotteryReports.operations.bankTypes.redemption_income",
  purchase_income: "admin.lotteryReports.operations.bankTypes.purchase_income",
  purchase_expense:
    "admin.lotteryReports.operations.bankTypes.purchase_expense",
  transfer_income: "admin.lotteryReports.operations.bankTypes.transfer_income",
  transfer_expense:
    "admin.lotteryReports.operations.bankTypes.transfer_expense",
  license_rent: "admin.lotteryReports.operations.bankTypes.license_rent",
  adjustment: "admin.lotteryReports.operations.bankTypes.adjustment",
  other: "admin.lotteryReports.operations.bankTypes.other",
};

export const MOVEMENT_KEYS: Readonly<Record<string, string>> = {
  deposit: "admin.lotteryReports.operations.movements.deposit",
  withdraw: "admin.lotteryReports.operations.movements.withdraw",
  bank_deposit: "admin.lotteryReports.operations.movements.bank_deposit",
  refund: "admin.lotteryReports.operations.movements.refund",
  transfer_out: "admin.lotteryReports.operations.movements.transfer_out",
  transfer_in: "admin.lotteryReports.operations.movements.transfer_in",
  correction: "admin.lotteryReports.operations.movements.correction",
};

export const OUTSTANDING_KEYS: Readonly<Record<string, string>> = {
  purchaseToPay: "admin.lotteryReports.operations.outstanding.purchaseToPay",
  purchaseToRefund:
    "admin.lotteryReports.operations.outstanding.purchaseToRefund",
  transferToReceive:
    "admin.lotteryReports.operations.outstanding.transferToReceive",
  transferToPay: "admin.lotteryReports.operations.outstanding.transferToPay",
  transferPayerRefund:
    "admin.lotteryReports.operations.outstanding.transferPayerRefund",
  transferPayeeRefund:
    "admin.lotteryReports.operations.outstanding.transferPayeeRefund",
};

/** 對照表找訊息 key;不認得的值用 `fallback`(api 新增了類型、admin 還沒跟上時不至於整列壞掉)。 */
export const keyIn = (
  map: Readonly<Record<string, string>>,
  value: string,
  fallback: string,
): string => (Object.hasOwn(map, value) ? (map[value] ?? fallback) : fallback);
