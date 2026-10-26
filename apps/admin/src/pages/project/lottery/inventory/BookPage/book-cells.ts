import { TICKET_STATUS } from "@repo/domain/project/lottery";
import type { LotteryInventoryTicketFieldsFragment } from "@repo/graphql";

import type {
  TicketGridCell,
  TicketGridProps,
} from "@/components/project/lottery/TicketGrid/TicketGrid";

type Ticket = Pick<
  LotteryInventoryTicketFieldsFragment,
  "ticketNo" | "status" | "locked" | "operable"
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
 * 被單據鎖定的未售用「已售 / 不能選」(規格 7.5)。張分在不止一家店時,每格的提示寫所在分店。
 */
export const bookCellsOf = (tickets: readonly Ticket[]): TicketGridCell[] => {
  const showStore = spansStores(tickets);
  return tickets.map((ticket) => {
    let state: CellState;
    if (!ticket.operable) {
      state = "otherStore";
    } else if (ticket.locked && ticket.status === TICKET_STATUS.unsold) {
      state = "sold";
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

/** 本的詳情頁能選:未售(報廢)、待查·遺失(尋回)。 */
export const BOOK_SELECTABLE: TicketGridProps["selectableStates"] = [
  "unsold",
  "lost",
];

/** 本的詳情頁的圖例(未售 / 已售 / 跳號 / 報廢 / 待查·遺失 /(其他分店)/ 已選)。 */
export const bookLegendOf = (
  tickets: readonly Ticket[],
): TicketGridProps["legendItems"] =>
  withOtherStore(
    ["unsold", "sold", "skipped", "scrapped", "lost", "selected"],
    tickets,
  );

/**
 * 更正跳號的格子(Figma IN-04a):自己範圍內的目前跳號與未售(未被鎖定)的張能選,別店的張是「其他分店」,
 * 其他都是「不能選」;圖例只有未售 /(其他分店)/ 已選。
 */
export const skipCorrectionCellsOf = (
  tickets: readonly Ticket[],
): TicketGridCell[] => {
  const showStore = spansStores(tickets);
  return tickets.map((ticket) => {
    let state: CellState = "sold";
    if (!ticket.operable) {
      state = "otherStore";
    } else if (
      ticket.status === TICKET_STATUS.skipped ||
      (ticket.status === TICKET_STATUS.unsold && !ticket.locked)
    ) {
      state = "unsold";
    }
    return {
      ticketNo: ticket.ticketNo,
      state,
      ...(showStore && { tooltip: ticket.org.name }),
    };
  });
};

export const skipCorrectionLegendOf = (
  tickets: readonly Ticket[],
): TicketGridProps["legendItems"] =>
  withOtherStore(["unsold", "selected"], tickets);

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
