import type { SheetRow, SheetSection } from "@/lib/base/reports/excel";

import {
  type OperationsStore,
  type SheetOptions,
  type T,
  hasCost,
  isCountSheet,
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
import { inventoryInfoSection } from "./operations-rows-inventory-info";
import {
  bankSection,
  gamesSection,
  notesSection,
  outstandingSection,
} from "./operations-rows-more";
import { wholesaleSections } from "./operations-rows-wholesale";

export type { OperationsStore, SheetOptions, T } from "./operations-row-base";

/** 1 銷售:刷條碼、手動(依原因)、依張數標記售出(張數店)、補登售出、撤銷(負數)、淨銷售。 */
const salesSection = (store: OperationsStore, t: T): SheetSection => {
  const { sales } = store;
  return {
    title: t("admin.lotteryReports.operations.blocks.sales"),
    description: t("admin.lotteryReports.operations.descriptions.sales"),
    columns: [
      textColumn("item", t("admin.lotteryReports.operations.columns.item")),
      numberColumn(
        "tickets",
        t("admin.lotteryReports.operations.columns.tickets"),
      ),
      numberColumn(
        "amount",
        t("admin.lotteryReports.operations.columns.amount"),
        14,
      ),
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
      // 張數店多一列來源(依張數賣不混進手動;張數店規格 11.2、11.4)
      ...(isCountSheet(store)
        ? [
            line({
              item: t("admin.lotteryReports.operations.items.countSale"),
              tickets: sales.countSale.count,
              amount: sales.countSale.amount,
            }),
          ]
        : []),
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

/**
 * 2 毛利(要成本權限):淨銷售金額、已售成本、毛利、毛利率。這一期含估算(張數店規格 11.1)→ 標題「毛利(估算)」、
 * 說明前面加估算的範圍;數字不加標記。
 */
const profitSection = (store: OperationsStore, t: T): SheetSection | null => {
  const { sales } = store;
  if (sales.cost == null) {
    return null;
  }
  return {
    title: t(
      store.estimated
        ? "admin.lotteryReports.operations.blocks.profitEstimated"
        : "admin.lotteryReports.operations.blocks.profit",
    ),
    description: store.estimated
      ? `${t("admin.lotteryReports.operations.descriptions.estimated")}${t("admin.lotteryReports.operations.descriptions.profit")}`
      : t("admin.lotteryReports.operations.descriptions.profit"),
    columns: [
      textColumn("item", t("admin.lotteryReports.operations.columns.item")),
      numberColumn(
        "amount",
        t("admin.lotteryReports.operations.columns.amount"),
        14,
      ),
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
    textColumn("item", t("admin.lotteryReports.operations.columns.item")),
    numberColumn(
      "tickets",
      t("admin.lotteryReports.operations.columns.tickets"),
    ),
    numberColumn(
      "amount",
      t("admin.lotteryReports.operations.columns.prize"),
      14,
    ),
    textColumn("note", t("admin.lotteryReports.operations.columns.note")),
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
    textColumn("item", t("admin.lotteryReports.operations.columns.item")),
    numberColumn(
      "tickets",
      t("admin.lotteryReports.operations.columns.tickets"),
    ),
    ...(withCost
      ? [
          numberColumn(
            "cost",
            t("admin.lotteryReports.operations.columns.cost"),
            14,
          ),
        ]
      : []),
    textColumn("note", t("admin.lotteryReports.operations.columns.note")),
  ];
  const rows: SheetRow[] = [
    line({
      item: t("admin.lotteryReports.operations.items.opening"),
      tickets: inv.openingTickets,
      cost: inv.openingCost,
    }),
    line({
      item: t("admin.lotteryReports.operations.items.purchase"),
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
      item: t("admin.lotteryReports.operations.items.transferIn"),
      tickets: inv.transferInTickets,
      cost: inv.transferInAmount,
    }),
    line({
      item: t("admin.lotteryReports.operations.items.transferOut"),
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
      item: t("admin.lotteryReports.operations.items.sales"),
      tickets: negate(inv.salesTickets),
      cost: negate(inv.salesCost),
    }),
    // 淨批售(批售 − 取消批售;專案規格 21.7)
    line({
      item: t("admin.lotteryReports.operations.items.wholesale"),
      tickets: negate(inv.wholesaleTickets),
      cost: negate(inv.wholesaleCost),
    }),
    line({
      item: t("admin.lotteryReports.operations.items.scrap"),
      tickets: negate(inv.scrapTickets),
      cost: negate(inv.scrapCost),
    }),
    line({
      item: t("admin.lotteryReports.operations.items.newInvestigating"),
      tickets: negate(inv.newInvestigatingTickets),
      cost: negate(inv.newInvestigatingCost),
    }),
    // 撤銷報廢(兩種店共用,張數店規格 7.8、11.2):有撤銷或張數店才列
    ...(isCountSheet(store) || inv.scrapUndoTickets !== 0
      ? [
          line({
            item: t("admin.lotteryReports.operations.items.scrapUndo"),
            tickets: inv.scrapUndoTickets,
            cost: inv.scrapUndoCost,
          }),
        ]
      : []),
    line({
      item: t("admin.lotteryReports.operations.items.investigateRecovered"),
      tickets: inv.investigateRecoveredTickets,
      cost: inv.investigateRecoveredCost,
    }),
    line({
      item: t("admin.lotteryReports.operations.items.lostRecovered"),
      tickets: inv.lostRecoveredTickets,
      cost: inv.lostRecoveredCost,
    }),
    line({
      item: t("admin.lotteryReports.operations.items.pendingAdjust"),
      tickets: inv.pendingAdjustTickets,
      cost: inv.pendingAdjustCost,
      note: t("admin.lotteryReports.operations.items.pendingAdjustNote"),
    }),
    // 對號成本調整(張數店;只有成本、張數留空,張數店規格 11.2)
    ...(isCountSheet(store)
      ? [
          line({
            item: t("admin.lotteryReports.operations.items.matchCostAdjust"),
            cost: inv.matchCostAdjustCost,
            note: t(
              "admin.lotteryReports.operations.items.matchCostAdjustNote",
            ),
          }),
        ]
      : []),
    totalLine({
      item: t("admin.lotteryReports.operations.items.ending"),
      tickets: inv.endingTickets,
      cost: inv.endingCost,
    }),
    totalLine({
      item: t("admin.lotteryReports.operations.items.check"),
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

/** 一家店(或合計)的全部區塊,依區塊順序(1 銷售 → 依遊戲 → 2 → 2b → 3 → … → 8);沒有成本權限時不放毛利。 */
export const operationsSectionsOf = (
  store: OperationsStore,
  t: T,
  options: SheetOptions,
): SheetSection[] =>
  [
    salesSection(store, t),
    gamesSection(store, t),
    profitSection(store, t),
    ...wholesaleSections(store, t, options),
    redemptionSection(store, t),
    inventorySection(store, t),
    inventoryInfoSection(store, t),
    cashDifferenceSection(store, t),
    cashMovementSection(store, t),
    bankSection(store, t),
    outstandingSection(store, t),
    notesSection(store, t, options),
  ].filter((section): section is SheetSection => section !== null);
