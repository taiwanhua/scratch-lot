/** 營運報表的「分店比較」工作表(項目 × 分店 + 合計;使用者 10/26 定)。 */
import type { SheetSection } from "@/lib/base/reports/excel";

import {
  type OperationsStore,
  type T,
  hasCost,
  line,
  numberColumn,
  textColumn,
} from "./operations-row-base";

/** 分店比較的一列:項目 + 各店的值 + 合計。 */
interface CompareMetric {
  label: string;
  value: (store: OperationsStore) => number | null | undefined;
  /** 只在有成本權限時列 */
  cost?: boolean;
}

const outstandingOf = (store: OperationsStore, kinds: readonly string[]) =>
  store.outstanding.items
    .filter((item) => kinds.includes(item.kind))
    .reduce((sum, item) => sum + item.amount, 0);

/**
 * 分店比較(Excel 另一張工作表;使用者 10/26 定):列 = 重要數字(淨銷售、毛利、兌獎、期末庫存、結帳差額、
 * 待付與待收),欄 = 各分店 + 合計。`total` 是「全部分店合計」那一份(合計欄照它,銀行等去重複的規則一致)。
 */
export const compareSectionOf = (
  stores: readonly { name: string; store: OperationsStore }[],
  total: OperationsStore,
  t: T,
): SheetSection => {
  const withCost = hasCost(total);
  const metrics: CompareMetric[] = [
    {
      label: t("admin.lotteryReports.operations.compare.netSales"),
      value: (store) => store.sales.net.amount,
    },
    {
      label: t("admin.lotteryReports.operations.compare.grossProfit"),
      value: (store) =>
        store.sales.cost == null
          ? null
          : store.sales.net.amount - store.sales.cost,
      cost: true,
    },
    {
      label: t("admin.lotteryReports.operations.compare.redemption"),
      value: (store) => store.redemption.valid.amount,
    },
    {
      label: t("admin.lotteryReports.operations.compare.endingTickets"),
      value: (store) => store.inventory.endingTickets,
    },
    {
      label: t("admin.lotteryReports.operations.compare.endingCost"),
      value: (store) => store.inventory.endingCost,
      cost: true,
    },
    {
      label: t("admin.lotteryReports.operations.compare.shiftDifference"),
      value: (store) => store.cash.shiftDifference,
    },
    {
      label: t("admin.lotteryReports.operations.compare.toPay"),
      value: (store) =>
        outstandingOf(store, ["purchaseToPay", "transferToPay"]),
    },
    {
      label: t("admin.lotteryReports.operations.compare.toReceive"),
      value: (store) => outstandingOf(store, ["transferToReceive"]),
    },
  ];
  return {
    title: t("admin.lotteryReports.operations.blocks.compare"),
    description: t("admin.lotteryReports.operations.descriptions.compare"),
    columns: [
      textColumn("item", t("admin.lotteryReports.operations.columns.item"), 20),
      ...stores.map((entry, index) =>
        numberColumn(`store${String(index)}`, entry.name, 12),
      ),
      numberColumn(
        "total",
        t("admin.lotteryReports.operations.columns.total"),
        14,
      ),
    ],
    rows: metrics
      .filter((metric) => withCost || metric.cost !== true)
      .map((metric) =>
        line({
          item: metric.label,
          ...Object.fromEntries(
            stores.map((entry, index) => [
              `store${String(index)}`,
              metric.value(entry.store) ?? null,
            ]),
          ),
          total: metric.value(total) ?? null,
        }),
      ),
  };
};
