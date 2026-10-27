import { useTranslations } from "use-intl";

import {
  TRANSFER_MODE,
  formatTicketRanges,
  transferLinesOf,
} from "@repo/domain/project/lottery";
import type {
  FormSubmissionFieldsFragment,
  LotteryTransferReceivingFieldsFragment,
} from "@repo/graphql";

import type { BookListRow } from "@/components/project/lottery/BookGroupList/BookGroupList";
import { groupBooksByGame } from "@/components/project/lottery/BookGroupList/book-groups";

type Row = LotteryTransferReceivingFieldsFragment["rows"][number];

const displayBookNo = (bookNo: string): string =>
  bookNo.startsWith("0") ? bookNo.slice(1) : bookNo;

/**
 * 調貨單的本清單(一列 = 一本或一本的選張;依遊戲分組):出貨確認清單與點收區塊同一份。
 * `receivingOf` 給點收區塊補每一列的點收狀態與展開的格子(`useTransferReceiving` 的 `rowReceivingOf`)。
 */
export const useTransferBookGroups = (
  submission: FormSubmissionFieldsFragment | null,
  rows: readonly Row[],
  receivingOf?: (
    row: Row,
  ) => Pick<BookListRow, "status" | "statusLabel" | "panel">,
) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.view");
  const gameIdOf = new Map(
    transferLinesOf(submission?.values ?? {}).map((line) => [
      line.rowId,
      line.gameId,
    ]),
  );
  const groups = groupBooksByGame(
    rows,
    (row) => ({
      key: gameIdOf.get(row.rowId) ?? row.gameCode,
      title: `${row.gameCode} ${row.gameName}`,
    }),
    (row): BookListRow => ({
      rowId: row.rowId,
      bookNo: displayBookNo(row.bookNo),
      detail:
        row.mode === TRANSFER_MODE.whole
          ? t("modes.whole")
          : t("modes.partial"),
      ticketText: formatTicketRanges(row.ticketNos),
      tickets: row.tickets,
      bookPrice: row.amount,
      rate: row.rate,
      amount: row.purchaseAmount,
      ...receivingOf?.(row),
    }),
  );
  const gameLabelOf = (gameId: string): string =>
    groups.find((group) => group.key === gameId)?.title ?? gameId;
  return { groups, gameLabelOf };
};
