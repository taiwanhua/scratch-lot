import type { LotteryTransferOptionsQuery } from "@repo/graphql";

/** 調貨單新增頁的選項與選張格子(`transfer-handlers.ts` 用;mock 模式與測試同一份)。 */

const book = (
  bookId: string,
  gameCode: string,
  gameName: string,
  bookNo: string,
  unitPrice: number,
  isWhole: boolean,
  availableCount = 100,
  lastTicketNo = availableCount,
) => ({
  __typename: "LotteryTransferBook" as const,
  bookId,
  gameId: `game-${gameCode}`,
  gameCode,
  gameName,
  bookNo,
  unitPrice,
  bookPrice: unitPrice * 100,
  rate: 92,
  isWhole,
  availableCount,
  lastTicketNo,
});

/** 新增頁的選項(出貨分店不論是哪一家都回同一份)。 */
export const transferOptions =
  (): LotteryTransferOptionsQuery["lotteryTransferOptions"] => ({
    __typename: "LotteryTransferOptions",
    books: [
      book("book-56527", "5164", "發大財", "0056527", 200, false, 88),
      book("book-1233", "5201", "金好運", "0001233", 100, true),
      book("book-1234", "5201", "金好運", "0001234", 100, true),
    ],
    requisitions: [
      {
        __typename: "LotteryTransferRequisition",
        id: "req-22",
        serialNo: "R-0022",
        books: 2,
      },
    ],
    // 收貨店 5201:預計 3、已給 2、在途 1 → 再調 1 整本就超過(只警告)
    allocations: [
      {
        __typename: "LotteryTransferAllocation",
        gameId: "game-5201",
        plannedBooks: 3,
        givenBooks: 2,
        inTransitBooks: 1,
      },
    ],
  });

/** 拆過的那本的格子:#001–011、#032、#048 已售,其餘可以調。 */
export const transferBookTickets = () =>
  Array.from({ length: 100 }, (_, index) => {
    const ticketNo = String(index + 1).padStart(3, "0");
    const isSold = index < 11 || ticketNo === "032" || ticketNo === "048";
    return {
      __typename: "LotteryTransferTicketCell" as const,
      ticketNo,
      state: isSold ? "sold" : "available",
    };
  });
