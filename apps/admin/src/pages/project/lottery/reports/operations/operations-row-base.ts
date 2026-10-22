import type { LotteryOperationsReportQuery } from "@repo/graphql";

import type { SheetCell } from "@/lib/project/reports/excel";
import type { ReportSheetContext } from "@/lib/project/reports/report-registry";

export type OperationsReport =
  LotteryOperationsReportQuery["lotteryOperationsReport"];
export type OperationsStore = OperationsReport["stores"][number];

/**
 * 營運報表的工作表列:區塊、項目、張數(筆數 / 本數)、金額、說明。`unit` 不是欄位(Excel 不寫),
 * 給預覽卡片顯示「210 張 · 42,000」。
 */
export type OperationsRow = Readonly<Record<string, SheetCell>> & {
  block: string;
  item: string;
  count: number | null;
  amount: number | null;
  note: string | null;
  unit: string | null;
  /** 預覽卡片佔整列(依遊戲展開) */
  wide: number | null;
};

/** 區塊順序固定(規格 11.2):1–8 + 依遊戲展開。 */
export const OPERATIONS_BLOCKS = [
  "sales",
  "profit",
  "redemption",
  "inventory",
  "cash",
  "bank",
  "outstanding",
  "notes",
  "games",
] as const;
export type OperationsBlock = (typeof OPERATIONS_BLOCKS)[number];

export const BLOCK_KEYS: Readonly<Record<OperationsBlock, string>> = {
  sales: "admin.lotteryReports.operations.blocks.sales",
  profit: "admin.lotteryReports.operations.blocks.profit",
  redemption: "admin.lotteryReports.operations.blocks.redemption",
  inventory: "admin.lotteryReports.operations.blocks.inventory",
  cash: "admin.lotteryReports.operations.blocks.cash",
  bank: "admin.lotteryReports.operations.blocks.bank",
  outstanding: "admin.lotteryReports.operations.blocks.outstanding",
  notes: "admin.lotteryReports.operations.blocks.notes",
  games: "admin.lotteryReports.operations.blocks.games",
};

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

export const UNIT_KEYS = {
  tickets: "admin.lotteryReports.operations.units.tickets",
  records: "admin.lotteryReports.operations.units.records",
  books: "admin.lotteryReports.operations.units.books",
  shifts: "admin.lotteryReports.operations.units.shifts",
  times: "admin.lotteryReports.operations.units.times",
} as const;
export type Unit = keyof typeof UNIT_KEYS;

export type T = ReportSheetContext["t"];

/** 對照表找訊息 key;不認得的值用 `fallback`(api 新增了類型、admin 還沒跟上時不至於整列壞掉)。 */
export const keyIn = (
  map: Readonly<Record<string, string>>,
  value: string,
  fallback: string,
): string => (Object.hasOwn(map, value) ? (map[value] ?? fallback) : fallback);

export const row = (
  block: OperationsBlock,
  item: string,
  values: {
    count?: number | null;
    amount?: number | null;
    note?: string | null;
    unit?: Unit | null;
    wide?: boolean;
  },
  t: T,
): OperationsRow => ({
  block: t(BLOCK_KEYS[block]),
  item,
  count: values.count ?? null,
  amount: values.amount ?? null,
  note: values.note ?? null,
  unit: values.unit == null ? null : t(UNIT_KEYS[values.unit]),
  wide: values.wide === true ? 1 : null,
});
