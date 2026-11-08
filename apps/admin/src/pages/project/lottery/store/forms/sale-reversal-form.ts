import { COLLATION_LOCALE } from "@repo/domain/collation";
import type { StoredValues } from "@repo/domain/form";
import {
  SALE_REVERSAL_FIELD_KEYS as F,
  SALE_REVERSAL_LINE_KIND,
  SALE_REVERSAL_REFUND,
  TICKET_STATUS,
  saleReversalRefundAmountOf,
  ticketNosText,
} from "@repo/domain/project/lottery";

/** 新增頁的一組(一本):本的資訊 + 選的張號(3 位、排序)。 */
export interface ReversalGroup {
  bookId: string;
  gameCode: string;
  gameName: string;
  /** 本號 7 位。 */
  bookNo: string;
  unitPrice: number;
  /** 確定張號的已售(刷條碼或點格子選的)。 */
  ticketNos: string[];
  /**
   * 張數店刷到、不是確定張號的已售(未售、待查、遺失、已售·未對號):送出時先和刷的那一台最近一筆依張數售出對號再鎖
   * (張數店規格 7.3 第 1、3 點;清單標「已對號」)。格子點不到,只能刷或手輸加入。
   */
  matchNos: string[];
}

/** 「依遊戲 + 張數」的一列(張數店規格 7.3 第 3 點、13.2;Figma CS-14)。 */
export interface ReversalCountRow {
  rowId: string;
  cashPointId: string;
  gameId: string;
  /** 選到遊戲時帶入(退貨退款收據用) */
  gameCode: string;
  gameName: string;
  unitPrice: number;
  count: number;
}

export interface SaleReversalState {
  orgId: string;
  reasonKey: string;
  refund: boolean;
  refundShiftId: string;
  note: string;
  /**
   * 依張號各列記的位置:刷退票的那一台(預設本機收銀點);從全店重刷進來 = 重刷刷到的位置(庫存 = null)。
   * 張數店送出時依它找要對號的依張數售出,核准時依它判斷「回到重刷刷到的位置」。
   */
  ticketCashPointId: string | null;
}

/** 刷到的那一張要怎麼加入(`null` = 不能撤銷)。 */
export type ReversalScanKind = "certain" | "match";

/** 刷到的那一張(`lotteryStoreScan` 的欄位)。 */
export interface ReversalScanItem {
  status: string;
  unmatched: boolean;
  blockReason?: string | null;
}

/** 不論哪種店都不能進撤銷申請的處理方式(被鎖住、跳號、報廢、在途、不是本店)。 */
const BLOCKED: ReadonlySet<string> = new Set([
  "not_this_store",
  "skipped",
  "scrapped",
  "locked",
  "in_transit",
]);

/** 張數店刷到時送出前可以對號的狀態。 */
const MATCHABLE: ReadonlySet<string> = new Set([
  TICKET_STATUS.unsold,
  TICKET_STATUS.investigating,
  TICKET_STATUS.lost,
  TICKET_STATUS.sold,
]);

/**
 * 刷到的那一張怎麼加入(張數店規格 7.3 第 1、3 點):確定張號的已售 → 照張號(格子選取);張數店(`matching`)的
 * 未售 / 待查 / 遺失 / 已售·未對號 → 送出時先對號;其他(編號店不是已售、被鎖住、跳號、報廢、在途、不是本店)→ null。
 * 伺服器送出時會再算一次(畫面只是先擋明顯不行的)。
 */
export const reversalScanKindOf = (
  item: ReversalScanItem,
  matching: boolean,
): ReversalScanKind | null => {
  if (item.blockReason != null && BLOCKED.has(item.blockReason)) {
    return null;
  }
  if (item.status === TICKET_STATUS.sold && !item.unmatched) {
    return "certain";
  }
  return matching && MATCHABLE.has(item.status) ? "match" : null;
};

const sortNos = (nos: Iterable<string>): string[] =>
  [...new Set(nos)].toSorted((left, right) =>
    left.localeCompare(right, COLLATION_LOCALE),
  );

type BookInfo = Omit<ReversalGroup, "ticketNos" | "matchNos">;

/** 加一張:這本已有一組就併進去,沒有就在最後加一組(`kind` = match 的放進送出時對號的清單)。 */
export const addTicket = (
  groups: readonly ReversalGroup[],
  book: BookInfo,
  ticketNo: string,
  kind: ReversalScanKind = "certain",
): ReversalGroup[] => {
  const key = kind === "match" ? "matchNos" : "ticketNos";
  if (!groups.some((group) => group.bookId === book.bookId)) {
    return [
      ...groups,
      { ...book, ticketNos: [], matchNos: [], [key]: [ticketNo] },
    ];
  }
  return groups.map((group) =>
    group.bookId === book.bookId
      ? { ...group, [key]: sortNos([...group[key], ticketNo]) }
      : group,
  );
};

/** 在格子改選這本的張。 */
export const setGroupTickets = (
  groups: readonly ReversalGroup[],
  bookId: string,
  ticketNos: readonly string[],
): ReversalGroup[] =>
  groups.map((group) =>
    group.bookId === bookId
      ? { ...group, ticketNos: sortNos(ticketNos) }
      : group,
  );

/** 移除一張送出時對號的張。 */
export const removeMatchTicket = (
  groups: readonly ReversalGroup[],
  bookId: string,
  ticketNo: string,
): ReversalGroup[] =>
  groups.map((group) =>
    group.bookId === bookId
      ? { ...group, matchNos: group.matchNos.filter((no) => no !== ticketNo) }
      : group,
  );

export const removeGroup = (
  groups: readonly ReversalGroup[],
  bookId: string,
): ReversalGroup[] => groups.filter((group) => group.bookId !== bookId);

/** 這本要送出的張號(格子選的 + 送出時對號的)。 */
const groupNosOf = (group: ReversalGroup): string[] =>
  sortNos([...group.ticketNos, ...group.matchNos]);

/** 退款金額 = 選到的張數的面額合計(唯讀;含依遊戲 + 張數的列)。 */
export const refundAmountOf = (
  groups: readonly ReversalGroup[],
  countRows: readonly ReversalCountRow[] = [],
): number =>
  saleReversalRefundAmountOf([
    ...groups.map((group) => ({
      unitPrice: group.unitPrice,
      tickets: groupNosOf(group).length,
    })),
    ...countRows.map((row) => ({
      unitPrice: row.unitPrice,
      tickets: row.count,
    })),
  ]);

/** 送出前畫面上的檢查:沒有張、依遊戲 + 張數沒選遊戲、沒選原因、退款 = 是沒有退款班次。 */
export const invalidFieldsOf = (
  state: SaleReversalState,
  groups: readonly ReversalGroup[],
  countRows: readonly ReversalCountRow[] = [],
): string[] => [
  ...((groups.every((group) => groupNosOf(group).length === 0) &&
    countRows.length === 0) ||
  countRows.some((row) => row.gameId === "" || row.cashPointId === "")
    ? ["lines"]
    : []),
  ...(state.reasonKey === "" ? ["reason"] : []),
  ...(state.refund && state.refundShiftId === "" ? ["refundShift"] : []),
];

/** 畫面 → 表單引擎的存值(欄位 key 同受管表單 `sale_reversal.r4.seed.ts`;退款金額由引擎重算)。 */
export const saleReversalStoredValues = (
  state: SaleReversalState,
  groups: readonly ReversalGroup[],
  newRowId: () => string,
  countRows: readonly ReversalCountRow[] = [],
): StoredValues => {
  const ticketLines = groups
    .filter((group) => groupNosOf(group).length > 0)
    .map((group) => {
      const nos = groupNosOf(group);
      return {
        rowId: newRowId(),
        [F.lineKind]: SALE_REVERSAL_LINE_KIND.byTicket,
        [F.book]: group.bookId,
        [F.ticketNos]: ticketNosText(nos),
        [F.tickets]: nos.length,
        [F.cashPoint]: state.ticketCashPointId,
        [F.amount]: group.unitPrice * nos.length,
      };
    });
  const countLines = countRows.map((row) => ({
    rowId: row.rowId,
    [F.lineKind]: SALE_REVERSAL_LINE_KIND.byCount,
    [F.game]: row.gameId,
    [F.cashPoint]: row.cashPointId,
    [F.count]: row.count,
    [F.amount]: row.unitPrice * row.count,
  }));
  return {
    [F.branch]: state.orgId,
    [F.lines]: [...ticketLines, ...countLines],
    [F.reason]: state.reasonKey,
    [F.refund]: state.refund
      ? SALE_REVERSAL_REFUND.yes
      : SALE_REVERSAL_REFUND.no,
    [F.refundShift]: state.refund ? state.refundShiftId : null,
    [F.note]: state.note.trim() === "" ? null : state.note.trim(),
    [F.refundAmount]: refundAmountOf(groups, countRows),
  };
};

/** 張的顯示鍵 `5164-056527-012` → 正面編號 `056527-012`(帶入那一張時拿去刷,找出本與張號)。 */
export const frontCodeOfTicketKey = (ticketKey: string): string | null => {
  const parts = ticketKey.split("-");
  return parts.length === 3 ? `${parts[1] ?? ""}-${parts[2] ?? ""}` : null;
};

/**
 * 刷到的結果裡要加入哪一張、怎麼加入:帶入那一張時以張 id 對;否則取第一張能加入的。
 * 找到但不能撤銷 → `kind` = null。
 */
export const reversalScanHitOf = <
  T extends ReversalScanItem & { ticketId: string },
>(
  items: readonly T[],
  wantedTicketId: string | null,
  matching: boolean,
): { item: T; kind: ReversalScanKind | null } | null => {
  const hit =
    items.find((item) =>
      wantedTicketId === null
        ? reversalScanKindOf(item, matching) !== null
        : item.ticketId === wantedTicketId,
    ) ?? items.at(0);
  return hit === undefined
    ? null
    : { item: hit, kind: reversalScanKindOf(hit, matching) };
};

/**
 * 依張號各列記的位置(張數店規格 7.3 第 1、5 點):全店重刷帶入的位置(`stock` = 庫存 = null),
 * 沒帶 = 刷退票的這一台(本機收銀點;沒設定 = null)。
 */
export const ticketCashPointIdOf = (
  place: string,
  stockPlace: string,
  localCashPointId: string | null,
): string | null => {
  if (place === "") {
    return localCashPointId;
  }
  return place === stockPlace ? null : place;
};

/** 帶入的「遊戲 + 張數」列(網址 `game` / `point` / `count`;張數看不懂 = 1)。 */
export const prefilledCountRowsOf = (
  prefill: { game: string; point: string; count: string },
  newRowId: () => string,
): ReversalCountRow[] => {
  if (prefill.game === "" || prefill.point === "") {
    return [];
  }
  const count = Number(prefill.count);
  return [
    {
      rowId: newRowId(),
      cashPointId: prefill.point,
      gameId: prefill.game,
      gameCode: "",
      gameName: "",
      unitPrice: 0,
      count: Number.isInteger(count) && count > 0 ? count : 1,
    },
  ];
};

/** 新的一列「依遊戲 + 張數」(收銀點預設本機,沒設定 = 第一台)。 */
export const newCountRowOf = (
  rowId: string,
  cashPointId: string,
): ReversalCountRow => ({
  rowId,
  cashPointId,
  gameId: "",
  gameCode: "",
  gameName: "",
  unitPrice: 0,
  count: 1,
});
