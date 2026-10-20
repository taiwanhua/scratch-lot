import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import { TICKET_STATUS, ticketEventIdOf } from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { systemTenantReader } from "../../../database/system-tenant-reader";
import {
  LotteryBooksRepository,
  type LotteryTicketDocument,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import type { TicketStateSnapshot } from "../../database/lottery-inventory/lottery-ticket-event.schema";
import { ticketConflictError, validationError } from "./inventory-error";
import type {
  TicketEventInput,
  TicketEventResult,
  TicketLockInput,
  TicketLockRef,
  TicketStatePatch,
} from "./ticket-ledger.types";

type TicketRecord = Persisted<LotteryTicketDocument>;

function sameId(
  left: Types.ObjectId | null | undefined,
  right: Types.ObjectId | null | undefined,
): boolean {
  return (left ?? null) === null
    ? (right ?? null) === null
    : (right ?? null) !== null && String(left) === String(right);
}

function sameLock(
  lock: TicketLockRef | null | undefined,
  other: TicketLockRef | null | undefined,
): boolean {
  if (!lock || !other) {
    return !lock && !other;
  }
  return lock.refType === other.refType && sameId(lock.refId, other.refId);
}

export function snapshotOf(ticket: {
  status: TicketStateSnapshot["status"];
  location: {
    kind: TicketStateSnapshot["locationKind"];
    cashPointId: Types.ObjectId | null;
  };
  storeOrgId: Types.ObjectId;
}): TicketStateSnapshot {
  return {
    status: ticket.status,
    locationKind: ticket.location.kind,
    cashPointId: ticket.location.cashPointId ?? null,
    storeOrgId: ticket.storeOrgId,
  };
}

/** patch → `$set`(只放有給的欄位)。 */
function setOf(patch: TicketStatePatch): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    set.status = patch.status;
  }
  if (patch.location !== undefined) {
    set.location = {
      kind: patch.location.kind,
      cashPointId: patch.location.cashPointId ?? null,
    };
  }
  if (patch.storeOrgId !== undefined) {
    set.storeOrgId = patch.storeOrgId;
  }
  if (patch.responsibleOrgId !== undefined) {
    set.responsibleOrgId = patch.responsibleOrgId;
  }
  if (patch.unitCost !== undefined) {
    set.unitCost = patch.unitCost;
  }
  if (patch.sold !== undefined) {
    set.soldAt = patch.sold?.at ?? null;
    set.soldBy = patch.sold?.by ?? null;
    set.soldSource = patch.sold?.source ?? null;
  }
  return set;
}

/** 「被鎖定的張不能動,除非是同一個鎖」的條件。 */
function lockConditionOf(
  allowLockedBy: TicketLockRef | undefined,
): Record<string, unknown> {
  if (allowLockedBy === undefined) {
    return { lockedBy: null };
  }
  return {
    $or: [
      { lockedBy: null },
      {
        "lockedBy.refType": allowLockedBy.refType,
        "lockedBy.refId": allowLockedBy.refId,
      },
    ],
  };
}

/** 重送判斷:同一個事件 id 已寫過,而且是同一件事(類型、誰、來源單據、班、收銀點、金額都一樣)。 */
function isSameEvent(
  existing: {
    type: string;
    by: Types.ObjectId | null;
    refType: string | null;
    refId: Types.ObjectId | null;
    shiftId: Types.ObjectId | null;
    cashPointId: Types.ObjectId | null;
    amount: number;
  },
  input: TicketEventInput,
): boolean {
  return (
    existing.type === input.type &&
    sameId(existing.by, input.by) &&
    (existing.refType ?? null) === (input.refType ?? null) &&
    sameId(existing.refId, input.refId) &&
    sameId(existing.shiftId, input.shiftId) &&
    sameId(existing.cashPointId, input.cashPointId) &&
    existing.amount === (input.amount ?? 0)
  );
}

/**
 * **張數帳本(唯一入口)**(專案規格 7.1、7.2、第 17 章共通原則;正本 `docs/modules/project/inventory.md`
 * 「資料與帳本」)。張的目前狀態與張數事件**只經這裡寫**,而且在呼叫端給的同一個交易裡:
 *
 * - 每張以「`version`(+ 狀態)」條件更新,`version` +1;不符 → `CONFLICT`(「已被處理」),整個交易回復
 * - 事件 id = `<ticketId>:<變動後的版本>`,重送(同 id、同內容)不重複寫入、回 `applied: false`
 * - 鎖定的張只有同一個鎖能動;鎖定 / 解除用 `lockTickets` / `unlockTickets`
 * - 張換分店後重算本的持有分店(讀取放行)與所在分店(所有可用的張都在同一家店 = 整本調貨)
 *
 * 權限與業務規則(誰能賣、能不能撤銷)由呼叫端判斷;這裡以租戶系統身分(`systemTenantReader`)
 * 讀寫,範圍釘在事件給的租戶。呼叫端一律先 `TransactionService.withTransaction`,把 session 傳進來。
 */
@Injectable()
export class TicketLedgerService {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  async applyTicketEvents(
    session: ClientSession,
    events: readonly TicketEventInput[],
  ): Promise<TicketEventResult[]> {
    const [first] = events;
    if (first === undefined) {
      return [];
    }
    const tenantId = first.tenantId;
    if (events.some((event) => !sameId(event.tenantId, tenantId))) {
      throw new Error("applyTicketEvents:同一批事件必須屬於同一個租戶");
    }
    const ledger = await this.ledgerContext(tenantId);
    const movedBooks = new Map<string, Types.ObjectId>();
    const results: TicketEventResult[] = [];
    // 交易內依序 await(TX-02:不平行讀寫)
    for (const input of events) {
      const result = await this.applyOne(ledger, session, input, movedBooks);
      results.push(result);
    }
    for (const bookId of movedBooks.values()) {
      await this.refreshBookHolders(ledger, session, bookId);
    }
    return results;
  }

  /** 鎖定(調貨單 / 撤銷售出申請):已是同一個鎖 → 不動;被別的鎖住或版本變了 → `CONFLICT`。 */
  async lockTickets(
    session: ClientSession,
    ticketIds: readonly Types.ObjectId[],
    lock: TicketLockInput,
  ): Promise<void> {
    await this.changeLock(session, ticketIds, lock, "lock");
  }

  /** 解除鎖定:已沒有鎖 → 不動;被別的鎖住 → `CONFLICT`。 */
  async unlockTickets(
    session: ClientSession,
    ticketIds: readonly Types.ObjectId[],
    lock: TicketLockInput,
  ): Promise<void> {
    await this.changeLock(session, ticketIds, lock, "unlock");
  }

  /** 帳本的讀寫身分:這個租戶的系統身分(讀組織時自動用目前交易的 session,TX-02)。 */
  private ledgerContext(tenantId: Types.ObjectId): Promise<OperatorContext> {
    return systemTenantReader(this.orgs, tenantId);
  }

  private async applyOne(
    ledger: OperatorContext,
    session: ClientSession,
    input: TicketEventInput,
    movedBooks: Map<string, Types.ObjectId>,
  ): Promise<TicketEventResult> {
    const amount = input.amount ?? 0;
    if (!Number.isFinite(amount) || amount < 0) {
      throw validationError("金額一律是正數", ["amount"]);
    }
    const ticketId = String(input.ticketId);
    const version = input.expectedVersion + 1;
    const eventId = ticketEventIdOf(ticketId, version);
    const existing = await this.events.findOne(
      ledger,
      { eventId },
      { session },
    );
    if (existing) {
      if (isSameEvent(existing, input)) {
        return { ticketId, eventId, version, applied: false };
      }
      throw ticketConflictError([ticketId]);
    }
    const before = await this.tickets.findOne(
      ledger,
      { _id: input.ticketId },
      { session },
    );
    if (before?.version !== input.expectedVersion) {
      throw ticketConflictError([ticketId]);
    }
    const after = await this.tickets.findOneAndUpdate(
      ledger,
      {
        $and: [
          {
            _id: input.ticketId,
            version: input.expectedVersion,
            ...(input.expectedStatuses === undefined
              ? {}
              : { status: { $in: [...input.expectedStatuses] } }),
          },
          lockConditionOf(input.allowLockedBy),
        ],
      },
      { $set: setOf(input.patch), $inc: { version: 1 } },
      { session },
    );
    if (!after) {
      throw ticketConflictError([ticketId]);
    }
    await this.events.create(
      ledger,
      {
        orgId: after.storeOrgId,
        eventId,
        ticketId: after._id,
        bookId: after.bookId,
        gameId: after.gameId,
        at: input.at ?? new Date(),
        by: input.by,
        type: input.type,
        from: snapshotOf(before),
        to: snapshotOf(after),
        quantity: 1,
        amount,
        cashEffect: input.cashEffect ?? "none",
        cashPointId: input.cashPointId ?? null,
        shiftId: input.shiftId ?? null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        reasonKey: input.reasonKey ?? null,
        reasonNote: input.reasonNote ?? null,
      },
      { session },
    );
    // 持有分店只在換分店、或跳號進出時會變(一般售出不必重算)
    if (
      !sameId(before.storeOrgId, after.storeOrgId) ||
      (before.status !== after.status &&
        (before.status === TICKET_STATUS.skipped ||
          after.status === TICKET_STATUS.skipped))
    ) {
      movedBooks.set(String(after.bookId), after.bookId);
    }
    return { ticketId, eventId, version: after.version, applied: true };
  }

  /** 重算本的持有分店;所有可用(非跳號)的張都在同一家店 → 所在分店跟著改(整本調貨)。 */
  private async refreshBookHolders(
    ledger: OperatorContext,
    session: ClientSession,
    bookId: Types.ObjectId,
  ): Promise<void> {
    const tickets = await this.tickets.findMany(
      ledger,
      { bookId, status: { $ne: TICKET_STATUS.skipped } },
      { select: "storeOrgId", session },
    );
    const holders = new Map<string, Types.ObjectId>();
    for (const ticket of tickets) {
      holders.set(String(ticket.storeOrgId), ticket.storeOrgId);
    }
    const holderOrgIds = [...holders.values()];
    const [onlyHolder] = holderOrgIds;
    await this.books.updateById(
      ledger,
      bookId,
      {
        $set: {
          holderOrgIds,
          ...(holderOrgIds.length === 1 && onlyHolder !== undefined
            ? { storeOrgId: onlyHolder }
            : {}),
        },
      },
      { session },
    );
  }

  private async changeLock(
    session: ClientSession,
    ticketIds: readonly Types.ObjectId[],
    lock: TicketLockInput,
    action: "lock" | "unlock",
  ): Promise<void> {
    if (ticketIds.length === 0) {
      return;
    }
    const ledger = await this.ledgerContext(lock.tenantId);
    const ref: TicketLockRef = { refType: lock.refType, refId: lock.refId };
    const bookDeltas = new Map<
      string,
      { bookId: Types.ObjectId; delta: number }
    >();
    for (const ticketId of ticketIds) {
      const bookId = await this.changeOneLock(
        ledger,
        session,
        ticketId,
        action === "lock" ? null : ref,
        action === "lock" ? ref : null,
      );
      if (bookId === null) {
        continue;
      }
      const key = String(bookId);
      const entry = bookDeltas.get(key) ?? { bookId, delta: 0 };
      entry.delta += action === "lock" ? 1 : -1;
      bookDeltas.set(key, entry);
    }
    for (const { bookId, delta } of bookDeltas.values()) {
      await this.books.updateById(
        ledger,
        bookId,
        { $inc: { lockedTicketCount: delta } },
        { session },
      );
    }
  }

  /**
   * 一張的鎖從 `from` 改成 `target`(null = 沒有鎖);已是 `target` → 不動、回 null(重送)。
   * 鎖定只能從「沒有鎖」開始、解除只能解自己的鎖;不符或版本變了 → `CONFLICT`。回這張的本 id。
   */
  private async changeOneLock(
    ledger: OperatorContext,
    session: ClientSession,
    ticketId: Types.ObjectId,
    from: TicketLockRef | null,
    target: TicketLockRef | null,
  ): Promise<Types.ObjectId | null> {
    const ticket: TicketRecord | null = await this.tickets.findOne(
      ledger,
      { _id: ticketId },
      { session },
    );
    if (!ticket) {
      throw ticketConflictError([String(ticketId)]);
    }
    if (sameLock(ticket.lockedBy, target)) {
      return null;
    }
    if (!sameLock(ticket.lockedBy, from)) {
      throw ticketConflictError([String(ticketId)]);
    }
    const updated = await this.tickets.findOneAndUpdate(
      ledger,
      { _id: ticketId, version: ticket.version },
      { $set: { lockedBy: target }, $inc: { version: 1 } },
      { session },
    );
    if (!updated) {
      throw ticketConflictError([String(ticketId)]);
    }
    return ticket.bookId;
  }
}
