import { useTranslations } from "use-intl";

import {
  displayBookNo,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import type { LotteryInvestigationRowFieldsFragment } from "@repo/graphql";

import { useTemporalText } from "@/hooks/base/useTemporalText";

type Row = LotteryInvestigationRowFieldsFragment;

/**
 * 待查·遺失一列的顯示文字(電腦 / 平板的表格與手機卡片同一份):本、張號、來源、日期、天數、
 * 未對號列的「本號 056527 · #090(系統預設帶入)」。
 */
export const useInvestigationText = () => {
  const t = useTranslations("admin.lotteryInventory");
  const temporal = useTemporalText();
  const at = (row: Row) => (row.at ? temporal(row.at, "monthDay") : "");
  return {
    book: (row: Row) =>
      row.unmatched ? t("stock.none") : displayBookNo(row.bookNo),
    game: (row: Row) => `${row.gameCode} ${row.gameName}`,
    responsible: (row: Row) => row.responsibleOrg?.name ?? t("stock.none"),
    ticketNos: (row: Row) =>
      row.unmatched
        ? t("investigations.systemDefault")
        : formatTicketRanges(row.tickets.map((ticket) => ticket.ticketNo)),
    source: (row: Row) =>
      row.unmatched && row.sourceStocktakeType != null
        ? t("investigations.sourceStocktake", {
            date: at(row),
            type: t(`investigations.stocktakeTypes.${row.sourceStocktakeType}`),
          })
        : t("investigations.source", {
            serial: row.refSerialNo ?? t("stock.none"),
          }),
    at,
    days: (row: Row) =>
      row.days == null ? "" : t("investigations.daysValue", { days: row.days }),
    unmatchedBooks: (row: Row) =>
      row.unmatchedBooks
        .map((book) =>
          t("investigations.unmatchedBook", {
            bookNo: displayBookNo(book.bookNo),
            tickets: book.ticketNos
              .map((ticketNo) => `#${ticketNo}`)
              .join("、"),
          }),
        )
        .join("、"),
  };
};
