import {
  LAST_TICKET_NO_MAX,
  type OpeningPlacement,
  type OpeningPlanProblem,
  formatTicketNo,
  isOpeningBookOpened,
  openingPendingSkipCountOf,
  openingPlanProblemOf,
  openingPresoldOf,
} from "@repo/domain/project/lottery";
import type { LotteryOpeningScanQuery } from "@repo/graphql";

import {
  type SplitPlaceState,
  splitAssignmentsOf,
} from "@/components/project/lottery/SplitSteps/split-place";

export type OpeningScan = LotteryOpeningScanQuery["lotteryOpeningScan"];
export type OpeningCandidate = OpeningScan["candidates"][number];

/** ③ 分放「庫存」的位置 id(其他位置是收銀點 id;送出時換成 `cashPointId: null`)。 */
export const OPENING_STOCK = "stock";

/** 本卡的三步。 */
export type OpeningStep = "sold" | "skip" | "place";

/** 本卡(一次一本)的畫面狀態;步驟之間不寫資料庫。 */
export interface OpeningCard {
  /** 刷到的遊戲與本號 */
  game: OpeningCandidate;
  bookNo: string;
  /** 迄號欄的文字(預設標準張數) */
  lastText: string;
  /** ① 導入前已賣出 */
  sold: string[];
  /** ② 跳號 */
  skipped: string[];
  /** ③ 分放;`allTo` 空字串 = 照預設(① 有標 → 本機收銀點,0 張 → 庫存) */
  place: SplitPlaceState;
  /** 批購金額率(整數 %) */
  rate: number;
  step: OpeningStep;
}

/**
 * 刷到一本 → 新的本卡(刷到的張當「手上最上面那一張」:比它小的預先標成導入前已賣出)。迄號預設標準張數;
 * 刷到的張號比標準張數大 → 迄號帶到那一張。
 */
export const openingCardOf = (
  game: OpeningCandidate,
  bookNo: string,
  topTicketNo: string | null,
): OpeningCard => ({
  game,
  bookNo,
  lastText: String(Math.max(game.ticketsPerBook, Number(topTicketNo ?? 0))),
  sold: topTicketNo === null ? [] : openingPresoldOf(topTicketNo),
  skipped: [],
  place: { mode: "all", allTo: "", assigned: {}, selected: [] },
  rate: game.defaultRate,
  step: "sold",
});

/** 迄號欄的值:≥ 標準張數、≤ 999 的整數;不合 = null。 */
export const lastTicketOf = (card: OpeningCard): number | null => {
  const text = card.lastText.trim();
  if (!/^\d+$/u.test(text)) {
    return null;
  }
  const value = Number(text);
  return value >= card.game.ticketsPerBook && value <= LAST_TICKET_NO_MAX
    ? value
    : null;
};

/** 001–迄號。 */
export const ticketNosOf = (last: number): string[] =>
  Array.from({ length: last }, (_, index) => formatTicketNo(index + 1));

/** 改迄號:超出新迄號的標記拿掉、分放重來。 */
export const withLastText = (card: OpeningCard, text: string): OpeningCard => {
  const next = { ...card, lastText: text };
  const last = lastTicketOf(next) ?? card.game.ticketsPerBook;
  return {
    ...next,
    sold: card.sold.filter((no) => Number(no) <= last),
    skipped: card.skipped.filter((no) => Number(no) <= last),
    place: { ...card.place, assigned: {}, selected: [] },
  };
};

/** 位置(收銀點 + 庫存)。 */
export interface OpeningPlace {
  id: string;
  name: string;
}

/** 本卡算出來的東西:各步的張號、送出的分放、能不能建、合計。 */
export interface OpeningCardPlan {
  last: number | null;
  ticketNos: string[];
  /** ② 能點的張(已標導入前已賣出的不算) */
  skipCandidates: string[];
  /** 待標註張數(迄號 − 標準張數) */
  pending: number;
  /** ③ 手上的張(扣掉 ①、②) */
  inHand: string[];
  /** ③ 實際用的狀態(預設位置帶入) */
  place: SplitPlaceState;
  /** 每個位置分到的張(位置 id) */
  assignments: { cashPointId: string; ticketNos: readonly string[] }[];
  /** 送出的分放(庫存 = null) */
  placements: OpeningPlacement[];
  /** 拆過的本(① 有標、或 ③ 有放檯面) */
  opened: boolean;
  problem: OpeningPlanProblem | "last_invalid" | null;
}

/** ③ 預設位置:① 有標 → 本機收銀點(沒設定 = 第一個收銀點);0 張 → 庫存。 */
export const defaultPlaceOf = (
  soldCount: number,
  points: readonly OpeningPlace[],
  localId: string | null,
): string => {
  if (soldCount === 0) {
    return OPENING_STOCK;
  }
  const local = points.find((point) => point.id === localId);
  return (
    local?.id ??
    points.find((point) => point.id !== OPENING_STOCK)?.id ??
    OPENING_STOCK
  );
};

export const openingCardPlanOf = (
  card: OpeningCard,
  points: readonly OpeningPlace[],
  localId: string | null,
): OpeningCardPlan => {
  const last = lastTicketOf(card);
  const ticketNos = ticketNosOf(last ?? card.game.ticketsPerBook);
  const soldSet = new Set(card.sold);
  const skippedSet = new Set(card.skipped);
  const skipCandidates = ticketNos.filter((no) => !soldSet.has(no));
  const inHand = skipCandidates.filter((no) => !skippedSet.has(no));
  const place: SplitPlaceState = {
    ...card.place,
    allTo:
      card.place.allTo === ""
        ? defaultPlaceOf(card.sold.length, points, localId)
        : card.place.allTo,
  };
  const assignments = splitAssignmentsOf(inHand, points, place);
  const placements = assignments
    .filter((row) => row.ticketNos.length > 0)
    .map((row) => ({
      cashPointId: row.cashPointId === OPENING_STOCK ? null : row.cashPointId,
      ticketNos: [...row.ticketNos],
    }));
  const pending = openingPendingSkipCountOf({
    lastTicketNo: last ?? card.game.ticketsPerBook,
    standardTickets: card.game.ticketsPerBook,
  });
  const opened = isOpeningBookOpened({ soldTicketNos: card.sold, placements });
  const problem =
    last === null
      ? "last_invalid"
      : openingPlanProblemOf({
          lastTicketNo: last,
          standardTickets: card.game.ticketsPerBook,
          soldTicketNos: card.sold,
          skippedTicketNos: card.skipped,
          placements,
        });
  return {
    last,
    ticketNos,
    skipCandidates,
    pending,
    inHand,
    place,
    assignments,
    placements,
    opened,
    problem,
  };
};

/** 刷到的碼 → 這一本(遊戲 + 本號)或擋下的原因。 */
export type OpeningScanOutcome =
  | { kind: "invalid" }
  | { kind: "no_game" }
  | { kind: "unknown_game" }
  | { kind: "exists"; bookId: string }
  | { kind: "on_purchase"; serialNo: string }
  | {
      kind: "book";
      game: OpeningCandidate;
      bookNo: string;
      topTicketNo: string | null;
    };

/**
 * 刷條碼的結果(規格 3.1、3.2):背面編號帶遊戲代號 → 那一款;正面條碼沒有遊戲代號 → 用「正面條碼的遊戲」選的那款
 * (跟進貨單一樣)。已在系統裡 / 在進貨單上 → 擋下。
 */
export const openingScanOutcomeOf = (
  scan: OpeningScan,
  fallbackGameId: string | null,
): OpeningScanOutcome => {
  if (scan.bookNo === null || scan.bookNo === undefined) {
    return { kind: "invalid" };
  }
  let game: OpeningCandidate | undefined;
  if (scan.hasGameCode) {
    game = scan.candidates.at(0);
    if (game === undefined) {
      return { kind: "unknown_game" };
    }
  } else {
    if (fallbackGameId === null) {
      return { kind: "no_game" };
    }
    game = scan.candidates.find(
      (candidate) => candidate.gameId === fallbackGameId,
    );
    if (game === undefined) {
      return { kind: "unknown_game" };
    }
  }
  if (game.block === "exists" && game.bookId != null) {
    return { kind: "exists", bookId: game.bookId };
  }
  if (game.block === "on_purchase") {
    return { kind: "on_purchase", serialNo: game.serialNo ?? "" };
  }
  return {
    kind: "book",
    game,
    bookNo: scan.bookNo,
    topTicketNo: scan.topTicketNo ?? null,
  };
};
