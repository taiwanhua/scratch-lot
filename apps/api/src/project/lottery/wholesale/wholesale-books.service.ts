import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketLocationKind,
  type TicketStatus,
  isDocumentLock,
  isUnopenedInStore,
} from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  LotteryBooksRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { TicketLockDocuments } from "../tickets/ticket-lock-documents";

export function toObjectId(id: string | null): Types.ObjectId | null {
  return id !== null && Types.ObjectId.isValid(id)
    ? new Types.ObjectId(id)
    : null;
}

export function objectIdsOf(ids: readonly (string | null)[]): Types.ObjectId[] {
  return [...new Set(ids)].flatMap((id) => {
    const objectId = toObjectId(id);
    return objectId === null ? [] : [objectId];
  });
}

/** 讀到的張(批售判斷用的欄位)。 */
export interface WholesaleTicket {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  orgId: Types.ObjectId;
  ticketNo: string;
  status: TicketStatus;
  location: { kind: TicketLocationKind };
  lockedBy: { refType: string; refId: Types.ObjectId } | null;
}

/** 讀到的本。 */
export interface WholesaleBook {
  _id: Types.ObjectId;
  gameId: Types.ObjectId;
  gameCode: string;
  bookNo: string;
  status: string;
  /** 第一次拆本時間;null = 從沒拆過。 */
  firstOpenedAt?: Date | null;
}

/** 讀到的遊戲。 */
export interface WholesaleGame {
  _id: Types.ObjectId;
  gameCode: string;
  name: string;
  unitPrice: number;
  ticketsPerBook: number;
  bookPrice: number;
  defaultRate: number;
}

/**
 * 這本為什麼不能批售(規格 21.3「刷到不能批售的本,當下寫原因」;順序 = 判斷順序):
 * 已撤銷、已批售、拆過、在別家店、被調貨單 / 批售單(或其他來源)鎖住、張不是未售在庫存。
 */
export type WholesaleBookProblem =
  | { kind: "revoked" }
  | { kind: "wholesaled" }
  | { kind: "opened" }
  | { kind: "elsewhere" }
  | {
      kind: "transferring" | "wholesaling" | "locked";
      lockedBy: { refType: string; refId: Types.ObjectId };
    }
  | { kind: "not_in_stock" };

const BOOK_SELECT = "gameId gameCode bookNo status firstOpenedAt";
const TICKET_SELECT = "bookId orgId ticketNo status location lockedBy";
const GAME_SELECT =
  "gameCode name unitPrice ticketsPerBook bookPrice defaultRate";

const LOCK_KINDS: Readonly<
  Partial<Record<string, "transferring" | "wholesaling">>
> = {
  transfer: "transferring",
  wholesale: "wholesaling",
};

/**
 * 一本能不能批售(條件同調貨單「整本」的 `lineProblemOf`:從沒拆過、整本未售在出貨分店庫存、沒被鎖住)。
 * `tickets` = 這本全部的張(跳號不看);能 → null。
 */
export function wholesaleBookProblemOf(
  book: Pick<WholesaleBook, "status" | "firstOpenedAt">,
  tickets: readonly WholesaleTicket[],
  fromId: Types.ObjectId,
): WholesaleBookProblem | null {
  const usable = tickets.filter(
    (ticket) => ticket.status !== TICKET_STATUS.skipped,
  );
  if (book.status !== "normal") {
    return { kind: "revoked" };
  }
  if (usable.some((ticket) => ticket.status === TICKET_STATUS.wholesaled)) {
    return { kind: "wholesaled" };
  }
  if ((book.firstOpenedAt ?? null) !== null) {
    return { kind: "opened" };
  }
  if (usable.some((ticket) => !ticket.orgId.equals(fromId))) {
    return { kind: "elsewhere" };
  }
  const lockedBy = usable.find((ticket) => ticket.lockedBy !== null)?.lockedBy;
  if (lockedBy != null) {
    return { kind: LOCK_KINDS[lockedBy.refType] ?? "locked", lockedBy };
  }
  return isUnopenedInStore(
    null,
    usable.map((ticket) => ({
      status: ticket.status,
      locationKind: ticket.location.kind,
    })),
  )
    ? null
    : { kind: "not_in_stock" };
}

/** 批售單用到的本、張、遊戲的讀取與「能不能批售」的共用判斷(新增頁選項、刷條碼、送出前、核准前)。 */
@Injectable()
export class WholesaleBooks {
  constructor(
    private readonly books: LotteryBooksRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly games: LotteryGamesRepository,
    private readonly lockDocuments: TicketLockDocuments,
  ) {}

  async booksOf(
    reader: OperatorContext,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, WholesaleBook>> {
    return ids.length === 0
      ? new Map()
      : this.byId(
          await this.books.findMany(
            reader,
            { _id: { $in: [...ids] } },
            { select: BOOK_SELECT },
          ),
        );
  }

  /** 刷到的碼 → 這個租戶裡同本號(有給遊戲代號就再比它)的本。 */
  booksByNo(
    reader: OperatorContext,
    bookNo: string,
    gameCode: string | null,
  ): Promise<WholesaleBook[]> {
    return this.books.findMany(
      reader,
      { bookNo, ...(gameCode === null ? {} : { gameCode }) },
      { select: BOOK_SELECT },
    );
  }

  async gamesOf(
    reader: OperatorContext,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, WholesaleGame>> {
    return ids.length === 0
      ? new Map()
      : this.byId(
          await this.games.findMany(
            reader,
            { _id: { $in: [...ids] } },
            { select: GAME_SELECT },
          ),
        );
  }

  /** 幾本的張(一次讀完;本 id → 張)。 */
  async ticketsOf(
    reader: OperatorContext,
    bookIds: readonly Types.ObjectId[],
    session?: ClientSession,
  ): Promise<Map<string, WholesaleTicket[]>> {
    const byBook = new Map<string, WholesaleTicket[]>();
    if (bookIds.length === 0) {
      return byBook;
    }
    const rows: WholesaleTicket[] = await this.tickets.findMany(
      reader,
      { bookId: { $in: [...bookIds] } },
      { select: TICKET_SELECT, sort: { bookId: 1, ticketNo: 1 }, session },
    );
    for (const ticket of rows) {
      const key = String(ticket.bookId);
      const list = byBook.get(key) ?? [];
      list.push(ticket);
      byBook.set(key, list);
    }
    return byBook;
  }

  /**
   * 出貨分店庫存裡未售、沒被鎖的張:本 id → 張數與單張成本合計(新增頁的選項;已拆過的、不是整本的由呼叫端排除)。
   */
  async stockOf(
    reader: OperatorContext,
    fromId: Types.ObjectId,
  ): Promise<Map<string, { count: number; cost: number }>> {
    const rows = await this.tickets.aggregate(reader, [
      {
        $match: {
          orgId: fromId,
          status: TICKET_STATUS.unsold,
          lockedBy: null,
          "location.kind": TICKET_LOCATION_KIND.stock,
        },
      },
      {
        $group: {
          _id: "$bookId",
          count: { $sum: 1 },
          cost: { $sum: "$unitCost" },
        },
      },
    ]);
    return new Map(
      rows.map((row) => [
        String(row._id),
        { count: Number(row.count), cost: Number(row.cost) },
      ]),
    );
  }

  /** 幾本各有幾張(跳號不算)。 */
  async usableCountsOf(
    reader: OperatorContext,
    bookIds: readonly Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (bookIds.length === 0) {
      return new Map();
    }
    const rows = await this.tickets.aggregate(reader, [
      {
        $match: {
          bookId: { $in: [...bookIds] },
          status: { $ne: TICKET_STATUS.skipped },
        },
      },
      { $group: { _id: "$bookId", count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [String(row._id), Number(row.count)]));
  }

  /** 各問題鎖住它的單據的單號(調貨中 / 批售中「哪一張單」)。 */
  serialsOf(
    reader: OperatorContext,
    problems: readonly (WholesaleBookProblem | null)[],
  ): Promise<Map<string, string>> {
    return this.lockDocuments.serialsOf(
      reader,
      problems.map((problem) =>
        problem !== null &&
        "lockedBy" in problem &&
        isDocumentLock(problem.lockedBy.refType)
          ? problem.lockedBy
          : null,
      ),
    );
  }

  private byId<T extends { _id: Types.ObjectId }>(
    rows: readonly T[],
  ): Map<string, T> {
    return new Map(rows.map((row) => [String(row._id), row]));
  }
}

/** 一個問題鎖住它的單號(不是單據鎖 = null)。 */
export function serialOfProblem(
  problem: WholesaleBookProblem,
  serials: ReadonlyMap<string, string>,
): string | null {
  return "lockedBy" in problem
    ? (serials.get(String(problem.lockedBy.refId)) ?? null)
    : null;
}
