import { COLLATION_LOCALE } from "@repo/domain/collation";
import {
  type StocktakeDiffAction,
  type StocktakeDiffKind,
  type StocktakeDraft,
  type StocktakeLostAction,
  type StocktakeMethod,
  isStocktakeStockLine,
  stocktakeActionsOf,
} from "@repo/domain/project/lottery";
import type {
  LotteryStocktakeReviewQuery,
  LotteryStocktakeSheetQuery,
} from "@repo/graphql";

import { missingReasonFields } from "@/components/project/lottery/ReasonFields/reason-value";

import type { GroupCount } from "./stocktake-count-model";

export type StocktakeSheet =
  LotteryStocktakeSheetQuery["lotteryStocktakeSheet"];
export type SheetBook = StocktakeSheet["books"][number];
export type SheetCashPoint = StocktakeSheet["cashPoints"][number];
export type SheetLostTicket = StocktakeSheet["lostTickets"][number];
export type StocktakeReview =
  LotteryStocktakeReviewQuery["lotteryStocktakeReview"];
export type ReviewLine = StocktakeReview["lines"][number];
export type SheetCountGroup = StocktakeSheet["countGroups"][number];
export type ReviewCountLine = StocktakeReview["countLines"][number];

/** 張數盤點一組的 key(收銀點 × 遊戲;本清單與本的 key 分得開)。 */
export const groupKeyOf = (cashPointId: string, gameId: string): string =>
  `g:${cashPointId}:${gameId}`;

export const countGroupKeyOf = (
  group: Pick<SheetCountGroup, "cashPointId" | "gameId">,
): string => groupKeyOf(group.cashPointId, group.gameId);

/**
 * 一行的位置名稱:收銀點名稱;拆過、在庫存的張那一區(`STOCKTAKE_STOCK_LINE`)= `stockLabel`(「庫存」)。
 */
export const placeNameOf = (
  cashPoints: readonly { id: string; name: string }[],
  cashPointId: string,
  stockLabel: string,
): string =>
  isStocktakeStockLine(cashPointId)
    ? stockLabel
    : (cashPoints.find((point) => point.id === cashPointId)?.name ?? "");

/** 一本 × 收銀點的 key(本清單、盤點內容共用)。 */
export const lineKeyOf = (bookId: string, cashPointId: string): string =>
  `${bookId}:${cashPointId}`;

export const bookKeyOf = (book: Pick<SheetBook, "bookId" | "cashPointId">) =>
  lineKeyOf(book.bookId, book.cashPointId);

/** 一本的盤點(畫面狀態):開始盤的時間、方式、點到的張。 */
export interface BookCount {
  countedAt: string;
  method: StocktakeMethod;
  present: string[];
}

/** 一張差異的處理;補登售出記下這次寫的事件 id。 */
export interface DiffChoice {
  action: StocktakeDiffAction;
  eventId: string | null;
}

/** 待查清單一組(一本)的處理。 */
export interface LostChoice {
  action: StocktakeLostAction;
  reasonKey: string;
  reasonNote: string;
  /**
   * 「找到了」刷到的張(規格 6.8「要刷條碼」):整本都待查的一組刷到任一張就算整本找到;
   * 零碎待查的一組只有刷到的張算找到,沒刷到的維持待查
   */
  scannedTicketIds: string[];
}

/**
 * 盤點的畫面狀態(規格 6.0、6.8:只放在畫面上,重新整理或離開就從頭盤;[送出] 時才建立盤點單)。
 */
export interface StocktakeState {
  startedAt: string;
  counts: Partial<Record<string, BookCount>>;
  unopened: Partial<Record<string, boolean>>;
  lost: Partial<Record<string, LostChoice>>;
  /** `<lineKey>#<張號>` → 處理 */
  diffs: Partial<Record<string, DiffChoice>>;
  /** 張數盤點的組(`groupKeyOf` → 這一組的盤點與處理) */
  groups: Partial<Record<string, GroupCount>>;
}

export const diffKeyOf = (lineKey: string, ticketNo: string): string =>
  `${lineKey}#${ticketNo}`;

export const emptyState = (startedAt: string): StocktakeState => ({
  startedAt,
  counts: {},
  unopened: {},
  lost: {},
  diffs: {},
  groups: {},
});

/** 退回後打開:盤點內容 → 畫面狀態(帶入原內容)。 */
export const stateOfDraft = (
  draft: StocktakeDraft,
  sheet: StocktakeSheet,
): StocktakeState => {
  const state = emptyState(draft.startedAt);
  for (const line of draft.lines) {
    const key = lineKeyOf(line.bookId, line.cashPointId);
    state.counts[key] = {
      countedAt: line.countedAt,
      method: line.method,
      present: [...line.presentTicketNos],
    };
    for (const diff of line.diffs) {
      state.diffs[diffKeyOf(key, diff.ticketNo)] = {
        action: diff.action,
        eventId: diff.eventId ?? null,
      };
    }
  }
  for (const line of draft.countLines ?? []) {
    state.groups[groupKeyOf(line.cashPointId, line.gameId)] = {
      countedAt: line.countedAt,
      presentCount: line.presentCount,
      recounts: [...line.recounts],
      saleCount: line.saleCount,
      saleRefIds: [...line.saleRefIds],
      investigateCount: line.investigateCount,
      flagged: line.flagged,
    };
  }
  for (const item of draft.unopened) {
    state.unopened[item.bookId] = item.present;
  }
  const groupOfTicket = new Map(
    sheet.lostTickets.map((ticket) => [
      ticket.ticketId,
      lostGroupKeyOf(ticket),
    ]),
  );
  for (const item of draft.lostReview) {
    const bookId = groupOfTicket.get(item.ticketId);
    if (bookId !== undefined) {
      const before = state.lost[bookId];
      state.lost[bookId] = {
        action: item.action,
        reasonKey: item.reasonKey ?? "",
        reasonNote: item.reasonNote ?? "",
        scannedTicketIds:
          item.action === "found"
            ? [...(before?.scannedTicketIds ?? []), item.ticketId]
            : [],
      };
    }
  }
  return state;
};

/**
 * 待查清單一組的 key:確定的待查依本;待查·未對號(張數盤點 [待查] 系統預設帶入的張號)依「遊戲 × 來源盤點」
 * (張數店規格 7.9、13.2)。
 */
export const lostGroupKeyOf = (
  ticket: Pick<SheetLostTicket, "bookId" | "unmatched" | "sourceId" | "gameId">,
): string =>
  ticket.unmatched
    ? `u:${ticket.sourceId ?? "none"}:${ticket.gameId}`
    : ticket.bookId;

/** 待查清單一組(確定的待查 = 一本;待查·未對號 = 遊戲 × 來源盤點)。 */
export interface LostGroup {
  /** 這一組的 key(`lostGroupKeyOf`;畫面狀態 `lost` 的 key) */
  bookId: string;
  /** 待查·未對號(只有 [確認遺失]、[繼續待查],沒有 [找到了]) */
  unmatched: boolean;
  gameName: string;
  sourceType: string | null;
  sourceCashPointName: string | null;
  gameCode: string;
  bookNo: string;
  tickets: SheetLostTicket[];
  /** 這本在這家店的張全都待查 */
  wholeBook: boolean;
  since: string | null;
  source: string | null;
}

export const lostGroupsOf = (sheet: StocktakeSheet): LostGroup[] => {
  const groups = new Map<string, LostGroup>();
  for (const ticket of sheet.lostTickets) {
    const key = lostGroupKeyOf(ticket);
    const group = groups.get(key) ?? {
      bookId: key,
      unmatched: ticket.unmatched,
      gameName: ticket.gameName,
      sourceType: ticket.sourceType ?? null,
      sourceCashPointName: ticket.sourceCashPointName ?? null,
      gameCode: ticket.gameCode,
      bookNo: ticket.bookNo,
      tickets: [],
      wholeBook: false,
      since: ticket.since ?? null,
      source: ticket.source ?? null,
    };
    group.tickets.push(ticket);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    wholeBook:
      !group.unmatched &&
      group.tickets.length > 0 &&
      group.tickets.length === group.tickets[0]?.bookTicketCount,
  }));
};

/** 盤點內容(送出 / 差異核對;規格 6.8)。 */
export const draftOf = (
  orgId: string,
  scopeCashPointId: string | null,
  state: StocktakeState,
  sheet: StocktakeSheet,
): StocktakeDraft => {
  const lostGroups = lostGroupsOf(sheet);
  const countMode = sheet.countMode === "count" ? "count" : "numbered";
  return {
    version: 1,
    orgId,
    scopeCashPointId,
    startedAt: state.startedAt,
    // 張數盤點:檯面是組(數過、按了 [確定] 的才送);編號盤點不帶這些欄位(和以前的盤點內容一樣)
    ...(countMode === "count"
      ? {
          countMode: "count" as const,
          purpose: "normal" as const,
          countLines: sheet.countGroups.flatMap((group) => {
            const count = state.groups[countGroupKeyOf(group)];
            if (count?.presentCount == null) {
              return [];
            }
            return [
              {
                gameId: group.gameId,
                cashPointId: group.cashPointId,
                countedAt: count.countedAt,
                presentCount: count.presentCount,
                recounts: [...count.recounts],
                saleCount: count.saleCount,
                saleRefIds: [...count.saleRefIds],
                investigateCount: count.investigateCount,
                flagged: count.flagged,
              },
            ];
          }),
        }
      : {}),
    // 補點編號(張數店與轉換中的全店編號盤點;張數店規格 9.3)
    ...(sheet.purpose === "renumber"
      ? { countMode: "numbered" as const, purpose: "renumber" as const }
      : {}),
    lines: sheet.books.flatMap((book) => {
      const key = bookKeyOf(book);
      const count = state.counts[key];
      if (count === undefined) {
        return [];
      }
      return [
        {
          bookId: book.bookId,
          cashPointId: book.cashPointId,
          countedAt: count.countedAt,
          method: count.method,
          presentTicketNos: [...count.present].toSorted((a, b) =>
            a.localeCompare(b, COLLATION_LOCALE),
          ),
          diffs: Object.entries(state.diffs).flatMap(([diffKey, choice]) => {
            const [lineKey, ticketNo] = diffKey.split("#");
            return lineKey === key && choice
              ? [{ ticketNo, action: choice.action, eventId: choice.eventId }]
              : [];
          }),
        },
      ];
    }),
    unopened: sheet.unopenedBooks.flatMap((book) => {
      const present = state.unopened[book.bookId];
      return present === undefined ? [] : [{ bookId: book.bookId, present }];
    }),
    lostReview: lostGroups.flatMap((group) => {
      const choice = state.lost[group.bookId];
      if (choice === undefined || choice.action === "keep") {
        return [];
      }
      // 找到了:整本 → 整組;零碎 → 只有刷到的張(其他維持待查,不送)
      const tickets =
        choice.action === "found" && !group.wholeBook
          ? group.tickets.filter((ticket) =>
              choice.scannedTicketIds.includes(ticket.ticketId),
            )
          : group.tickets;
      return tickets.map((ticket) => ({
        ticketId: ticket.ticketId,
        action: choice.action,
        reasonKey: choice.action === "lost" ? choice.reasonKey : null,
        reasonNote:
          choice.action === "lost" && choice.reasonNote.trim() !== ""
            ? choice.reasonNote.trim()
            : null,
      }));
    }),
  };
};

/** 一本在畫面上的比對(格子下方「系統 / 實盤 / 差異」;以這本的系統數字比)。 */
export interface BookFigures {
  systemNos: string[];
  presentCount: number;
  diffNos: string[];
}

export const figuresOf = (
  book: SheetBook,
  count: BookCount | undefined,
): BookFigures => {
  const present = new Set(count?.present);
  const unsold = book.tickets.filter((ticket) => ticket.status === "unsold");
  const isDiff = (ticket: SheetBook["tickets"][number]): boolean => {
    if (ticket.pendingReversal) {
      return false;
    }
    const isHere = present.has(ticket.ticketNo);
    return ticket.status === "unsold" ? !isHere : isHere;
  };
  const diffNos = book.tickets
    .filter((ticket) => isDiff(ticket))
    .map((ticket) => ticket.ticketNo);
  return {
    systemNos: unsold.map((ticket) => ticket.ticketNo),
    presentCount: present.size,
    diffNos: count === undefined ? [] : diffNos,
  };
};

/** 差異核對還沒處理的張數(目前的差異、沒有選處理或處理對不上)+ 還沒處理完的組(伺服器比對)。 */
export const unhandledOf = (
  review: StocktakeReview,
  state: StocktakeState,
): number =>
  review.countLines.filter((line) => line.unhandled).length +
  review.lines.reduce(
    (sum, line) =>
      sum +
      line.diffs.filter((diff) => {
        const choice =
          state.diffs[
            diffKeyOf(lineKeyOf(line.bookId, line.cashPointId), diff.ticketNo)
          ];
        return (
          choice === undefined ||
          !stocktakeActionsOf(
            diff.kind as StocktakeDiffKind,
            line.cashPointId,
            {
              pendingSkip: line.pendingSkipCount > 0,
            },
          ).includes(choice.action) ||
          (choice.action === "sale_backfill") !== diff.backfilled
        );
      }).length,
    0,
  );

/** 待查清單的處理都填好了(找到了要刷到、確認遺失要原因)。 */
export const lostChoicesReady = (state: StocktakeState): boolean =>
  Object.values(state.lost).every(
    (choice) =>
      choice === undefined ||
      (choice.action === "found" && choice.scannedTicketIds.length > 0) ||
      (choice.action === "lost" && missingReasonFields(choice).length === 0) ||
      choice.action === "keep",
  );

/** 拿掉符合條件的 key(回新的物件;不就地刪)。 */
export const omitKeys = <T>(
  record: Partial<Record<string, T>>,
  drop: (key: string, value: T | undefined) => boolean,
): Partial<Record<string, T>> =>
  Object.fromEntries(
    Object.entries(record).filter(([key, value]) => !drop(key, value)),
  );
