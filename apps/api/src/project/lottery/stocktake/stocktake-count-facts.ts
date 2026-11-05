import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import { COLLATION_LOCALE } from "@repo/domain/collation";
import {
  type CountLineFacts,
  type CountLineSnapshot,
  STOCKTAKE_REF_TYPE,
  type StocktakeDraft,
  type StocktakeDraftCountLine,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  countLineFactsOf,
  countLineProblemOf,
  stocktakeCountLinesOf,
} from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import {
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import type { TicketStateSnapshot } from "../../database/lottery-inventory/lottery-ticket-event.schema";

const idOf = (text: string): Types.ObjectId | null =>
  Types.ObjectId.isValid(text) ? new Types.ObjectId(text) : null;

/** 一組的 key(收銀點 × 遊戲)。 */
export const countGroupKeyOf = (
  cashPointId: Types.ObjectId | string,
  gameId: Types.ObjectId | string,
): string => `${String(cashPointId)}:${String(gameId)}`;

/** 範圍內一組「收銀點 × 遊戲」現在的未售張數與在哪幾本。 */
export interface CountGroupNow {
  cashPointId: Types.ObjectId;
  gameId: Types.ObjectId;
  unsoldCount: number;
  bookIds: Types.ObjectId[];
}

/** 張數盤點一組的比對結果。 */
export interface CountLineEvaluation {
  line: StocktakeDraftCountLine;
  /** 收銀點 / 遊戲 id 讀不懂 → null(整組視為要重數)。 */
  cashPointId: Types.ObjectId | null;
  gameId: Types.ObjectId | null;
  facts: CountLineFacts;
  problem: "stale" | "unhandled" | null;
}

/** 張數盤點 [算售出] 寫的一張(送出時記進盤點單的 `diffs`)。 */
export interface CountSaleRow {
  refId: string;
  ticketId: Types.ObjectId;
  ticketNo: string;
  eventId: string;
  amount: number;
  postClose: boolean;
  cashPointId: string | null;
  gameId: string;
}

function snapshotOf(
  value: Pick<TicketStateSnapshot, "status" | "locationKind" | "cashPointId">,
): CountLineSnapshot {
  return {
    status: value.status,
    locationKind: value.locationKind,
    cashPointId: value.cashPointId === null ? null : String(value.cashPointId),
  };
}

/**
 * 張數盤點與資料庫的比對(張數店規格 8.1、8.2、8.5a B6;規則在 `@repo/domain/project/lottery` 的 `count-mode.ts`):
 * 每組以開始數那一刻的系統數字比對 —— 現在的未售張數(一次 aggregate)加上那之後同遊戲的張數事件倒推
 * (事件依 `{ orgId, at }` 索引一次讀完,每組再以自己的 `countedAt` 篩;TX-06,不逐組查)。
 */
@Injectable()
export class StocktakeCountFacts {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly events: LotteryTicketEventsRepository,
  ) {}

  /**
   * 範圍內每一組「收銀點 × 遊戲」現在的未售張數(檯面上;一次 `$group`)。只列有未售的組
   * (售完的不必數;和盤點頁列的組相同)。
   */
  async groupsOf(
    reader: OperatorContext,
    storeId: Types.ObjectId,
    cashPointIds: readonly Types.ObjectId[],
    options: {
      session?: ClientSession;
      gameIds?: readonly Types.ObjectId[];
    } = {},
  ): Promise<Map<string, CountGroupNow>> {
    if (cashPointIds.length === 0) {
      return new Map();
    }
    const rows = await this.tickets.aggregate(
      reader,
      [
        {
          $match: {
            orgId: storeId,
            status: TICKET_STATUS.unsold,
            "location.kind": TICKET_LOCATION_KIND.counter,
            "location.cashPointId": { $in: [...cashPointIds] },
            ...(options.gameIds === undefined
              ? {}
              : { gameId: { $in: [...options.gameIds] } }),
          },
        },
        {
          $group: {
            _id: { cashPointId: "$location.cashPointId", gameId: "$gameId" },
            unsoldCount: { $sum: 1 },
            bookIds: { $addToSet: "$bookId" },
          },
        },
      ],
      options.session === undefined ? {} : { session: options.session },
    );
    const groups = new Map<string, CountGroupNow>();
    for (const row of rows) {
      const key = row._id as {
        cashPointId: Types.ObjectId;
        gameId: Types.ObjectId;
      };
      groups.set(countGroupKeyOf(key.cashPointId, key.gameId), {
        cashPointId: key.cashPointId,
        gameId: key.gameId,
        unsoldCount: Number(row.unsoldCount),
        bookIds: row.bookIds as Types.ObjectId[],
      });
    }
    return groups;
  }

  /** 本號(依 id;排序用)。 */
  async bookNosOf(
    reader: OperatorContext,
    bookIds: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (bookIds.length === 0) {
      return new Map();
    }
    const found = await this.books.findMany(
      reader,
      { _id: { $in: [...bookIds] } },
      { select: "bookNo" },
    );
    return new Map(found.map((book) => [String(book._id), book.bookNo]));
  }

  /**
   * 盤點內容的每一組與資料庫比對:現在的未售張數一次 aggregate、開始數之後同遊戲的事件一次讀完
   * (從最早的 `countedAt` 讀起)。
   */
  async evaluate(
    reader: OperatorContext,
    storeId: Types.ObjectId,
    draft: StocktakeDraft,
    session?: ClientSession,
  ): Promise<CountLineEvaluation[]> {
    const lines = stocktakeCountLinesOf(draft);
    if (lines.length === 0) {
      return [];
    }
    const parsed = lines.map((line) => ({
      line,
      cashPointId: idOf(line.cashPointId),
      gameId: idOf(line.gameId),
    }));
    const valid = parsed.filter(
      (
        item,
      ): item is typeof item & {
        cashPointId: Types.ObjectId;
        gameId: Types.ObjectId;
      } => item.cashPointId !== null && item.gameId !== null,
    );
    const options = session === undefined ? {} : { session };
    const gameIds = [...new Set(valid.map((item) => String(item.gameId)))].map(
      (id) => new Types.ObjectId(id),
    );
    const groups = await this.groupsOf(
      reader,
      storeId,
      [...new Set(valid.map((item) => String(item.cashPointId)))].map(
        (id) => new Types.ObjectId(id),
      ),
      { ...options, gameIds },
    );
    const earliest = Math.min(
      ...valid.map((item) => new Date(item.line.countedAt).getTime()),
    );
    const after =
      valid.length === 0
        ? []
        : await this.events.findMany(
            reader,
            {
              orgId: storeId,
              at: { $gt: new Date(earliest) },
              gameId: { $in: gameIds },
            },
            {
              ...options,
              select: "eventId at type from to refType refId gameId",
            },
          );
    return parsed.map((item) => {
      if (item.cashPointId === null || item.gameId === null) {
        return {
          ...item,
          facts: { systemCount: 0, ownSaleCount: 0, touchedByOther: true },
          problem: "stale" as const,
        };
      }
      const countedAt = new Date(item.line.countedAt).getTime();
      const gameId = item.gameId;
      const facts = countLineFactsOf(
        groups.get(countGroupKeyOf(item.cashPointId, gameId))?.unsoldCount ?? 0,
        after
          .filter(
            (event) =>
              event.gameId.equals(gameId) && event.at.getTime() > countedAt,
          )
          .map((event) => ({
            eventId: event.eventId,
            type: event.type,
            from: event.from === null ? null : snapshotOf(event.from),
            to: snapshotOf(event.to),
            refType: event.refType,
            refId: event.refId === null ? null : String(event.refId),
          })),
        String(item.cashPointId),
        new Set(item.line.saleRefIds),
      );
      return { ...item, facts, problem: countLineProblemOf(facts, item.line) };
    });
  }

  /**
   * [算售出] 寫的張(依 `refId`;盤點寫的售出):送出時記進盤點單、核准時當作「自己的」。
   * 事件與張各一次讀完。
   */
  async saleRowsOf(
    reader: OperatorContext,
    refIds: readonly string[],
    options: { session?: ClientSession } = {},
  ): Promise<CountSaleRow[]> {
    const ids = refIds.flatMap((text) => {
      const id = idOf(text);
      return id === null ? [] : [id];
    });
    if (ids.length === 0) {
      return [];
    }
    const found = await this.events.findMany(
      reader,
      {
        refType: STOCKTAKE_REF_TYPE,
        refId: { $in: ids },
        type: TICKET_EVENT_TYPE.saleStocktake,
      },
      options,
    );
    const tickets =
      found.length === 0
        ? []
        : await this.tickets.findMany(
            reader,
            { _id: { $in: found.map((event) => event.ticketId) } },
            { ...options, select: "ticketNo" },
          );
    const ticketNo = new Map(
      tickets.map((ticket) => [String(ticket._id), ticket.ticketNo]),
    );
    return found
      .map((event) => ({
        refId: String(event.refId),
        ticketId: event.ticketId,
        ticketNo: ticketNo.get(String(event.ticketId)) ?? "",
        eventId: event.eventId,
        amount: event.amount,
        postClose: event.postCloseOf !== null,
        cashPointId:
          event.cashPointId === null ? null : String(event.cashPointId),
        gameId: String(event.gameId),
      }))
      .toSorted((a, b) =>
        a.ticketNo.localeCompare(b.ticketNo, COLLATION_LOCALE),
      );
  }
}
