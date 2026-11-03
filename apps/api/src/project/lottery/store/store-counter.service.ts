import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import { COLLATION_LOCALE } from "@repo/domain/collation";
import {
  type CountMode,
  type CountPickBook,
  type CounterScanContext,
  type CounterScanDecision,
  type CounterScanProblem,
  type CounterScanTicketFacts,
  STORE_PERMISSIONS,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  counterScanDecisionOf,
  counterScanMatchPlacesOf,
  isMatchingCountMode,
  isSealedInStore,
  moveByCountProblemOf,
  normalizeBookNo,
  parseTicketInput,
  pickForCountSale,
  splitNeedsActualCount,
  splitPlanProblemOf,
  splitSkipCountOf,
} from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { TransactionService } from "../../../database/transaction";
import {
  LotteryBooksRepository,
  type LotteryTicketDocument,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { StoreCountModeService } from "../settings/store-count-mode.service";
import { countsOfBook, pendingSkipCountOfBook } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";
import type {
  LotteryStoreCounterScanInput,
  MoveLotteryTicketsByCountInput,
  MoveLotteryTicketsInput,
  RecallLotteryTicketsInput,
  SplitLotteryBookInput,
} from "./dto/lottery-store-sales.input";
import type {
  LotteryStoreCounterScanItemModel,
  LotteryStoreStockBookModel,
} from "./models/lottery-store-sales.model";
import { parseId } from "./shift-views";
import { StoreAccess } from "./store-access";
import { StoreClock } from "./store-clock";
import { forbiddenError, notFoundError, validationError } from "./store-error";
import { StoreMatching, matchEventsOf, ticketCopyOf } from "./store-matching";
import {
  bookAlreadyOpenedError,
  countStoreScanOnlyError,
  counterTicketBlockedError,
  moveByCountInvalidError,
  movePausedError,
  notOnCounterError,
  splitActualCountMismatchError,
  splitActualCountRequiredError,
  splitPlanInvalidError,
} from "./store-sales-error";
import { type StoreRef, StoreSalesSupport } from "./store-sales-support";
import { ticketRefsOf } from "./store-sales.service";

type TicketRecord = Persisted<LotteryTicketDocument>;

/** 收回 / 移櫃寫的那一筆(收回 → 庫存;移櫃 → 要移到的收銀點)。 */
type CounterAction =
  { kind: "recall" } | { kind: "move"; toCashPointId: Types.ObjectId };

/** 刷到的張的事實(收回 / 刷條碼移櫃的判斷用)。 */
function counterFactsOf(
  ticket: TicketRecord,
  orgId: Types.ObjectId,
): CounterScanTicketFacts {
  const pointId = ticket.location.cashPointId ?? null;
  return {
    inThisStore: ticket.orgId.equals(orgId),
    status: ticket.status,
    unmatched: ticket.unmatched,
    locked: ticket.lockedBy !== null,
    locationKind: ticket.location.kind,
    cashPointId: pointId === null ? null : String(pointId),
  };
}

/** 收回 / 移櫃那一筆事件(狀態不變、只換位置;事件記從哪台離開 / 移到哪台)。 */
function counterEventOf(
  ticketId: Types.ObjectId,
  expectedVersion: number,
  action: CounterAction,
  from: Types.ObjectId | null,
  at: Date,
): TicketEventInput {
  const base = {
    ticketId,
    expectedVersion,
    expectedStatuses: [TICKET_STATUS.unsold],
    at,
  };
  return action.kind === "recall"
    ? {
        ...base,
        type: TICKET_EVENT_TYPE.recall,
        patch: {
          location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
        },
        cashPointId: from,
      }
    : {
        ...base,
        type: TICKET_EVENT_TYPE.move,
        patch: {
          location: {
            kind: TICKET_LOCATION_KIND.counter,
            cashPointId: action.toCashPointId,
          },
        },
        cashPointId: action.toCashPointId,
      };
}

/**
 * 拆本、移櫃、收回(專案規格 6.4、3.3;張數店規格 7.5–7.7;正本 `docs/modules/project/store.md`「銷售與拆本」
 * 「收回與移櫃」):
 *
 * - **拆本 / 上檯面**(`store.split`):本店庫存的張放上檯面。從沒拆過的本 → ① 標跳號(剛好待標註張數)
 *   ② 每一張放到一個收銀點;拆過的本只有 ②(只分配庫存的張)。張數店與轉換中不是原封不動的本先問手上實際張數,
 *   比系統少 d 張就要從庫存的張號標 d 張跳號(7.5)。寫「跳號」與「拆本」事件
 * - **移櫃 / 收回**(`store.move`):檯面上未售的張移到別的收銀點 / 收回庫存;一律寫事件、不需審核。
 *   張數店與轉換中只接受刷條碼或手輸張號的張(格子、整本不行),未對號或系統記在別台的張先在來源台對號(6.3);
 *   對號要 `store.sell`(張數店規格 12)
 * - **依張數移櫃**(`store.move` + `store.sell`;只有張數店):照挑張順序挑來源台這個遊戲的張寫「移櫃」
 * - 移櫃(兩種)檢查 `movePauses`、`$inc` 分店那一筆的 `version`(8.5、8.5a B1 / B2)
 *
 * 張的狀態與事件一律經帳本(條件更新,同一個交易;一批張整批寫,TX-06)。
 */
@Injectable()
export class StoreCounterService {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly orgs: OrgsRepository,
    private readonly ledger: TicketLedgerService,
    private readonly transactions: TransactionService,
    private readonly support: StoreSalesSupport,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
    private readonly matching: StoreMatching,
    private readonly countModes: StoreCountModeService,
  ) {}

  /**
   * 拆本 / 上檯面「先選本」:本店有未售、在庫存、沒被鎖的張的本(使用者 10/27 定案 D:拆本 = 把本店庫存的張
   * 放上檯面;被調貨單鎖住的張不算,全部鎖住的本不列),依遊戲代號、本號排序。`sealed` = 這家店原封不動
   * (從沒拆過、這家店的張全是未售在庫存;標「未拆」,要標跳號、張數扣待標註);其他標「拆過 · 庫存 N 張」,
   * 不標跳號、張數照庫存的張(待標註保留,之後在本的詳情 [標跳號] 補標;張數店另問手上實際張數,7.5)。
   */
  async stockBooks(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryStoreStockBookModel[]> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, orgIdText);
    const rows = await this.tickets.aggregate(operator, [
      {
        $match: { orgId: store.orgId, status: { $ne: TICKET_STATUS.skipped } },
      },
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
    ]);
    if (rows.length === 0) {
      return [];
    }
    const rowOf = new Map(
      rows.map((row) => [
        String(row._id),
        { total: Number(row.total), inStock: Number(row.inStock) },
      ]),
    );
    const books = await this.books.findMany(operator, {
      _id: { $in: rows.map((row) => row._id as Types.ObjectId) },
      status: "normal",
    });
    const games = await this.support.gamesOf(
      operator,
      books.map((book) => book.gameId),
    );
    return books
      .map((book) => {
        const game = games.get(String(book.gameId));
        const row = rowOf.get(String(book._id)) ?? { total: 0, inStock: 0 };
        const sealed =
          row.total === row.inStock &&
          isSealedInStore(
            {
              counts: countsOfBook(book),
              firstOpenedAt: book.firstOpenedAt ?? null,
            },
            row.total,
          );
        const pendingSkipTotal = pendingSkipCountOfBook(book);
        const pendingSkipCount = sealed ? pendingSkipTotal : 0;
        return {
          bookId: String(book._id),
          gameCode: book.gameCode,
          gameName: game?.name ?? "",
          unitPrice: game?.unitPrice ?? 0,
          bookNo: book.bookNo,
          firstTicketNo: book.firstTicketNo,
          lastTicketNo: book.lastTicketNo,
          // 未拆的本:待標註的跳號(拆本前還沒標的)實體不存在,不算張數(使用者 10/27 定案甲)
          ticketCount: Math.max(0, row.inStock - pendingSkipCount),
          pendingSkipCount,
          sealed,
          pendingSkipTotal,
        };
      })
      .toSorted(
        (a, b) =>
          a.gameCode.localeCompare(b.gameCode, COLLATION_LOCALE) ||
          a.bookNo.localeCompare(b.bookNo, COLLATION_LOCALE),
      );
  }

  /**
   * 拆本 / 上檯面:把這本在本店庫存、未售、沒被鎖的張放到收銀點檯面(寫「拆本」事件;帳本在第一次寫
   * `firstOpenedAt`)。這家店原封不動的本照原流程先標跳號(剛好待標註張數);張數店與轉換中不是原封不動的本
   * 要給手上實際張數(`actualCount`):系統比實際多 d 張就要剛好標 d 張跳號,d 超過待標註 / 實際比系統多 → 擋
   * (張數店規格 7.5);編號店其他本不標跳號,待標註保留(使用者 10/27 定案 M1)。
   * 本店沒有可放的庫存張 → `BOOK_ALREADY_OPENED`(清單已過時)。
   */
  async split(
    operator: OperatorContext,
    input: SplitLotteryBookInput,
  ): Promise<number> {
    const store = await this.support.mustStore(operator, input.orgId);
    const bookId = parseId(input.bookId);
    const book =
      bookId === null ? null : await this.books.findById(operator, bookId);
    if (book === null) {
      throw notFoundError(`book not found: ${input.bookId}`);
    }
    const pointIds = new Map<string, Types.ObjectId>();
    for (const assignment of input.assignments) {
      const point = await this.support.mustCashPoint(
        operator,
        store.orgId,
        assignment.cashPointId,
        "assignments",
      );
      pointIds.set(assignment.cashPointId, point._id);
    }
    const countMode = await this.matching.modeOf(operator, store.orgId);
    return this.transactions.withTransaction(async (session) => {
      const mine = await this.tickets.findMany(
        operator,
        {
          bookId: book._id,
          orgId: store.orgId,
          status: { $ne: TICKET_STATUS.skipped },
        },
        { session },
      );
      const usable = mine.filter(
        (ticket) =>
          ticket.status === TICKET_STATUS.unsold &&
          ticket.location.kind === TICKET_LOCATION_KIND.stock &&
          ticket.lockedBy === null,
      );
      if (usable.length === 0 || book.status !== "normal") {
        throw bookAlreadyOpenedError();
      }
      // 這家店原封不動(從沒拆過、這家店的張全是未售在庫存、沒被鎖)才標跳號
      const sealed =
        usable.length === mine.length &&
        isSealedInStore(
          {
            counts: countsOfBook(book),
            firstOpenedAt: book.firstOpenedAt ?? null,
          },
          mine.length,
        );
      const skipCount = this.splitSkipCountOf(
        countMode,
        sealed,
        usable.length,
        pendingSkipCountOfBook(book),
        input.actualCount ?? null,
      );
      const problem = splitPlanProblemOf(
        usable.map((ticket) => ticket.ticketNo),
        skipCount,
        input.skippedTicketNos,
        input.assignments,
      );
      if (problem !== null) {
        throw splitPlanInvalidError(problem);
      }
      const byNo = new Map(usable.map((ticket) => [ticket.ticketNo, ticket]));
      const at = this.clock.now();
      const skipped = new Set(input.skippedTicketNos);
      const events: TicketEventInput[] = [];
      for (const no of skipped) {
        const ticket = byNo.get(no);
        if (ticket !== undefined) {
          events.push({
            ticketId: ticket._id,
            expectedVersion: ticket.version,
            expectedStatuses: [TICKET_STATUS.unsold],
            type: TICKET_EVENT_TYPE.skip,
            at,
            patch: { status: TICKET_STATUS.skipped },
          });
        }
      }
      for (const assignment of input.assignments) {
        const cashPointId = pointIds.get(assignment.cashPointId) ?? null;
        for (const no of assignment.ticketNos) {
          const ticket = byNo.get(no);
          if (ticket !== undefined && cashPointId !== null) {
            events.push({
              ticketId: ticket._id,
              expectedVersion: ticket.version,
              expectedStatuses: [TICKET_STATUS.unsold],
              type: TICKET_EVENT_TYPE.open,
              at,
              patch: {
                location: { kind: TICKET_LOCATION_KIND.counter, cashPointId },
              },
              cashPointId,
            });
          }
        }
      }
      await this.ledger.applyTicketEvents(session, { operator }, events);
      await this.support.publish(store);
      return events.length;
    });
  }

  /**
   * 這次拆本要標幾張跳號:原封不動 → 待標註;張數店與轉換中其他本 → 系統比手上實際多幾張就標幾張
   * (沒給實際張數、多出、少太多 → 擋;7.5);編號店其他本 → 0(待標註保留)。
   */
  private splitSkipCountOf(
    countMode: CountMode,
    sealed: boolean,
    systemCount: number,
    pendingSkipTotal: number,
    actualCount: number | null,
  ): number {
    if (!splitNeedsActualCount(countMode, sealed)) {
      return sealed ? pendingSkipTotal : 0;
    }
    if (actualCount === null) {
      throw splitActualCountRequiredError();
    }
    const result = splitSkipCountOf(systemCount, actualCount, pendingSkipTotal);
    if (!result.ok) {
      throw splitActualCountMismatchError(result.problem);
    }
    return result.skipCount;
  }

  /**
   * [收回] / [刷條碼移櫃] 刷到一張(張數店規格 13.1、6.3、7.6、7.7;只讀):解析碼 → 本店對到的張
   * (本號對到兩款以上遊戲時每款一筆;本店沒有而別家店有 → 一筆「不是本店」)→ `counterScanDecisionOf`。
   * 張數店與轉換中依 6.3 在來源台找配對張(只讀;真正對號在送出的交易裡重挑)。
   */
  async counterScan(
    operator: OperatorContext,
    input: LotteryStoreCounterScanInput,
  ): Promise<LotteryStoreCounterScanItemModel[]> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, input.orgId);
    const source = await this.support.mustCashPoint(
      operator,
      store.orgId,
      input.fromCashPointId,
      "fromCashPointId",
    );
    const targetId = parseId(input.toCashPointId);
    const parsed = parseTicketInput(input.code);
    const bookNo = parsed === null ? null : normalizeBookNo(parsed.bookNo);
    if (parsed === null || bookNo === null) {
      return [];
    }
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
    const mine = found.filter((ticket) => ticket.orgId.equals(store.orgId));
    const picked = mine.length > 0 ? mine : found.slice(0, 1);
    if (picked.length === 0) {
      return [];
    }
    const countMode = await this.matching.modeOf(operator, store.orgId);
    const context: CounterScanContext = {
      countMode,
      sourceCashPointId: String(source._id),
      targetCashPointId: targetId === null ? null : String(targetId),
    };
    const partners = await this.matching.partnersOf(
      operator,
      store.orgId,
      mine.map((ticket) => ({
        ticket,
        places:
          counterScanMatchPlacesOf(
            counterFactsOf(ticket, store.orgId),
            context,
          ) ?? [],
      })),
    );
    const [games, points] = await Promise.all([
      this.support.gamesOf(
        reader,
        picked.map((ticket) => ticket.gameId),
      ),
      this.support.cashPointsOf(operator, store.orgId),
    ]);
    const bookById = new Map(books.map((book) => [String(book._id), book]));
    return picked
      .flatMap((ticket) => {
        const book = bookById.get(String(ticket.bookId));
        if (book === undefined) {
          return [];
        }
        const decision = counterScanDecisionOf(
          counterFactsOf(ticket, store.orgId),
          context,
          partners.has(String(ticket._id)),
        );
        const pointId = ticket.location.cashPointId ?? null;
        const point =
          pointId === null || !ticket.orgId.equals(store.orgId)
            ? undefined
            : points.get(String(pointId));
        return [
          {
            ticketId: String(ticket._id),
            version: ticket.version,
            bookId: String(book._id),
            gameId: String(ticket.gameId),
            gameCode: book.gameCode,
            gameName: games.get(String(ticket.gameId))?.name ?? "",
            bookNo: book.bookNo,
            ticketNo: ticket.ticketNo,
            status: ticket.status,
            unmatched: ticket.unmatched,
            cashPoint:
              point === undefined
                ? null
                : { id: String(point._id), name: point.name },
            soldAt:
              ticket.status === TICKET_STATUS.sold
                ? (ticket.soldAt ?? null)
                : null,
            problem: decision.problem,
            match: decision.match,
          },
        ];
      })
      .toSorted((a, b) =>
        a.gameCode.localeCompare(b.gameCode, COLLATION_LOCALE),
      );
  }

  /** 移櫃:檯面上未售的張移到這家店另一個收銀點。 */
  async move(
    operator: OperatorContext,
    input: MoveLotteryTicketsInput,
  ): Promise<number> {
    const store = await this.support.mustStore(operator, input.orgId);
    const target = await this.support.mustCashPoint(
      operator,
      store.orgId,
      input.toCashPointId,
      "toCashPointId",
    );
    return this.counterMoves(operator, store, input, {
      kind: "move",
      toCashPointId: target._id,
    });
  }

  /** 收回:檯面上未售的張回到庫存。 */
  async recall(
    operator: OperatorContext,
    input: RecallLotteryTicketsInput,
  ): Promise<number> {
    const store = await this.support.mustStore(operator, input.orgId);
    return this.counterMoves(operator, store, input, { kind: "recall" });
  }

  /**
   * 依張數移櫃(張數店規格 7.7、13.1;只有張數店,轉換中與編號店擋 `MOVE_BY_COUNT_INVALID`):店員拿任意張,
   * 系統照挑張順序挑來源台這個遊戲未售、沒被鎖的張寫「移櫃」(張數一定對,張號由系統預設帶入;之後刷到時照對號
   * 規則換位置更正)。上限 = 來源台這個遊戲的總剩餘(不限一本)。查詢次數與張數無關(TX-06)。
   */
  async moveByCount(
    operator: OperatorContext,
    input: MoveLotteryTicketsByCountInput,
  ): Promise<number> {
    const store = await this.support.mustStore(operator, input.orgId);
    const grant = await this.access.grantOf(operator);
    if (!grant.has(STORE_PERMISSIONS.sell)) {
      throw forbiddenError(`Missing permission ${STORE_PERMISSIONS.sell}`);
    }
    const [from, to] = await Promise.all([
      this.support.mustCashPoint(
        operator,
        store.orgId,
        input.fromCashPointId,
        "fromCashPointId",
      ),
      this.support.mustCashPoint(
        operator,
        store.orgId,
        input.toCashPointId,
        "toCashPointId",
      ),
    ]);
    const gameId = parseId(input.gameId);
    if (gameId === null) {
      throw validationError("invalid game id", ["gameId"]);
    }
    const countMode = await this.matching.modeOf(operator, store.orgId);
    return this.transactions.withTransaction(async (session) => {
      const candidates = await this.tickets.findMany(
        operator,
        {
          orgId: store.orgId,
          gameId,
          "location.kind": TICKET_LOCATION_KIND.counter,
          "location.cashPointId": from._id,
          status: TICKET_STATUS.unsold,
          lockedBy: null,
        },
        { session, select: "bookId ticketNo status lockedBy version" },
      );
      const problem = moveByCountProblemOf(
        countMode,
        String(from._id),
        String(to._id),
        input.count,
        candidates.length,
      );
      if (problem !== null) {
        throw moveByCountInvalidError(problem);
      }
      await this.guardMove(operator, store, [gameId], session);
      const bookRows = await this.books.findMany(
        operator,
        { _id: { $in: [...new Set(candidates.map((t) => t.bookId))] } },
        { session, select: "bookNo firstOpenedAt" },
      );
      const books = new Map<string, CountPickBook>(
        bookRows.map((book) => [
          String(book._id),
          { bookNo: book.bookNo, firstOpenedAt: book.firstOpenedAt ?? null },
        ]),
      );
      const picked = pickForCountSale(
        candidates.map((ticket) => ({
          id: String(ticket._id),
          bookId: String(ticket.bookId),
          ticketNo: ticket.ticketNo,
          status: ticket.status,
          locked: ticket.lockedBy !== null,
        })),
        books,
        input.count,
      );
      if (!picked.ok) {
        throw moveByCountInvalidError({
          kind: "exceeds",
          available: picked.available,
        });
      }
      const byId = new Map(
        candidates.map((ticket) => [String(ticket._id), ticket]),
      );
      const at = this.clock.now();
      const action: CounterAction = { kind: "move", toCashPointId: to._id };
      const events = picked.ticketIds.flatMap((id) => {
        const ticket = byId.get(id);
        return ticket === undefined
          ? []
          : [counterEventOf(ticket._id, ticket.version, action, from._id, at)];
      });
      await this.ledger.applyTicketEvents(session, { operator }, events);
      await this.support.publish(store);
      return events.length;
    });
  }

  /** 移櫃暫停(8.5a B1 / B2):擋下 → `MOVE_PAUSED`;沒擋 → 分店那一筆 `version` +1。 */
  private async guardMove(
    operator: OperatorContext,
    store: StoreRef,
    gameIds: readonly Types.ObjectId[],
    session: ClientSession,
  ): Promise<void> {
    const block = await this.countModes.guardMove(
      operator,
      store,
      gameIds,
      session,
    );
    if (block !== null) {
      throw movePausedError(block);
    }
  }

  /**
   * 收回 / 移櫃(同一個交易):編號店照現況(檯面上未售、沒被鎖的張);張數店與轉換中只接受刷的張(`source: scan`
   * 與來源台),每張照 `counterScanDecisionOf`,要對號的先寫兩筆 `match`(配對張在交易裡挑、整批讀),再寫收回 /
   * 移櫃(版本 +1)。不能做的張一起列在 `COUNTER_TICKET_BLOCKED`,什麼都不寫。移櫃另檢查移櫃暫停。
   */
  private async counterMoves(
    operator: OperatorContext,
    store: StoreRef,
    input: RecallLotteryTicketsInput,
    action: CounterAction,
  ): Promise<number> {
    const refs = ticketRefsOf(input.tickets);
    const countMode = await this.matching.modeOf(operator, store.orgId);
    const counting = isMatchingCountMode(countMode);
    const sourceId = parseId(input.fromCashPointId);
    if (counting && (input.source !== "scan" || sourceId === null)) {
      throw countStoreScanOnlyError();
    }
    const source =
      counting && sourceId !== null
        ? await this.support.mustCashPoint(
            operator,
            store.orgId,
            String(sourceId),
            "fromCashPointId",
          )
        : null;
    const grant = await this.access.grantOf(operator);
    return this.transactions.withTransaction(async (session) => {
      const found = await this.tickets.findMany(
        operator,
        { _id: { $in: refs.map((item) => item.id) }, orgId: store.orgId },
        { session },
      );
      const byId = new Map(found.map((ticket) => [String(ticket._id), ticket]));
      const at = this.clock.now();
      const events =
        source === null
          ? this.plainEventsOf(refs, byId, action, at)
          : await this.countEventsOf(operator, store, {
              refs,
              byId,
              action,
              at,
              session,
              countMode,
              sourceId: source._id,
              canMatch: grant.has(STORE_PERMISSIONS.sell),
            });
      if (action.kind === "move") {
        const gameIds = new Map(
          found.map((ticket) => [String(ticket.gameId), ticket.gameId]),
        );
        await this.guardMove(operator, store, [...gameIds.values()], session);
      }
      await this.ledger.applyTicketEvents(session, { operator }, events);
      await this.support.publish(store);
      return refs.length;
    });
  }

  /** 編號店(現況):只能是檯面上、未售、沒被鎖的張;不合 → `TICKET_NOT_ON_COUNTER`。 */
  private plainEventsOf(
    refs: readonly { id: Types.ObjectId; version: number }[],
    byId: ReadonlyMap<string, TicketRecord>,
    action: CounterAction,
    at: Date,
  ): TicketEventInput[] {
    const wrong = refs
      .filter((item) => {
        const ticket = byId.get(String(item.id));
        return (
          ticket?.status !== TICKET_STATUS.unsold ||
          ticket.location.kind !== TICKET_LOCATION_KIND.counter ||
          ticket.lockedBy !== null
        );
      })
      .map((item) => String(item.id));
    if (wrong.length > 0) {
      throw notOnCounterError(wrong);
    }
    return refs.flatMap((item) => {
      const ticket = byId.get(String(item.id));
      if (ticket === undefined) {
        return [];
      }
      const from = ticket.location.cashPointId ?? null;
      if (action.kind === "move" && from?.equals(action.toCashPointId)) {
        throw validationError("already on this cash point", ["toCashPointId"]);
      }
      return [counterEventOf(ticket._id, item.version, action, from, at)];
    });
  }

  /** 張數店與轉換中:逐張判斷、要對號的先對號(6.3「收回、刷條碼移櫃 → 來源台」)。 */
  private async countEventsOf(
    operator: OperatorContext,
    store: StoreRef,
    plan: {
      refs: readonly { id: Types.ObjectId; version: number }[];
      byId: ReadonlyMap<string, TicketRecord>;
      action: CounterAction;
      at: Date;
      session: ClientSession;
      countMode: CountMode;
      sourceId: Types.ObjectId;
      canMatch: boolean;
    },
  ): Promise<TicketEventInput[]> {
    const { refs, byId, action, at } = plan;
    const context: CounterScanContext = {
      countMode: plan.countMode,
      sourceCashPointId: String(plan.sourceId),
      targetCashPointId:
        action.kind === "move" ? String(action.toCashPointId) : null,
    };
    // 讀到的版本以畫面送來的為準(條件更新;被別人動過 → 帳本回「已被處理」)
    const scanned = refs.flatMap((item) => {
      const ticket = byId.get(String(item.id));
      return ticket === undefined
        ? []
        : [ticketCopyOf(ticket, { version: item.version })];
    });
    const partners = await this.matching.partnersOf(
      operator,
      store.orgId,
      scanned.map((ticket) => ({
        ticket,
        places:
          counterScanMatchPlacesOf(
            counterFactsOf(ticket, store.orgId),
            context,
          ) ?? [],
      })),
      plan.session,
    );
    const problems: { ticketId: string; problem: CounterScanProblem }[] = [];
    const decided: { ticket: TicketRecord; decision: CounterScanDecision }[] =
      [];
    for (const item of refs) {
      const ticket = scanned.find((one) => one._id.equals(item.id));
      if (ticket === undefined) {
        problems.push({ ticketId: String(item.id), problem: "not_this_store" });
        continue;
      }
      const decision = counterScanDecisionOf(
        counterFactsOf(ticket, store.orgId),
        context,
        partners.has(String(ticket._id)),
      );
      if (decision.problem === null) {
        decided.push({ ticket, decision });
      } else {
        problems.push({ ticketId: String(item.id), problem: decision.problem });
      }
    }
    if (problems.length > 0) {
      throw counterTicketBlockedError(problems);
    }
    if (decided.some((item) => item.decision.match) && !plan.canMatch) {
      throw forbiddenError(`Missing permission ${STORE_PERMISSIONS.sell}`);
    }
    return decided.flatMap(({ ticket, decision }) => {
      const partner = partners.get(String(ticket._id));
      // 實際離開的收銀點:對號後是來源台,否則是系統記的那台
      const fromId = decision.match
        ? plan.sourceId
        : (ticket.location.cashPointId ?? null);
      if (decision.match && partner !== undefined) {
        return [
          ...matchEventsOf(ticket, partner, at),
          counterEventOf(ticket._id, ticket.version + 1, action, fromId, at),
        ];
      }
      return [counterEventOf(ticket._id, ticket.version, action, fromId, at)];
    });
  }
}
