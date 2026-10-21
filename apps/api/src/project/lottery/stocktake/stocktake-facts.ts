import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import {
  type StocktakeDiff,
  type StocktakeDraft,
  type StocktakeDraftLine,
  type StocktakeTicketFacts,
  type StocktakeTicketSnapshot,
  stocktakeActionProblemsOf,
  stocktakeDiffsOf,
  stocktakeTicketFactsOf,
} from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import type { OperatorContext } from "../../../database/operator-context";
import {
  type LotteryBookDocument,
  LotteryBooksRepository,
  type LotteryTicketDocument,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";

type BookRecord = Persisted<LotteryBookDocument>;
type TicketRecord = Persisted<LotteryTicketDocument>;

const idOf = (text: string): Types.ObjectId | null =>
  Types.ObjectId.isValid(text) ? new Types.ObjectId(text) : null;

function snapshotOf(value: {
  status: StocktakeTicketSnapshot["status"];
  locationKind?: StocktakeTicketSnapshot["locationKind"];
  location?: {
    kind: StocktakeTicketSnapshot["locationKind"];
    cashPointId: Types.ObjectId | null;
  };
  cashPointId?: Types.ObjectId | null;
}): StocktakeTicketSnapshot {
  const kind = value.location?.kind ?? value.locationKind ?? "stock";
  const pointId = value.location?.cashPointId ?? value.cashPointId ?? null;
  return {
    status: value.status,
    locationKind: kind,
    cashPointId: pointId === null ? null : String(pointId),
  };
}

/** 一本 × 收銀點的比對結果。 */
export interface LineEvaluation {
  line: StocktakeDraftLine;
  /** 這本(找不到 = null,整行視為已被處理)。 */
  book: BookRecord | null;
  cashPointId: Types.ObjectId | null;
  facts: StocktakeTicketFacts[];
  diffs: StocktakeDiff[];
  /** 盤到那一刻這個收銀點檯面上未售的張數。 */
  systemCount: number;
  /** 撤銷審核中的張號。 */
  pendingReversalNos: string[];
  /** 畫面上的處理對不到目前差異的張號(「這幾張已被處理」)。 */
  stale: string[];
  /** 還沒處理的差異張號。 */
  unhandled: string[];
  ticketById: Map<string, TicketRecord>;
}

/**
 * 盤點內容與資料庫的比對(專案規格 6.8;規則在 `@repo/domain/project/lottery` 的 `stocktake.ts`):
 * 每本與 `countedAt` 那一刻的系統數字比對 —— 那一刻的狀態由那之後的張數事件倒推(事件是盤點比對的唯一來源)。
 * 讀取身分由呼叫端給(操作者;掛接點的系統動作用租戶邊界上下文)。
 */
@Injectable()
export class StocktakeFacts {
  constructor(
    private readonly books: LotteryBooksRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
  ) {}

  async evaluate(
    reader: OperatorContext,
    storeId: Types.ObjectId,
    draft: StocktakeDraft,
    session?: ClientSession,
  ): Promise<LineEvaluation[]> {
    const options = session === undefined ? {} : { session };
    const results: LineEvaluation[] = [];
    // TX-02:交易內依序 await
    for (const line of draft.lines) {
      results.push(await this.evaluateLine(reader, storeId, line, options));
    }
    return results;
  }

  private async evaluateLine(
    reader: OperatorContext,
    storeId: Types.ObjectId,
    line: StocktakeDraftLine,
    options: { session?: ClientSession },
  ): Promise<LineEvaluation> {
    const bookId = idOf(line.bookId);
    const cashPointId = idOf(line.cashPointId);
    const book =
      bookId === null
        ? null
        : await this.books.findOne(reader, { _id: bookId }, options);
    const tickets =
      book === null
        ? []
        : await this.tickets.findMany(
            reader,
            { bookId: book._id, orgId: storeId },
            options,
          );
    const countedAt = new Date(line.countedAt);
    const after =
      tickets.length === 0
        ? []
        : await this.events.findMany(
            reader,
            {
              ticketId: { $in: tickets.map((ticket) => ticket._id) },
              at: { $gt: countedAt },
            },
            { ...options, sort: { at: 1, _id: 1 } },
          );
    const eventsOf = new Map<string, typeof after>();
    for (const event of after) {
      const key = String(event.ticketId);
      eventsOf.set(key, [...(eventsOf.get(key) ?? []), event]);
    }
    const own = new Set(
      line.diffs.flatMap((diff) =>
        typeof diff.eventId === "string" ? [diff.eventId] : [],
      ),
    );
    const facts = tickets.map((ticket) =>
      stocktakeTicketFactsOf(
        {
          ticketId: String(ticket._id),
          ticketNo: ticket.ticketNo,
          current: snapshotOf(ticket),
          lockRefType: ticket.lockedBy?.refType ?? null,
        },
        (eventsOf.get(String(ticket._id)) ?? []).map((event) => ({
          eventId: event.eventId,
          at: event.at,
          from: event.from === null ? null : snapshotOf(event.from),
        })),
        line.cashPointId,
        countedAt,
        own,
      ),
    );
    const diffs = stocktakeDiffsOf(facts, line.presentTicketNos);
    const problems = stocktakeActionProblemsOf(diffs, line.diffs);
    return {
      line,
      book,
      cashPointId,
      facts,
      diffs,
      systemCount: facts.filter((item) => item.atCount === "unsold").length,
      pendingReversalNos: facts
        .filter((item) => item.pendingReversal && item.atCount !== "absent")
        .map((item) => item.ticketNo)
        .toSorted((a, b) => a.localeCompare(b)),
      stale: problems.stale,
      unhandled: problems.unhandled,
      ticketById: new Map(
        tickets.map((ticket) => [String(ticket._id), ticket]),
      ),
    };
  }

  /** 依事件 id 讀張數事件(補登售出的那幾筆:是不是事後更正)。 */
  eventsByIds(
    reader: OperatorContext,
    eventIds: readonly string[],
    options: { session?: ClientSession } = {},
  ) {
    return this.events.findMany(
      reader,
      { eventId: { $in: [...eventIds] } },
      options,
    );
  }

  bookOf(
    reader: OperatorContext,
    bookId: Types.ObjectId,
    options: { session?: ClientSession } = {},
  ): Promise<BookRecord | null> {
    return this.books.findOne(reader, { _id: bookId }, options);
  }

  async booksOf(
    reader: OperatorContext,
    bookIds: readonly Types.ObjectId[],
    options: { session?: ClientSession } = {},
  ): Promise<Map<string, BookRecord>> {
    if (bookIds.length === 0) {
      return new Map();
    }
    const found = await this.books.findMany(
      reader,
      { _id: { $in: [...bookIds] } },
      options,
    );
    return new Map(found.map((book) => [String(book._id), book]));
  }
}
