import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { type ClientSession, Types } from "mongoose";

import {
  STORE_PERMISSIONS,
  type SaleUndoBlock,
  type StoreScanTicketFacts,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketSoldSource,
  displayTicketKey,
  isUnopenedInStore,
  normalizeBookNo,
  parseTicketInput,
  pendingSkipCountOf,
  saleUndoBlockOf,
  storeScanDecisionOf,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { TransactionService } from "../../../database/transaction";
import { FieldOptionsService } from "../../../fields/field-options.service";
import {
  type LotteryBookDocument,
  LotteryBooksRepository,
  type LotteryTicketDocument,
  type LotteryTicketEventDocument,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { LOTTERY_FIELD_CATEGORIES } from "../field-options/lottery-field-options";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";
import type {
  LotteryStoreScanInput,
  LotteryStoreTicketRefInput,
  SellLotteryTicketsInput,
} from "./dto/lottery-store-sales.input";
import type {
  LotteryStoreBookCardModel,
  LotteryStoreSaleModel,
  LotteryStoreScanItemModel,
} from "./models/lottery-store-sales.model";
import { type ShiftRecord, StoreShiftViews, parseId } from "./shift-views";
import { StoreAccess } from "./store-access";
import { StoreClock } from "./store-clock";
import { notFoundError, validationError } from "./store-error";
import {
  alreadySoldError,
  gameNotFoundError,
  localShiftNotOpenError,
  moveConfirmRequiredError,
  moveNotAllowedError,
  notSellableError,
  undoNotAllowedError,
} from "./store-sales-error";
import {
  type CashPointRecord,
  type GameRecord,
  type StoreRef,
  StoreSalesSupport,
} from "./store-sales-support";

type TicketRecord = Persisted<LotteryTicketDocument>;
type EventRecord = Persisted<LotteryTicketEventDocument>;

const SALE_SOURCES: readonly TicketSoldSource[] = ["scan", "manual"];

function ref(id: Types.ObjectId | string, name: string) {
  return { id: String(id), name };
}

type BookRecord = Persisted<LotteryBookDocument>;

/** 事件 id `<ticketId>:<寫入後的版本>` → 版本(`ticketEventIdOf` 的反向)。 */
const versionOfEvent = (eventId: string): number =>
  Number(eventId.split(":").at(-1));

const isMissing = (ticket: TicketRecord): boolean =>
  ticket.status === TICKET_STATUS.investigating ||
  ticket.status === TICKET_STATUS.lost;

const pendingSkipOf = (book: BookRecord): number =>
  pendingSkipCountOf(
    Number(book.lastTicketNo),
    book.standardTickets,
    book.skippedTicketNos.length,
  );

/** 刷到的張與它所在收銀點那一班(判斷 `storeScanDecisionOf` 用;店與未拆另外給)。 */
function scanFactsOf(
  operator: OperatorContext,
  ticket: TicketRecord,
  counterShift: ShiftRecord | undefined,
): Omit<StoreScanTicketFacts, "inThisStore" | "bookUnopened"> {
  const pointId = ticket.location.cashPointId ?? null;
  return {
    status: ticket.status,
    locationKind: ticket.location.kind,
    cashPointId: pointId === null ? null : String(pointId),
    locked: ticket.lockedBy !== null,
    counterShiftIsMine:
      operator.actorId !== null &&
      counterShift?.openedBy.equals(operator.actorId) === true,
  };
}

/** 移櫃並售出的「移櫃」那一筆(移到本機收銀點)。 */
function moveEventOf(
  ticket: TicketRecord,
  expectedVersion: number,
  localId: Types.ObjectId,
  at: Date,
): TicketEventInput {
  return {
    ticketId: ticket._id,
    expectedVersion,
    expectedStatuses: [TICKET_STATUS.unsold],
    type: TICKET_EVENT_TYPE.move,
    at,
    patch: {
      location: { kind: TICKET_LOCATION_KIND.counter, cashPointId: localId },
    },
    cashPointId: localId,
  };
}

/** 刷到時共用的讀取結果。 */
interface ScanScope {
  operator: OperatorContext;
  store: StoreRef;
  localId: Types.ObjectId | null;
  canSell: boolean;
  canMove: boolean;
  points: Map<string, CashPointRecord>;
  openShifts: Map<string, ShiftRecord>;
  owners: Map<string, string>;
  orgNames: Map<string, string>;
}

/** 一次售出的條件。 */
interface SalePlan {
  operator: OperatorContext;
  store: StoreRef;
  localId: Types.ObjectId;
  refs: readonly { id: Types.ObjectId; version: number }[];
  source: TicketSoldSource;
  confirmMove: boolean;
  canMove: boolean;
  reason: { reasonKey: string; reasonNote: string | null } | null;
}

interface SoldRow {
  ticket: TicketRecord;
  shift: ShiftRecord;
  amount: number;
  at: Date;
  version: number;
}

/**
 * 這張的錢算在哪一班、要不要先移櫃(規格 6.3「錢算在哪一班」、3.3 移櫃情境表);不能賣 → 拋錯。
 * 手動標記只在本機收銀點檯面上的張(展開卡片 [標記售出])。
 */
function saleTargetOf(
  plan: SalePlan,
  ticket: TicketRecord,
  openShifts: ReadonlyMap<string, ShiftRecord>,
  localShift: ShiftRecord,
): { shift: ShiftRecord; move: boolean } {
  if (ticket.status === TICKET_STATUS.sold && ticket.soldAt) {
    throw alreadySoldError(String(ticket._id), ticket.soldAt);
  }
  const pointId = ticket.location.cashPointId ?? null;
  const counterShift =
    pointId === null ? undefined : openShifts.get(String(pointId));
  const decision = storeScanDecisionOf(
    {
      ...scanFactsOf(plan.operator, ticket, counterShift),
      inThisStore: true,
      bookUnopened: false,
    },
    {
      localCashPointId: String(plan.localId),
      localShiftOpen: true,
      canSell: true,
      canMove: plan.canMove,
    },
  );
  if (plan.source === "manual" && decision.outcome !== "sell") {
    throw notSellableError(String(ticket._id), decision.blockReason);
  }
  switch (decision.outcome) {
    case "sell": {
      return { shift: localShift, move: false };
    }
    case "sell_other_mine": {
      return { shift: counterShift ?? localShift, move: false };
    }
    case "move_and_sell": {
      if (!plan.confirmMove) {
        throw moveConfirmRequiredError(String(ticket._id));
      }
      return { shift: localShift, move: true };
    }
    case "move_forbidden": {
      throw moveNotAllowedError(String(ticket._id));
    }
    default: {
      throw notSellableError(String(ticket._id), decision.blockReason);
    }
  }
}

/** 輸入的張(去重、id 合法);空 → `VALIDATION_FAILED`。 */
export function ticketRefsOf(
  tickets: readonly LotteryStoreTicketRefInput[],
): { id: Types.ObjectId; version: number }[] {
  const unique = new Map<string, { id: Types.ObjectId; version: number }>();
  for (const ticket of tickets) {
    const id = parseId(ticket.ticketId);
    if (id === null) {
      throw validationError("invalid ticket id", ["tickets"]);
    }
    unique.set(String(id), { id, version: ticket.version });
  }
  if (unique.size === 0) {
    throw validationError("pick at least one ticket", ["tickets"]);
  }
  return [...unique.values()];
}

/**
 * 銷售與當下撤銷(專案規格 6.3、3.3;正本 `docs/modules/project/store.md`「銷售與拆本」):
 *
 * - **刷到時** `scan`:解析碼(`parseTicketInput`)→ 本店對到的張 → `storeScanDecisionOf` 決定處理方式
 *   (本號對到兩款以上遊戲時每款一筆,畫面讓人選遊戲)。待查 / 遺失的張可能在別家店,以租戶邊界反查
 * - **售出** `sell`:錢算在哪一班照 `storeScanDecisionOf`;移櫃並售出寫「移櫃」+「售出」兩筆事件;
 *   張的狀態 / 事件經帳本(條件更新),同時兩次售出只有一次成功,失敗方收到 `ALREADY_SOLD`(帶售出時間)
 * - **當下撤銷** `undo`:`saleUndoBlockOf`(自己賣的、30 分鐘內、班開著、之後沒有異動)→ 寫「撤銷」
 * - 售出 / 撤銷動到那一班的抽屜:交易內先鎖住那一班(`drawerVersion` +1)
 */
@Injectable()
export class StoreSalesService {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly orgs: OrgsRepository,
    private readonly ledger: TicketLedgerService,
    private readonly fieldOptions: FieldOptionsService,
    private readonly transactions: TransactionService,
    private readonly support: StoreSalesSupport,
    private readonly views: StoreShiftViews,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
  ) {}

  // ---- 刷到時 ----

  async scan(
    operator: OperatorContext,
    input: LotteryStoreScanInput,
  ): Promise<LotteryStoreScanItemModel[]> {
    const grant = await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, input.orgId);
    const parsed = parseTicketInput(input.code);
    const bookNo = parsed === null ? null : normalizeBookNo(parsed.bookNo);
    if (parsed === null || bookNo === null) {
      return [];
    }
    // 待查 / 遺失的張可能還在別家店(任何一家店刷到都提示尋回):以租戶邊界反查這個本號
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      store.tenantId,
    );
    const books = await this.books.findMany(reader, {
      bookNo,
      ...(parsed.gameCode === undefined ? {} : { gameCode: parsed.gameCode }),
    });
    const found = await this.tickets.findMany(reader, {
      bookId: { $in: books.map((book) => book._id) },
      ticketNo: parsed.ticketNo,
    });
    // 本店的張(含待查 / 遺失);都沒有而別家店有 → 一筆「不是本店的刮刮樂」
    const mine = found.filter(
      (ticket) => ticket.orgId.equals(store.orgId) || isMissing(ticket),
    );
    const picked = mine.length > 0 ? mine : found.slice(0, 1);
    if (picked.length === 0) {
      return [];
    }
    const [points, openShifts, games] = await Promise.all([
      this.support.cashPointsOf(operator, store.orgId),
      this.support.openShiftsOf(operator, store.orgId),
      this.support.gamesOf(
        reader,
        picked.map((ticket) => ticket.gameId),
      ),
    ]);
    const scope: ScanScope = {
      operator,
      store,
      localId: parseId(input.localCashPointId),
      canSell: grant.has(STORE_PERMISSIONS.sell),
      canMove: grant.has(STORE_PERMISSIONS.move),
      points,
      openShifts,
      owners: await this.views.userNames(
        operator,
        store.tenantId,
        [...openShifts.values()].map((shift) => shift.openedBy),
      ),
      orgNames: await this.orgNamesOf(
        reader,
        picked.flatMap((ticket) =>
          ticket.responsibleOrgId === null ? [] : [ticket.responsibleOrgId],
        ),
      ),
    };
    const bookById = new Map(books.map((book) => [String(book._id), book]));
    const items: LotteryStoreScanItemModel[] = [];
    for (const ticket of picked) {
      const book = bookById.get(String(ticket.bookId));
      if (book !== undefined) {
        items.push(
          await this.scanItemOf(
            scope,
            ticket,
            book,
            games.get(String(ticket.gameId)),
          ),
        );
      }
    }
    return items.toSorted((a, b) => a.gameCode.localeCompare(b.gameCode));
  }

  private async scanItemOf(
    scope: ScanScope,
    ticket: TicketRecord,
    book: BookRecord,
    game: GameRecord | undefined,
  ): Promise<LotteryStoreScanItemModel> {
    const inThisStore = ticket.orgId.equals(scope.store.orgId);
    const unopened =
      inThisStore && (await this.isUnopened(scope.operator, book, scope.store));
    const pointId = ticket.location.cashPointId ?? null;
    const counterShift =
      pointId === null ? undefined : scope.openShifts.get(String(pointId));
    const decision = storeScanDecisionOf(
      {
        ...scanFactsOf(scope.operator, ticket, counterShift),
        inThisStore,
        bookUnopened: unopened,
      },
      {
        localCashPointId: scope.localId === null ? null : String(scope.localId),
        localShiftOpen:
          scope.localId !== null && scope.openShifts.has(String(scope.localId)),
        canSell: scope.canSell,
        canMove: scope.canMove,
      },
    );
    const point =
      pointId === null || !inThisStore
        ? undefined
        : scope.points.get(String(pointId));
    const owner = inThisStore ? counterShift?.openedBy : undefined;
    const responsible = ticket.responsibleOrgId;
    return {
      ticketId: String(ticket._id),
      version: ticket.version,
      bookId: String(book._id),
      gameCode: book.gameCode,
      gameName: game?.name ?? "",
      unitPrice: game?.unitPrice ?? 0,
      bookNo: book.bookNo,
      ticketNo: ticket.ticketNo,
      status: ticket.status,
      locationKind: ticket.location.kind,
      cashPoint: point === undefined ? null : ref(point._id, point.name),
      counterShiftOwner:
        owner === undefined
          ? null
          : ref(owner, scope.owners.get(String(owner)) ?? ""),
      responsibleOrg:
        responsible === null
          ? null
          : ref(responsible, scope.orgNames.get(String(responsible)) ?? ""),
      outcome: decision.outcome,
      blockReason: decision.blockReason,
      soldAt:
        ticket.status === TICKET_STATUS.sold ? (ticket.soldAt ?? null) : null,
      pendingSkipCount: unopened ? pendingSkipOf(book) : 0,
    };
  }

  /** 這本在這家店還沒拆(從沒拆過,這家店的張全是未售、在庫存;`isUnopenedInStore`)。 */
  private async isUnopened(
    operator: OperatorContext,
    book: BookRecord,
    store: StoreRef,
  ): Promise<boolean> {
    const tickets = await this.tickets.findMany(
      operator,
      { bookId: book._id, orgId: store.orgId },
      { select: "status location orgId" },
    );
    return isUnopenedInStore(
      book.firstOpenedAt ?? null,
      tickets.map((item) => ({
        status: item.status,
        locationKind: item.location.kind,
      })),
    );
  }

  // ---- 售出 ----

  async sell(
    operator: OperatorContext,
    input: SellLotteryTicketsInput,
  ): Promise<LotteryStoreSaleModel[]> {
    const source = SALE_SOURCES.find((item) => item === input.source);
    if (source === undefined) {
      throw validationError("source must be scan or manual", ["source"]);
    }
    const refs = ticketRefsOf(input.tickets);
    const store = await this.support.mustStore(operator, input.orgId);
    const local = await this.support.mustCashPoint(
      operator,
      store.orgId,
      input.localCashPointId,
      "localCashPointId",
    );
    const reason =
      source === "manual"
        ? await this.fieldOptions.assertReason(
            operator,
            LOTTERY_FIELD_CATEGORY_KEYS.manualSaleReason,
            {
              reasonKey: input.reasonKey ?? null,
              reasonNote: input.reasonNote ?? null,
            },
            LOTTERY_FIELD_CATEGORIES,
          )
        : null;
    const grant = await this.access.grantOf(operator);
    try {
      const sold = await this.transactions.withTransaction((session) =>
        this.writeSales(session, {
          operator,
          store,
          localId: local._id,
          refs,
          source,
          confirmMove: input.confirmMove === true,
          canMove: grant.has(STORE_PERMISSIONS.move),
          reason,
        }),
      );
      return await this.saleRowsOf(operator, store, sold);
    } catch (error) {
      throw await this.explainConflict(operator, refs, error);
    }
  }

  /** 交易內:鎖住要動的班、依處理方式組事件、經帳本寫入。 */
  private async writeSales(
    session: ClientSession,
    plan: SalePlan,
  ): Promise<SoldRow[]> {
    const { operator, store } = plan;
    const now = this.clock.now();
    const openShifts = await this.support.openShiftsOf(
      operator,
      store.orgId,
      session,
    );
    const localShift = openShifts.get(String(plan.localId));
    if (localShift === undefined) {
      throw localShiftNotOpenError();
    }
    const found = await this.tickets.findMany(
      operator,
      { _id: { $in: plan.refs.map((item) => item.id) }, orgId: store.orgId },
      { session },
    );
    const byId = new Map(found.map((ticket) => [String(ticket._id), ticket]));
    const games = await this.support.gamesOf(
      operator,
      found.map((ticket) => ticket.gameId),
    );
    const events: TicketEventInput[] = [];
    const locked = new Set<string>();
    const rows: SoldRow[] = [];
    for (const item of plan.refs) {
      const ticket = byId.get(String(item.id));
      if (ticket === undefined) {
        throw notSellableError(String(item.id), "not_this_store");
      }
      // 金額 = 遊戲面額;讀不到遊戲(主檔沒共用到這家店、或已刪)不能用 0 元賣掉
      const game = games.get(String(ticket.gameId));
      if (game === undefined) {
        throw gameNotFoundError(String(ticket._id));
      }
      const target = saleTargetOf(plan, ticket, openShifts, localShift);
      const shiftKey = String(target.shift._id);
      if (!locked.has(shiftKey)) {
        const drawer = await this.support.lockDrawer(
          operator,
          target.shift._id,
        );
        if (drawer === null) {
          throw localShiftNotOpenError();
        }
        locked.add(shiftKey);
      }
      const amount = game.unitPrice;
      const version = target.move ? item.version + 1 : item.version;
      if (target.move) {
        events.push(moveEventOf(ticket, item.version, plan.localId, now));
      }
      events.push({
        ticketId: ticket._id,
        expectedVersion: version,
        expectedStatuses: [TICKET_STATUS.unsold],
        type: TICKET_EVENT_TYPE.sale,
        at: now,
        patch: {
          status: TICKET_STATUS.sold,
          sold: { at: now, source: plan.source },
        },
        amount,
        cashEffect: "increase",
        cashPointId: target.shift.cashPointId,
        shiftId: target.shift._id,
        reasonKey: plan.reason?.reasonKey ?? null,
        reasonNote: plan.reason?.reasonNote ?? null,
      });
      rows.push({
        ticket,
        shift: target.shift,
        amount,
        at: now,
        version: version + 1,
      });
    }
    await this.ledger.applyTicketEvents(session, { operator }, events);
    await this.support.publish(store);
    return rows;
  }

  private async saleRowsOf(
    operator: OperatorContext,
    store: StoreRef,
    sold: readonly SoldRow[],
  ): Promise<LotteryStoreSaleModel[]> {
    const names = await this.support.cashPointsOf(operator, store.orgId);
    const books = await this.books.findMany(operator, {
      _id: { $in: sold.map((row) => row.ticket.bookId) },
    });
    const bookById = new Map(books.map((book) => [String(book._id), book]));
    return sold.map((row) => ({
      ticketId: String(row.ticket._id),
      version: row.version,
      ticketKey: displayTicketKey(
        bookById.get(String(row.ticket.bookId))?.gameCode ?? "",
        row.ticket.bookNo,
        row.ticket.ticketNo,
      ),
      amount: row.amount,
      soldAt: row.at,
      cashPoint: ref(
        row.shift.cashPointId,
        names.get(String(row.shift.cashPointId))?.name ?? "",
      ),
      shiftId: String(row.shift._id),
      undone: false,
      undoBlock: null,
    }));
  }

  /** 帳本的「已被處理」:其中有張已經賣掉 → `ALREADY_SOLD`(帶售出時間;第 17 章第 3 題看板一側)。 */
  private async explainConflict(
    operator: OperatorContext,
    refs: readonly { id: Types.ObjectId }[],
    error: unknown,
  ): Promise<unknown> {
    if (
      !(error instanceof GraphQLError) ||
      error.extensions.code !== "CONFLICT"
    ) {
      return error;
    }
    const now = await this.tickets.findMany(operator, {
      _id: { $in: refs.map((item) => item.id) },
      status: TICKET_STATUS.sold,
    });
    const sold = now.find((ticket) => ticket.soldAt);
    return sold?.soldAt
      ? alreadySoldError(String(sold._id), sold.soldAt)
      : error;
  }

  // ---- 當下撤銷 ----

  async saleOf(
    operator: OperatorContext,
    ticketIdText: string,
  ): Promise<LotteryStoreSaleModel> {
    await this.access.assertView(operator);
    const ticket = await this.mustTicket(operator, ticketIdText);
    const sale = await this.lastSaleOf(operator, ticket._id);
    if (sale === null) {
      throw notFoundError(`sale not found: ${ticketIdText}`);
    }
    return this.saleModel(operator, ticket, sale);
  }

  /** [最近售出]:自己在這一班 30 分鐘內賣的張(撤銷過的那一筆標「已撤銷」),新的在上面。 */
  async recentSales(
    operator: OperatorContext,
    shiftIdText: string,
  ): Promise<LotteryStoreSaleModel[]> {
    await this.access.assertView(operator);
    const shiftId = parseId(shiftIdText);
    const shift =
      shiftId === null ? null : await this.shifts.findById(operator, shiftId);
    if (shift === null) {
      throw notFoundError(`shift not found: ${shiftIdText}`);
    }
    if (operator.actorId === null) {
      return [];
    }
    const since = new Date(this.clock.now().getTime() - 30 * 60_000);
    const sales = await this.events.findMany(
      operator,
      {
        shiftId: shift._id,
        by: operator.actorId,
        type: TICKET_EVENT_TYPE.sale,
        at: { $gte: since },
      },
      { sort: { at: -1, _id: -1 } },
    );
    const tickets = await this.tickets.findMany(operator, {
      _id: { $in: sales.map((sale) => sale.ticketId) },
    });
    const ticketById = new Map(
      tickets.map((ticket) => [String(ticket._id), ticket]),
    );
    const rows: LotteryStoreSaleModel[] = [];
    for (const sale of sales) {
      const ticket = ticketById.get(String(sale.ticketId));
      if (ticket !== undefined) {
        rows.push(await this.saleModel(operator, ticket, sale));
      }
    }
    return rows;
  }

  async undo(
    operator: OperatorContext,
    input: LotteryStoreTicketRefInput,
  ): Promise<LotteryStoreSaleModel> {
    const ticket = await this.mustTicket(operator, input.ticketId);
    const sale = await this.lastSaleOf(operator, ticket._id);
    if (sale === null) {
      throw notFoundError(`sale not found: ${input.ticketId}`);
    }
    const block = await this.undoBlockOf(operator, ticket, sale);
    if (block !== null) {
      throw undoNotAllowedError(block);
    }
    const shiftId = sale.shiftId;
    if (shiftId === null) {
      throw undoNotAllowedError("shift_closed");
    }
    const store: StoreRef = { orgId: ticket.orgId, tenantId: ticket.tenantId };
    await this.transactions.withTransaction(async (session) => {
      const locked = await this.support.lockDrawer(operator, shiftId);
      if (locked === null) {
        throw undoNotAllowedError("shift_closed");
      }
      await this.ledger.applyTicketEvents(session, { operator }, [
        {
          ticketId: ticket._id,
          // 只撤銷「售出之後沒有其他異動」的那個版本:由售出事件推(事件 id = `<張>:<售出後的版本>`),
          // 不用畫面傳來的版本;檢查之後到寫入之前有人動過這張(例:移櫃)→ 帳本擋下(已被處理)
          expectedVersion: versionOfEvent(sale.eventId),
          expectedStatuses: [TICKET_STATUS.sold],
          type: TICKET_EVENT_TYPE.saleUndo,
          at: this.clock.now(),
          patch: { status: TICKET_STATUS.unsold, sold: null },
          amount: sale.amount,
          cashEffect: "decrease",
          cashPointId: sale.cashPointId,
          shiftId,
          refType: "sale",
          refId: sale._id,
        },
      ]);
      await this.support.publish(store);
    });
    const after = await this.mustTicket(operator, input.ticketId);
    return this.saleModel(operator, after, sale);
  }

  // ---- 展開卡片 ----

  async bookCard(
    operator: OperatorContext,
    orgIdText: string,
    bookIdText: string,
  ): Promise<LotteryStoreBookCardModel> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, orgIdText);
    const bookId = parseId(bookIdText);
    const book =
      bookId === null ? null : await this.books.findById(operator, bookId);
    if (book === null) {
      throw notFoundError(`book not found: ${bookIdText}`);
    }
    const all = await this.tickets.findMany(
      operator,
      { bookId: book._id, orgId: store.orgId },
      { sort: { ticketNo: 1 } },
    );
    const usable = all.filter(
      (ticket) => ticket.status !== TICKET_STATUS.skipped,
    );
    const [points, games, soldShifts] = await Promise.all([
      this.support.cashPointsOf(operator, store.orgId),
      this.support.gamesOf(operator, [book.gameId]),
      this.soldShiftsOf(
        operator,
        usable
          .filter((ticket) => ticket.status === TICKET_STATUS.sold)
          .map((ticket) => ticket._id),
      ),
    ]);
    const game = games.get(String(book.gameId));
    const unopened = isUnopenedInStore(
      book.firstOpenedAt ?? null,
      usable.map((ticket) => ({
        status: ticket.status,
        locationKind: ticket.location.kind,
      })),
    );
    return {
      bookId: String(book._id),
      gameCode: book.gameCode,
      gameName: game?.name ?? "",
      unitPrice: game?.unitPrice ?? 0,
      bookNo: book.bookNo,
      firstTicketNo: book.firstTicketNo,
      lastTicketNo: book.lastTicketNo,
      // 這家店原封不動才在拆本時標跳號;其他(拆過、只尋回幾張…)不標,待標註保留(使用者 10/27 定案 M1)
      pendingSkipCount: unopened ? pendingSkipOf(book) : 0,
      unopened,
      tickets: usable.map((ticket) => {
        const pointId = ticket.location.cashPointId ?? null;
        const point =
          pointId === null ? undefined : points.get(String(pointId));
        return {
          id: String(ticket._id),
          ticketNo: ticket.ticketNo,
          version: ticket.version,
          status: ticket.status,
          locationKind: ticket.location.kind,
          cashPoint: point === undefined ? null : ref(point._id, point.name),
          soldShiftId: soldShifts.get(String(ticket._id)) ?? null,
          locked: ticket.lockedBy !== null,
        };
      }),
    };
  }

  // ---- 內部 ----

  private async mustTicket(
    operator: OperatorContext,
    idText: string,
  ): Promise<TicketRecord> {
    const id = parseId(idText);
    const ticket =
      id === null ? null : await this.tickets.findById(operator, id);
    if (ticket === null) {
      throw notFoundError(`ticket not found: ${idText}`);
    }
    return ticket;
  }

  private lastSaleOf(
    operator: OperatorContext,
    ticketId: Types.ObjectId,
  ): Promise<EventRecord | null> {
    return this.events.findOne(
      operator,
      { ticketId, type: TICKET_EVENT_TYPE.sale },
      { sort: { at: -1, _id: -1 } },
    );
  }

  /** 售出之後的事件(撤銷、移櫃…);以版本判斷(事件 id = `<張>:<版本>`,同一張的版本嚴格遞增)。 */
  private async undoBlockOf(
    operator: OperatorContext,
    ticket: TicketRecord,
    sale: EventRecord,
  ): Promise<SaleUndoBlock | null> {
    const later = await this.events.findMany(
      operator,
      { ticketId: ticket._id, _id: { $ne: sale._id } },
      { select: "type eventId" },
    );
    const saleVersion = versionOfEvent(sale.eventId);
    const after = later.filter(
      (event) => versionOfEvent(event.eventId) > saleVersion,
    );
    const undone = after.some(
      (event) => event.type === TICKET_EVENT_TYPE.saleUndo,
    );
    const shift =
      sale.shiftId === null
        ? null
        : await this.shifts.findById(operator, sale.shiftId);
    return saleUndoBlockOf({
      soldByMe:
        operator.actorId !== null && sale.by?.equals(operator.actorId) === true,
      soldAt: sale.at,
      now: this.clock.now(),
      shiftOpen: shift !== null && shift.closedAt === null,
      changedAfterSale: after.length > 0,
      undone,
    });
  }

  private async saleModel(
    operator: OperatorContext,
    ticket: TicketRecord,
    sale: EventRecord,
  ): Promise<LotteryStoreSaleModel> {
    const [book, block, points] = await Promise.all([
      this.books.findById(operator, ticket.bookId),
      this.undoBlockOf(operator, ticket, sale),
      this.support.cashPointsOf(operator, ticket.orgId),
    ]);
    const pointId = sale.cashPointId ?? null;
    return {
      ticketId: String(ticket._id),
      version: ticket.version,
      ticketKey: displayTicketKey(
        book?.gameCode ?? "",
        ticket.bookNo,
        ticket.ticketNo,
      ),
      amount: sale.amount,
      soldAt: sale.at,
      cashPoint: ref(
        pointId ?? new Types.ObjectId(),
        pointId === null ? "" : (points.get(String(pointId))?.name ?? ""),
      ),
      shiftId: String(sale.shiftId ?? ""),
      undone: block === "already_undone",
      undoBlock: block,
    };
  }

  /** 已售的張最近一次售出算進的班。 */
  private async soldShiftsOf(
    operator: OperatorContext,
    ticketIds: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (ticketIds.length === 0) {
      return new Map();
    }
    const sales = await this.events.findMany(
      operator,
      { ticketId: { $in: [...ticketIds] }, type: TICKET_EVENT_TYPE.sale },
      { sort: { at: 1, _id: 1 }, select: "ticketId shiftId" },
    );
    const latest = new Map<string, string>();
    for (const sale of sales) {
      if (sale.shiftId !== null) {
        latest.set(String(sale.ticketId), String(sale.shiftId));
      }
    }
    return latest;
  }

  private async orgNamesOf(
    reader: OperatorContext,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const found = await this.orgs.findMany(reader, {
      _id: { $in: [...ids] },
    });
    return new Map(found.map((org) => [String(org._id), org.name]));
  }
}
