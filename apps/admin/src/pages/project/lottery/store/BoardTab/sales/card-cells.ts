import type { LotteryStoreCardTicketFieldsFragment } from "@repo/graphql";

import type { TicketCellState } from "@/components/project/lottery/TicketGrid/ticket-cell-styles";

import type { CounterTicket } from "./CounterActionDialogs";

export type CardTicket = LotteryStoreCardTicketFieldsFragment;

/** 卡片所在的收銀點與它開著的班。 */
export interface ExpandedCashPoint {
  id: string;
  name: string;
  shift?: { id: string; openedBy: { name: string }; openedAt: string } | null;
}

export const LEGEND: readonly TicketCellState[] = [
  "unsold",
  "sold",
  "soldThisShift",
  "otherCashPoint",
  "selected",
];

export type CardAction =
  "markSold" | "move" | "recall" | "undoSale" | "recover" | "moveAndSell";

export type CardDialog = {
  kind: "manual" | "move" | "recall" | "recover";
  tickets: CardTicket[];
} | null;

export const toCounter = (list: readonly CardTicket[]): CounterTicket[] =>
  list.map((ticket) => ({
    id: ticket.id,
    version: ticket.version,
    ticketNo: ticket.ticketNo,
  }));

/** 一張在這張卡片上的格子狀態(規格 7.5「看板展開卡片」)。 */
export const cellStateOf = (
  ticket: CardTicket,
  point: ExpandedCashPoint,
): Exclude<TicketCellState, "selected"> => {
  if (ticket.status === "sold") {
    return ticket.soldShiftId != null && ticket.soldShiftId === point.shift?.id
      ? "soldThisShift"
      : "sold";
  }
  if (ticket.cashPoint?.id !== point.id) {
    return "otherCashPoint";
  }
  if (ticket.status === "investigating" || ticket.status === "lost") {
    return "lost";
  }
  if (ticket.status === "scrapped") {
    return "scrapped";
  }
  return ticket.locked ? "sold" : "unsold";
};

/** 選到的狀態 → 能按哪些(選到不同狀態只顯示共同可用的;規格 6.2)。 */
export const actionsOf = (
  states: ReadonlySet<TicketCellState>,
  count: number,
  isLocal: boolean,
  can: (action: CardAction) => boolean,
): CardAction[] => {
  const only = (state: TicketCellState) =>
    states.size === 1 && states.has(state);
  let actions: CardAction[] = [];
  if (isLocal && only("unsold")) {
    actions = ["markSold", "move", "recall"];
  } else if (isLocal && only("soldThisShift") && count === 1) {
    actions = ["undoSale"];
  } else if (isLocal && only("lost")) {
    actions = ["recover"];
  } else if (!isLocal && only("unsold")) {
    actions = ["move", "moveAndSell"];
  }
  return actions.filter((action) => can(action));
};
