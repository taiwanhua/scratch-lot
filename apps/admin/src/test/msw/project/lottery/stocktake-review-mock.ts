import type { StocktakeDraft } from "@repo/domain/project/lottery";
import type { LotteryStocktakeReviewQuery } from "@repo/graphql";

import { sampleCountStocktakeSheet } from "./stocktake-count-fixtures";
import {
  type StocktakeSheetFixture,
  sampleRenumberStocktakeSheet,
  sampleStocktakeSheet,
} from "./stocktake-fixtures";

type RenumberMatch =
  LotteryStocktakeReviewQuery["lotteryStocktakeReview"]["renumberMatches"][number];

type SheetBook = StocktakeSheetFixture["books"][number];

/** 差異核對假 api 的一張差異(比對前)。 */
export interface MockDiff {
  ticket: SheetBook["tickets"][number];
  kind: string;
  backfilled: boolean;
}

/**
 * 補點編號的自動對號(假 api;同 api 的 `renumberMatchesOf`,這裡只看同一本):實際在的未對號張依序配實際不在的未售張,
 * 配到的兩邊都不算差異;實際在的已售·未對號沒配到也不列(照編號差異只留不在的張)。一般盤點 → 原樣。
 */
export const renumberMatchesOfBook = (
  renumber: boolean,
  book: SheetBook,
  sheet: StocktakeSheetFixture,
  all: readonly MockDiff[],
): { matches: RenumberMatch[]; diffs: MockDiff[] } => {
  if (!renumber) {
    return { matches: [], diffs: [...all] };
  }
  const guesses = all.filter((diff) => diff.ticket.unmatched);
  const absent = all.filter(
    (diff) => diff.kind === "missing" && !diff.backfilled,
  );
  const pairs = guesses.slice(0, absent.length).flatMap((guess, index) => {
    const partner = absent.at(index);
    return partner === undefined ? [] : [{ guess, partner }];
  });
  const cashPointName =
    sheet.cashPoints.find((point) => point.id === book.cashPointId)?.name ??
    null;
  const matched = new Set(
    pairs.flatMap((pair) => [
      pair.guess.ticket.ticketId,
      pair.partner.ticket.ticketId,
    ]),
  );
  return {
    matches: pairs.map((pair) => ({
      __typename: "LotteryStocktakeRenumberMatch",
      gameCode: book.gameCode,
      gameName: book.gameName,
      cashPointId: book.cashPointId,
      cashPointName,
      ticketNo: pair.guess.ticket.ticketNo,
      bookNo: book.bookNo,
      partnerTicketNo: pair.partner.ticket.ticketNo,
      partnerBookNo: book.bookNo,
    })),
    diffs: all.filter(
      (diff) =>
        !matched.has(diff.ticket.ticketId) &&
        !(diff.kind === "extra" && diff.ticket.unmatched),
    ),
  };
};

/** 盤點頁的資料:補點編號 / 張數店 / 編號店。 */
export const sheetOf = (
  renumber: boolean,
  countMode: boolean,
): StocktakeSheetFixture => {
  if (renumber) {
    return sampleRenumberStocktakeSheet();
  }
  return countMode ? sampleCountStocktakeSheet() : sampleStocktakeSheet();
};

/** 補點編號還沒盤的(還沒盤的本 + 還沒回答在 / 不在的未拆的本);一般盤點 = 0。 */
export const renumberMissingOf = (
  renumber: boolean,
  draft: StocktakeDraft,
  sheet: StocktakeSheetFixture,
  uncounted: number,
): number =>
  renumber
    ? uncounted +
      sheet.unopenedBooks.filter(
        (book) => !draft.unopened.some((item) => item.bookId === book.bookId),
      ).length
    : 0;

/** 畫面上的處理對不到目前差異的張號(已被處理)。 */
export const staleNosOf = (
  choices: StocktakeDraft["lines"][number]["diffs"],
  diffs: readonly { ticket: { ticketNo: string }; backfilled: boolean }[],
): string[] =>
  choices
    .filter((choice) => {
      const diff = diffs.find(
        (item) => item.ticket.ticketNo === choice.ticketNo,
      );
      return (choice.action === "sale_backfill") !== diff?.backfilled;
    })
    .map((choice) => choice.ticketNo);

/** 這張在哪一本。 */
export const bookOfTicket = (sheet: StocktakeSheetFixture, ticketId: string) =>
  sheet.books.find((item) =>
    item.tickets.some((ticket) => ticket.ticketId === ticketId),
  );
