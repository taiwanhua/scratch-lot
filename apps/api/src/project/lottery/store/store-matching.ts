import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import {
  type CountMode,
  type CountPickBook,
  type CountPlace,
  type MatchTicket,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_MATCH_REF_TYPE,
  TICKET_STATUS,
  matchPartnerOf,
} from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import type { OperatorContext } from "../../../database/operator-context";
import {
  LotteryBooksRepository,
  type LotteryTicketDocument,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { StoreCountModeService } from "../settings/store-count-mode.service";
import type {
  TicketEventInput,
  TicketStatePatch,
} from "../tickets/ticket-ledger.types";

type TicketRecord = Persisted<LotteryTicketDocument>;

/** 一張要找配對張的刷到的張與要找的位置(依序;張數店規格 6.3)。 */
export interface MatchRequest {
  ticket: TicketRecord;
  places: readonly CountPlace[];
}

/** 這張現在的「狀態 + 位置」(對號時整組換到另一張;售出資訊與帶著的售出事件跟著狀態走,規格 6.1)。 */
function stateOf(ticket: TicketRecord): TicketStatePatch {
  return {
    status: ticket.status,
    location: {
      kind: ticket.location.kind,
      cashPointId: ticket.location.cashPointId ?? null,
    },
    responsibleOrgId: ticket.responsibleOrgId ?? null,
    sold:
      ticket.soldAt == null
        ? null
        : {
            at: ticket.soldAt,
            source: ticket.soldSource ?? "count",
            by: ticket.soldBy ?? null,
          },
    saleEventId: ticket.saleEventId ?? null,
  };
}

/**
 * 對號的兩筆 `match` 事件(張數店規格 5.2、6.1):刷到的張接手配對張的「狀態 + 位置」、清掉未對號;配對張接手刷到的張的
 * 「狀態 + 位置」與未對號記號(未售沒有未對號)。兩筆 `cashEffect: none`、金額 0、`refType: ticket_match`、
 * `refId` = 另一張;成本快照由帳本各記自己的。刷到的張寫完後版本 +1(後續動作的 `expectedVersion`)。
 */
export function matchEventsOf(
  scanned: TicketRecord,
  partner: TicketRecord,
  at: Date,
): TicketEventInput[] {
  const common = {
    type: TICKET_EVENT_TYPE.match,
    at,
    amount: 0,
    cashEffect: "none" as const,
    refType: TICKET_MATCH_REF_TYPE,
  };
  return [
    {
      ...common,
      ticketId: scanned._id,
      expectedVersion: scanned.version,
      expectedStatuses: [scanned.status],
      refId: partner._id,
      patch: { ...stateOf(partner), unmatched: false },
    },
    {
      ...common,
      ticketId: partner._id,
      expectedVersion: partner.version,
      expectedStatuses: [partner.status],
      refId: scanned._id,
      patch: {
        ...stateOf(scanned),
        unmatched: scanned.unmatched && scanned.status !== TICKET_STATUS.unsold,
      },
    },
  ];
}

/**
 * 讀到的張複製一份來改(Mongoose 文件的欄位是 getter,直接展開會漏掉;改成純物件再改)。
 */
export function ticketCopyOf(
  ticket: TicketRecord,
  patch: Partial<TicketRecord> = {},
): TicketRecord {
  const plain: TicketRecord =
    typeof (ticket as { toObject?: unknown }).toObject === "function"
      ? (ticket as unknown as { toObject: () => TicketRecord }).toObject()
      : ticket;
  return Object.assign({}, plain, patch);
}

/** 對號後刷到的張的樣子(後續流程再判斷一次、照原本的流程寫事件)。 */
export function afterMatchOf(
  scanned: TicketRecord,
  partner: TicketRecord,
): TicketRecord {
  return ticketCopyOf(scanned, {
    status: partner.status,
    location: partner.location,
    responsibleOrgId: partner.responsibleOrgId,
    soldAt: partner.soldAt,
    soldBy: partner.soldBy,
    soldSource: partner.soldSource,
    saleEventId: partner.saleEventId,
    unmatched: false,
    version: scanned.version + 1,
  });
}

/**
 * 對號(張數店規格第 6 節)的讀取:這家店實際的盤點制度、配對張。配對張由伺服器在交易裡挑(6.2「不信用前端」):
 * 同遊戲、未售、沒被鎖、不在途、本已拆過,依 6.3 的位置順序照挑張順序取第一張(`matchPartnerOf`)。
 * 一批刷到的張一次讀候選、一次讀本(TX-06),同一批不會挑到同一張配對張;兩台同時搶到同一張時,
 * MongoDB 寫入衝突讓後到的交易整個重跑、重新挑。
 */
@Injectable()
export class StoreMatching {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly countModes: StoreCountModeService,
  ) {}

  /** 這家店實際的盤點制度(沒有筆 = 編號店)。 */
  modeOf(operator: OperatorContext, orgId: Types.ObjectId): Promise<CountMode> {
    return this.countModes.modeOf(operator, orgId);
  }

  /** 每張刷到的張的配對張(找不到 = 不在 map 裡)。 */
  async partnersOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    requests: readonly MatchRequest[],
    session?: ClientSession,
  ): Promise<Map<string, TicketRecord>> {
    const partners = new Map<string, TicketRecord>();
    const wanted = requests.filter((request) => request.places.length > 0);
    if (wanted.length === 0) {
      return partners;
    }
    const places = wanted.flatMap((request) => request.places);
    const pointIds = [
      ...new Map(
        places.flatMap((place) =>
          place.locationKind === TICKET_LOCATION_KIND.counter &&
          place.cashPointId !== null
            ? [[place.cashPointId, place.cashPointId] as const]
            : [],
        ),
      ).values(),
    ];
    const withStock = places.some(
      (place) => place.locationKind === TICKET_LOCATION_KIND.stock,
    );
    const where = [
      ...(pointIds.length === 0
        ? []
        : [
            {
              "location.kind": TICKET_LOCATION_KIND.counter,
              "location.cashPointId": { $in: pointIds },
            },
          ]),
      ...(withStock ? [{ "location.kind": TICKET_LOCATION_KIND.stock }] : []),
    ];
    const gameIds = [
      ...new Map(
        wanted.map((request) => [
          String(request.ticket.gameId),
          request.ticket.gameId,
        ]),
      ).values(),
    ];
    const found = await this.tickets.findMany(
      operator,
      {
        orgId,
        gameId: { $in: gameIds },
        status: TICKET_STATUS.unsold,
        lockedBy: null,
        $or: where,
      },
      session === undefined ? {} : { session },
    );
    const bookRows = await this.books.findMany(
      operator,
      { _id: { $in: [...new Set(found.map((ticket) => ticket.bookId))] } },
      {
        select: "bookNo firstOpenedAt",
        ...(session === undefined ? {} : { session }),
      },
    );
    const books = new Map<string, CountPickBook>(
      bookRows.map((book) => [
        String(book._id),
        { bookNo: book.bookNo, firstOpenedAt: book.firstOpenedAt ?? null },
      ]),
    );
    const byId = new Map(found.map((ticket) => [String(ticket._id), ticket]));
    // 刷到的張自己不能當別張的配對;挑過的不再挑
    const used = new Set(requests.map((request) => String(request.ticket._id)));
    for (const request of wanted) {
      const candidates: MatchTicket[] = found
        .filter((ticket) => !used.has(String(ticket._id)))
        .map((ticket) => ({
          id: String(ticket._id),
          bookId: String(ticket.bookId),
          ticketNo: ticket.ticketNo,
          status: ticket.status,
          locked: ticket.lockedBy !== null,
          gameId: String(ticket.gameId),
          locationKind: ticket.location.kind,
          cashPointId:
            ticket.location.cashPointId == null
              ? null
              : String(ticket.location.cashPointId),
        }));
      const id = matchPartnerOf(
        {
          id: String(request.ticket._id),
          gameId: String(request.ticket.gameId),
        },
        candidates,
        books,
        request.places,
      );
      const partner = id === null ? undefined : byId.get(id);
      if (partner !== undefined) {
        used.add(id ?? "");
        partners.set(String(request.ticket._id), partner);
      }
    }
    return partners;
  }
}
