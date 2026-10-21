/**
 * 張數格子的選取(專案規格 7.5:Shift 連選、「連號快選 從 [ ] 到 [ ]」)。
 * 只回新的已選張號(依格子順序),不改傳入的陣列。
 */

export interface TicketSelectionInput {
  /** 格子順序的張號。 */
  order: readonly string[];
  /** 能選的張號。 */
  selectable: ReadonlySet<string>;
  /** 目前已選。 */
  selected: readonly string[];
  /** 已選上限(拆本標跳號:點滿 N 張);不給 = 不限。 */
  max?: number;
}

const inOrder = (order: readonly string[], picked: ReadonlySet<string>) =>
  order.filter((ticketNo) => picked.has(ticketNo));

/** 加入幾張(不超過上限;超過的部分依格子順序捨去)。 */
const addAll = (
  input: TicketSelectionInput,
  ticketNos: readonly string[],
): string[] => {
  const picked = new Set(input.selected);
  for (const ticketNo of ticketNos) {
    if (input.max !== undefined && picked.size >= input.max) {
      break;
    }
    if (input.selectable.has(ticketNo)) {
      picked.add(ticketNo);
    }
  }
  return inOrder(input.order, picked);
};

/**
 * 點一格:沒按 Shift(或還沒有起點)→ 切換這一格;按著 Shift → 從起點到這一格之間能選的全部加入
 * (不能選的跳過)。
 */
export const clickTicket = (
  input: TicketSelectionInput,
  target: string,
  shift: boolean,
  anchor: string | null,
): string[] => {
  if (!input.selectable.has(target)) {
    return [...input.selected];
  }
  const anchorIndex = anchor === null ? -1 : input.order.indexOf(anchor);
  if (shift && anchorIndex !== -1) {
    const targetIndex = input.order.indexOf(target);
    const [start, end] =
      anchorIndex <= targetIndex
        ? [anchorIndex, targetIndex]
        : [targetIndex, anchorIndex];
    return addAll(input, input.order.slice(start, end + 1));
  }
  if (input.selected.includes(target)) {
    return input.selected.filter((ticketNo) => ticketNo !== target);
  }
  return addAll(input, [target]);
};

/** 連號快選:張號在 `from`–`to`(含,順序不拘)之間能選的全部加入;輸入不是數字 → 不變。 */
export const selectTicketRange = (
  input: TicketSelectionInput,
  from: string,
  to: string,
): string[] => {
  const start = Number.parseInt(from, 10);
  const end = Number.parseInt(to, 10);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return [...input.selected];
  }
  const [low, high] = start <= end ? [start, end] : [end, start];
  return addAll(
    input,
    input.order.filter((ticketNo) => {
      const value = Number(ticketNo);
      return value >= low && value <= high;
    }),
  );
};
