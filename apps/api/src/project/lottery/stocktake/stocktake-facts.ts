import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import { COLLATION_LOCALE } from "@repo/domain/collation";
import {
  type CountPickBook,
  type RenumberMatchResult,
  type RenumberPresentTicket,
  type RenumberTicket,
  STOCKTAKE_STOCK_LINE,
  type StocktakeDiff,
  type StocktakeDraft,
  type StocktakeDraftLine,
  type StocktakeTicketFacts,
  type StocktakeTicketSnapshot,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  isSealedInStore,
  isStocktakeStockLine,
  renumberMatchesOf,
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
  type LotteryTicketEventDocument,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { countsOfBook, pendingSkipCountOfBook } from "../tickets/books.service";

type BookRecord = Persisted<LotteryBookDocument>;
type TicketRecord = Persisted<LotteryTicketDocument>;
type TicketEventRecord = Persisted<LotteryTicketEventDocument>;

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
  /** 補點編號自動對號之前的差異(其他盤點 = `diffs`;自動對號從這裡算,重算也一樣)。 */
  allDiffs: StocktakeDiff[];
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

/** 補點編號一行的位置 key(收銀點 id;庫存 = `STOCKTAKE_STOCK_LINE`)。 */
const placeKeyOf = (item: LineEvaluation): string =>
  item.cashPointId === null ? STOCKTAKE_STOCK_LINE : String(item.cashPointId);

/**
 * 補點編號的自動對號(張數店規格 9.3 第 2 點、16.8 RN1;規則在 `renumberMatchesOf`):每一行(本 × 位置)
 * 實際不在、盤點那一刻未售、之後沒被動過的張(差異 `missing`、沒補登)當配對張;實際在的未對號張 =
 * 那一刻已售·未對號(差異 `extra`)、或現在待查 / 遺失·未對號而且盤點之後沒被動過、系統記在這個位置的張。
 * 同遊戲 × 位置跨本配對。
 */
export function renumberOfEvaluations(
  evaluations: readonly LineEvaluation[],
): RenumberMatchResult {
  const present: RenumberPresentTicket[] = [];
  const absent: RenumberTicket[] = [];
  const books = new Map<string, CountPickBook>();
  for (const item of evaluations) {
    if (item.book === null) {
      continue;
    }
    books.set(String(item.book._id), {
      firstOpenedAt: item.book.firstOpenedAt ?? null,
      bookNo: item.book.bookNo,
    });
    const line = renumberTicketsOfLine(item, item.book);
    present.push(...line.present);
    absent.push(...line.absent);
  }
  return renumberMatchesOf(present, absent, books);
}

/** 補點編號比對的一張(位置 = 這一行的位置)。 */
const renumberTicketOf = (
  ticket: TicketRecord,
  book: BookRecord,
  place: string,
): RenumberTicket => ({
  ticketId: String(ticket._id),
  ticketNo: ticket.ticketNo,
  bookId: String(book._id),
  gameId: String(book.gameId),
  place,
});

/** 這張現在系統記在這一行的位置(檯面 = 同一個收銀點;庫存那一行 = 庫存)。 */
const isAtLine = (ticket: TicketRecord, item: LineEvaluation): boolean => {
  if (item.cashPointId === null) {
    return ticket.location.kind === TICKET_LOCATION_KIND.stock;
  }
  return (
    ticket.location.kind === TICKET_LOCATION_KIND.counter &&
    ticket.location.cashPointId?.equals(item.cashPointId) === true
  );
};

/** 實際在、現在是待查 / 遺失·未對號、盤點之後沒被動過、沒被鎖、系統記在這個位置的張。 */
const isPresentGuess = (
  ticket: TicketRecord,
  item: LineEvaluation,
  changed: ReadonlySet<string>,
): boolean =>
  ticket.unmatched &&
  (ticket.status === TICKET_STATUS.investigating ||
    ticket.status === TICKET_STATUS.lost) &&
  ticket.lockedBy === null &&
  item.line.presentTicketNos.includes(ticket.ticketNo) &&
  !changed.has(String(ticket._id)) &&
  isAtLine(ticket, item);

/** 一行(本 × 位置)要拿去配的兩邊:實際在的未對號張、實際不在的未售張。 */
function renumberTicketsOfLine(
  item: LineEvaluation,
  book: BookRecord,
): { present: RenumberPresentTicket[]; absent: RenumberTicket[] } {
  const place = placeKeyOf(item);
  const present: RenumberPresentTicket[] = [];
  const absent: RenumberTicket[] = [];
  for (const diff of item.allDiffs) {
    const ticket = item.ticketById.get(diff.ticketId);
    if (ticket === undefined) {
      continue;
    }
    if (diff.kind === "missing" && !diff.backfilled) {
      absent.push(renumberTicketOf(ticket, book, place));
    } else if (diff.kind === "extra" && ticket.unmatched) {
      present.push({
        ...renumberTicketOf(ticket, book, place),
        status: TICKET_STATUS.sold,
      });
    }
  }
  const changed = new Set(
    item.facts.filter((fact) => fact.changedSince).map((fact) => fact.ticketId),
  );
  for (const ticket of item.ticketById.values()) {
    if (isPresentGuess(ticket, item, changed)) {
      present.push({
        ...renumberTicketOf(ticket, book, place),
        status: ticket.status,
      });
    }
  }
  return { present, absent };
}

/**
 * 補點編號:自動對號配走的差異不算差異(配對張的「不在」、未對號張的「已售還在」),剩下的照編號差異處理;
 * 已拆還有待標註的本,不在的張多一個 [標跳號](最多標待標註張數;9.3 第 3 點)。重算 stale / unhandled。
 */
function withRenumber(
  item: LineEvaluation,
  matched: ReadonlySet<string>,
): LineEvaluation {
  if (item.book === null) {
    return item;
  }
  const diffs = item.allDiffs.filter((diff) => !matched.has(diff.ticketId));
  const problems = stocktakeActionProblemsOf(
    diffs,
    item.line.diffs,
    item.line.cashPointId,
    pendingSkipCountOfBook(item.book),
  );
  return {
    ...item,
    diffs,
    stale: problems.stale,
    unhandled: problems.unhandled,
  };
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

  /**
   * 盤點內容的每一行(本 × 收銀點)與資料庫比對。本、這家店的張、那之後的張數事件各一次讀完
   * (事件從最早的 `countedAt` 讀起,每行再以自己的 `countedAt` 篩)。
   */
  async evaluate(
    reader: OperatorContext,
    storeId: Types.ObjectId,
    draft: StocktakeDraft,
    session?: ClientSession,
  ): Promise<LineEvaluation[]> {
    const options = session === undefined ? {} : { session };
    const bookIds = draft.lines.flatMap((line) => {
      const bookId = idOf(line.bookId);
      return bookId === null ? [] : [bookId];
    });
    const books = await this.booksOf(reader, bookIds, options);
    const tickets =
      books.size === 0
        ? []
        : await this.tickets.findMany(
            reader,
            {
              bookId: { $in: [...books.values()].map((book) => book._id) },
              orgId: storeId,
            },
            options,
          );
    const ticketsOf = new Map<string, TicketRecord[]>();
    for (const ticket of tickets) {
      const key = String(ticket.bookId);
      const list = ticketsOf.get(key) ?? [];
      list.push(ticket);
      ticketsOf.set(key, list);
    }
    const bookOf = (line: StocktakeDraftLine): BookRecord | null => {
      const bookId = idOf(line.bookId);
      return bookId === null ? null : (books.get(String(bookId)) ?? null);
    };
    const countedTimes = draft.lines
      .filter((line) => bookOf(line) !== null)
      .map((line) => new Date(line.countedAt).getTime())
      .filter((time) => Number.isFinite(time));
    const after =
      tickets.length === 0 || countedTimes.length === 0
        ? []
        : await this.events.findMany(
            reader,
            {
              ticketId: { $in: tickets.map((ticket) => ticket._id) },
              at: { $gt: new Date(Math.min(...countedTimes)) },
            },
            { ...options, sort: { at: 1, _id: 1 } },
          );
    const evaluations = draft.lines.map((line) => {
      const book = bookOf(line);
      return this.evaluateLine(
        line,
        book,
        book === null ? [] : (ticketsOf.get(String(book._id)) ?? []),
        after,
      );
    });
    if (draft.purpose !== "renumber") {
      return evaluations;
    }
    const renumber = renumberOfEvaluations(evaluations);
    const matched = new Set(
      renumber.matches.flatMap((match) => [match.ticketId, match.partnerId]),
    );
    return evaluations.map((item) => withRenumber(item, matched));
  }

  private evaluateLine(
    line: StocktakeDraftLine,
    book: BookRecord | null,
    tickets: readonly TicketRecord[],
    events: readonly TicketEventRecord[],
  ): LineEvaluation {
    // 庫存那一行沒有收銀點(盤點單紀錄存 null)
    const cashPointId = isStocktakeStockLine(line.cashPointId)
      ? null
      : idOf(line.cashPointId);
    const countedAt = new Date(line.countedAt);
    const ids = new Set(tickets.map((ticket) => String(ticket._id)));
    const after = events.filter(
      (event) =>
        ids.has(String(event.ticketId)) &&
        event.at.getTime() > countedAt.getTime(),
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
    const problems = stocktakeActionProblemsOf(
      diffs,
      line.diffs,
      line.cashPointId,
    );
    return {
      line,
      book,
      cashPointId,
      facts,
      diffs,
      allDiffs: diffs,
      systemCount: facts.filter((item) => item.atCount === "unsold").length,
      pendingReversalNos: facts
        .filter((item) => item.pendingReversal && item.atCount !== "absent")
        .map((item) => item.ticketNo)
        .toSorted((a, b) => a.localeCompare(b, COLLATION_LOCALE)),
      stale: problems.stale,
      unhandled: problems.unhandled,
      ticketById: new Map(
        tickets.map((ticket) => [String(ticket._id), ticket]),
      ),
    };
  }

  /**
   * 本店庫存裡的本分兩區(盤點頁、送出檢查共用,使用者 10/27 定案 D):
   *
   * - `unopened`:未拆的本(從沒拆過,這家店的張全是未售、在庫存、沒被調貨單鎖住)→ 盤「在 / 不在」整本
   * - `stock`:其他有未售、在庫存、沒被調貨單鎖住的張的本(拆過收回、尋回、調回…)→ 比照檯面逐張盤
   *
   * 已撤銷的本不列。張依本聚合一次、本一次讀完。
   */
  async stockBooksOf(
    reader: OperatorContext,
    storeId: Types.ObjectId,
    options: { session?: ClientSession } = {},
  ): Promise<{
    unopened: Map<string, { book: BookRecord; inStock: number }>;
    stock: Map<string, { book: BookRecord; inStock: number }>;
  }> {
    const rows = await this.tickets.aggregate(
      reader,
      [
        { $match: { orgId: storeId, status: { $ne: TICKET_STATUS.skipped } } },
        {
          $group: {
            _id: "$bookId",
            total: { $sum: 1 },
            inStock: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$status", TICKET_STATUS.unsold] },
                      { $eq: ["$location.kind", TICKET_LOCATION_KIND.stock] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            unlockedInStock: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$status", TICKET_STATUS.unsold] },
                      { $eq: ["$location.kind", TICKET_LOCATION_KIND.stock] },
                      { $eq: [{ $ifNull: ["$lockedBy", null] }, null] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $match: { inStock: { $gt: 0 } } },
      ],
      options,
    );
    const unopened = new Map<string, { book: BookRecord; inStock: number }>();
    const stock = new Map<string, { book: BookRecord; inStock: number }>();
    if (rows.length === 0) {
      return { unopened, stock };
    }
    const books = await this.books.findMany(
      reader,
      { _id: { $in: rows.map((row) => row._id as Types.ObjectId) } },
      options,
    );
    const bookOf = new Map(books.map((book) => [String(book._id), book]));
    for (const row of rows) {
      const book = bookOf.get(String(row._id));
      if (book?.status !== "normal") {
        continue;
      }
      // 未拆的本:從沒拆過、這家店的張全是未售在庫存,而且沒被調貨單鎖住(與拆本清單同一個規則)
      const sealed =
        Number(row.total) === Number(row.unlockedInStock) &&
        isSealedInStore(
          {
            counts: countsOfBook(book),
            firstOpenedAt: book.firstOpenedAt ?? null,
          },
          Number(row.total),
        );
      if (sealed) {
        unopened.set(String(book._id), {
          book,
          inStock: Number(row.inStock),
        });
      } else if (Number(row.unlockedInStock) > 0) {
        stock.set(String(book._id), {
          book,
          inStock: Number(row.unlockedInStock),
        });
      }
    }
    return { unopened, stock };
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

  /**
   * 盤點之後有異動的張(核准完成時套用前檢查;比照比對的「之後被別人處理過就不是差異」):
   * 每張給自己的時間點(差異 = 那本的 `countedAt`;未拆的本、待查清單 = 開始盤的時間),
   * 那之後有任何張數事件 → 放進回傳的集合。
   */
  async changedAfter(
    reader: OperatorContext,
    entries: readonly { ticketId: Types.ObjectId; after: Date }[],
    options: { session?: ClientSession } = {},
  ): Promise<Set<string>> {
    if (entries.length === 0) {
      return new Set();
    }
    const earliest = Math.min(...entries.map((entry) => entry.after.getTime()));
    const events = await this.events.findMany(
      reader,
      {
        ticketId: { $in: entries.map((entry) => entry.ticketId) },
        at: { $gt: new Date(earliest) },
      },
      { ...options, select: "ticketId at" },
    );
    const afterOf = new Map(
      entries.map((entry) => [String(entry.ticketId), entry.after.getTime()]),
    );
    return new Set(
      events
        .filter(
          (event) =>
            event.at.getTime() >
            (afterOf.get(String(event.ticketId)) ?? Number.POSITIVE_INFINITY),
        )
        .map((event) => String(event.ticketId)),
    );
  }
}
