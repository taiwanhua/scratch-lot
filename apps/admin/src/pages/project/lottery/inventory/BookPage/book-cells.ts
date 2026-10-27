import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
} from "@repo/domain/project/lottery";
import type { LotteryInventoryTicketFieldsFragment } from "@repo/graphql";

import type {
  TicketGridCell,
  TicketGridProps,
} from "@/components/project/lottery/TicketGrid/TicketGrid";

type Ticket = Pick<
  LotteryInventoryTicketFieldsFragment,
  "ticketNo" | "status" | "locked" | "operable" | "locationKind"
> & { org: { id: string; name: string } };
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

/**
 * 本的詳情頁的格子:別店的張(`operable = false`,所在分店不在可見範圍內)用「其他分店」、不能選;
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
      state = STATE_OF[ticket.status] ?? "sold";
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

/** 本的詳情頁能選:未售(報廢)、待查·遺失(尋回);能對調跳號時另加跳號。 */
export const bookSelectableOf = (
  canSwapSkips: boolean,
): TicketGridProps["selectableStates"] =>
  canSwapSkips ? ["unsold", "lost", "skipped"] : ["unsold", "lost"];

/** 選到的張能不能出現在操作列:自己範圍內的張;跳號記在哪家店都可以(對調跳號用)。 */
export const isSelectable = (ticket: Ticket): boolean =>
  ticket.operable || ticket.status === TICKET_STATUS.skipped;

/** 本的詳情頁的圖例(未售 / 已售 /(調貨中)/ 跳號 / 報廢 / 待查·遺失 /(其他分店)/ 已選)。 */
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
      "selected",
    ],
    tickets,
  );

/**
 * 對調跳號的一對(規格 7.3 做法 D):剛好兩張,一張跳號(記在哪家店都可以)+ 一張自己範圍內未售、未鎖定、
 * 不在途的張;其他組合 → null(按鈕停用並提示)。
 */
export const swapPairOf = <T extends Ticket>(
  tickets: readonly T[],
): { skipped: T; unsold: T } | null => {
  if (tickets.length !== 2) {
    return null;
  }
  const skipped = tickets.find(
    (ticket) => ticket.status === TICKET_STATUS.skipped,
  );
  const unsold = tickets.find(
    (ticket) =>
      ticket.status === TICKET_STATUS.unsold &&
      ticket.operable &&
      !ticket.locked &&
      ticket.locationKind !== TICKET_LOCATION_KIND.inTransit,
  );
  return skipped === undefined || unsold === undefined
    ? null
    : { skipped, unsold };
};

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
  (ticket.status === TICKET_STATUS.investigating ||
    ticket.status === TICKET_STATUS.lost);

/**
 * 選到的張能做什麼:全部未售 → 報廢;全部待查 / 遺失 → 尋回;混在一起 → 沒有共同可用的按鈕。
 * 選到別店的張(例:查刮刮樂帶來的張號在別店)→ 沒有按鈕。
 */
export const selectionActionsOf = (
  tickets: readonly Ticket[],
): { canScrap: boolean; canRecover: boolean } => ({
  canScrap:
    tickets.length > 0 &&
    tickets.every(
      (ticket) =>
        ticket.operable &&
        ticket.status === TICKET_STATUS.unsold &&
        !ticket.locked,
    ),
  canRecover:
    tickets.length > 0 && tickets.every((ticket) => isRecoverable(ticket)),
});
