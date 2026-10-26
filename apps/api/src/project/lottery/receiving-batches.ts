import type { Types } from "mongoose";

/** 一次點收(按一次 [完成這次點收]):點收單照它印、補印照它重排版。 */
export interface ReceivingBatch {
  batchId: string;
  /** 第幾次點收(依完成時間,從 1 起)。 */
  no: number;
  completedAt: Date;
  /** 這一次點收的列。 */
  rowIds: string[];
}

/**
 * 點收紀錄 → 每一次點收(依完成時間由舊到新,編號從 1 起;進貨點收、調貨點收共用)。
 * 還沒按 [完成這次點收] 的紀錄(`batchId` 是 null)不算。
 */
export function receivingBatchesOf(
  receipts: readonly {
    rowId: string;
    batchId?: Types.ObjectId | null;
    batchedAt?: Date | null;
  }[],
): ReceivingBatch[] {
  const batches = new Map<string, { completedAt: Date; rowIds: string[] }>();
  for (const receipt of receipts) {
    if (receipt.batchId == null) {
      continue;
    }
    const key = String(receipt.batchId);
    const batch = batches.get(key) ?? {
      completedAt: receipt.batchedAt ?? new Date(0),
      rowIds: [],
    };
    batch.rowIds.push(receipt.rowId);
    batches.set(key, batch);
  }
  return [...batches.entries()]
    .toSorted(
      ([, a], [, b]) => a.completedAt.getTime() - b.completedAt.getTime(),
    )
    .map(([batchId, batch], index) => ({ batchId, no: index + 1, ...batch }));
}
