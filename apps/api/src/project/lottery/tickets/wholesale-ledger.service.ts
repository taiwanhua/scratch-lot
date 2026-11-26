import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import {
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  WHOLESALE_REF_TYPE,
} from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import {
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { ticketConflictError } from "./inventory-error";
import { TicketLedgerService } from "./ticket-ledger.service";
import type { TicketLockRef } from "./ticket-ledger.types";

/** 這張批售單的鎖(張被它鎖定 = 「批售中」)。 */
export function wholesaleLockOf(submissionId: Types.ObjectId): TicketLockRef {
  return { refType: WHOLESALE_REF_TYPE, refId: submissionId };
}

/** 一次出貨 / 取消的共同輸入(都在呼叫端的交易裡)。 */
export interface WholesaleWrite {
  session: ClientSession;
  /** 這個租戶的租戶邊界上下文(事後動作的系統身分看不到張所在的分店) */
  reader: OperatorContext;
  tenantId: Types.ObjectId;
  submissionId: Types.ObjectId;
  /** 事件的「誰」:出貨 = 做決定的人(`decidedBy`)、取消 = 作廢的人 */
  actorId: Types.ObjectId | null;
  at?: Date;
}

/** 批售單的一列(一整本)。 */
export interface WholesaleLedgerLine {
  bookId: Types.ObjectId;
  /** 這一列的批售金額 */
  amount: number;
  /** 這一列的張數(= 標準張數;待標註的跳號不算) */
  tickets: number;
}

/**
 * 批售的帳本寫入(專案規格 21.5;正本 `docs/modules/project/inventory.md`「批售」):出貨與取消批售。
 * 鎖定、解除沿用 `TicketLedgerService.lockTicketsInTenant` / `unlockTicketsInTenant` + `wholesaleLockOf`。
 * 一張單的張一次寫完(帳本整批寫,TX-06);待標註的跳號在張的層級照整本調貨:整本的張都寫,張數合計由共用函式扣。
 */
@Injectable()
export class WholesaleLedger {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly ledger: TicketLedgerService,
  ) {}

  /**
   * 出貨:這張單鎖住的張每張寫「批售」事件、改已批售,再解除鎖定。所在分店不變(出貨店之後仍看得到這本的歷史),
   * 位置維持庫存。鎖住的張和明細的本對不上、或狀態已變 → `CONFLICT`。
   */
  async ship(
    write: WholesaleWrite,
    lines: readonly WholesaleLedgerLine[],
  ): Promise<void> {
    const lock = wholesaleLockOf(write.submissionId);
    const locked = await this.tickets.findMany(
      write.reader,
      { "lockedBy.refType": lock.refType, "lockedBy.refId": lock.refId },
      { select: "bookId version", session: write.session },
    );
    const amountOf = new Map(
      lines.map((line) => [String(line.bookId), line.amount / line.tickets]),
    );
    const lockedBooks = new Set(locked.map((ticket) => String(ticket.bookId)));
    const mismatched = [
      ...[...lockedBooks].filter((bookId) => !amountOf.has(bookId)),
      ...[...amountOf.keys()].filter((bookId) => !lockedBooks.has(bookId)),
    ];
    if (mismatched.length > 0) {
      throw ticketConflictError(mismatched);
    }
    const at = write.at ?? new Date();
    await this.ledger.applyTicketEvents(
      write.session,
      {
        operator: null,
        crossStoreTenantId: write.tenantId,
        systemActorId: write.actorId,
      },
      locked.map((ticket) => ({
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        expectedStatuses: [TICKET_STATUS.unsold],
        allowLockedBy: lock,
        type: TICKET_EVENT_TYPE.wholesale,
        at,
        patch: { status: TICKET_STATUS.wholesaled },
        amount: amountOf.get(String(ticket.bookId)) ?? 0,
        refType: lock.refType,
        refId: lock.refId,
      })),
    );
    await this.ledger.unlockTicketsInTenant(
      write.session,
      write.tenantId,
      locked.map((ticket) => ticket._id),
      lock,
    );
  }

  /**
   * 取消批售(作廢批售單):這張單批售出去的張每張寫「取消批售」事件,回到出貨分店庫存的未售(單張成本不變;
   * 第一次拆本時間仍是空 = 還是未拆),`amount` 同原批售事件,帶作廢原因。已不是已批售 → `CONFLICT`。
   */
  async cancel(
    write: WholesaleWrite,
    reason: { reasonKey: string | null; reasonNote: string | null },
  ): Promise<void> {
    const shipped = await this.events.findMany(
      write.reader,
      {
        refType: WHOLESALE_REF_TYPE,
        refId: write.submissionId,
        type: TICKET_EVENT_TYPE.wholesale,
      },
      { select: "ticketId amount", session: write.session },
    );
    const amountOf = new Map(
      shipped.map((event) => [String(event.ticketId), event.amount]),
    );
    const tickets = await this.tickets.findMany(
      write.reader,
      { _id: { $in: shipped.map((event) => event.ticketId) } },
      { select: "version", session: write.session },
    );
    const at = write.at ?? new Date();
    await this.ledger.applyTicketEvents(
      write.session,
      {
        operator: null,
        crossStoreTenantId: write.tenantId,
        systemActorId: write.actorId,
      },
      tickets.map((ticket) => ({
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        expectedStatuses: [TICKET_STATUS.wholesaled],
        type: TICKET_EVENT_TYPE.wholesaleVoid,
        at,
        patch: {
          status: TICKET_STATUS.unsold,
          location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
        },
        amount: amountOf.get(String(ticket._id)) ?? 0,
        refType: WHOLESALE_REF_TYPE,
        refId: write.submissionId,
        ...reason,
      })),
    );
  }
}
