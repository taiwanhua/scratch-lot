import {
  type OperationsRow,
  type OperationsStore,
  POST_CLOSE_KEYS,
  type T,
  keyIn,
  row,
} from "./operations-row-base";
import {
  bankRows,
  gameRows,
  notesRows,
  outstandingRows,
} from "./operations-rows-more";

export type { OperationsRow, OperationsStore, T } from "./operations-row-base";

/** 區塊 1–2:銷售、毛利(毛利只在有成本時列)。 */
const salesRows = (store: OperationsStore, t: T): OperationsRow[] => {
  const { sales } = store;
  const rows = [
    row(
      "sales",
      t("admin.lotteryReports.operations.items.scan"),
      { ...sales.scan, unit: "tickets" },
      t,
    ),
    ...sales.manual.map((reason) =>
      row(
        "sales",
        t("admin.lotteryReports.operations.items.manual", {
          reason: reason.reason,
        }),
        { count: reason.count, amount: reason.amount, unit: "tickets" },
        t,
      ),
    ),
    row(
      "sales",
      t("admin.lotteryReports.operations.items.stocktake"),
      { ...sales.stocktake, unit: "tickets" },
      t,
    ),
    row(
      "sales",
      t("admin.lotteryReports.operations.items.undo"),
      { count: -sales.undo.count, amount: -sales.undo.amount, unit: "tickets" },
      t,
    ),
    row(
      "sales",
      t("admin.lotteryReports.operations.items.net"),
      { ...sales.net, unit: "tickets" },
      t,
    ),
  ];
  if (sales.cost != null) {
    rows.push(
      row(
        "profit",
        t("admin.lotteryReports.operations.items.soldCost"),
        { amount: sales.cost },
        t,
      ),
      row(
        "profit",
        t("admin.lotteryReports.operations.items.grossProfit"),
        { amount: sales.net.amount - sales.cost },
        t,
      ),
    );
  }
  return rows;
};

const redemptionRows = (store: OperationsStore, t: T): OperationsRow[] => {
  const { redemption } = store;
  return [
    row(
      "redemption",
      t("admin.lotteryReports.operations.items.redemptionValid"),
      { ...redemption.valid, unit: "tickets" },
      t,
    ),
    row(
      "redemption",
      t("admin.lotteryReports.operations.items.redemptionInStore"),
      { ...redemption.inStore, unit: "tickets" },
      t,
    ),
    row(
      "redemption",
      t("admin.lotteryReports.operations.items.redemptionSent"),
      { ...redemption.sent, unit: "tickets" },
      t,
    ),
    row(
      "redemption",
      t("admin.lotteryReports.operations.items.redemptionRevoked"),
      { ...redemption.revoked, unit: "tickets" },
      t,
    ),
  ];
};

const inventoryRows = (store: OperationsStore, t: T): OperationsRow[] => {
  const { inventory: inv } = store;
  const withCost = inv.purchaseCost != null;
  const rows = [
    row(
      "inventory",
      t("admin.lotteryReports.operations.items.purchase"),
      {
        count: inv.purchaseTickets,
        amount: inv.purchaseCost,
        note: t("admin.lotteryReports.operations.items.books", {
          count: inv.purchaseBooks,
        }),
        unit: "tickets",
      },
      t,
    ),
    row(
      "inventory",
      t("admin.lotteryReports.operations.items.transferIn"),
      {
        count: inv.transferInTickets,
        amount: inv.transferInAmount,
        unit: "tickets",
      },
      t,
    ),
    row(
      "inventory",
      t("admin.lotteryReports.operations.items.transferOut"),
      {
        count: inv.transferOutTickets,
        amount: inv.transferOutAmount,
        unit: "tickets",
      },
      t,
    ),
  ];
  if (withCost) {
    rows.push(
      row(
        "inventory",
        t("admin.lotteryReports.operations.items.transferGain"),
        { amount: inv.transferGain },
        t,
      ),
    );
  }
  rows.push(
    row(
      "inventory",
      t("admin.lotteryReports.operations.items.scrap"),
      { count: inv.scrapTickets, amount: inv.scrapCost, unit: "tickets" },
      t,
    ),
    row(
      "inventory",
      t("admin.lotteryReports.operations.items.lost"),
      { count: inv.lostTickets, amount: inv.lostCost, unit: "tickets" },
      t,
    ),
    row(
      "inventory",
      t("admin.lotteryReports.operations.items.recovered"),
      {
        count: inv.recoveredTickets,
        amount: inv.recoveredCost,
        unit: "tickets",
      },
      t,
    ),
    row(
      "inventory",
      t("admin.lotteryReports.operations.items.skipped"),
      {
        count: inv.skippedTickets,
        note: t("admin.lotteryReports.operations.items.noCost"),
        unit: "tickets",
      },
      t,
    ),
    row(
      "inventory",
      t("admin.lotteryReports.operations.items.ending"),
      { count: inv.endingTickets, amount: inv.endingCost, unit: "tickets" },
      t,
    ),
    row(
      "inventory",
      t("admin.lotteryReports.operations.items.investigating"),
      { count: inv.investigatingBooks, unit: "books" },
      t,
    ),
  );
  return rows;
};

const cashRows = (store: OperationsStore, t: T): OperationsRow[] => {
  const { cash } = store;
  return [
    row(
      "cash",
      t("admin.lotteryReports.operations.items.shiftDifference"),
      { count: cash.shiftCount, amount: cash.shiftDifference, unit: "shifts" },
      t,
    ),
    ...(cash.postClose.length === 0
      ? [
          row(
            "cash",
            t("admin.lotteryReports.operations.items.postCloseNone"),
            { amount: 0 },
            t,
          ),
        ]
      : cash.postClose.map((item) =>
          row(
            "cash",
            t("admin.lotteryReports.operations.items.postClose", {
              category: t(
                keyIn(
                  POST_CLOSE_KEYS,
                  item.category,
                  "admin.lotteryReports.operations.postClose.other",
                ),
              ),
            }),
            { count: item.count, amount: item.amount, unit: "records" },
            t,
          ),
        )),
    row(
      "cash",
      t("admin.lotteryReports.operations.items.refund"),
      { amount: cash.refund },
      t,
    ),
    row(
      "cash",
      t("admin.lotteryReports.operations.items.transferExpense"),
      { amount: cash.transferExpense },
      t,
    ),
    row(
      "cash",
      t("admin.lotteryReports.operations.items.transferIncome"),
      { amount: cash.transferIncome },
      t,
    ),
    row(
      "cash",
      t("admin.lotteryReports.operations.items.deposit"),
      { amount: cash.deposit },
      t,
    ),
    row(
      "cash",
      t("admin.lotteryReports.operations.items.bankDeposit"),
      { amount: cash.bankDeposit },
      t,
    ),
    row(
      "cash",
      t("admin.lotteryReports.operations.items.vaultDifference"),
      {
        count: cash.dailyCloseCount,
        amount: cash.vaultDifference,
        unit: "times",
      },
      t,
    ),
  ];
};

/** 一家店(或合計)的全部列,依區塊順序。 */
export const operationsRowsOf = (
  store: OperationsStore,
  t: T,
): OperationsRow[] => {
  return [
    ...salesRows(store, t),
    ...redemptionRows(store, t),
    ...inventoryRows(store, t),
    ...cashRows(store, t),
    ...bankRows(store, t),
    ...outstandingRows(store, t),
    ...notesRows(store, t),
    ...gameRows(store, t),
  ];
};
