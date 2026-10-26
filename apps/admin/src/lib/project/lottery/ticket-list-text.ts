import { formatTicketRanges } from "@repo/domain/project/lottery";

/** 逐張列出的上限:超過就改用區段(`#012–016、#020`)。 */
const LIST_LIMIT = 5;

/**
 * 確認句裡的張號(調貨單「其餘全部到齊」「會變成待查」的確認):5 張以內逐張列「054、055、056」,
 * 更多張時寫區段「#012–016、#020」。
 */
export const ticketListText = (ticketNos: readonly string[]): string => {
  const sorted = [...new Set(ticketNos)].toSorted((a, b) => a.localeCompare(b));
  return sorted.length <= LIST_LIMIT
    ? sorted.join("、")
    : formatTicketRanges(sorted);
};
