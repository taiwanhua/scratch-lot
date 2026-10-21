import { TICKET_STATUS } from "@repo/domain/project/lottery";
import type { LotteryInventoryTicketFieldsFragment } from "@repo/graphql";

import type {
  TicketGridCell,
  TicketGridProps,
} from "@/components/project/lottery/TicketGrid/TicketGrid";

type Ticket = Pick<
  LotteryInventoryTicketFieldsFragment,
  "ticketNo" | "status" | "locked"
>;
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

/** 本的詳情頁的格子:被單據鎖定的未售用「已售 / 不能選」(規格 7.5)。 */
export const bookCellsOf = (tickets: readonly Ticket[]): TicketGridCell[] =>
  tickets.map((ticket) => ({
    ticketNo: ticket.ticketNo,
    state:
      ticket.locked && ticket.status === TICKET_STATUS.unsold
        ? "sold"
        : (STATE_OF[ticket.status] ?? "sold"),
  }));

/** 本的詳情頁能選:未售(報廢)、待查·遺失(尋回)。 */
export const BOOK_SELECTABLE: TicketGridProps["selectableStates"] = [
  "unsold",
  "lost",
];

/** 本的詳情頁的圖例。 */
export const BOOK_LEGEND: TicketGridProps["legendItems"] = [
  "unsold",
  "sold",
  "skipped",
  "scrapped",
  "lost",
  "selected",
];

/**
 * 更正跳號的格子(Figma IN-04a):目前的跳號與未售(未被鎖定)的張能選,其他都是「不能選」;
 * 圖例只有未售 / 已選。
 */
export const skipCorrectionCellsOf = (
  tickets: readonly Ticket[],
): TicketGridCell[] =>
  tickets.map((ticket) => ({
    ticketNo: ticket.ticketNo,
    state:
      ticket.status === TICKET_STATUS.skipped ||
      (ticket.status === TICKET_STATUS.unsold && !ticket.locked)
        ? "unsold"
        : "sold",
  }));

/** 選到的張能做什麼:全部未售 → 報廢;全部待查 / 遺失 → 尋回;混在一起 → 沒有共同可用的按鈕。 */
export const selectionActionsOf = (
  tickets: readonly Ticket[],
): { canScrap: boolean; canRecover: boolean } => ({
  canScrap:
    tickets.length > 0 &&
    tickets.every(
      (ticket) => ticket.status === TICKET_STATUS.unsold && !ticket.locked,
    ),
  canRecover:
    tickets.length > 0 &&
    tickets.every(
      (ticket) =>
        ticket.status === TICKET_STATUS.investigating ||
        ticket.status === TICKET_STATUS.lost,
    ),
});
