import type { useTranslations } from "use-intl";

import {
  TRANSFER_MODE,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import type { LotteryTransferReceivingFieldsFragment } from "@repo/graphql";

type Row = LotteryTransferReceivingFieldsFragment["rows"][number];

const displayBookNo = (bookNo: string): string =>
  bookNo.startsWith("0") ? bookNo.slice(1) : bookNo;

/** 選張的列在點收時可以展開格子(整本的列刷一張整列點收,不展開)。 */
export const isPartialRow = (row: Row): boolean =>
  row.mode === TRANSFER_MODE.partial;

/** 這一列還沒點收的張號(選張的列逐張點收)。 */
export const unreceivedOf = (row: Row): string[] => {
  const received = new Set(row.receivedTicketNos);
  return row.ticketNos.filter((ticketNo) => !received.has(ticketNo));
};

/**
 * 收貨店點收過一部分、還有張沒到:「還有 3 張沒點收(100002 #054–056),請退回由出貨店移除沒到的張」
 * (核准會被擋下);還沒開始點收 / 都到齊 → null。
 */
export const unreceivedTextOf = (
  t: ReturnType<
    typeof useTranslations<"admin.lotteryPurchasing.transfer.view">
  >,
  rows: readonly Row[],
): string | null => {
  const pending = rows.filter((row) => row.shipped && !row.received);
  const count = pending.reduce(
    (sum, row) =>
      sum + (isPartialRow(row) ? unreceivedOf(row).length : row.tickets),
    0,
  );
  const hasPartlyReceived = rows.some(
    (row) => !row.received && row.receivedTickets > 0,
  );
  if (!hasPartlyReceived || count === 0) {
    return null;
  }
  return t("unreceived", {
    count,
    items: pending
      .map((row) =>
        isPartialRow(row)
          ? t("unreceivedItem", {
              bookNo: displayBookNo(row.bookNo),
              tickets: formatTicketRanges(unreceivedOf(row)),
            })
          : t("unreceivedWhole", { bookNo: displayBookNo(row.bookNo) }),
      )
      .join(t("unreceivedSeparator")),
  });
};
