import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import { TICKET_STATUS, ticketEventIdOf } from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import {
  LotteryBooksRepository,
  type LotteryTicketDocument,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import type { TicketStateSnapshot } from "../../database/lottery-inventory/lottery-ticket-event.schema";
import {
  crossStoreForbiddenError,
  ticketConflictError,
  validationError,
} from "./inventory-error";
import type {
  LedgerContext,
  TicketEventInput,
  TicketEventResult,
  TicketLockRef,
  TicketStatePatch,
  TicketVersion,
} from "./ticket-ledger.types";

type TicketRecord = Persisted<LotteryTicketDocument>;

type MovedBooks = Map<
  string,
  { bookId: Types.ObjectId; tenantId: Types.ObjectId | null }
>;

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
  orgId: Types.ObjectId;
}): TicketStateSnapshot {
  return {
    status: ticket.status,
    locationKind: ticket.location.kind,
    cashPointId: ticket.location.cashPointId ?? null,
    orgId: ticket.orgId,
  };
}

/** patch → `$set`(只放有給的欄位;換店另走搬家入口)。 */
function setOf(
  patch: TicketStatePatch,
  by: Types.ObjectId | null,
): Record<string, unknown> {
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
  if (patch.responsibleOrgId !== undefined) {
    set.responsibleOrgId = patch.responsibleOrgId;
  }
  if (patch.unitCost !== undefined) {
    set.unitCost = patch.unitCost;
  }
  if (patch.sold !== undefined) {
    set.soldAt = patch.sold?.at ?? null;
    set.soldBy = patch.sold ? by : null;
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
  by: Types.ObjectId | null,
): boolean {
  return (
    existing.type === input.type &&
    sameId(existing.by, by) &&
    (existing.refType ?? null) === (input.refType ?? null) &&
    sameId(existing.refId, input.refId) &&
    sameId(existing.shiftId, input.shiftId) &&
    sameId(existing.cashPointId, input.cashPointId) &&
    existing.amount === (input.amount ?? 0)
  );
}

/** 目標組織在操作者的可見範圍內。 */
function isVisibleTo(
  operator: OperatorContext,
  orgId: Types.ObjectId,
): boolean {
  return (
    operator.visibleOrgIds === "all" ||
    operator.visibleOrgIds.some((id) => id.equals(orgId))
  );
}

/**
 * 跨店寫入(`crossStoreTenantId` + 有操作者)只能「把張移進自己看得到的店」:每一筆都要換店
 * (`patch.orgId`),而且目標在操作者的可見範圍內(調入、尋回到刷到的那家店)。跨店把別店的張賣掉、
 * 報廢、移走 → `FORBIDDEN`。沒有操作者的系統寫入不在此限。
 */
function assertCrossStoreMovesIn(
  ledger: LedgerContext,
  events: readonly TicketEventInput[],
): void {
  const operator = ledger.operator;
  if (ledger.crossStoreTenantId === undefined || operator === null) {
    return;
  }
  const outside = events.filter(
    (event) =>
      event.patch.orgId === undefined ||
      !isVisibleTo(operator, event.patch.orgId),
  );
  if (outside.length > 0) {
    throw crossStoreForbiddenError(
      outside.map((event) => String(event.ticketId)),
    );
  }
}

/** 解析好的帳本身分:讀寫用的上下文、操作者、「誰」。 */
interface ResolvedLedger {
  context: OperatorContext;
  operator: OperatorContext | null;
  by: Types.ObjectId | null;
}

/**
 * **張數帳本(唯一入口)**(專案規格 7.1、7.2、第 17 章共通原則;正本 `docs/modules/project/inventory.md`
 * 「資料與帳本」)。張的目前狀態與張數事件**只經這裡寫**,而且在呼叫端給的同一個交易裡:
 *
 * - 每張以「`version`(+ 狀態)」條件更新,`version` +1;不符 → `CONFLICT`(「已被處理」),整個交易回復
 * - 事件 id = `<ticketId>:<變動後的版本>`,重送(同 id、同內容)不重複寫入、回 `applied: false`
 * - 鎖定的張只有同一個鎖能動;鎖定 / 解除用 `lockTickets` / `unlockTickets`(用掉一個版本、不寫事件)
 * - 換店走底座的搬家入口 `reassignOrg`;張換店後以租戶邊界上下文重算本的持有分店與所在分店
 *
 * 讀寫範圍見 `LedgerContext`:預設照操作者自己的範圍;跨店的例外寫入才用租戶邊界上下文。
 * 權限與業務規則(誰能賣、能不能撤銷)由呼叫端判斷。呼叫端一律先 `TransactionService.withTransaction`。
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
    ledger: LedgerContext,
    events: readonly TicketEventInput[],
  ): Promise<TicketEventResult[]> {
    if (events.length === 0) {
      return [];
    }
    assertCrossStoreMovesIn(ledger, events);
    const resolved = await this.resolve(ledger);
    const movedBooks: MovedBooks = new Map();
    const results: TicketEventResult[] = [];
    // 交易內依序 await(TX-02:不平行讀寫)
    for (const input of events) {
      const result = await this.applyOne(resolved, session, input, movedBooks);
      results.push(result);
    }
    for (const { bookId, tenantId } of movedBooks.values()) {
      await this.refreshBookHolders(resolved, session, bookId, tenantId);
    }
    return results;
  }

  /**
   * 鎖定(調貨單 / 撤銷售出申請):已是同一個鎖 → 不動;被別的鎖住或版本變了 → `CONFLICT`。
   * 鎖定用掉一個版本(`version` +1)、不寫事件;回每張鎖定後的版本。只照操作者自己的範圍(不接受跨店)。
   */
  async lockTickets(
    session: ClientSession,
    operator: OperatorContext,
    ticketIds: readonly Types.ObjectId[],
    lock: TicketLockRef,
  ): Promise<TicketVersion[]> {
    return this.changeLock(session, operator, ticketIds, null, lock);
  }

  /** 解除自己的鎖:已沒有鎖 → 不動;被別的鎖住 → `CONFLICT`。同樣用掉一個版本、不寫事件。 */
  async unlockTickets(
    session: ClientSession,
    operator: OperatorContext,
    ticketIds: readonly Types.ObjectId[],
    lock: TicketLockRef,
  ): Promise<TicketVersion[]> {
    return this.changeLock(session, operator, ticketIds, lock, null);
  }

  private async resolve(ledger: LedgerContext): Promise<ResolvedLedger> {
    const by = ledger.operator?.actorId ?? null;
    if (ledger.crossStoreTenantId !== undefined) {
      return {
        context: await tenantBoundaryContext(
          this.orgs,
          ledger.operator,
          ledger.crossStoreTenantId,
        ),
        operator: ledger.operator,
        by,
      };
    }
    if (ledger.operator === null) {
      throw new Error("帳本:沒有操作者的系統寫入要給 crossStoreTenantId");
    }
    return { context: ledger.operator, operator: ledger.operator, by };
  }

  private async applyOne(
    ledger: ResolvedLedger,
    session: ClientSession,
    input: TicketEventInput,
    movedBooks: MovedBooks,
  ): Promise<TicketEventResult> {
    const amount = input.amount ?? 0;
    if (!Number.isFinite(amount) || amount < 0) {
      throw validationError("金額一律是正數", ["amount"]);
    }
    const ticketId = String(input.ticketId);
    const version = input.expectedVersion + 1;
    const eventId = ticketEventIdOf(ticketId, version);
    const existing = await this.events.findOne(
      ledger.context,
      { eventId },
      { session },
    );
    if (existing) {
      if (isSameEvent(existing, input, ledger.by)) {
        return { ticketId, eventId, version, applied: false };
      }
      throw ticketConflictError([ticketId]);
    }
    const before = await this.tickets.findOne(
      ledger.context,
      { _id: input.ticketId },
      { session },
    );
    if (before?.version !== input.expectedVersion) {
      throw ticketConflictError([ticketId]);
    }
    const after = await this.updateTicket(ledger, session, before, input);
    if (!after) {
      throw ticketConflictError([ticketId]);
    }
    await this.events.create(
      ledger.context,
      {
        orgId: after.orgId,
        eventId,
        ticketId: after._id,
        bookId: after.bookId,
        gameId: after.gameId,
        at: input.at ?? new Date(),
        by: ledger.by,
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
      !sameId(before.orgId, after.orgId) ||
      (before.status !== after.status &&
        (before.status === TICKET_STATUS.skipped ||
          after.status === TICKET_STATUS.skipped))
    ) {
      movedBooks.set(String(after.bookId), {
        bookId: after.bookId,
        tenantId: after.tenantId,
      });
    }
    return { ticketId, eventId, version: after.version, applied: true };
  }

  /** 條件更新一張;要換店時走搬家入口(同一次寫入順便改狀態與版本)。 */
  private async updateTicket(
    ledger: ResolvedLedger,
    session: ClientSession,
    before: TicketRecord,
    input: TicketEventInput,
  ): Promise<TicketRecord | null> {
    const filter = {
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
    };
    const update = {
      $set: setOf(input.patch, ledger.by),
      $inc: { version: 1 },
    };
    const target = input.patch.orgId;
    if (target === undefined || sameId(target, before.orgId)) {
      return this.tickets.findOneAndUpdate(ledger.context, filter, update, {
        session,
      });
    }
    if (ledger.operator === null) {
      throw new Error("帳本:換店要寫搬家稽核,需要操作者");
    }
    return this.tickets.reassignOrg(ledger.context, filter, target, {
      update,
      session,
    });
  }

  /**
   * 重算本的持有分店;所有可用(非跳號)的張都在同一家店 → 本搬到那家店(整本調貨)。
   * 要看整本的張(不只操作者看得到的),所以以這本所在租戶的邊界上下文讀寫(仍記得操作者)。
   */
  private async refreshBookHolders(
    ledger: ResolvedLedger,
    session: ClientSession,
    bookId: Types.ObjectId,
    tenantId: Types.ObjectId | null,
  ): Promise<void> {
    const whole = await tenantBoundaryContext(
      this.orgs,
      ledger.operator,
      tenantId,
    );
    const tickets = await this.tickets.findMany(
      whole,
      { bookId, status: { $ne: TICKET_STATUS.skipped } },
      { select: "orgId", session },
    );
    const holders = new Map<string, Types.ObjectId>();
    for (const ticket of tickets) {
      holders.set(String(ticket.orgId), ticket.orgId);
    }
    const holderOrgIds = [...holders.values()];
    await this.books.updateById(
      whole,
      bookId,
      { $set: { holderOrgIds } },
      { session },
    );
    const [onlyHolder] = holderOrgIds;
    if (
      holderOrgIds.length === 1 &&
      onlyHolder !== undefined &&
      ledger.operator !== null
    ) {
      // 已在那家店時搬家入口不寫入(冪等)
      await this.books.reassignOrg(whole, { _id: bookId }, onlyHolder, {
        session,
      });
    }
  }

  private async changeLock(
    session: ClientSession,
    operator: OperatorContext,
    ticketIds: readonly Types.ObjectId[],
    from: TicketLockRef | null,
    to: TicketLockRef | null,
  ): Promise<TicketVersion[]> {
    if (ticketIds.length === 0) {
      return [];
    }
    // 鎖定只照操作者自己的範圍(不接受跨店):只能鎖自己看得到的張
    const resolved = await this.resolve({ operator });
    const bookDeltas = new Map<
      string,
      { bookId: Types.ObjectId; delta: number }
    >();
    const versions: TicketVersion[] = [];
    for (const ticketId of ticketIds) {
      const changed = await this.changeOneLock(
        resolved.context,
        session,
        ticketId,
        from,
        to,
      );
      versions.push({
        ticketId: String(ticketId),
        version: changed.version,
        changed: changed.bookId !== null,
      });
      if (changed.bookId === null) {
        continue;
      }
      const key = String(changed.bookId);
      const entry = bookDeltas.get(key) ?? { bookId: changed.bookId, delta: 0 };
      entry.delta += to === null ? -1 : 1;
      bookDeltas.set(key, entry);
    }
    for (const { bookId, delta } of bookDeltas.values()) {
      await this.books.updateById(
        resolved.context,
        bookId,
        { $inc: { lockedTicketCount: delta } },
        { session },
      );
    }
    return versions;
  }

  /**
   * 一張的鎖從 `from` 改成 `to`(null = 沒有鎖);已是 `to` → 不動(重送,`bookId: null`)。
   * 鎖定只能從「沒有鎖」開始、解除只能解自己的鎖;不符或版本變了 → `CONFLICT`。
   */
  private async changeOneLock(
    context: OperatorContext,
    session: ClientSession,
    ticketId: Types.ObjectId,
    from: TicketLockRef | null,
    to: TicketLockRef | null,
  ): Promise<{ bookId: Types.ObjectId | null; version: number }> {
    const ticket = await this.tickets.findOne(
      context,
      { _id: ticketId },
      { session },
    );
    if (!ticket) {
      throw ticketConflictError([String(ticketId)]);
    }
    if (sameLock(ticket.lockedBy, to)) {
      return { bookId: null, version: ticket.version };
    }
    if (!sameLock(ticket.lockedBy, from)) {
      throw ticketConflictError([String(ticketId)]);
    }
    const updated = await this.tickets.findOneAndUpdate(
      context,
      { _id: ticketId, version: ticket.version },
      { $set: { lockedBy: to }, $inc: { version: 1 } },
      { session },
    );
    if (!updated) {
      throw ticketConflictError([String(ticketId)]);
    }
    return { bookId: ticket.bookId, version: updated.version };
  }
}
