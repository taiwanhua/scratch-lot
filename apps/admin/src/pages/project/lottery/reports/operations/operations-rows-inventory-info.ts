/** 營運報表區塊 4 · 不在加減裡、另外列的(`operations-rows.ts` 的一部分)。 */
import type { SheetRow, SheetSection } from "@/lib/base/reports/excel";

import {
  type OperationsStore,
  type T,
  hasCost,
  line,
  numberColumn,
  textColumn,
} from "./operations-row-base";
import { pendingAtEndLine } from "./operations-rows-wholesale";

/** 4 庫存異動 · 不在加減裡、另外列的:期末在途、期末待查、確認遺失、跳號、期末批售中、調貨損益。 */
export const inventoryInfoSection = (
  store: OperationsStore,
  t: T,
): SheetSection => {
  const inv = store.inventory;
  const withCost = hasCost(store);
  const rows: SheetRow[] = [
    line({
      item: t("admin.lotteryReports.operations.items.inTransit"),
      tickets: inv.inTransitTickets,
      amount: inv.inTransitAmount,
      note: t("admin.lotteryReports.operations.items.inTransitNote"),
    }),
    line({
      item: t("admin.lotteryReports.operations.items.investigating"),
      tickets: inv.investigatingTickets,
      amount: inv.investigatingCost,
      // 系統預設帶入的(待查·未對號)不列張號區段(張數店規格 11.4)
      note:
        inv.investigatingUnmatchedTickets > 0
          ? t("admin.lotteryReports.operations.items.investigatingUnmatched", {
              count: inv.investigatingBooks,
              unmatched: inv.investigatingUnmatchedTickets,
            })
          : t("admin.lotteryReports.operations.items.books", {
              count: inv.investigatingBooks,
            }),
    }),
    line({
      item: t("admin.lotteryReports.operations.items.lost"),
      tickets: inv.lostTickets,
      amount: inv.lostCost,
      note: t("admin.lotteryReports.operations.items.lostNote"),
    }),
    line({
      item: t("admin.lotteryReports.operations.items.skipped"),
      tickets: inv.skippedTickets,
      note: t("admin.lotteryReports.operations.items.skippedNote"),
    }),
    // 期末批售中:仍算在期末庫存,只是註記(專案規格 21.7)
    pendingAtEndLine(store, t),
  ];
  if (withCost) {
    rows.push(
      line({
        item: t("admin.lotteryReports.operations.items.transferGain"),
        amount: inv.transferGain,
        note: t("admin.lotteryReports.operations.items.transferGainNote"),
      }),
    );
  }
  return {
    title: t("admin.lotteryReports.operations.blocks.inventoryInfo"),
    description: t(
      "admin.lotteryReports.operations.descriptions.inventoryInfo",
    ),
    columns: [
      textColumn("item", t("admin.lotteryReports.operations.columns.item")),
      numberColumn(
        "tickets",
        t("admin.lotteryReports.operations.columns.tickets"),
      ),
      ...(withCost
        ? [
            numberColumn(
              "amount",
              t("admin.lotteryReports.operations.columns.amount"),
              14,
            ),
          ]
        : []),
      textColumn("note", t("admin.lotteryReports.operations.columns.note")),
    ],
    rows,
  };
};
