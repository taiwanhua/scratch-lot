/** 營運報表區塊 6–8 與依遊戲展開的列(`operations-rows.ts` 的後半)。 */
import {
  BANK_TYPE_KEYS,
  type OperationsRow,
  type OperationsStore,
  type T,
  keyIn,
  row,
} from "./operations-row-base";

export const bankRows = (store: OperationsStore, t: T): OperationsRow[] => {
  return store.bankAccounts.flatMap((account) => {
    const label = account.shared
      ? t("admin.lotteryReports.operations.items.sharedAccount", {
          label: account.label,
        })
      : account.label;
    return [
      ...account.types.map((type) =>
        row(
          "bank",
          t("admin.lotteryReports.operations.items.bankType", {
            account: label,
            type: t(
              keyIn(
                BANK_TYPE_KEYS,
                type.type,
                "admin.lotteryReports.operations.bankTypes.other",
              ),
            ),
          }),
          {
            amount: type.direction === "in" ? type.amount : -type.amount,
          },
          t,
        ),
      ),
      row(
        "bank",
        t("admin.lotteryReports.operations.items.bankBalance", {
          account: label,
        }),
        { amount: account.endingBalance },
        t,
      ),
    ];
  });
};

export const outstandingRows = (
  store: OperationsStore,
  t: T,
): OperationsRow[] => {
  const { outstanding } = store;
  return [
    row(
      "outstanding",
      t("admin.lotteryReports.operations.items.purchaseToPay"),
      { amount: outstanding.purchaseToPay },
      t,
    ),
    row(
      "outstanding",
      t("admin.lotteryReports.operations.items.purchaseToRefund"),
      { amount: outstanding.purchaseToRefund },
      t,
    ),
    row(
      "outstanding",
      t("admin.lotteryReports.operations.items.transferToReceive"),
      { amount: outstanding.transferToReceive },
      t,
    ),
    row(
      "outstanding",
      t("admin.lotteryReports.operations.items.transferToPay"),
      { amount: outstanding.transferToPay },
      t,
    ),
  ];
};

export const notesRows = (store: OperationsStore, t: T): OperationsRow[] => {
  const { notes } = store;
  const skipped = notes.skippedStocktakes.reduce(
    (sum, item) => sum + item.count,
    0,
  );
  return [
    row(
      "notes",
      t("admin.lotteryReports.operations.items.skippedStocktakes"),
      {
        count: skipped,
        note:
          notes.skippedStocktakes.length === 0
            ? null
            : notes.skippedStocktakes
                .map((item) =>
                  t("admin.lotteryReports.operations.items.reasonCount", {
                    reason: item.reason,
                    count: item.count,
                  }),
                )
                .join("、"),
        unit: "times",
      },
      t,
    ),
    row(
      "notes",
      t("admin.lotteryReports.operations.items.uncountedBooks"),
      {
        count: notes.uncountedBooks,
        note:
          notes.uncountedBooks === 0
            ? null
            : t("admin.lotteryReports.operations.items.uncountedNote", {
                books: notes.uncountedBooks,
                stocktakes: notes.uncountedStocktakes,
              }),
        unit: "books",
      },
      t,
    ),
    row(
      "notes",
      t("admin.lotteryReports.operations.items.uncoveredShifts"),
      { count: notes.uncoveredShifts, unit: "shifts" },
      t,
    ),
    row(
      "notes",
      t("admin.lotteryReports.operations.items.priorPeriod"),
      {
        count: notes.priorPeriodCount,
        amount: notes.priorPeriodAmount,
        unit: "records",
      },
      t,
    ),
    row(
      "notes",
      t("admin.lotteryReports.operations.items.openMonths"),
      {
        note:
          notes.openMonths.length === 0
            ? t("admin.lotteryReports.operations.items.allClosed")
            : notes.openMonths.join("、"),
      },
      t,
    ),
  ];
};

export const gameRows = (store: OperationsStore, t: T): OperationsRow[] => {
  return store.sales.games.map((game) =>
    row(
      "games",
      t("admin.lotteryReports.operations.items.game", {
        code: game.gameCode,
        name: game.gameName,
        price: game.unitPrice,
      }),
      {
        count: game.sold - game.undone,
        amount: game.netAmount,
        note: t("admin.lotteryReports.operations.items.gameNote", {
          sold: game.sold,
          undone: game.undone,
        }),
        unit: "tickets",
        wide: true,
      },
      t,
    ),
  );
};
