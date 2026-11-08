import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { type ClientSession, Types } from "mongoose";

import { COLLATION_LOCALE } from "@repo/domain/collation";
import {
  COUNT_SALE_REF_TYPE,
  type CountMode,
  STORE_PERMISSIONS,
  type SaleUndoBlock,
  type StoreScanContext,
  type StoreScanDecision,
  type StoreScanPartner,
  type StoreScanTicketFacts,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketSoldSource,
  changedAfterSaleOf,
  displayTicketKey,
  isMatchingCountMode,
  isSealedInStore,
  normalizeBookNo,
  parseTicketInput,
  pendingSkipCountOf,
  pickForReversal,
  saleUndoBlockOf,
  storeScanDecisionOf,
  storeScanMatchPlacesOf,
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
import { countsOfBook } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";
import type {
  LotteryStoreScanInput,
  LotteryStoreTicketRefInput,
  SellLotteryTicketsInput,
  UndoLotteryCountSaleInput,
  UndoLotteryTicketSaleInput,
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
  StoreMatching,
  afterMatchOf,
  matchEventsOf,
  ticketCopyOf,
} from "./store-matching";
import {
  alreadySoldError,
  countSaleNotFoundError,
  countUndoExceedsError,
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
/** 撤銷限制要看的事件欄位(`to`:事件後的狀態,找這張何時接手售出)。 */
type LaterEvent = Pick<EventRecord, "_id" | "type" | "eventId" | "from" | "to">;

/** 一筆售出與現在帶著它的張(張數店規格 5.1 `saleEventId`;已撤銷 = null)。 */
interface CarriedSale {
  sale: EventRecord;
  carrier: TicketRecord | null;
  /** 售出事件上原本記的張(帶著它的張被對號換走時仍顯示得出來) */
  original: TicketRecord | null;
}

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

const isShiftMine = (
  operator: OperatorContext,
  shift: ShiftRecord | undefined,
): boolean =>
  operator.actorId !== null &&
  shift?.openedBy.equals(operator.actorId) === true;

/** 刷到的張與它所在收銀點那一班(判斷 `storeScanDecisionOf` 用;店與未拆另外給)。 */
function scanFactsOf(
  operator: OperatorContext,
  ticket: TicketRecord,
  counterShift?: ShiftRecord,
): Omit<StoreScanTicketFacts, "inThisStore" | "bookUnopened"> {
  const pointId = ticket.location.cashPointId ?? null;
  return {
    status: ticket.status,
    locationKind: ticket.location.kind,
    cashPointId: pointId === null ? null : String(pointId),
    locked: ticket.lockedBy !== null,
    counterShiftIsMine: isShiftMine(operator, counterShift),
    unmatched: ticket.unmatched,
  };
}

/** 配對張的位置與那一班(對號後刷到的張接手這個位置)。 */
function partnerFactsOf(
  operator: OperatorContext,
  partner: TicketRecord | undefined,
  openShifts: ReadonlyMap<string, ShiftRecord>,
): StoreScanPartner | null {
  if (partner === undefined) {
    return null;
  }
  const pointId = partner.location.cashPointId ?? null;
  return {
    locationKind: partner.location.kind,
    cashPointId: pointId === null ? null : String(pointId),
    counterShiftIsMine: isShiftMine(
      operator,
      pointId === null ? undefined : openShifts.get(String(pointId)),
    ),
  };
}

/**
 * 這張何時接手現在帶著的售出:最後一筆讓它帶著售出的事件(改成已售的售出,或對號)的版本;沒有 → `fallback`。
 * 已售之後的移櫃等(已售 → 已售、不是對號)不算接手,算「之後有異動」。
 */
function acquiredVersionOf(
  events: readonly LaterEvent[],
  fallback: number,
): number {
  return events.reduce(
    (latest, event) =>
      event.to.status === TICKET_STATUS.sold &&
      (event.type === TICKET_EVENT_TYPE.match ||
        event.from?.status !== TICKET_STATUS.sold)
        ? Math.max(latest, versionOfEvent(event.eventId))
        : latest,
    fallback,
  );
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
  countMode: CountMode;
  /** 依 6.3 找到的配對張(依刷到的張 id) */
  partners: Map<string, TicketRecord>;
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
  countMode: CountMode;
}

interface SoldRow {
  ticket: TicketRecord;
  shift: ShiftRecord;
  amount: number;
  at: Date;
  version: number;
  matched: boolean;
}

/**
 * 這張的錢算在哪一班、要不要先移櫃(規格 6.3「錢算在哪一班」、3.3 移櫃情境表);不能賣 → 拋錯。
 * 手動標記只在本機收銀點檯面上的張(展開卡片 [標記售出])。
 */
function saleTargetOf(
  plan: SalePlan,
  ticket: TicketRecord,
  decision: StoreScanDecision,
  openShifts: ReadonlyMap<string, ShiftRecord>,
  localShift: ShiftRecord,
): { shift: ShiftRecord; move: boolean } {
  // `ticket` = 對號之後的樣子。已售:已售·未對號找不到配對 → 不能賣(規格 6.4),其他照現況「已於 hh:mm 售出」
  if (
    ticket.status === TICKET_STATUS.sold &&
    ticket.soldAt &&
    decision.blockReason !== "unmatched_no_partner"
  ) {
    throw alreadySoldError(String(ticket._id), ticket.soldAt);
  }
  const pointId = ticket.location.cashPointId ?? null;
  const counterShift =
    pointId === null ? undefined : openShifts.get(String(pointId));
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
    private readonly matching: StoreMatching,
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
    const [points, openShifts, games, countMode] = await Promise.all([
      this.support.cashPointsOf(operator, store.orgId),
      this.support.openShiftsOf(operator, store.orgId),
      this.support.gamesOf(
        reader,
        picked.map((ticket) => ticket.gameId),
      ),
      this.matching.modeOf(operator, store.orgId),
    ]);
    const localId = parseId(input.localCashPointId);
    const context = this.scanContextOf(
      localId,
      openShifts,
      grant.has(STORE_PERMISSIONS.sell),
      grant.has(STORE_PERMISSIONS.move),
      countMode,
    );
    // 張數店:未對號或位置不同的張先依 6.3 找配對張(只讀;真正對號在售出的交易裡重挑)
    const partners = await this.matching.partnersOf(
      operator,
      store.orgId,
      picked.flatMap((ticket) => {
        if (!ticket.orgId.equals(store.orgId)) {
          return [];
        }
        const places = storeScanMatchPlacesOf(
          {
            ...scanFactsOf(operator, ticket),
            inThisStore: true,
            bookUnopened: false,
          },
          context,
        );
        return places === null ? [] : [{ ticket, places }];
      }),
    );
    const scope: ScanScope = {
      operator,
      store,
      localId,
      canSell: context.canSell,
      canMove: context.canMove,
      countMode,
      partners,
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
    return items.toSorted((a, b) =>
      a.gameCode.localeCompare(b.gameCode, COLLATION_LOCALE),
    );
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
      this.scanContextOf(
        scope.localId,
        scope.openShifts,
        scope.canSell,
        scope.canMove,
        scope.countMode,
      ),
      partnerFactsOf(
        scope.operator,
        scope.partners.get(String(ticket._id)),
        scope.openShifts,
      ),
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
      unmatched: ticket.unmatched,
      match: decision.match,
    };
  }

  /** 刷到時的銷售條件(規格 6.3)與這家店的盤點制度(張數店規格 6.7)。 */
  private scanContextOf(
    localId: Types.ObjectId | null,
    openShifts: ReadonlyMap<string, ShiftRecord>,
    canSell: boolean,
    canMove: boolean,
    countMode: CountMode,
  ): StoreScanContext {
    return {
      localCashPointId: localId === null ? null : String(localId),
      localShiftOpen: localId !== null && openShifts.has(String(localId)),
      canSell,
      canMove,
      countMode,
    };
  }

  /** 這本在這家店還沒拆(整本原封不動而且整本都在這家店;`isSealedInStore`)。 */
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
    // 這家店原封不動:整本都在這家店、從沒拆過、張全是未售在庫存
    return isSealedInStore(
      { counts: countsOfBook(book), firstOpenedAt: book.firstOpenedAt ?? null },
      tickets.filter((item) => item.status !== TICKET_STATUS.skipped).length,
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
    const countMode = await this.matching.modeOf(operator, store.orgId);
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
          countMode,
        }),
      );
      return await this.saleRowsOf(operator, store, sold);
    } catch (error) {
      throw await this.explainConflict(operator, refs, error);
    }
  }

  /**
   * 交易內:鎖住要動的班、依處理方式組事件、經帳本寫入。張數店未對號或位置不同的張先在同一個交易裡挑配對張、
   * 寫兩筆「對號」再寫「售出」(張數店規格 6.1 第 4 點、14.2 `sellLotteryTickets`);後面做不了整個交易回復。
   */
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
    const resolve = await this.saleMatchesOf(session, plan, found, openShifts);
    const events: TicketEventInput[] = [];
    const locked = new Set<string>();
    const rows: SoldRow[] = [];
    for (const item of plan.refs) {
      const read = byId.get(String(item.id));
      if (read === undefined) {
        throw notSellableError(String(item.id), "not_this_store");
      }
      // 金額 = 遊戲面額;讀不到遊戲(主檔沒共用到這家店、或已刪)不能用 0 元賣掉
      const game = games.get(String(read.gameId));
      if (game === undefined) {
        throw gameNotFoundError(String(read._id));
      }
      const { scanned, partner, decision, ticket } = resolve(
        read,
        item.version,
      );
      const matched = partner !== null;
      const target = saleTargetOf(
        plan,
        ticket,
        decision,
        openShifts,
        localShift,
      );
      await this.lockDrawerOnce(operator, target.shift, locked);
      const amount = game.unitPrice;
      if (partner !== null) {
        events.push(...matchEventsOf(scanned, partner, now));
      }
      const version = target.move ? ticket.version + 1 : ticket.version;
      if (target.move) {
        events.push(moveEventOf(ticket, ticket.version, plan.localId, now));
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
        matched,
      });
    }
    await this.ledger.applyTicketEvents(session, { operator }, events);
    await this.support.publish(store);
    return rows;
  }

  /** 鎖住這一班的抽屜(同一批只鎖一次;已結帳 → 本機收銀點沒開班)。 */
  private async lockDrawerOnce(
    operator: OperatorContext,
    shift: ShiftRecord,
    locked: Set<string>,
  ): Promise<void> {
    const key = String(shift._id);
    if (locked.has(key)) {
      return;
    }
    if ((await this.support.lockDrawer(operator, shift._id)) === null) {
      throw localShiftNotOpenError();
    }
    locked.add(key);
  }

  /**
   * 售出前的判斷(交易內):依 6.3 一次挑好這批張的配對張(`StoreMatching.partnersOf`),回一個逐張判斷的函式:
   * 刷到的張(以畫面讀到的版本為準)、要對號時的配對張、`storeScanDecisionOf` 的結果與對號後的樣子。
   */
  private async saleMatchesOf(
    session: ClientSession,
    plan: SalePlan,
    found: readonly TicketRecord[],
    openShifts: ReadonlyMap<string, ShiftRecord>,
  ): Promise<
    (
      read: TicketRecord,
      version: number,
    ) => {
      scanned: TicketRecord;
      partner: TicketRecord | null;
      decision: StoreScanDecision;
      ticket: TicketRecord;
    }
  > {
    const { operator } = plan;
    const context = this.scanContextOf(
      plan.localId,
      openShifts,
      true,
      plan.canMove,
      plan.countMode,
    );
    const factsOf = (ticket: TicketRecord): StoreScanTicketFacts => {
      const pointId = ticket.location.cashPointId ?? null;
      return {
        ...scanFactsOf(
          operator,
          ticket,
          pointId === null ? undefined : openShifts.get(String(pointId)),
        ),
        inThisStore: true,
        bookUnopened: false,
      };
    };
    const partners = await this.matching.partnersOf(
      operator,
      plan.store.orgId,
      found.flatMap((ticket) => {
        const places = storeScanMatchPlacesOf(factsOf(ticket), context);
        return places === null ? [] : [{ ticket, places }];
      }),
      session,
    );
    return (read, version) => {
      const scanned = ticketCopyOf(read, { version });
      const found = partners.get(String(scanned._id));
      const decision = storeScanDecisionOf(
        factsOf(scanned),
        context,
        partnerFactsOf(operator, found, openShifts),
      );
      const partner = decision.match && found !== undefined ? found : null;
      return {
        scanned,
        partner,
        decision,
        ticket: partner === null ? scanned : afterMatchOf(scanned, partner),
      };
    };
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
      matched: row.matched,
      countSale: null,
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
    const carried = await this.carriedSaleOf(operator, ticket);
    if (carried === null) {
      throw notFoundError(`sale not found: ${ticketIdText}`);
    }
    return this.saleModel(operator, carried);
  }

  /**
   * [最近售出]:自己在這一班 30 分鐘內賣的(撤銷過的那一筆標「已撤銷」),新的在上面。一筆刷條碼 / 手動售出一列
   * (顯示現在帶著它的張);一次依張數賣出合成一列「遊戲 × N 張」(張數店規格 13.2、14.2,帶 `refId` 與可撤幾張)。
   */
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
    return this.saleModels(operator, await this.carriersOf(operator, sales), [
      shift,
    ]);
  }

  /**
   * 當下撤銷:撤「現在帶著這筆售出的張」(張數店規格 5.1、7.3「實作必須做到」)。給的張是已售 → 撤它帶著的那一筆;
   * 不是(例:[最近售出] 記的原本那張已被對號換走)→ 找它最近一次售出、撤現在帶著它的張。
   * 刷退的票(給本機收銀點;張數店規格 7.3 第 1 點)見 `undoReturned`。
   */
  async undo(
    operator: OperatorContext,
    input: UndoLotteryTicketSaleInput,
  ): Promise<LotteryStoreSaleModel> {
    const ticket = await this.mustTicket(operator, input.ticketId);
    if (
      input.orgId != null &&
      input.localCashPointId != null &&
      !(ticket.status === TICKET_STATUS.sold && !ticket.unmatched)
    ) {
      const returned = await this.undoReturned(operator, input, ticket);
      if (returned !== null) {
        return returned;
      }
    }
    const carried = await this.carriedSaleOf(operator, ticket);
    if (carried === null) {
      throw notFoundError(`sale not found: ${input.ticketId}`);
    }
    const { sale, carrier } = carried;
    const block = await this.undoBlockOf(operator, carried);
    if (block !== null) {
      throw undoNotAllowedError(block);
    }
    const shiftId = sale.shiftId;
    if (shiftId === null || carrier === null) {
      throw undoNotAllowedError("shift_closed");
    }
    const store: StoreRef = {
      orgId: carrier.orgId,
      tenantId: carrier.tenantId,
    };
    await this.transactions.withTransaction(async (session) => {
      const locked = await this.support.lockDrawer(operator, shiftId);
      if (locked === null) {
        throw undoNotAllowedError("shift_closed");
      }
      // 只撤銷「接手售出之後只有對號」的那個版本(伺服器檢查時讀到的,不用畫面傳來的版本);
      // 檢查之後到寫入之前有人動過這張(例:移櫃)→ 帳本擋下(已被處理)
      await this.ledger.applyTicketEvents(session, { operator }, [
        this.undoEventOf(carrier, carrier.version, sale),
      ]);
      await this.support.publish(store);
    });
    return this.saleModel(operator, { ...carried, carrier: null });
  }

  /**
   * 刷退的票(張數店規格 7.3 第 1 點、14.2 `undoLotteryTicketSale`):這張不是確定張號的已售 → 先和這台
   * 同遊戲最近一筆依張數售出帶著的其中一張對號(這張接手那一筆售出、那張接手這張的狀態),再撤這一張;
   * 都在同一個交易。編號店、或這台沒有依張數售出而這張自己帶著售出 → null(照一般撤銷)。
   * 被鎖定、跳號、報廢、在途、不是本店 → 擋下(U3)。
   */
  private async undoReturned(
    operator: OperatorContext,
    input: UndoLotteryTicketSaleInput,
    scanned: TicketRecord,
  ): Promise<LotteryStoreSaleModel | null> {
    const store = await this.support.mustStore(operator, input.orgId ?? "");
    const local = await this.support.mustCashPoint(
      operator,
      store.orgId,
      input.localCashPointId ?? "",
      "localCashPointId",
    );
    const mode = await this.matching.modeOf(operator, store.orgId);
    if (!isMatchingCountMode(mode)) {
      return null;
    }
    const id = String(scanned._id);
    if (!scanned.orgId.equals(store.orgId)) {
      throw notSellableError(id, "not_this_store");
    }
    if (scanned.lockedBy !== null) {
      throw notSellableError(id, "locked");
    }
    if (
      scanned.status === TICKET_STATUS.skipped ||
      scanned.status === TICKET_STATUS.scrapped
    ) {
      throw notSellableError(id, scanned.status);
    }
    if (scanned.location.kind === TICKET_LOCATION_KIND.inTransit) {
      throw notSellableError(id, "in_transit");
    }
    const carriers = await this.tickets.findMany(
      operator,
      {
        orgId: store.orgId,
        gameId: scanned.gameId,
        "location.cashPointId": local._id,
        status: TICKET_STATUS.sold,
        unmatched: true,
        soldSource: "count",
        lockedBy: null,
        _id: { $ne: scanned._id },
      },
      { sort: { soldAt: -1, _id: -1 }, limit: 1 },
    );
    const [partner] = carriers;
    if (partner?.saleEventId == null) {
      if (scanned.status === TICKET_STATUS.sold) {
        return null;
      }
      throw countSaleNotFoundError(id);
    }
    const sale = await this.events.findOne(operator, {
      eventId: partner.saleEventId,
    });
    if (sale?.shiftId == null) {
      throw countSaleNotFoundError(id);
    }
    const shiftId = sale.shiftId;
    const block = await this.undoBlockOf(operator, {
      sale,
      carrier: partner,
      original: null,
    });
    if (block !== null) {
      throw undoNotAllowedError(block);
    }
    const now = this.clock.now();
    await this.transactions.withTransaction(async (session) => {
      const locked = await this.support.lockDrawer(operator, shiftId);
      if (locked === null) {
        throw undoNotAllowedError("shift_closed");
      }
      await this.ledger.applyTicketEvents(session, { operator }, [
        ...matchEventsOf(scanned, partner, now),
        this.undoEventOf(
          afterMatchOf(scanned, partner),
          scanned.version + 1,
          sale,
        ),
      ]);
      await this.support.publish(store);
    });
    const [model] = await this.saleModels(operator, [
      { sale, carrier: null, original: scanned },
    ]);
    if (model === undefined) {
      throw notFoundError(`sale not found: ${id}`);
    }
    model.matched = true;
    return model;
  }

  /**
   * 撤一筆依張數賣出的其中 N 張(張數店規格 7.3 第 2 點、14.2 `undoLotteryCountSale`):撤這一筆現在帶著的
   * 已售·未對號(`pickForReversal`,售出時間新到舊);這一筆的張都被對號換走(沒有帶著它的已售·未對號)時,
   * 改撤同台、同遊戲最近一筆依張數售出的張。條件照 `saleUndoBlockOf`;同一個交易、每張一筆「撤銷」。
   */
  async undoCountSale(
    operator: OperatorContext,
    input: UndoLotteryCountSaleInput,
  ): Promise<LotteryStoreSaleModel> {
    const store = await this.support.mustStore(operator, input.orgId);
    const refId = parseId(input.refId);
    if (refId === null) {
      throw notFoundError(`count sale not found: ${input.refId}`);
    }
    if (!Number.isInteger(input.count) || input.count < 1) {
      throw validationError("count must be a positive integer", ["count"]);
    }
    const sales = await this.countSaleEventsOf(operator, store, refId);
    const first = sales[0];
    if (first === undefined) {
      throw notFoundError(`count sale not found: ${input.refId}`);
    }
    const carried = await this.carriersOf(operator, sales);
    let rows = carried.filter((row) => row.carrier?.unmatched === true);
    if (rows.length === 0) {
      rows = await this.latestCountSaleOf(operator, store, first);
    }
    const blocks = await this.undoBlocksOf(operator, rows);
    const usable = rows.filter(
      (row) => blocks.get(row.sale.eventId) === null && !row.carrier?.lockedBy,
    );
    const picked = pickForReversal(
      usable.map((row) => ({
        id: row.sale.eventId,
        status: row.carrier?.status ?? TICKET_STATUS.unsold,
        unmatched: row.carrier?.unmatched === true,
        locked: row.carrier?.lockedBy != null,
        soldAt: row.carrier?.soldAt ?? null,
      })),
      input.count,
    );
    if (!picked.ok) {
      const blocked = rows
        .map((row) => blocks.get(row.sale.eventId))
        .find((block) => block != null);
      if (usable.length === 0 && blocked != null) {
        throw undoNotAllowedError(blocked);
      }
      throw countUndoExceedsError(picked.available);
    }
    const chosen = rows.filter((row) =>
      picked.ticketIds.includes(row.sale.eventId),
    );
    await this.transactions.withTransaction(async (session) => {
      for (const shiftId of new Set(
        chosen.map((row) => String(row.sale.shiftId)),
      )) {
        const locked = await this.support.lockDrawer(
          operator,
          new Types.ObjectId(shiftId),
        );
        if (locked === null) {
          throw undoNotAllowedError("shift_closed");
        }
      }
      await this.ledger.applyTicketEvents(
        session,
        { operator },
        chosen.flatMap((row) =>
          row.carrier === null
            ? []
            : [this.undoEventOf(row.carrier, row.carrier.version, row.sale)],
        ),
      );
      await this.support.publish(store);
    });
    const after = await this.countSaleEventsOf(operator, store, refId);
    const [model] = await this.saleModels(
      operator,
      await this.carriersOf(operator, after),
    );
    if (model === undefined) {
      throw notFoundError(`count sale not found: ${input.refId}`);
    }
    return model;
  }

  /** 一次依張數賣出的售出事件(`refId` 的時間 = 售出時間,走 `{ orgId, at }` 索引;見 `countSaleRefIdAt`)。 */
  private countSaleEventsOf(
    operator: OperatorContext,
    store: StoreRef,
    refId: Types.ObjectId,
  ): Promise<EventRecord[]> {
    const from = refId.getTimestamp();
    return this.events.findMany(
      operator,
      {
        orgId: store.orgId,
        at: { $gte: from, $lt: new Date(from.getTime() + 1000) },
        type: TICKET_EVENT_TYPE.sale,
        refType: COUNT_SALE_REF_TYPE,
        refId,
      },
      { sort: { at: -1, _id: -1 } },
    );
  }

  /** 同台、同遊戲最近一筆依張數售出現在帶著的已售·未對號(這一筆的張都被換走時改撤它;7.3 第 2 點)。 */
  private async latestCountSaleOf(
    operator: OperatorContext,
    store: StoreRef,
    sale: EventRecord,
  ): Promise<CarriedSale[]> {
    const latest = await this.tickets.findOne(
      operator,
      {
        orgId: store.orgId,
        gameId: sale.gameId,
        "location.cashPointId": sale.cashPointId,
        status: TICKET_STATUS.sold,
        unmatched: true,
        soldSource: "count",
      },
      { sort: { soldAt: -1, _id: -1 } },
    );
    const latestSale =
      latest?.saleEventId == null
        ? null
        : await this.events.findOne(operator, { eventId: latest.saleEventId });
    if (latestSale?.refId == null) {
      return [];
    }
    const sales = await this.countSaleEventsOf(
      operator,
      store,
      latestSale.refId,
    );
    const carried = await this.carriersOf(operator, sales);
    return carried.filter((row) => row.carrier?.unmatched === true);
  }

  /** 撤銷一筆售出(撤「現在帶著它的張」;當下撤銷扣那一班的應有現金)。 */
  private undoEventOf(
    carrier: TicketRecord,
    expectedVersion: number,
    sale: EventRecord,
  ): TicketEventInput {
    return {
      ticketId: carrier._id,
      expectedVersion,
      expectedStatuses: [TICKET_STATUS.sold],
      type: TICKET_EVENT_TYPE.saleUndo,
      at: this.clock.now(),
      patch: { status: TICKET_STATUS.unsold, sold: null },
      amount: sale.amount,
      cashEffect: "decrease",
      cashPointId: sale.cashPointId,
      shiftId: sale.shiftId,
      refType: "sale",
      refId: sale._id,
    };
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
    const unopened = isSealedInStore(
      { counts: countsOfBook(book), firstOpenedAt: book.firstOpenedAt ?? null },
      usable.length,
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
      pendingSkipTotal: pendingSkipOf(book),
      unopened,
      unmatchedCount: usable.filter((ticket) => ticket.unmatched).length,
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
          soldSource:
            ticket.status === TICKET_STATUS.sold
              ? (ticket.soldSource ?? null)
              : null,
          locked: ticket.lockedBy !== null,
          unmatched: ticket.unmatched,
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

  /**
   * 這張帶著的售出,或它最近一次售出、現在帶著它的張(張數店規格 5.1):已售而且帶著售出事件 → 那一筆;
   * 其他 → 最近一次售出事件,再找現在帶著它的張(沒有 = 已撤銷)。舊資料(T1 前賣的,沒有 `saleEventId`)
   * 的已售張帶著自己最近一次售出。
   */
  private async carriedSaleOf(
    operator: OperatorContext,
    ticket: TicketRecord,
  ): Promise<CarriedSale | null> {
    if (ticket.status === TICKET_STATUS.sold && ticket.saleEventId != null) {
      const sale = await this.events.findOne(operator, {
        eventId: ticket.saleEventId,
      });
      return sale === null ? null : { sale, carrier: ticket, original: null };
    }
    const sale = await this.lastSaleOf(operator, ticket._id);
    if (sale === null) {
      return null;
    }
    const [row] = await this.carriersOf(operator, [sale], [ticket]);
    return row ?? null;
  }

  /**
   * 一批售出事件與現在帶著它們的張(一次讀:帶著售出事件的張 + 售出事件上原本記的張;TX-07)。
   * 帶著它的張:`saleEventId` = 這筆事件;沒有而原本那張是已售、沒有 `saleEventId`、最近一次售出就是這筆
   * (舊資料)→ 原本那張;都不是 → null(已撤銷)。
   */
  private async carriersOf(
    operator: OperatorContext,
    sales: readonly EventRecord[],
    known: readonly TicketRecord[] = [],
  ): Promise<CarriedSale[]> {
    if (sales.length === 0) {
      return [];
    }
    const knownIds = new Set(known.map((ticket) => String(ticket._id)));
    const found = await this.tickets.findMany(operator, {
      $or: [
        { saleEventId: { $in: sales.map((sale) => sale.eventId) } },
        {
          _id: {
            $in: sales
              .map((sale) => sale.ticketId)
              .filter((id) => !knownIds.has(String(id))),
          },
        },
      ],
    });
    const tickets = [...known, ...found];
    const byId = new Map(tickets.map((ticket) => [String(ticket._id), ticket]));
    const bySale = new Map(
      tickets.flatMap((ticket) =>
        ticket.saleEventId == null ? [] : [[ticket.saleEventId, ticket]],
      ),
    );
    const legacy = await this.lastSalesOf(
      operator,
      tickets.filter(
        (ticket) =>
          ticket.status === TICKET_STATUS.sold && ticket.saleEventId == null,
      ),
    );
    return sales.map((sale) => {
      const original = byId.get(String(sale.ticketId)) ?? null;
      const carrier =
        bySale.get(sale.eventId) ??
        (original !== null && legacy.get(String(original._id)) === sale.eventId
          ? original
          : null);
      return { sale, carrier, original };
    });
  }

  /** 舊資料的已售張(沒有 `saleEventId`)最近一次售出的事件 id。 */
  private async lastSalesOf(
    operator: OperatorContext,
    tickets: readonly TicketRecord[],
  ): Promise<Map<string, string>> {
    if (tickets.length === 0) {
      return new Map();
    }
    const sales = await this.events.findMany(
      operator,
      {
        ticketId: { $in: tickets.map((ticket) => ticket._id) },
        type: TICKET_EVENT_TYPE.sale,
      },
      { sort: { at: 1, _id: 1 }, select: "ticketId eventId" },
    );
    return new Map(sales.map((sale) => [String(sale.ticketId), sale.eventId]));
  }

  private async undoBlockOf(
    operator: OperatorContext,
    carried: CarriedSale,
  ): Promise<SaleUndoBlock | null> {
    const blocks = await this.undoBlocksOf(operator, [carried]);
    return blocks.get(carried.sale.eventId) ?? null;
  }

  /** 一批售出的撤銷限制(依售出事件 id;帶著它的張的事件、售出算進的班一批各讀一次)。 */
  private async undoBlocksOf(
    operator: OperatorContext,
    rows: readonly CarriedSale[],
    knownShifts: readonly ShiftRecord[] = [],
  ): Promise<Map<string, SaleUndoBlock | null>> {
    const carriers = rows.flatMap((row) =>
      row.carrier === null ? [] : [row.carrier._id],
    );
    const [later, shifts] = await Promise.all([
      this.laterEventsOf(operator, carriers),
      this.shiftsOf(
        operator,
        rows.map((row) => row.sale),
        knownShifts,
      ),
    ]);
    return new Map(
      rows.map((row) => [
        row.sale.eventId,
        this.blockOf(operator, row, later, shifts),
      ]),
    );
  }

  /**
   * 撤銷限制(`later` = 帶著它的張的事件,依張分組;`shifts` = 售出算進的班):沒有張帶著 = 已撤銷;
   * 「之後有異動」= 這張接手這筆售出(售出或對號)之後,除了對號以外還有事件(張數店規格 7.3、14.1)。
   */
  private blockOf(
    operator: OperatorContext,
    row: CarriedSale,
    later: ReadonlyMap<string, readonly LaterEvent[]>,
    shifts: ReadonlyMap<string, { closedAt: Date | null }>,
  ): SaleUndoBlock | null {
    const { sale, carrier } = row;
    const events =
      carrier === null ? [] : (later.get(String(carrier._id)) ?? []);
    const acquired = acquiredVersionOf(events, versionOfEvent(sale.eventId));
    const after = events.filter(
      (event) => versionOfEvent(event.eventId) > acquired,
    );
    const shift =
      sale.shiftId === null ? undefined : shifts.get(String(sale.shiftId));
    return saleUndoBlockOf({
      soldByMe:
        operator.actorId !== null && sale.by?.equals(operator.actorId) === true,
      soldAt: sale.at,
      now: this.clock.now(),
      shiftOpen: shift?.closedAt === null,
      changedAfterSale: changedAfterSaleOf(after.map((event) => event.type)),
      undone: carrier === null,
    });
  }

  /** 這幾張的事件(撤銷限制用),依張分組。 */
  private async laterEventsOf(
    operator: OperatorContext,
    ticketIds: readonly Types.ObjectId[],
  ): Promise<Map<string, LaterEvent[]>> {
    if (ticketIds.length === 0) {
      return new Map();
    }
    const events = await this.events.findMany(
      operator,
      { ticketId: { $in: [...ticketIds] } },
      { select: "ticketId type eventId from to" },
    );
    const byTicket = new Map<string, LaterEvent[]>();
    for (const event of events) {
      const key = String(event.ticketId);
      byTicket.set(key, [...(byTicket.get(key) ?? []), event]);
    }
    return byTicket;
  }

  /** 售出算進的班(`known` = 已讀到的班,不再讀)。 */
  private async shiftsOf(
    operator: OperatorContext,
    sales: readonly EventRecord[],
    known: readonly ShiftRecord[] = [],
  ): Promise<Map<string, { closedAt: Date | null }>> {
    const result = new Map<string, { closedAt: Date | null }>(
      known.map((shift) => [String(shift._id), shift]),
    );
    const missing = [
      ...new Set(
        sales.flatMap((sale) =>
          sale.shiftId === null ? [] : [String(sale.shiftId)],
        ),
      ),
    ].filter((id) => !result.has(id));
    if (missing.length > 0) {
      const shifts = await this.shifts.findMany(
        operator,
        { _id: { $in: missing.map((id) => new Types.ObjectId(id)) } },
        { select: "closedAt" },
      );
      for (const shift of shifts) {
        result.set(String(shift._id), shift);
      }
    }
    return result;
  }

  private async saleModel(
    operator: OperatorContext,
    carried: CarriedSale,
  ): Promise<LotteryStoreSaleModel> {
    const [model] = await this.saleModels(operator, [carried]);
    if (model === undefined) {
      throw notFoundError(`sale not found: ${String(carried.sale.ticketId)}`);
    }
    return model;
  }

  /**
   * 一批售出的畫面資料(順序照給的):本、遊戲、收銀點、撤銷限制(帶著它的張的事件、售出算進的班)一批各讀一次
   * (最近售出一次幾十上百筆;TX-07)。同一次依張數賣出(`refType: count_sale`、同一個 `refId`)合成一列,
   * 放在第一筆出現的位置。`knownShifts` = 已讀到的班。
   */
  private async saleModels(
    operator: OperatorContext,
    rows: readonly CarriedSale[],
    knownShifts: readonly ShiftRecord[] = [],
  ): Promise<LotteryStoreSaleModel[]> {
    if (rows.length === 0) {
      return [];
    }
    const unique = (ids: readonly Types.ObjectId[]) => [
      ...new Map(ids.map((id) => [String(id), id])).values(),
    ];
    const shown = rows.map((row) => row.carrier ?? row.original);
    const tickets = shown.flatMap((ticket) =>
      ticket === null ? [] : [ticket],
    );
    const countRows = rows.filter(
      (row) => row.sale.refType === COUNT_SALE_REF_TYPE,
    );
    const [books, blocks, points, games] = await Promise.all([
      this.books.findMany(
        operator,
        { _id: { $in: unique(tickets.map((ticket) => ticket.bookId)) } },
        { select: "gameCode" },
      ),
      this.undoBlocksOf(operator, rows, knownShifts),
      this.support.cashPointsOf(
        operator,
        unique(rows.map((row) => row.sale.orgId)),
      ),
      this.support.gamesOf(
        operator,
        unique(countRows.map((row) => row.sale.gameId)),
      ),
    ]);
    const bookOf = new Map(books.map((book) => [String(book._id), book]));
    const cashPointOf = (sale: EventRecord) => {
      const pointId = sale.cashPointId ?? null;
      // 收銀點只認售出那家店的
      const point = pointId === null ? undefined : points.get(String(pointId));
      return ref(
        pointId ?? new Types.ObjectId(),
        point?.orgId.equals(sale.orgId) ? point.name : "",
      );
    };
    const groups = new Map<string, CarriedSale[]>();
    for (const row of countRows) {
      const key = String(row.sale.refId);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const models: LotteryStoreSaleModel[] = [];
    const done = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const { sale } = row;
      if (sale.refType === COUNT_SALE_REF_TYPE) {
        const key = String(sale.refId);
        if (done.has(key)) {
          continue;
        }
        done.add(key);
        models.push(
          this.countRowOf(
            groups.get(key) ?? [row],
            blocks,
            games.get(String(sale.gameId)),
            cashPointOf(sale),
          ),
        );
        continue;
      }
      const ticket = shown[index] ?? null;
      const book =
        ticket === null ? undefined : bookOf.get(String(ticket.bookId));
      const block = blocks.get(sale.eventId) ?? null;
      models.push({
        ticketId: String(ticket?._id ?? sale.ticketId),
        version: ticket?.version ?? 0,
        ticketKey: displayTicketKey(
          book?.gameCode ?? "",
          ticket?.bookNo ?? "",
          ticket?.ticketNo ?? "",
        ),
        amount: sale.amount,
        soldAt: sale.at,
        cashPoint: cashPointOf(sale),
        shiftId: String(sale.shiftId ?? ""),
        undone: block === "already_undone",
        undoBlock: block,
        matched: false,
        countSale: null,
      });
    }
    return models;
  }

  /**
   * 一次依張數賣出合成的一列(張數店規格 13.2):張數、已撤幾張、現在可以撤幾張(帶著它的已售·未對號、沒被鎖、
   * 之後沒有異動);全撤 = 已撤銷,其他不能撤的原因取第一個(超過 30 分鐘、不是自己賣的…)。
   */
  private countRowOf(
    rows: readonly CarriedSale[],
    blocks: ReadonlyMap<string, SaleUndoBlock | null>,
    game: GameRecord | undefined,
    cashPoint: { id: string; name: string },
  ): LotteryStoreSaleModel {
    const [first] = rows;
    if (first === undefined) {
      throw notFoundError("count sale has no tickets");
    }
    const live = rows.filter((row) => row.carrier !== null);
    const undoable = live.filter(
      (row) =>
        row.carrier?.unmatched === true &&
        row.carrier.lockedBy === null &&
        (blocks.get(row.sale.eventId) ?? null) === null,
    );
    let block: SaleUndoBlock | null = null;
    if (live.length === 0) {
      block = "already_undone";
    } else if (undoable.length === 0) {
      block =
        live
          .map((row) => blocks.get(row.sale.eventId) ?? null)
          .find((item) => item !== null) ?? "changed";
    }
    const ticket = live[0]?.carrier ?? first.original;
    return {
      ticketId: String(ticket?._id ?? first.sale.ticketId),
      version: ticket?.version ?? 0,
      ticketKey: game?.gameCode ?? "",
      amount: rows.reduce((sum, row) => sum + row.sale.amount, 0),
      soldAt: first.sale.at,
      cashPoint,
      shiftId: String(first.sale.shiftId ?? ""),
      undone: live.length === 0,
      undoBlock: block,
      matched: false,
      countSale: {
        refId: String(first.sale.refId),
        gameId: String(first.sale.gameId),
        gameCode: game?.gameCode ?? "",
        gameName: game?.name ?? "",
        unitPrice: game?.unitPrice ?? first.sale.amount,
        count: rows.length,
        undoneCount: rows.length - live.length,
        undoableCount: undoable.length,
      },
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
