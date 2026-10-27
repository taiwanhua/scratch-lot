import type { Types } from "mongoose";

import {
  TRANSFER_MODE,
  type TransferLineValue,
} from "@repo/domain/project/lottery";

/** 點收紀錄讀到的欄位(一次點收一筆;一列可以有好幾筆)。 */
export interface TransferReceiptTickets {
  submissionId?: Types.ObjectId;
  rowId: string;
  tickets: readonly {
    ticketId: Types.ObjectId;
    /** 逐張點收之前的舊紀錄沒有(= 整列一次點收) */
    ticketNo?: string | null;
  }[];
}

/** 一列已點收的張。 */
export interface RowReceived {
  /** 已點收的張(張 id) */
  ticketIds: Set<string>;
  /** 已點收的張號(舊紀錄沒有張號的不在裡面;整列一次點收的舊紀錄張數照 `ticketIds`) */
  ticketNos: Set<string>;
}

/**
 * 點收紀錄 → 每一列已點收的張(專案規格 8.4「點收」:整本的列一次整列、選張的列逐張點收)。
 * `keyOf` 預設 = rowId;跨好幾張單時傳 `${submissionId}:${rowId}`。
 */
export function receivedByRow(
  receipts: readonly TransferReceiptTickets[],
  keyOf: (receipt: TransferReceiptTickets) => string = (receipt) =>
    receipt.rowId,
): Map<string, RowReceived> {
  const rows = new Map<string, RowReceived>();
  for (const receipt of receipts) {
    const key = keyOf(receipt);
    const row = rows.get(key) ?? { ticketIds: new Set(), ticketNos: new Set() };
    for (const ticket of receipt.tickets) {
      row.ticketIds.add(String(ticket.ticketId));
      if (typeof ticket.ticketNo === "string") {
        row.ticketNos.add(ticket.ticketNo);
      }
    }
    rows.set(key, row);
  }
  return rows;
}

/** 這一列已點收幾張。 */
export function receivedCountOf(received: RowReceived | undefined): number {
  return received?.ticketIds.size ?? 0;
}

/** 這一列全部到齊:整本的列點收過(一次整列);選張的列已點收張數 ≥ 這一列的張數。 */
export function isLineReceived(
  line: Pick<TransferLineValue, "mode" | "tickets">,
  received: RowReceived | undefined,
): boolean {
  const count = receivedCountOf(received);
  return line.mode === TRANSFER_MODE.whole
    ? count > 0
    : line.tickets > 0 && count >= line.tickets;
}
