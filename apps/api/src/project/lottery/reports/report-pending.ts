import type { Types } from "mongoose";

import { TICKET_EVENT_TYPE } from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import type {
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";

/** 一本的待標註與作廢資訊(報表用)。 */
interface BookMeta {
  /** 迄號 − 標準張數(> 0 才可能有待標註)。 */
  surplus: number;
  standard: number;
  /** 現在已標的跳號數。 */
  skippedNow: number;
  /** 跳號 +1 / 取消跳號 −1 的時間(只讀可能有待標註的本)。 */
  skipChanges: { at: Date; delta: number }[];
  /** 進貨作廢的時間(已撤銷的本;沒作廢 = null)。 */
  voidedAt: Date | null;
}

/**
 * 報表的「待標註跳號」與「已撤銷的本」(使用者 10/27 定案甲):**待標註的跳號(拆本前還沒標的)實體不存在,
 * 不算庫存張數與成本**;作廢的本從作廢那一刻起不算期末庫存。
 *
 * - 某一刻的待標註張數 = 迄號 − 標準張數 − 那一刻已標的跳號(= 現在已標的 − 那一刻之後的跳號淨數)
 * - 整本一起動的一組張(進貨、進貨作廢、整本調貨、未拆的本盤點不在 / 確認遺失 / 尋回):張數 = 標準張數 + 待標註
 *   時扣掉待標註那幾張(成本扣同樣張數 × 這組的平均單張成本)。未拆的本只能整本調貨,其他動作也是整本
 */
export class BookPendings {
  constructor(private readonly meta: ReadonlyMap<string, BookMeta>) {}

  /** 這本在 `at` 那一刻的待標註張數。 */
  pendingAt(bookId: Types.ObjectId | string, at: Date): number {
    const meta = this.meta.get(String(bookId));
    if (meta === undefined || meta.surplus <= 0) {
      return 0;
    }
    const after = meta.skipChanges
      .filter((change) => change.at >= at)
      .reduce((sum, change) => sum + change.delta, 0);
    return Math.max(0, meta.surplus - (meta.skippedNow - after));
  }

  /**
   * 一組同一本的張要扣掉的待標註張數:那一刻還有待標註、而且這組是整本(張數 = 標準張數 + 待標註)→ 待標註張數;
   * 其他 → 0。
   */
  adjustmentOf(
    bookId: Types.ObjectId | string,
    at: Date,
    groupSize: number,
  ): number {
    const meta = this.meta.get(String(bookId));
    const pending = this.pendingAt(bookId, at);
    return meta !== undefined &&
      pending > 0 &&
      groupSize === meta.standard + pending
      ? pending
      : 0;
  }

  /**
   * 還待查的那一組要扣的待標註張數:還有待標註就扣(不超過這組;使用者 10/27 定案 M1)。整本待查後只處理一部分
   * (確認遺失、尋回幾張)時,還沒標的跳號沒有實體、不會被逐張處理,算在還待查的那一組。
   */
  remainderAdjustmentOf(
    bookId: Types.ObjectId | string,
    at: Date,
    groupSize: number,
  ): number {
    return Math.min(groupSize, this.pendingAt(bookId, at));
  }

  /** 這本在 `at` 之前已作廢(作廢那一刻起不算庫存)。 */
  revokedBefore(bookId: Types.ObjectId | string, at: Date): boolean {
    const voidedAt = this.meta.get(String(bookId))?.voidedAt ?? null;
    return voidedAt !== null && voidedAt < at;
  }
}

const numberOf = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 讀這些本的待標註與作廢資訊(一次查本、一次查跳號事件、一次查作廢時間;不逐本查)。 */
export async function loadBookPendings(
  reader: OperatorContext,
  repositories: {
    books: LotteryBooksRepository;
    events: LotteryTicketEventsRepository;
  },
  bookIds: readonly Types.ObjectId[],
): Promise<BookPendings> {
  const unique = [...new Map(bookIds.map((id) => [String(id), id])).values()];
  if (unique.length === 0) {
    return new BookPendings(new Map());
  }
  const rows = await repositories.books.findMany(
    reader,
    { _id: { $in: unique } },
    { select: "lastTicketNo standardTickets skippedTicketNos status" },
  );
  const meta = new Map<string, BookMeta>();
  for (const row of rows) {
    const standard = numberOf(row.standardTickets);
    meta.set(String(row._id), {
      surplus:
        standard > 0 ? Math.max(0, numberOf(row.lastTicketNo) - standard) : 0,
      standard,
      skippedNow: (row.skippedTicketNos as string[] | undefined)?.length ?? 0,
      skipChanges: [],
      voidedAt: null,
    });
  }
  const withSurplus = rows
    .filter((row) => (meta.get(String(row._id))?.surplus ?? 0) > 0)
    .map((row) => row._id);
  const revoked = rows
    .filter((row) => row.status === "revoked")
    .map((row) => row._id);
  const [skips, voids] = await Promise.all([
    withSurplus.length === 0
      ? Promise.resolve([])
      : repositories.events.findMany(
          reader,
          {
            bookId: { $in: withSurplus },
            type: { $in: [TICKET_EVENT_TYPE.skip, TICKET_EVENT_TYPE.unskip] },
          },
          { select: "bookId type at" },
        ),
    revoked.length === 0
      ? Promise.resolve([])
      : (repositories.events.aggregate(reader, [
          {
            $match: {
              bookId: { $in: revoked },
              type: TICKET_EVENT_TYPE.purchaseVoid,
            },
          },
          { $group: { _id: "$bookId", at: { $min: "$at" } } },
        ]) as Promise<{ _id: Types.ObjectId; at: Date }[]>),
  ]);
  for (const skip of skips) {
    meta.get(String(skip.bookId))?.skipChanges.push({
      at: skip.at,
      delta: skip.type === TICKET_EVENT_TYPE.skip ? 1 : -1,
    });
  }
  for (const row of voids) {
    const entry = meta.get(String(row._id));
    if (entry !== undefined) {
      entry.voidedAt = row.at;
    }
  }
  return new BookPendings(meta);
}
