import type { OperationsStore } from "./operations-rows";

/**
 * 營運報表「全部分店合計」:各店加總。例外:
 * - 銀行:同一個帳戶只列一次,各店歸屬的交易依類型加總;期末餘額取**各店期末裡最晚那一刻**那家店算的
 *   (對齊日結時各店的期末不同;使用者 10/26 定)
 * - 期末待查的本:依本去重複(一本拆在兩家店只算一本);張數、成本照加
 * - 成本是 null(沒有 show-cost)維持 null
 */

type Inventory = OperationsStore["inventory"];

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

/** 區塊 4:張數直接加、成本 null 維持 null;待查的本依本去重複。 */
const totalInventoryOf = (list: readonly Inventory[]): Inventory => {
  const counts = [
    "openingTickets",
    "purchaseBooks",
    "purchaseVoidBooks",
    "purchaseTickets",
    "transferInTickets",
    "transferOutTickets",
    "salesTickets",
    "scrapTickets",
    "newInvestigatingTickets",
    "investigateRecoveredTickets",
    "lostRecoveredTickets",
    "endingTickets",
    "checkTickets",
    "inTransitTickets",
    "investigatingTickets",
    "lostTickets",
    "skippedTickets",
  ] as const;
  const amounts = [
    "openingCost",
    "purchaseCost",
    "transferInAmount",
    "transferOutCost",
    "transferOutAmount",
    "transferGain",
    "salesCost",
    "scrapCost",
    "newInvestigatingCost",
    "investigateRecoveredCost",
    "lostRecoveredCost",
    "costAdjustCost",
    "endingCost",
    "checkCost",
    "inTransitAmount",
    "investigatingCost",
    "lostCost",
  ] as const;
  const bookIds = [
    ...new Set(list.flatMap((item) => item.investigatingBookIds)),
  ];
  return {
    ...Object.fromEntries(counts.map((key) => [key, sumBy(list, key)])),
    ...Object.fromEntries(
      amounts.map((key) => [key, sumNullable(list.map((item) => item[key]))]),
    ),
    investigatingBooks: bookIds.length,
    investigatingBookIds: bookIds,
  } as Inventory;
};

/** 期末最晚的那家店(銀行期末餘額照它)。 */
const latestOf = (stores: readonly OperationsStore[]) => {
  let latest = stores.at(0);
  for (const store of stores) {
    if (latest !== undefined && store.period.to > latest.period.to) {
      latest = store;
    }
  }
  return latest;
};

/** 全部分店合計(每家店的數字加總;成本是 null 的(沒有 show-cost)維持 null)。 */
export const totalStoreOf = (
  stores: readonly OperationsStore[],
): OperationsStore => {
  const sales = stores.map((store) => store.sales);
  const cash = stores.map((store) => store.cash);
  const notes = stores.map((store) => store.notes);
  const redemption = stores.map((store) => store.redemption);
  const latest = latestOf(stores);
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
    inventory: totalInventoryOf(stores.map((store) => store.inventory)),
    cash: {
      shiftCount: sumBy(cash, "shiftCount"),
      pendingShiftCount: sumBy(cash, "pendingShiftCount"),
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
      dailyCloseCount: sumBy(cash, "dailyCloseCount"),
      vaultDifference: sumBy(cash, "vaultDifference"),
      movements: mergeBy(
        cash.map((item) => item.movements),
        (item) => item.type,
        (left, right) => ({
          ...left,
          count: left.count + right.count,
          drawer: left.drawer + right.drawer,
          vault: left.vault + right.vault,
        }),
      ),
    },
    // 同一個帳戶只列一次:各店歸屬的交易依類型加總;期末餘額取期末最晚那家店算的(整個帳戶的)
    bankAccounts: mergeBy(
      stores.map((store) => store.bankAccounts),
      (item) => item.accountId,
      (left, right) => ({
        ...left,
        types: mergeBy(
          [left.types, right.types],
          (item) => item.type,
          (a, b) => ({
            ...a,
            inAmount: a.inAmount + b.inAmount,
            outAmount: a.outAmount + b.outAmount,
            reversalCount: a.reversalCount + b.reversalCount,
          }),
        ),
      }),
    ).map((account) => ({
      ...account,
      endingBalance:
        latest?.bankAccounts.find(
          (item) => item.accountId === account.accountId,
        )?.endingBalance ?? account.endingBalance,
    })),
    outstanding: {
      items: mergeBy(
        stores.map((store) => store.outstanding.items),
        (item) => item.kind,
        (left, right) => ({
          ...left,
          count: left.count + right.count,
          amount: left.amount + right.amount,
          serialNos: [...left.serialNos, ...right.serialNos].slice(0, 5),
        }),
      ),
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
      uncoveredShiftLabels: notes
        .flatMap((item) => item.uncoveredShiftLabels)
        .slice(0, 5),
      priorPeriodCount: sumBy(notes, "priorPeriodCount"),
      priorPeriodAmount: sumBy(notes, "priorPeriodAmount"),
      openMonths: [
        ...new Set(notes.flatMap((item) => item.openMonths)),
      ].toSorted((a, b) => a.localeCompare(b)),
    },
  };
};
