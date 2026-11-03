import {
  INVENTORY_PERMISSIONS,
  STORE_PERMISSIONS,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
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

/** 卡片操作列按鈕的文字 key(`admin.lotteryStore.expand.*`)。 */
export const CARD_ACTION_KEYS: Record<CardAction, string> = {
  markSold: "expand.markSold",
  move: "expand.move",
  recall: "expand.recall",
  undoSale: "expand.undoSale",
  recover: "expand.recover",
  moveAndSell: "expand.moveAndSell",
};

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

/**
 * 這家店用張數店的看板(張數店與轉換中;張數店規格 13 節「轉換中的店用張數店的 UI」):虛線格子、
 * 卡片格子只留三種操作、遊戲合計、剩餘標「約」。
 */
export const isCountBoard = (countMode: string | null | undefined): boolean =>
  countMode === "count" || countMode === "converting";

/** 一張在這張卡片上的格子狀態(規格 7.5「看板展開卡片」;張數店的未對號畫虛線,13.2)。 */
export const cellStateOf = (
  ticket: CardTicket,
  point: ExpandedCashPoint,
): Exclude<TicketCellState, "selected"> => {
  if (ticket.unmatched && ticket.status === "sold") {
    return "unmatchedSold";
  }
  if (
    ticket.unmatched &&
    (ticket.status === "investigating" || ticket.status === "lost")
  ) {
    return "unmatchedLost";
  }
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
  // 檯面上未售的張只會被調貨單鎖住(撤銷售出申請鎖的是已售)
  return ticket.locked ? "transferring" : "unsold";
};

/**
 * 卡片圖例:有被調貨單鎖住的張才放「調貨中」;張數店另放「已售·未對號」「待查·遺失·未對號」
 * (Figma CS-02a;格子下方另寫「虛線 = 系統預設帶入的張號」)。
 */
export const legendOf = (
  tickets: readonly CardTicket[],
  countBoard = false,
): readonly TicketCellState[] => {
  const base: TicketCellState[] = tickets.some(
    (ticket) => ticket.status === "unsold" && ticket.locked,
  )
    ? [...LEGEND.slice(0, 2), "transferring", ...LEGEND.slice(2)]
    : [...LEGEND];
  if (!countBoard) {
    return base;
  }
  const selected = base.indexOf("selected");
  return [
    ...base.slice(0, selected),
    "unmatchedSold",
    "unmatchedLost",
    ...base.slice(selected),
  ];
};

/**
 * 選到的狀態 → 能按哪些(選到不同狀態只顯示共同可用的;規格 6.2)。張數店(`countBoard`)只留三種
 * (張數店規格 13.4):標記售出、確定待查的 [尋回]、本班刷條碼售出的 [撤銷售出](`scanSold` = 選到的是刷條碼賣的);
 * 不能在格子選張移櫃、收回,已售·未對號不給撤銷售出。
 */
export const actionsOf = (
  states: ReadonlySet<TicketCellState>,
  count: number,
  isLocal: boolean,
  can: (action: CardAction) => boolean,
  countBoard = false,
  scanSold = true,
): CardAction[] => {
  const only = (state: TicketCellState) =>
    states.size === 1 && states.has(state);
  if (countBoard) {
    return countBoardActionsOf(only, count, isLocal, scanSold).filter(
      (action) => can(action),
    );
  }
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

/** 張數店卡片格子的三種操作(張數店規格 13.4;只在本機收銀點)。 */
const countBoardActionsOf = (
  only: (state: TicketCellState) => boolean,
  count: number,
  isLocal: boolean,
  scanSold: boolean,
): CardAction[] => {
  if (!isLocal) {
    return [];
  }
  if (only("unsold")) {
    return ["markSold"];
  }
  if (only("soldThisShift") && count === 1 && scanSold) {
    return ["undoSale"];
  }
  return only("lost") ? ["recover"] : [];
};

/**
 * 哪些格子能選:本機收銀點 = 未售、本班售出、待查·遺失;別的收銀點 = 未售(移櫃 / 移櫃並售出)。
 * 張數店的格子不能選移櫃(13.4),別的收銀點都不能選。
 */
export const selectableOf = (
  isLocal: boolean,
  countBoard: boolean,
): TicketCellState[] => {
  if (isLocal) {
    return ["unsold", "soldThisShift", "lost"];
  }
  return countBoard ? [] : ["unsold"];
};

/** 按鈕要的權限與條件(`has` = 有沒有這個權限)。 */
export const cardActionAllowed = (
  action: CardAction,
  context: {
    has: (permission: string) => boolean;
    /** 卡片所在收銀點開著班 */
    shiftOpen: boolean;
    /** 有本機收銀點(開班中) */
    hasLocal: boolean;
  },
): boolean => {
  const { has } = context;
  switch (action) {
    case "markSold": {
      return has(STORE_PERMISSIONS.sell) && context.shiftOpen;
    }
    case "move":
    case "recall": {
      return has(STORE_PERMISSIONS.move);
    }
    case "moveAndSell": {
      return (
        has(STORE_PERMISSIONS.move) &&
        has(STORE_PERMISSIONS.sell) &&
        context.hasLocal
      );
    }
    case "undoSale": {
      return has(STORE_PERMISSIONS.undoSale);
    }
    case "recover": {
      // 店員尋回 `store.recover` 或庫存管理的尋回(張數店規格 7.9、12)
      return (
        has(INVENTORY_PERMISSIONS.recover) || has(STORE_PERMISSIONS.recover)
      );
    }
  }
};

/** 張數店卡片底部的按鈕(張數店規格 13.2、13.4):[收回]、[刷條碼移櫃]、[依張數移櫃](轉換中不顯示,9.2)。 */
export type CountCardAction = "recall" | "move" | "byCount";

/**
 * 張數店卡片底部要顯示哪幾顆(有 `store.move`;[依張數移櫃] 另要 `store.sell`,只有張數店)。
 * 收回與刷條碼移櫃開視窗刷條碼或手輸張號,依張數移櫃輸入張數;都預帶這張卡片的收銀點與遊戲。
 */
export const countCardActionsOf = (
  countMode: string,
  has: (permission: string) => boolean,
): CountCardAction[] => {
  if (!has(STORE_PERMISSIONS.move)) {
    return [];
  }
  return countMode === "count" && has(STORE_PERMISSIONS.sell)
    ? ["recall", "move", "byCount"]
    : ["recall", "move"];
};

/**
 * 這本的遊戲是不是暫停移櫃(張數店規格 8.5、8.5a B1 / B2):補點編號中(`gameId` = null)→ `renumber`;
 * 這個遊戲全店重刷中 → `rescan`;沒有 → null。後端一律再檢查。
 */
export const movePauseOf = (
  pauses: readonly { gameId?: string | null }[],
  gameId: string,
): "rescan" | "renumber" | null => {
  if (pauses.some((pause) => (pause.gameId ?? null) === null)) {
    return "renumber";
  }
  return pauses.some((pause) => pause.gameId === gameId) ? "rescan" : null;
};

/** 展開卡片的張數店按鈕要的資料:移櫃暫停(看板)與卡片收銀點這個遊戲的總剩餘、本數(看板的遊戲合計)。 */
export interface CountCardData {
  movePauses: readonly { gameId?: string | null }[];
  gameTotal?: { remaining: number; bookCount: number };
}

export const countCardOf = (
  board: { movePauses: readonly { gameId?: string | null }[] } | null,
  totals: readonly { gameId: string; remaining: number; bookCount: number }[],
  gameId: string,
): CountCardData => {
  const total = totals.find((item) => item.gameId === gameId);
  return {
    movePauses: board?.movePauses ?? [],
    ...(total && {
      gameTotal: { remaining: total.remaining, bookCount: total.bookCount },
    }),
  };
};

/** 選到的張的張號區段(「#080–081」)。 */
export const rangesOf = (tickets: readonly CounterTicket[]) =>
  formatTicketRanges(tickets.map((ticket) => ticket.ticketNo));
