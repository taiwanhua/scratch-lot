import { formatTicketRanges } from "@repo/domain/project/lottery";
import type { LotteryTransferBookTicketsQuery } from "@repo/graphql";

import type { TicketCellState } from "@/components/project/lottery/TicketGrid/ticket-cell-styles";

/** 選張格子的一格(`lotteryTransferBookTickets`)。 */
export type TransferCell =
  LotteryTransferBookTicketsQuery["lotteryTransferBookTickets"][number];

/**
 * 這張能不能加進已選(張數店規格 7.4):出貨店庫存的未售;張數店系統預設帶入狀態的張,
 * 出貨店庫存有配對張時也可以(送出時先對號再鎖定)。
 */
export const isPickableCell = (cell: TransferCell): boolean =>
  cell.state === "available" || (cell.unmatched && cell.matchable);

/**
 * api 的格子狀態 → 格子變體:可以調 = 未售;被其他調貨單鎖住的未售 = 調貨中;跳號;張數店系統預設帶入的張
 * 畫虛線(已售 / 待查·遺失·未對號);其他(已售、在檯面上、待查、報廢、在別家店…)= 不能選。
 */
export const transferCellStateOf = (
  cell: TransferCell,
): Exclude<TicketCellState, "selected"> => {
  if (cell.unmatched) {
    return cell.state === "sold" ? "unmatchedSold" : "unmatchedLost";
  }
  switch (cell.state) {
    case "available": {
      return "unsold";
    }
    case "locked": {
      return "transferring";
    }
    case "skipped": {
      return "skipped";
    }
    default: {
      return "sold";
    }
  }
};

/** 不能調的原因文字的 key 與值(`admin.lotteryPurchasing.transfer.create.cellProblems.*`)。 */
export interface CellProblem {
  key: string;
  values: Record<string, string>;
}

const PROBLEM_KEYS: Partial<Record<string, string>> = {
  counter: "cellProblems.counter",
  locked: "cellProblems.locked",
  investigating: "cellProblems.investigating",
  lost: "cellProblems.lost",
  scrapped: "cellProblems.scrapped",
  in_transit: "cellProblems.inTransit",
  skipped: "cellProblems.skipped",
  elsewhere: "cellProblems.elsewhere",
};

/**
 * 刷到或輸入不能調的張:原因與處理方式(張數店規格 7.4「刷到不能調的提示」;例「#041 已售(A 台 10:12 賣出):
 * 沒真的賣出請當下撤銷或送撤銷售出申請」「#041 在檯面上,請先收回到庫存」)。能調 = null。
 * `clock` 把售出時間換成租戶時區的 HH:mm。
 */
export const transferCellProblemOf = (
  cell: TransferCell,
  clock: (iso: string) => string,
): CellProblem | null => {
  if (isPickableCell(cell)) {
    return null;
  }
  if (cell.state === "sold") {
    const time = cell.soldAt == null ? "" : clock(cell.soldAt);
    return {
      key:
        cell.soldCashPointName == null
          ? "cellProblems.soldAt"
          : "cellProblems.sold",
      values: {
        ticketNo: cell.ticketNo,
        cashPoint: cell.soldCashPointName ?? "",
        time,
      },
    };
  }
  return {
    key: PROBLEM_KEYS[cell.state] ?? "cellProblems.elsewhere",
    values: {
      ticketNo: cell.ticketNo,
      cashPoint: cell.cashPointName ?? "",
      serialNo: cell.lockedSerialNo ?? "",
    },
  };
};

/** 送出被擋時,一列(選張)裡現在不能調的張:依狀態分組(「#014、#015 現在是在檯面上」)。 */
export interface BlockedRowGroup {
  state: string;
  ranges: string;
}

/** 這一列的張現在哪些不能調(送出被擋後重新拿格子資料;張數店規格 7.4「送出被擋」)。 */
export const blockedGroupsOf = (
  ticketNos: readonly string[],
  cells: readonly TransferCell[],
): BlockedRowGroup[] => {
  const wanted = new Set(ticketNos);
  const byState = new Map<string, string[]>();
  for (const cell of cells) {
    if (wanted.has(cell.ticketNo) && !isPickableCell(cell)) {
      const list = byState.get(cell.state) ?? [];
      list.push(cell.ticketNo);
      byState.set(cell.state, list);
    }
  }
  return [...byState.entries()].map(([state, nos]) => ({
    state,
    ranges: formatTicketRanges(nos),
  }));
};
