import type { LotteryOperationsReportQuery } from "@repo/graphql";

type OperationsStore =
  LotteryOperationsReportQuery["lotteryOperationsReport"]["stores"][number];

/** 營運報表示範數字的組件(`reports-handlers.ts` 的 `operationsStore` 用;mock 模式與測試同一份)。 */

export const movement = (
  type: string,
  count: number,
  drawer: number,
  vault: number,
) => ({
  __typename: "LotteryOperationsCashMovement" as const,
  type,
  count,
  drawer,
  vault,
});

export const outstandingItem = (
  kind: string,
  count: number,
  amount: number,
  serialNos: string[],
) => ({
  __typename: "LotteryOperationsOutstandingItem" as const,
  kind,
  count,
  amount,
  serialNos,
});

/**
 * 區塊 4 的示範數字:期初加減各列 = 期末(核對 0)。`n` 依第幾家店縮小、`cost` 沒有成本權限時是 null。
 */
export const inventoryOf = (
  n: (value: number) => number,
  cost: (value: number) => number | null,
): OperationsStore["inventory"] => {
  const tickets = {
    opening: n(1200),
    purchase: n(500),
    transferIn: n(100),
    transferOut: n(100),
    sales: n(211),
    scrap: 2,
    newInvestigating: 3,
    investigateRecovered: 1,
  };
  const costs = {
    opening: n(220_800),
    purchase: n(92_000),
    transferIn: n(18_400),
    transferOut: n(18_400),
    sales: n(38_824),
    scrap: 368,
    newInvestigating: 552,
    investigateRecovered: 184,
  };
  const ending = (values: typeof tickets) =>
    values.opening +
    values.purchase +
    values.transferIn -
    values.transferOut -
    values.sales -
    values.scrap -
    values.newInvestigating +
    values.investigateRecovered;
  const money = (value: number) => (cost(1) === null ? null : value);
  return {
    __typename: "LotteryOperationsInventory",
    openingTickets: tickets.opening,
    openingCost: money(costs.opening),
    purchaseBooks: 5,
    purchaseVoidBooks: 0,
    purchaseTickets: tickets.purchase,
    purchaseCost: money(costs.purchase),
    transferInTickets: tickets.transferIn,
    transferInAmount: money(costs.transferIn),
    transferOutTickets: tickets.transferOut,
    transferOutCost: money(costs.transferOut),
    transferOutAmount: money(n(19_000)),
    transferGain: money(n(19_000) - costs.transferOut),
    salesTickets: tickets.sales,
    salesCost: money(costs.sales),
    scrapTickets: tickets.scrap,
    scrapCost: money(costs.scrap),
    newInvestigatingTickets: tickets.newInvestigating,
    newInvestigatingCost: money(costs.newInvestigating),
    investigateRecoveredTickets: tickets.investigateRecovered,
    investigateRecoveredCost: money(costs.investigateRecovered),
    lostRecoveredTickets: 0,
    lostRecoveredCost: money(0),
    endingTickets: ending(tickets),
    endingCost: money(ending(costs)),
    checkTickets: 0,
    checkCost: money(0),
    inTransitTickets: n(100),
    inTransitAmount: money(n(19_000)),
    investigatingTickets: 3,
    investigatingCost: money(552),
    investigatingBooks: 2,
    investigatingBookIds: ["book-1", "book-2"],
    lostTickets: 0,
    lostCost: money(0),
    skippedTickets: 1,
  };
};
