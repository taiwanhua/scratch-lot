import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import {
  TICKET_STATUS,
  type TicketStatus,
  ticketEventIdOf,
} from "@repo/domain/project/lottery";

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
  bookConflictError,
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

/** 一筆輸入:在輸入裡的位置、事件 id。 */
interface PlannedEvent {
  index: number;
  input: TicketEventInput;
  eventId: string;
}

/** 一筆要寫的事件(這一輪裡這張只出現一次)。 */
interface PlannedWrite extends PlannedEvent {
  before: TicketRecord;
  version: number;
}

/** 已寫過(或這一批前面剛寫)的事件:重送判斷要的欄位。 */
type KnownEvent = Parameters<typeof isSameEvent>[0];

/** 一筆寫完的事件(`from` = 寫之前、`to` = 寫之後)。 */
function eventOf(
  by: Types.ObjectId | null,
  write: PlannedWrite,
  after: TicketRecord,
) {
  const { input } = write;
  return {
    orgId: after.orgId,
    eventId: write.eventId,
    ticketId: after._id,
    bookId: after.bookId,
    gameId: after.gameId,
    at: input.at ?? new Date(),
    by,
    type: input.type,
    from: snapshotOf(write.before),
    to: snapshotOf(after),
    quantity: 1,
    amount: input.amount ?? 0,
    cost: input.cost ?? null,
    cashEffect: input.cashEffect ?? "none",
    cashPointId: input.cashPointId ?? null,
    shiftId: input.shiftId ?? null,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    reasonKey: input.reasonKey ?? null,
    reasonNote: input.reasonNote ?? null,
    postCloseOf: input.postCloseOf ?? null,
  };
}

/** 一批事件寫到一半的狀態:已知事件、每張目前的樣子、結果、要新增的事件、要重算的本。 */
interface LedgerBatch {
  known: Map<string, KnownEvent>;
  current: Map<string, TicketRecord>;
  results: TicketEventResult[];
  created: ReturnType<typeof eventOf>[];
  movedBooks: MovedBooks;
}

function uniqueIdsOf(ids: readonly Types.ObjectId[]): Types.ObjectId[] {
  return [...new Map(ids.map((id) => [String(id), id])).values()];
}

function assertAmounts(events: readonly TicketEventInput[]): void {
  for (const input of events) {
    const amount = input.amount ?? 0;
    if (!Number.isFinite(amount) || amount < 0) {
      throw validationError("金額一律是正數", ["amount"]);
    }
  }
}

/** 把事件依「同一張的第幾筆」分輪:每一輪每張最多一筆,同一張的事件照輸入順序落在後面的輪。 */
function stagesOf(events: readonly TicketEventInput[]): PlannedEvent[][] {
  const seen = new Map<string, number>();
  const stages: PlannedEvent[][] = [];
  for (const [index, input] of events.entries()) {
    const key = String(input.ticketId);
    const round = seen.get(key) ?? 0;
    seen.set(key, round + 1);
    const stage = stages[round] ?? [];
    stage.push({
      index,
      input,
      eventId: ticketEventIdOf(key, input.expectedVersion + 1),
    });
    stages[round] = stage;
  }
  return stages;
}

/**
 * 這一輪要寫的張:事件 id 已寫過而且是同一件事 → 重送(記結果、不寫);寫過別的內容、或版本不是讀到的 →
 * `CONFLICT`。
 */
function planStage(
  by: Types.ObjectId | null,
  batch: LedgerBatch,
  stage: readonly PlannedEvent[],
): PlannedWrite[] {
  const writes: PlannedWrite[] = [];
  for (const planned of stage) {
    const { index, input, eventId } = planned;
    const ticketId = String(input.ticketId);
    const version = input.expectedVersion + 1;
    const existing = batch.known.get(eventId);
    if (existing !== undefined) {
      if (!isSameEvent(existing, input, by)) {
        throw ticketConflictError([ticketId]);
      }
      batch.results[index] = { ticketId, eventId, version, applied: false };
      continue;
    }
    const before = batch.current.get(ticketId);
    if (before?.version !== input.expectedVersion) {
      throw ticketConflictError([ticketId]);
    }
    writes.push({ ...planned, before, version });
  }
  return writes;
}

/** 持有分店只在換分店、或跳號進出時會變(一般售出不必重算)。 */
function changesHolders(before: TicketRecord, after: TicketRecord): boolean {
  if (!sameId(before.orgId, after.orgId)) {
    return true;
  }
  return (
    before.status !== after.status &&
    (before.status === TICKET_STATUS.skipped ||
      after.status === TICKET_STATUS.skipped)
  );
}

/** 一批鎖定 / 解除的計畫:每張的結果、要改的張(依讀到的版本分組)、本的鎖定張數增減。 */
interface LockPlan {
  versions: TicketVersion[];
  byVersion: Map<number, Types.ObjectId[]>;
  bookDeltas: Map<string, { bookId: Types.ObjectId; delta: number }>;
}

/**
 * 鎖從 `from` 改成 `to` 的計畫(不寫):已是 `to` → 不動;讀不到、或不是 `from` → `CONFLICT`;
 * 同一批重複給同一張 → 第一次改好、之後是「已是要的狀態」。
 */
function lockPlanOf(
  found: ReadonlyMap<
    string,
    Pick<TicketRecord, "bookId" | "version" | "lockedBy">
  >,
  ticketIds: readonly Types.ObjectId[],
  from: TicketLockRef | null,
  to: TicketLockRef | null,
): LockPlan {
  const done = new Map<string, number>();
  const plan: LockPlan = {
    versions: [],
    byVersion: new Map(),
    bookDeltas: new Map(),
  };
  for (const ticketId of ticketIds) {
    const key = String(ticketId);
    const repeated = done.get(key);
    const ticket = found.get(key);
    if (repeated !== undefined) {
      // 同一批重複給同一張:第一次已改好,這次是「已是要的狀態」
      plan.versions.push({ ticketId: key, version: repeated, changed: false });
      continue;
    }
    if (ticket && sameLock(ticket.lockedBy, to)) {
      done.set(key, ticket.version);
      plan.versions.push({
        ticketId: key,
        version: ticket.version,
        changed: false,
      });
      continue;
    }
    if (!ticket || !sameLock(ticket.lockedBy, from)) {
      throw ticketConflictError([key]);
    }
    done.set(key, ticket.version + 1);
    plan.versions.push({
      ticketId: key,
      version: ticket.version + 1,
      changed: true,
    });
    plan.byVersion.set(ticket.version, [
      ...(plan.byVersion.get(ticket.version) ?? []),
      ticketId,
    ]);
    const bookKey = String(ticket.bookId);
    const entry = plan.bookDeltas.get(bookKey) ?? {
      bookId: ticket.bookId,
      delta: 0,
    };
    entry.delta += to === null ? -1 : 1;
    plan.bookDeltas.set(bookKey, entry);
  }
  return plan;
}

/**
 * **張數帳本(唯一入口)**(專案規格 7.1、7.2、第 17 章共通原則;正本 `docs/modules/project/inventory.md`
 * 「資料與帳本」)。張的目前狀態與張數事件**只經這裡寫**,而且在呼叫端給的同一個交易裡:
 *
 * - 每張以「`version`(+ 狀態)」條件更新,`version` +1;不符 → `CONFLICT`(「已被處理」),整個交易回復
 * - 事件 id = `<ticketId>:<變動後的版本>`,重送(同 id、同內容)不重複寫入、回 `applied: false`
 * - 鎖定的張只有同一個鎖能動;鎖定 / 解除用 `lockTickets` / `unlockTickets`(用掉一個版本、不寫事件)
 * - 換店走底座的批次搬家入口 `reassignOrgMany`;張換店或跳號進出後以租戶邊界上下文重算本的持有分店、
 *   所在分店與跳號清單(`skippedTicketNos`)
 * - **整批寫**(TX-06):一次讀張與既有事件,條件相同的張一次 `updateMany`(寫入筆數不符 → `CONFLICT`),
 *   事件一次 `createMany`;資料庫往返數只隨「同一張在這批裡出現幾次」與條件 / 目標的種類數成長,與張數無關
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

  /**
   * 寫一批張數事件,回每一筆的結果(與輸入同順序)。同一張可以出現多次(例:作廢調貨單的「調出」再「調入」),
   * 依輸入順序套用,後一筆的 `expectedVersion` 是前一筆寫完的版本。
   */
  async applyTicketEvents(
    session: ClientSession,
    ledger: LedgerContext,
    events: readonly TicketEventInput[],
  ): Promise<TicketEventResult[]> {
    if (events.length === 0) {
      return [];
    }
    assertCrossStoreMovesIn(ledger, events);
    assertAmounts(events);
    const resolved = await this.resolve(ledger);
    const stages = stagesOf(events);
    const batch = await this.batchOf(resolved, session, events, stages);
    // 交易內依序 await(TX-02:不平行讀寫);每一輪每張最多一筆
    for (const stage of stages) {
      const writes = planStage(resolved.by, batch, stage);
      if (writes.length > 0) {
        await this.writeStage(resolved, session, batch, writes);
      }
    }
    if (batch.created.length > 0) {
      await this.events.createMany(resolved.context, batch.created, {
        session,
      });
    }
    await this.refreshBookHolders(resolved, session, batch.movedBooks);
    return batch.results;
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

  /**
   * 系統鎖定 / 解除(事後動作用:系統身分只看得到單據的組織,張在別家店):以這個租戶的租戶邊界上下文改鎖。
   * 只動 `lock` 這個鎖(鎖定從沒有鎖開始、解除只解自己的鎖),不換店、不寫事件;規則同 `lockTickets`。
   */
  async lockTicketsInTenant(
    session: ClientSession,
    tenantId: Types.ObjectId,
    ticketIds: readonly Types.ObjectId[],
    lock: TicketLockRef,
  ): Promise<TicketVersion[]> {
    if (ticketIds.length === 0) {
      return [];
    }
    const context = await tenantBoundaryContext(this.orgs, null, tenantId);
    return this.changeLockIn(context, session, ticketIds, null, lock);
  }

  /** 系統解除自己的鎖(見 `lockTicketsInTenant`)。 */
  async unlockTicketsInTenant(
    session: ClientSession,
    tenantId: Types.ObjectId,
    ticketIds: readonly Types.ObjectId[],
    lock: TicketLockRef,
  ): Promise<TicketVersion[]> {
    if (ticketIds.length === 0) {
      return [];
    }
    const context = await tenantBoundaryContext(this.orgs, null, tenantId);
    return this.changeLockIn(context, session, ticketIds, lock, null);
  }

  private async resolve(ledger: LedgerContext): Promise<ResolvedLedger> {
    const by = ledger.operator?.actorId ?? null;
    if (ledger.crossStoreTenantId !== undefined) {
      const context = await tenantBoundaryContext(
        this.orgs,
        ledger.operator,
        ledger.crossStoreTenantId,
      );
      const systemActorId =
        ledger.operator === null ? (ledger.systemActorId ?? null) : null;
      if (systemActorId !== null) {
        // 系統寫入代表觸發它的人:搬家稽核與事件的「誰」記他
        return {
          context: { ...context, actorId: systemActorId },
          operator: null,
          by: systemActorId,
        };
      }
      return { context, operator: ledger.operator, by };
    }
    if (ledger.operator === null) {
      throw new Error("帳本:沒有操作者的系統寫入要給 crossStoreTenantId");
    }
    return { context: ledger.operator, operator: ledger.operator, by };
  }

  /** 一批的起點:這批事件 id 已寫過的事件、這批的張(各一次讀)。 */
  private async batchOf(
    ledger: ResolvedLedger,
    session: ClientSession,
    events: readonly TicketEventInput[],
    stages: readonly PlannedEvent[][],
  ): Promise<LedgerBatch> {
    const eventIds = [
      ...new Set(stages.flat().map((planned) => planned.eventId)),
    ];
    const existing = await this.events.findMany(
      ledger.context,
      { eventId: { $in: eventIds } },
      { session },
    );
    const tickets = await this.tickets.findMany(
      ledger.context,
      { _id: { $in: uniqueIdsOf(events.map((input) => input.ticketId)) } },
      { session },
    );
    return {
      known: new Map(existing.map((event) => [event.eventId, event])),
      current: new Map(tickets.map((ticket) => [String(ticket._id), ticket])),
      results: [],
      created: [],
      movedBooks: new Map(),
    };
  }

  /** 寫這一輪:條件更新、讀回寫後的張(一次),排好要新增的事件與要重算的本。 */
  private async writeStage(
    ledger: ResolvedLedger,
    session: ClientSession,
    batch: LedgerBatch,
    writes: readonly PlannedWrite[],
  ): Promise<void> {
    await this.updateTickets(ledger, session, writes);
    // 寫後以同一個上下文重讀。前提:換店後的張仍在這個上下文看得到 —— 換店只經跨店寫入
    // (`crossStoreTenantId` = 租戶邊界上下文,看得到整個租戶),一般範圍的寫入不換店
    // (`assertCrossStoreMovesIn` 與呼叫端保證)。若將來有「以一般範圍把張搬到看不到的店」的用途,
    // 這裡會讀不到而誤報 CONFLICT,要改成以租戶邊界上下文重讀。
    const rows = await this.tickets.findMany(
      ledger.context,
      { _id: { $in: writes.map((write) => write.input.ticketId) } },
      { session },
    );
    const after = new Map(rows.map((ticket) => [String(ticket._id), ticket]));
    for (const write of writes) {
      const ticketId = String(write.input.ticketId);
      const updated = after.get(ticketId);
      if (updated?.version !== write.version) {
        throw ticketConflictError([ticketId]);
      }
      const event = eventOf(ledger.by, write, updated);
      batch.created.push(event);
      batch.known.set(write.eventId, event);
      batch.current.set(ticketId, updated);
      if (changesHolders(write.before, updated)) {
        batch.movedBooks.set(String(updated.bookId), {
          bookId: updated.bookId,
          tenantId: updated.tenantId,
        });
      }
      batch.results[write.index] = {
        ticketId,
        eventId: write.eventId,
        version: updated.version,
        applied: true,
      };
    }
  }

  /**
   * 條件更新這一輪的張:條件(版本、狀態、鎖)與要改的欄位都相同的一組一次 `updateMany`,寫入筆數不符 →
   * `CONFLICT`;要換店的再依目標店一次 `reassignOrgMany`(全有或全無,一筆稽核),都在呼叫端的交易內。
   */
  private async updateTickets(
    ledger: ResolvedLedger,
    session: ClientSession,
    writes: readonly PlannedWrite[],
  ): Promise<void> {
    const groups = new Map<
      string,
      {
        version: number;
        statuses: readonly TicketStatus[] | undefined;
        allowLockedBy: TicketLockRef | undefined;
        update: Record<string, unknown>;
        ids: Types.ObjectId[];
      }
    >();
    const moves = new Map<
      string,
      { target: Types.ObjectId; ids: Types.ObjectId[] }
    >();
    for (const { input, before } of writes) {
      const set = setOf(input.patch, ledger.by);
      const key = JSON.stringify([
        input.expectedVersion,
        set,
        input.expectedStatuses ?? null,
        input.allowLockedBy ?? null,
      ]);
      const group = groups.get(key) ?? {
        version: input.expectedVersion,
        statuses: input.expectedStatuses,
        allowLockedBy: input.allowLockedBy,
        update: { $set: set, $inc: { version: 1 } },
        ids: [],
      };
      group.ids.push(input.ticketId);
      groups.set(key, group);
      const target = input.patch.orgId;
      if (target !== undefined && !sameId(target, before.orgId)) {
        const move = moves.get(String(target)) ?? { target, ids: [] };
        move.ids.push(input.ticketId);
        moves.set(String(target), move);
      }
    }
    for (const group of groups.values()) {
      const filter = {
        $and: [
          {
            _id: { $in: group.ids },
            version: group.version,
            ...(group.statuses === undefined
              ? {}
              : { status: { $in: [...group.statuses] } }),
          },
          lockConditionOf(group.allowLockedBy),
        ],
      };
      const modified = await this.tickets.updateMany(
        ledger.context,
        filter,
        group.update,
        { session },
      );
      if (modified !== group.ids.length) {
        throw ticketConflictError(
          await this.unchangedOf(
            ledger.context,
            session,
            group.ids,
            group.version + 1,
          ),
        );
      }
    }
    if (moves.size > 0 && ledger.context.actorId === null) {
      throw new Error("帳本:換店要寫搬家稽核,需要操作者");
    }
    for (const { target, ids } of moves.values()) {
      const moved = await this.tickets.reassignOrgMany(
        ledger.context,
        ids,
        target,
        { session },
      );
      const problems = [...moved.mismatched, ...moved.skipped.map(String)];
      if (problems.length > 0) {
        throw ticketConflictError(problems);
      }
    }
  }

  /** 條件更新筆數不符時,找出沒寫到的張(版本不是預期的寫後版本)。 */
  private async unchangedOf(
    context: OperatorContext,
    session: ClientSession,
    ids: readonly Types.ObjectId[],
    version: number,
  ): Promise<string[]> {
    const found = await this.tickets.findMany(
      context,
      { _id: { $in: [...ids] } },
      { select: "version", session },
    );
    const written = new Set(
      found
        .filter((ticket) => ticket.version === version)
        .map((ticket) => String(ticket._id)),
    );
    const missing = ids.map(String).filter((id) => !written.has(id));
    return missing.length > 0 ? missing : ids.map(String);
  }

  /**
   * 重算本的持有分店與跳號清單;所有可用(非跳號)的張都在同一家店 → 本搬到那家店(整本調貨)。
   * 要看整本的張(不只操作者看得到的),所以以這本所在租戶的邊界上下文讀寫(仍記得操作者)。
   * 同一個租戶的本一次讀完;結果相同的本一次 `updateMany`、搬到同一家店的一次 `reassignOrgMany`。
   */
  private async refreshBookHolders(
    ledger: ResolvedLedger,
    session: ClientSession,
    movedBooks: MovedBooks,
  ): Promise<void> {
    const byTenant = new Map<
      string,
      { tenantId: Types.ObjectId | null; bookIds: Types.ObjectId[] }
    >();
    for (const { bookId, tenantId } of movedBooks.values()) {
      const key = String(tenantId);
      const entry = byTenant.get(key) ?? { tenantId, bookIds: [] };
      entry.bookIds.push(bookId);
      byTenant.set(key, entry);
    }
    for (const { tenantId, bookIds } of byTenant.values()) {
      await this.refreshTenantBooks(ledger, session, tenantId, bookIds);
    }
  }

  private async refreshTenantBooks(
    ledger: ResolvedLedger,
    session: ClientSession,
    tenantId: Types.ObjectId | null,
    bookIds: readonly Types.ObjectId[],
  ): Promise<void> {
    // 記得是誰(操作者,或系統寫入代表的人):整本搬家要寫稽核
    const whole = {
      ...(await tenantBoundaryContext(this.orgs, ledger.operator, tenantId)),
      actorId: ledger.context.actorId,
    };
    const tickets = await this.tickets.findMany(
      whole,
      { bookId: { $in: [...bookIds] } },
      { select: "bookId orgId status ticketNo", session },
    );
    const perBook = new Map(
      bookIds.map((bookId) => [
        String(bookId),
        {
          holders: new Map<string, Types.ObjectId>(),
          skippedTicketNos: [] as string[],
        },
      ]),
    );
    for (const ticket of tickets) {
      const book = perBook.get(String(ticket.bookId));
      if (book === undefined) {
        continue;
      }
      if (ticket.status === TICKET_STATUS.skipped) {
        book.skippedTicketNos.push(ticket.ticketNo);
        continue;
      }
      book.holders.set(String(ticket.orgId), ticket.orgId);
    }
    const sets = new Map<
      string,
      { set: Record<string, unknown>; ids: Types.ObjectId[] }
    >();
    const moves = new Map<
      string,
      { holder: Types.ObjectId; ids: Types.ObjectId[] }
    >();
    for (const bookId of bookIds) {
      const book = perBook.get(String(bookId));
      if (book === undefined) {
        continue;
      }
      const holderOrgIds = [...book.holders.values()];
      // 本的跳號清單跟著張的狀態(拆本標跳號、更正跳號都經帳本,這裡一起重算)
      const set = {
        holderOrgIds,
        skippedTicketNos: book.skippedTicketNos.toSorted((a, b) =>
          a.localeCompare(b),
        ),
      };
      const key = JSON.stringify(set);
      const entry = sets.get(key) ?? { set, ids: [] as Types.ObjectId[] };
      entry.ids.push(bookId);
      sets.set(key, entry);
      const [onlyHolder] = holderOrgIds;
      if (holderOrgIds.length === 1 && onlyHolder !== undefined) {
        const move = moves.get(String(onlyHolder)) ?? {
          holder: onlyHolder,
          ids: [],
        };
        move.ids.push(bookId);
        moves.set(String(onlyHolder), move);
      }
    }
    for (const { set, ids } of sets.values()) {
      await this.books.updateMany(
        whole,
        { _id: { $in: ids } },
        { $set: set },
        { session },
      );
    }
    if (ledger.context.actorId !== null) {
      await this.moveWholeBooks(whole, session, moves.values());
    }
  }

  /** 整本搬到唯一的持有店:同一家店的本一次搬。 */
  private async moveWholeBooks(
    whole: OperatorContext,
    session: ClientSession,
    moves: Iterable<{ holder: Types.ObjectId; ids: Types.ObjectId[] }>,
  ): Promise<void> {
    for (const { holder, ids } of moves) {
      // 已在那家店的本搬家入口跳過(冪等);全有或全無:有任何一本不符 → 整筆回復,不靜默不搬
      const moved = await this.books.reassignOrgMany(whole, ids, holder, {
        session,
      });
      if (moved.mismatched.length > 0) {
        throw bookConflictError(moved.mismatched);
      }
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
    return this.changeLockIn(resolved.context, session, ticketIds, from, to);
  }

  /**
   * 一批張的鎖從 `from` 改成 `to`(null = 沒有鎖);已是 `to` → 不動(重送,`changed: false`)。
   * 鎖定只能從「沒有鎖」開始、解除只能解自己的鎖;不符或版本變了 → `CONFLICT`。
   * 一次讀完;同一個版本的張一次 `updateMany`(寫入筆數不符 → `CONFLICT`),本的鎖定張數依增減量一次寫。
   */
  private async changeLockIn(
    context: OperatorContext,
    session: ClientSession,
    ticketIds: readonly Types.ObjectId[],
    from: TicketLockRef | null,
    to: TicketLockRef | null,
  ): Promise<TicketVersion[]> {
    if (ticketIds.length === 0) {
      return [];
    }
    const rows = await this.tickets.findMany(
      context,
      { _id: { $in: uniqueIdsOf(ticketIds) } },
      { select: "bookId version lockedBy", session },
    );
    const { versions, byVersion, bookDeltas } = lockPlanOf(
      new Map(rows.map((ticket) => [String(ticket._id), ticket])),
      ticketIds,
      from,
      to,
    );
    for (const [version, ids] of byVersion) {
      const modified = await this.tickets.updateMany(
        context,
        { _id: { $in: ids }, version },
        { $set: { lockedBy: to }, $inc: { version: 1 } },
        { session },
      );
      if (modified !== ids.length) {
        throw ticketConflictError(
          await this.unchangedOf(context, session, ids, version + 1),
        );
      }
    }
    const byDelta = new Map<number, Types.ObjectId[]>();
    for (const { bookId, delta } of bookDeltas.values()) {
      byDelta.set(delta, [...(byDelta.get(delta) ?? []), bookId]);
    }
    for (const [delta, bookIds] of byDelta) {
      await this.books.updateMany(
        context,
        { _id: { $in: bookIds } },
        { $inc: { lockedTicketCount: delta } },
        { session },
      );
    }
    return versions;
  }
}
