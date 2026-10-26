/** 調貨單新增頁的張數格子夾具:拆過的那本 #001–011、#032、#048 已售,其餘可以調。 */
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
