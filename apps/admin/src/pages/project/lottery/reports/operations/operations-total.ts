import type { OperationsStore } from "./operations-rows";

/** 營運報表「全部分店合計」:各店加總(銀行的期末餘額同一個帳戶只算一次)。 */

const sumQty = (
  list: readonly { count: number; amount: number }[],
): { count: number; amount: number } => ({
  count: list.reduce((sum, item) => sum + item.count, 0),
  amount: list.reduce((sum, item) => sum + item.amount, 0),
});

const sumNullable = (values: readonly (number | null | undefined)[]) =>
  values.some((value) => value === null || value === undefined)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);

const sumBy = <K extends string>(
  rows: readonly Record<K, number>[],
  key: K,
): number => rows.reduce((sum, row) => sum + row[key], 0);

/** 依 key 合併列表(加總數值欄)。 */
const mergeBy = <Item extends object>(
  lists: readonly (readonly Item[])[],
  keyOf: (item: Item) => string,
  merge: (left: Item, right: Item) => Item,
): Item[] => {
  const result = new Map<string, Item>();
  for (const item of lists.flat()) {
    const key = keyOf(item);
    const current = result.get(key);
    result.set(key, current === undefined ? item : merge(current, item));
  }
  return [...result.values()];
};

/** 全部分店合計(每家店的數字加總;成本是 null 的(沒有 show-cost)維持 null)。 */
export const totalStoreOf = (
  stores: readonly OperationsStore[],
): OperationsStore => {
  const sales = stores.map((store) => store.sales);
  const inventory = stores.map((store) => store.inventory);
  const cash = stores.map((store) => store.cash);
  const notes = stores.map((store) => store.notes);
  const outstanding = stores.map((store) => store.outstanding);
  const redemption = stores.map((store) => store.redemption);
  return {
    orgId: "",
    period: stores[0]?.period ?? {
      orgId: "",
      from: "",
      to: "",
      alignment: "period",
    },
    sales: {
      scan: sumQty(sales.map((item) => item.scan)),
      manual: mergeBy(
        sales.map((item) => item.manual),
        (item) => item.reasonKey,
        (left, right) => ({
          ...left,
          count: left.count + right.count,
          amount: left.amount + right.amount,
        }),
      ),
      stocktake: sumQty(sales.map((item) => item.stocktake)),
      undo: sumQty(sales.map((item) => item.undo)),
      net: sumQty(sales.map((item) => item.net)),
      cost: sumNullable(sales.map((item) => item.cost)),
      games: mergeBy(
        sales.map((item) => item.games),
        (item) => item.gameId,
        (left, right) => ({
          ...left,
          sold: left.sold + right.sold,
          undone: left.undone + right.undone,
          netAmount: left.netAmount + right.netAmount,
          cost: sumNullable([left.cost, right.cost]),
        }),
      ).toSorted((a, b) => a.gameCode.localeCompare(b.gameCode, "zh-Hant")),
    },
    redemption: {
      valid: sumQty(redemption.map((item) => item.valid)),
      inStore: sumQty(redemption.map((item) => item.inStore)),
      sent: sumQty(redemption.map((item) => item.sent)),
      revoked: sumQty(redemption.map((item) => item.revoked)),
    },
    inventory: {
      purchaseBooks: sumBy(inventory, "purchaseBooks"),
      purchaseTickets: sumBy(inventory, "purchaseTickets"),
      purchaseCost: sumNullable(inventory.map((item) => item.purchaseCost)),
      transferInTickets: sumBy(inventory, "transferInTickets"),
      transferInAmount: sumBy(inventory, "transferInAmount"),
      transferOutTickets: sumBy(inventory, "transferOutTickets"),
      transferOutAmount: sumBy(inventory, "transferOutAmount"),
      transferGain: sumNullable(inventory.map((item) => item.transferGain)),
      scrapTickets: sumBy(inventory, "scrapTickets"),
      scrapCost: sumNullable(inventory.map((item) => item.scrapCost)),
      lostTickets: sumBy(inventory, "lostTickets"),
      lostCost: sumNullable(inventory.map((item) => item.lostCost)),
      recoveredTickets: sumBy(inventory, "recoveredTickets"),
      recoveredCost: sumNullable(inventory.map((item) => item.recoveredCost)),
      skippedTickets: sumBy(inventory, "skippedTickets"),
      endingTickets: sumBy(inventory, "endingTickets"),
      endingCost: sumNullable(inventory.map((item) => item.endingCost)),
      investigatingBooks: sumBy(inventory, "investigatingBooks"),
    },
    cash: {
      shiftCount: sumBy(cash, "shiftCount"),
      shiftDifference: sumBy(cash, "shiftDifference"),
      postClose: mergeBy(
        cash.map((item) => item.postClose),
        (item) => item.category,
        (left, right) => ({
          ...left,
          count: left.count + right.count,
          amount: left.amount + right.amount,
        }),
      ),
      refund: sumBy(cash, "refund"),
      transferExpense: sumBy(cash, "transferExpense"),
      transferIncome: sumBy(cash, "transferIncome"),
      deposit: sumBy(cash, "deposit"),
      bankDeposit: sumBy(cash, "bankDeposit"),
      dailyCloseCount: sumBy(cash, "dailyCloseCount"),
      vaultDifference: sumBy(cash, "vaultDifference"),
    },
    // 同一個帳戶只列一次:各店歸屬的交易依類型加總,期末餘額是整個帳戶的(取一次)
    bankAccounts: mergeBy(
      stores.map((store) => store.bankAccounts),
      (item) => item.accountId,
      (left, right) => ({
        ...left,
        types: mergeBy(
          [left.types, right.types],
          (item) => `${item.type}|${item.direction}`,
          (a, b) => ({ ...a, amount: a.amount + b.amount }),
        ),
      }),
    ),
    outstanding: {
      purchaseToPay: sumBy(outstanding, "purchaseToPay"),
      purchaseToRefund: sumBy(outstanding, "purchaseToRefund"),
      transferToReceive: sumBy(outstanding, "transferToReceive"),
      transferToPay: sumBy(outstanding, "transferToPay"),
    },
    notes: {
      skippedStocktakes: mergeBy(
        notes.map((item) => item.skippedStocktakes),
        (item) => item.reason,
        (left, right) => ({ ...left, count: left.count + right.count }),
      ),
      uncountedStocktakes: sumBy(notes, "uncountedStocktakes"),
      uncountedBooks: sumBy(notes, "uncountedBooks"),
      uncoveredShifts: sumBy(notes, "uncoveredShifts"),
      priorPeriodCount: sumBy(notes, "priorPeriodCount"),
      priorPeriodAmount: sumBy(notes, "priorPeriodAmount"),
      openMonths: [
        ...new Set(notes.flatMap((item) => item.openMonths)),
      ].toSorted((a, b) => a.localeCompare(b)),
    },
  };
};
