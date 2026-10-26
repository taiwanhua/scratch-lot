import type { SheetRow, SheetSection } from "@/lib/project/reports/excel";

import {
  type OperationsStore,
  type T,
  hasCost,
  line,
  negate,
  numberColumn,
  percentLine,
  textColumn,
  totalLine,
} from "./operations-row-base";
import {
  cashDifferenceSection,
  cashMovementSection,
} from "./operations-rows-cash";
import {
  bankSection,
  gamesSection,
  notesSection,
  outstandingSection,
} from "./operations-rows-more";

export type { OperationsStore, T } from "./operations-row-base";

const columnsKey = "admin.lotteryReports.operations.columns";

/** 1 銷售:刷條碼、手動(依原因)、補登售出、撤銷(負數)、淨銷售。 */
const salesSection = (store: OperationsStore, t: T): SheetSection => {
  const { sales } = store;
  return {
    title: t("admin.lotteryReports.operations.blocks.sales"),
    description: t("admin.lotteryReports.operations.descriptions.sales"),
    columns: [
      textColumn("item", t(`${columnsKey}.item`)),
      numberColumn("tickets", t(`${columnsKey}.tickets`)),
      numberColumn("amount", t(`${columnsKey}.amount`), 14),
    ],
    rows: [
      line({
        item: t("admin.lotteryReports.operations.items.scan"),
        tickets: sales.scan.count,
        amount: sales.scan.amount,
      }),
      ...sales.manual.map((reason) =>
        line({
          item: t("admin.lotteryReports.operations.items.manual", {
            reason: reason.reason,
          }),
          tickets: reason.count,
          amount: reason.amount,
        }),
      ),
      line({
        item: t("admin.lotteryReports.operations.items.stocktake"),
        tickets: sales.stocktake.count,
        amount: sales.stocktake.amount,
      }),
      line({
        item: t("admin.lotteryReports.operations.items.undo"),
        tickets: negate(sales.undo.count),
        amount: negate(sales.undo.amount),
      }),
      totalLine({
        item: t("admin.lotteryReports.operations.items.net"),
        tickets: sales.net.count,
        amount: sales.net.amount,
      }),
    ],
  };
};

/** 毛利率 = 毛利 ÷ 淨銷售金額(淨銷售 0 → 空白)。 */
export const marginOf = (netAmount: number, cost: number): number | null =>
  netAmount === 0 ? null : (netAmount - cost) / netAmount;

/** 2 毛利(要成本權限):淨銷售金額、已售成本、毛利、毛利率。 */
const profitSection = (store: OperationsStore, t: T): SheetSection | null => {
  const { sales } = store;
  if (sales.cost == null) {
    return null;
  }
  return {
    title: t("admin.lotteryReports.operations.blocks.profit"),
    description: t("admin.lotteryReports.operations.descriptions.profit"),
    columns: [
      textColumn("item", t(`${columnsKey}.item`)),
      numberColumn("amount", t(`${columnsKey}.amount`), 14),
    ],
    rows: [
      line({
        item: t("admin.lotteryReports.operations.items.netAmount"),
        amount: sales.net.amount,
      }),
      line({
        item: t("admin.lotteryReports.operations.items.soldCost"),
        amount: sales.cost,
      }),
      totalLine({
        item: t("admin.lotteryReports.operations.items.grossProfit"),
        amount: sales.net.amount - sales.cost,
      }),
      percentLine({
        item: t("admin.lotteryReports.operations.items.margin"),
        amount: marginOf(sales.net.amount, sales.cost),
      }),
    ],
  };
};

/** 3 兌獎:有效(其中店內持有 / 已送兌)、已撤銷另列;狀態看期末那一刻。 */
const redemptionSection = (store: OperationsStore, t: T): SheetSection => {
  const { redemption } = store;
  const columns = [
    textColumn("item", t(`${columnsKey}.item`)),
    numberColumn("tickets", t(`${columnsKey}.tickets`)),
    numberColumn("amount", t(`${columnsKey}.prize`), 14),
    textColumn("note", t(`${columnsKey}.note`)),
  ];
  return {
    title: t("admin.lotteryReports.operations.blocks.redemption"),
    description: t("admin.lotteryReports.operations.descriptions.redemption"),
    columns,
    rows: [
      totalLine({
        item: t("admin.lotteryReports.operations.items.redemptionValid"),
        tickets: redemption.valid.count,
        amount: redemption.valid.amount,
        note: t("admin.lotteryReports.operations.items.redemptionValidNote"),
      }),
      line({
        item: t("admin.lotteryReports.operations.items.redemptionInStore"),
        tickets: redemption.inStore.count,
        amount: redemption.inStore.amount,
      }),
      line({
        item: t("admin.lotteryReports.operations.items.redemptionSent"),
        tickets: redemption.sent.count,
        amount: redemption.sent.amount,
      }),
      line({
        item: t("admin.lotteryReports.operations.items.redemptionRevoked"),
        tickets: redemption.revoked.count,
        amount: redemption.revoked.amount,
      }),
    ],
  };
};

/** 核對列的說明:對得上 / 差多少。 */
const checkNote = (store: OperationsStore, t: T): string => {
  const { checkTickets, checkCost } = store.inventory;
  if (checkTickets === 0 && (checkCost ?? 0) === 0) {
    return t("admin.lotteryReports.operations.items.checkOk");
  }
  return checkCost == null
    ? t("admin.lotteryReports.operations.items.checkDiffTickets", {
        tickets: checkTickets,
      })
    : t("admin.lotteryReports.operations.items.checkDiff", {
        tickets: checkTickets,
        cost: checkCost.toLocaleString(),
      });
};

/**
 * 4 庫存異動:由上往下加減(− 的列顯示負數),期末庫存之後是核對(0 = 對得上)。
 * 沒有成本權限時沒有成本欄,調出的調貨金額也不寫。
 */
const inventorySection = (store: OperationsStore, t: T): SheetSection => {
  const inv = store.inventory;
  const withCost = hasCost(store);
  const columns = [
    textColumn("item", t(`${columnsKey}.item`)),
    numberColumn("tickets", t(`${columnsKey}.tickets`)),
    ...(withCost ? [numberColumn("cost", t(`${columnsKey}.cost`), 14)] : []),
    textColumn("note", t(`${columnsKey}.note`)),
  ];
  const item = (key: string) =>
    t(`admin.lotteryReports.operations.items.${key}`);
  const rows: SheetRow[] = [
    line({
      item: item("opening"),
      tickets: inv.openingTickets,
      cost: inv.openingCost,
    }),
    line({
      item: item("purchase"),
      tickets: inv.purchaseTickets,
      cost: inv.purchaseCost,
      note:
        inv.purchaseVoidBooks > 0
          ? t("admin.lotteryReports.operations.items.booksWithVoid", {
              count: inv.purchaseBooks,
              voided: inv.purchaseVoidBooks,
            })
          : t("admin.lotteryReports.operations.items.books", {
              count: inv.purchaseBooks,
            }),
    }),
    line({
      item: item("transferIn"),
      tickets: inv.transferInTickets,
      cost: inv.transferInAmount,
    }),
    line({
      item: item("transferOut"),
      tickets: negate(inv.transferOutTickets),
      cost: negate(inv.transferOutCost),
      note:
        inv.transferOutAmount == null
          ? null
          : t("admin.lotteryReports.operations.items.transferAmount", {
              amount: inv.transferOutAmount.toLocaleString(),
            }),
    }),
    line({
      item: item("sales"),
      tickets: negate(inv.salesTickets),
      cost: negate(inv.salesCost),
    }),
    line({
      item: item("scrap"),
      tickets: negate(inv.scrapTickets),
      cost: negate(inv.scrapCost),
    }),
    line({
      item: item("newInvestigating"),
      tickets: negate(inv.newInvestigatingTickets),
      cost: negate(inv.newInvestigatingCost),
    }),
    line({
      item: item("investigateRecovered"),
      tickets: inv.investigateRecoveredTickets,
      cost: inv.investigateRecoveredCost,
    }),
    line({
      item: item("lostRecovered"),
      tickets: inv.lostRecoveredTickets,
      cost: inv.lostRecoveredCost,
    }),
    totalLine({
      item: item("ending"),
      tickets: inv.endingTickets,
      cost: inv.endingCost,
    }),
    totalLine({
      item: item("check"),
      tickets: inv.checkTickets,
      cost: inv.checkCost,
      note: checkNote(store, t),
    }),
  ];
  return {
    title: t("admin.lotteryReports.operations.blocks.inventory"),
    description: t("admin.lotteryReports.operations.descriptions.inventory"),
    columns,
    rows,
  };
};

/** 4 庫存異動 · 不在加減裡、另外列的:期末在途、期末待查、確認遺失、跳號、調貨損益。 */
const inventoryInfoSection = (store: OperationsStore, t: T): SheetSection => {
  const inv = store.inventory;
  const withCost = hasCost(store);
  const item = (key: string) =>
    t(`admin.lotteryReports.operations.items.${key}`);
  const rows: SheetRow[] = [
    line({
      item: item("inTransit"),
      tickets: inv.inTransitTickets,
      amount: inv.inTransitAmount,
      note: item("inTransitNote"),
    }),
    line({
      item: item("investigating"),
      tickets: inv.investigatingTickets,
      amount: inv.investigatingCost,
      note: t("admin.lotteryReports.operations.items.books", {
        count: inv.investigatingBooks,
      }),
    }),
    line({
      item: item("lost"),
      tickets: inv.lostTickets,
      amount: inv.lostCost,
      note: item("lostNote"),
    }),
    line({
      item: item("skipped"),
      tickets: inv.skippedTickets,
      note: item("skippedNote"),
    }),
  ];
  if (withCost) {
    rows.push(
      line({
        item: item("transferGain"),
        amount: inv.transferGain,
        note: item("transferGainNote"),
      }),
    );
  }
  return {
    title: t("admin.lotteryReports.operations.blocks.inventoryInfo"),
    description: t(
      "admin.lotteryReports.operations.descriptions.inventoryInfo",
    ),
    columns: [
      textColumn("item", t(`${columnsKey}.item`)),
      numberColumn("tickets", t(`${columnsKey}.tickets`)),
      ...(withCost
        ? [numberColumn("amount", t(`${columnsKey}.amount`), 14)]
        : []),
      textColumn("note", t(`${columnsKey}.note`)),
    ],
    rows,
  };
};

/** 一家店(或合計)的全部區塊,依區塊順序(1 銷售 → 依遊戲 → 2 → … → 8);沒有成本權限時不放毛利。 */
export const operationsSectionsOf = (
  store: OperationsStore,
  t: T,
): SheetSection[] =>
  [
    salesSection(store, t),
    gamesSection(store, t),
    profitSection(store, t),
    redemptionSection(store, t),
    inventorySection(store, t),
    inventoryInfoSection(store, t),
    cashDifferenceSection(store, t),
    cashMovementSection(store, t),
    bankSection(store, t),
    outstandingSection(store, t),
    notesSection(store, t),
  ].filter((section): section is SheetSection => section !== null);
