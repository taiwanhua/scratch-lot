import {
  type ScrapBlock,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  scrapBlockOf,
} from "@repo/domain/project/lottery";
import type { LotteryInventoryTicketFieldsFragment } from "@repo/graphql";

import type {
  TicketGridCell,
  TicketGridProps,
} from "@/components/project/lottery/TicketGrid/TicketGrid";

type Ticket = Pick<
  LotteryInventoryTicketFieldsFragment,
  "ticketNo" | "status" | "locked" | "operable" | "locationKind"
> & { org: { id: string; name: string }; unmatched?: boolean };
type CellState = TicketGridCell["state"];

/** 張的狀態 → 本的詳情頁格子的狀態(規格 7.5「本的詳情頁:未售 / 已售 / 跳號 / 報廢 / 待查·遺失 / 已選」)。 */
const STATE_OF: Record<string, CellState> = {
  [TICKET_STATUS.unsold]: "unsold",
  [TICKET_STATUS.sold]: "sold",
  [TICKET_STATUS.skipped]: "skipped",
  [TICKET_STATUS.scrapped]: "scrapped",
  [TICKET_STATUS.investigating]: "lost",
  [TICKET_STATUS.lost]: "lost",
};

/** 這本的張分在不止一家店(格子的提示寫每張在哪家店)。 */
const spansStores = (tickets: readonly Ticket[]): boolean =>
  new Set(tickets.map((ticket) => ticket.org.id)).size > 1;

/** 系統預設帶入的張(張數店的已售 / 待查 / 遺失·未對號)→ 虛線格子(張數店規格 13.2;不能選)。 */
const unmatchedStateOf = (ticket: Ticket): CellState | null => {
  if (ticket.unmatched !== true) {
    return null;
  }
  return ticket.status === TICKET_STATUS.sold
    ? "unmatchedSold"
    : "unmatchedLost";
};

/**
 * 本的詳情頁的格子:別店的張(`operable = false`,所在分店不在可見範圍內)用「其他分店」、不能選;
 * 系統預設帶入的張(未對號)畫虛線、不能選(只有張號確定的可以點選;張數店規格 13.2,Figma CS-20);
 * 跳號一律畫成跳號(跳號不算任何店的庫存;對調跳號時記在哪家店都能選,規格 7.3 做法 D);
 * 被調貨單鎖住的未售用「調貨中」、不能選(使用者 10/27 定案)。張分在不止一家店時,每格的提示寫所在分店。
 */
export const bookCellsOf = (tickets: readonly Ticket[]): TicketGridCell[] => {
  const showStore = spansStores(tickets);
  return tickets.map((ticket) => {
    let state: CellState;
    if (ticket.status === TICKET_STATUS.skipped) {
      state = "skipped";
    } else if (!ticket.operable) {
      state = "otherStore";
    } else if (ticket.locked && ticket.status === TICKET_STATUS.unsold) {
      state = "transferring";
    } else {
      const fallback: CellState = STATE_OF[ticket.status] ?? "sold";
      state = unmatchedStateOf(ticket) ?? fallback;
    }
    return {
      ticketNo: ticket.ticketNo,
      state,
      ...(showStore && { tooltip: ticket.org.name }),
    };
  });
};

/** 圖例的「其他分店」只在有別店的張時打開(只放畫面用得到的狀態)。 */
const withOtherStore = (
  items: NonNullable<TicketGridProps["legendItems"]>,
  tickets: readonly Ticket[],
): TicketGridProps["legendItems"] =>
  tickets.some((ticket) => !ticket.operable)
    ? [...items.slice(0, -1), "otherStore", ...items.slice(-1)]
    : items;

/** 有被調貨單鎖住的未售(自己範圍內)才放「調貨中」。 */
const isTransferring = (ticket: Ticket): boolean =>
  ticket.operable && ticket.locked && ticket.status === TICKET_STATUS.unsold;

/**
 * 本的詳情頁能選:未售(報廢)、待查·遺失(尋回)、報廢(撤銷報廢,張數店規格 7.8)。
 * 更正跳號改在 [更正跳號] 視窗裡先刷實體、再點缺的那張(7.10),格子不再選跳號。
 */
export const BOOK_SELECTABLE: TicketGridProps["selectableStates"] = [
  "unsold",
  "lost",
  "scrapped",
];

/** 選到的張能不能出現在操作列:自己範圍內的張。 */
export const isSelectable = (ticket: Ticket): boolean => ticket.operable;

/** 這本有系統預設帶入的張(自己範圍內的未對號;圖例放兩種虛線與說明)。 */
export const hasUnmatched = (tickets: readonly Ticket[]): boolean =>
  tickets.some((ticket) => ticket.operable && ticket.unmatched === true);

/**
 * 本的詳情頁的圖例(未售 / 已售 /(調貨中)/ 跳號 / 報廢 / 待查·遺失 /(已售·未對號 / 待查·遺失·未對號)/
 * (其他分店)/ 已選);有未對號時圖例下方另寫「虛線 = 系統預設帶入的張號」(`legendNote`,Figma CS-20)。
 */
export const bookLegendOf = (
  tickets: readonly Ticket[],
): TicketGridProps["legendItems"] =>
  withOtherStore(
    [
      "unsold",
      "sold",
      ...(tickets.some((ticket) => isTransferring(ticket))
        ? (["transferring"] as const)
        : []),
      "skipped",
      "scrapped",
      "lost",
      ...(hasUnmatched(tickets)
        ? (["unmatchedSold", "unmatchedLost"] as const)
        : []),
      "selected",
    ],
    tickets,
  );

/**
 * 更正跳號「手上沒有、要改記跳號的那張」能選哪些(張數店規格 7.10):自己範圍內、未鎖定、不在途的未售;
 * 張數店另可選系統預設帶入的已售 / 待查 / 遺失·未對號(送出時先把這個狀態移給同位置一張未售)。
 */
export const isCorrectionTarget = (ticket: Ticket): boolean =>
  ticket.operable &&
  !ticket.locked &&
  ticket.locationKind !== TICKET_LOCATION_KIND.inTransit &&
  (ticket.status === TICKET_STATUS.unsold || ticket.unmatched === true);

/** 更正跳號 ② 的格子:能選的未售、系統預設帶入的張畫虛線;其他照本的詳情頁。 */
export const correctionCellsOf = (
  tickets: readonly Ticket[],
): TicketGridCell[] =>
  bookCellsOf(tickets).map((cell, index) => {
    const ticket = tickets.at(index);
    if (ticket === undefined || !isCorrectionTarget(ticket)) {
      return cell.state === "unsold" ? { ...cell, state: "sold" } : cell;
    }
    if (ticket.status === TICKET_STATUS.sold) {
      return { ...cell, state: "unmatchedSold" };
    }
    return ticket.status === TICKET_STATUS.unsold
      ? cell
      : { ...cell, state: "unmatchedLost" };
  });

/** 更正跳號 ② 的圖例:有系統預設帶入的張才放兩種虛線。 */
export const correctionLegendOf = (
  tickets: readonly Ticket[],
): TicketGridProps["legendItems"] => bookLegendOf(tickets);

/**
 * 標跳號的格子(使用者 10/27 定案 M1):自己範圍內、沒被鎖的未售張能選,別店的張是「其他分店」、
 * 已標的跳號是「跳號」,其他都是「不能選」。
 */
export const markSkipCellsOf = (
  tickets: readonly Ticket[],
): TicketGridCell[] => {
  const showStore = spansStores(tickets);
  return tickets.map((ticket) => {
    let state: CellState = "sold";
    if (!ticket.operable) {
      state = "otherStore";
    } else if (ticket.status === TICKET_STATUS.skipped) {
      state = "skipped";
    } else if (ticket.status === TICKET_STATUS.unsold && !ticket.locked) {
      state = "unsold";
    }
    return {
      ticketNo: ticket.ticketNo,
      state,
      ...(showStore && { tooltip: ticket.org.name }),
    };
  });
};

/** 待查 / 遺失、而且操作者能操作(所在分店在可見範圍內)的張:[尋回] / [整本尋回] 的對象。 */
export const isRecoverable = (ticket: Ticket): boolean =>
  ticket.operable &&
  ticket.unmatched !== true &&
  (ticket.status === TICKET_STATUS.investigating ||
    ticket.status === TICKET_STATUS.lost);

/** 選到的動作與報廢不能按的原因。 */
export interface SelectionActions {
  /** 選到的全是自己範圍內的未售(顯示 [報廢];`scrapBlock` ≠ null 時停用並寫原因) */
  showScrap: boolean;
  /** 不能報廢的第一個原因:這本還沒拆 / 有張不在庫存(檯面上的請先收回)/ 被鎖定(張數店規格 7.8) */
  scrapBlock: ScrapBlock | null;
  canRecover: boolean;
  /** 選到的全是自己範圍內的報廢 → [撤銷報廢] */
  canUndoScrap: boolean;
}

/**
 * 選到的張能做什麼:全部未售 → 報廢(只能報拆過的本在庫存的張,其他停用並寫原因;張數店規格 7.8,
 * Figma IN-03-2a / 2b);全部待查 / 遺失 → 尋回;全部報廢 → 撤銷報廢;混在一起 → 沒有共同可用的按鈕。
 * 選到別店的張(例:查刮刮樂帶來的張號在別店)→ 沒有按鈕。
 */
export const selectionActionsOf = (
  tickets: readonly Ticket[],
  bookOpened: boolean,
): SelectionActions => {
  const all = (predicate: (ticket: Ticket) => boolean) =>
    tickets.length > 0 && tickets.every((ticket) => predicate(ticket));
  const showScrap = all(
    (ticket) => ticket.operable && ticket.status === TICKET_STATUS.unsold,
  );
  const blocks = new Set(
    tickets.flatMap((ticket) => {
      const block = scrapBlockOf({
        status: ticket.status,
        locationKind: ticket.locationKind,
        locked: ticket.locked,
        bookFirstOpenedAt: bookOpened ? "opened" : null,
      });
      return block === null ? [] : [block];
    }),
  );
  const order: readonly ScrapBlock[] = [
    "book_unopened",
    "not_in_stock",
    "locked",
    "not_unsold",
  ];
  return {
    showScrap,
    scrapBlock: showScrap
      ? (order.find((block) => blocks.has(block)) ?? null)
      : null,
    canRecover: all((ticket) => isRecoverable(ticket)),
    canUndoScrap: all(
      (ticket) => ticket.operable && ticket.status === TICKET_STATUS.scrapped,
    ),
  };
};
