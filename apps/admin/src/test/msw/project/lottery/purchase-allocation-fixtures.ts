import type { LotteryPurchaseOptionsQuery } from "@repo/graphql";

/** 進貨單新增頁的預計要給本數:5164 預計 30、已給 26、在途 4 → 這張再進 1 本就超過(只警告)。 */
export const purchaseAllocations =
  (): LotteryPurchaseOptionsQuery["lotteryPurchaseOptions"]["allocations"] => [
    {
      __typename: "LotteryPurchaseAllocation",
      gameId: "game-5164",
      plannedBooks: 30,
      givenBooks: 26,
      inTransitBooks: 4,
    },
  ];
