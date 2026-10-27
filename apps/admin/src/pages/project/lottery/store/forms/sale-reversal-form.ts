import type { StoredValues } from "@repo/domain/form";
import {
  SALE_REVERSAL_FIELD_KEYS as F,
  SALE_REVERSAL_REFUND,
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
  ticketNos: string[];
}

export interface SaleReversalState {
  orgId: string;
  reasonKey: string;
  refund: boolean;
  refundShiftId: string;
  note: string;
}

const sortNos = (nos: Iterable<string>): string[] =>
  [...new Set(nos)].toSorted((left, right) => left.localeCompare(right));

/** 加一張:這本已有一組就併進去,沒有就在最後加一組。 */
export const addTicket = (
  groups: readonly ReversalGroup[],
  book: Omit<ReversalGroup, "ticketNos">,
  ticketNo: string,
): ReversalGroup[] => {
  if (!groups.some((group) => group.bookId === book.bookId)) {
    return [...groups, { ...book, ticketNos: [ticketNo] }];
  }
  return groups.map((group) =>
    group.bookId === book.bookId
      ? { ...group, ticketNos: sortNos([...group.ticketNos, ticketNo]) }
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

export const removeGroup = (
  groups: readonly ReversalGroup[],
  bookId: string,
): ReversalGroup[] => groups.filter((group) => group.bookId !== bookId);

/** 退款金額 = 選到的張數的面額合計(唯讀)。 */
export const refundAmountOf = (groups: readonly ReversalGroup[]): number =>
  saleReversalRefundAmountOf(
    groups.map((group) => ({
      unitPrice: group.unitPrice,
      tickets: group.ticketNos.length,
    })),
  );

/** 送出前畫面上的檢查:沒有張、沒選原因、退款 = 是沒有退款班次。 */
export const invalidFieldsOf = (
  state: SaleReversalState,
  groups: readonly ReversalGroup[],
): string[] => [
  ...(groups.every((group) => group.ticketNos.length === 0) ? ["lines"] : []),
  ...(state.reasonKey === "" ? ["reason"] : []),
  ...(state.refund && state.refundShiftId === "" ? ["refundShift"] : []),
];

/** 畫面 → 表單引擎的存值(欄位 key 同受管表單 `sale_reversal.r1.seed.ts`;退款金額由引擎重算)。 */
export const saleReversalStoredValues = (
  state: SaleReversalState,
  groups: readonly ReversalGroup[],
  newRowId: () => string,
): StoredValues => {
  const lines = groups
    .filter((group) => group.ticketNos.length > 0)
    .map((group) => ({
      rowId: newRowId(),
      [F.book]: group.bookId,
      [F.ticketNos]: ticketNosText(group.ticketNos),
      [F.tickets]: group.ticketNos.length,
      [F.amount]: group.unitPrice * group.ticketNos.length,
    }));
  return {
    [F.branch]: state.orgId,
    [F.lines]: lines,
    [F.reason]: state.reasonKey,
    [F.refund]: state.refund
      ? SALE_REVERSAL_REFUND.yes
      : SALE_REVERSAL_REFUND.no,
    [F.refundShift]: state.refund ? state.refundShiftId : null,
    [F.note]: state.note.trim() === "" ? null : state.note.trim(),
    [F.refundAmount]: refundAmountOf(groups),
  };
};

/** 張的顯示鍵 `5164-056527-012` → 正面編號 `056527-012`(帶入那一張時拿去刷,找出本與張號)。 */
export const frontCodeOfTicketKey = (ticketKey: string): string | null => {
  const parts = ticketKey.split("-");
  return parts.length === 3 ? `${parts[1] ?? ""}-${parts[2] ?? ""}` : null;
};
