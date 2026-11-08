import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { type ClientSession, Types } from "mongoose";

import { COLLATION_LOCALE } from "@repo/domain/collation";
import {
  COUNT_MODE,
  type CountPickBook,
  STOCKTAKE_REASONS,
  STOCKTAKE_REF_TYPE,
  STORE_PERMISSIONS,
  type StocktakeCountMode,
  type StocktakeDraft,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  countDiffOf,
  countLineFactsOf,
  isStocktakeStockLine,
  pickForCountSale,
  stocktakeCountLinesOf,
  stocktakeCountModeOf,
} from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import { TransactionService } from "../../../database/transaction";
import {
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import type {
  StocktakeCountLine,
  StocktakeUncountedGroup,
} from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { StoreCountModeService } from "../settings/store-count-mode.service";
import { parseId } from "../store/shift-views";
import { StoreAccess } from "../store/store-access";
import { StoreClock } from "../store/store-clock";
import { type StoreRef, StoreSalesSupport } from "../store/store-sales-support";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";
import type { BackfillLotteryStocktakeCountSalesInput } from "./dto/stocktake.input";
import type {
  LotteryStocktakeCountBackfillModel,
  LotteryStocktakeReviewCountLineModel,
} from "./models/stocktake-count.model";
import {
  type CountLineEvaluation,
  StocktakeCountFacts,
  countGroupKeyOf,
} from "./stocktake-count-facts";
import {
  alreadyProcessedError,
  forbiddenError,
  notFoundError,
  validationError,
} from "./stocktake-error";

/** 張數盤點組好的內容(送出 / 送出前檢查 / 差異核對共用)。 */
export interface BuiltCountLines {
  countLines: StocktakeCountLine[];
  uncountedGroups: StocktakeUncountedGroup[];
  evaluations: CountLineEvaluation[];
  /** 差異核對的一組一列(與 `evaluations` 同順序)。 */
  reviewLines: LotteryStocktakeReviewCountLineModel[];
  /** 要重數的組(B6 或處理對不上)/ 還沒處理完的組(「遊戲代號@收銀點」)。 */
  stale: string[];
  unhandled: string[];
  saleCount: number;
  saleAmount: number;
  investigateCount: number;
  flaggedCount: number;
}

/** 盤點內容與分店盤點制度對不上的原因;沒問題 = null。 */
export type CountDraftProblem = "mode" | "shape" | "renumber" | null;

/**
 * 張數盤點(張數店規格 8.1、8.2、8.5a B6、14.2;正本 `docs/modules/project/store.md`「張數盤點」):
 *
 * - `storeCountModeOf`:這家店的盤點用哪一種(張數店與轉換中 = 張數盤點,9.2)
 * - `draftProblemOf`:盤點內容和這家店的盤點制度對得上(張數盤點的檯面只收組、編號盤點不收組)
 * - `backfill`:[算售出 N 張] **立即生效**:照挑張順序挑這一組未售、沒被鎖的 N 張記已售·未對號,
 *   算那個收銀點開著的班;沒有開著的班 → 最近一班的事後更正(同 [補登售出])
 * - `build`:每組與開始數那一刻比對、B6 退回組、還沒數的組
 * - `investigateEvents`:核准時 [待查] 照挑張順序挑張記待查·未對號(開始數之後被別張盤點處理過的組略過)
 *
 * 讀取一律整批(一次 aggregate / 一次讀事件 / 一次讀張與本),寫入經帳本整批寫(TX-06)。
 */
@Injectable()
export class StocktakeCountService {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly countFacts: StocktakeCountFacts,
    private readonly countModes: StoreCountModeService,
    private readonly ledger: TicketLedgerService,
    private readonly transactions: TransactionService,
    private readonly support: StoreSalesSupport,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
  ) {}

  /** 這家店的盤點用哪一種盤點制度:張數店與轉換中 = 張數盤點(9.2);沒有那一筆 = 編號盤點。 */
  async storeCountModeOf(
    reader: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<StocktakeCountMode> {
    const mode = await this.countModes.modeOf(reader, orgId);
    return mode === COUNT_MODE.numbered ? "numbered" : "count";
  }

  /**
   * 盤點內容和這家店的盤點制度對得上:制度不同(例:進行中切換)→ `mode`;張數盤點的檯面要用組
   * (`lines` 只能是庫存那一區)、編號盤點不能有組 → `shape`。
   */
  draftProblemOf(
    draft: StocktakeDraft,
    storeMode: StocktakeCountMode,
  ): CountDraftProblem {
    const draftMode = stocktakeCountModeOf(draft);
    // 補點編號:張數店與轉換中的全店編號盤點(9.3 第 1 點)
    if (draft.purpose === "renumber") {
      if (
        storeMode !== "count" ||
        draftMode !== "numbered" ||
        draft.scopeCashPointId !== null
      ) {
        return "renumber";
      }
      return stocktakeCountLinesOf(draft).length === 0 ? null : "shape";
    }
    if (draftMode !== storeMode) {
      return "mode";
    }
    if (draftMode === "count") {
      return draft.lines.every((line) => isStocktakeStockLine(line.cashPointId))
        ? null
        : "shape";
    }
    return stocktakeCountLinesOf(draft).length === 0 ? null : "shape";
  }

  // ---- [算售出 N 張](立即生效) ----

  async backfill(
    operator: OperatorContext,
    input: BackfillLotteryStocktakeCountSalesInput,
  ): Promise<LotteryStocktakeCountBackfillModel> {
    const grant = await this.access.grantOf(operator);
    if (!grant.has(STORE_PERMISSIONS.stocktake)) {
      throw forbiddenError(`Missing permission ${STORE_PERMISSIONS.stocktake}`);
    }
    const store = await this.support.mustStore(operator, input.orgId);
    if ((await this.storeCountModeOf(operator, store.orgId)) !== "count") {
      throw validationError(
        "count sales are only for count stores",
        ["orgId"],
        STOCKTAKE_REASONS.invalid,
      );
    }
    const point = await this.support.mustCashPoint(
      operator,
      store.orgId,
      input.cashPointId,
      "cashPointId",
    );
    const gameId = parseId(input.gameId);
    if (gameId === null || !Number.isInteger(input.count) || input.count < 1) {
      throw validationError("invalid count sale", ["gameId", "count"]);
    }
    const games = await this.support.gamesOf(operator, [gameId]);
    const game = games.get(String(gameId));
    if (game === undefined) {
      throw notFoundError(`game not found: ${input.gameId}`);
    }
    try {
      return await this.transactions.withTransaction((session) =>
        this.writeBackfill(session, operator, store, {
          cashPointId: point._id,
          gameId,
          count: input.count,
          unitPrice: game.unitPrice,
        }),
      );
    } catch (error) {
      if (
        error instanceof GraphQLError &&
        error.extensions.code === "CONFLICT"
      ) {
        throw alreadyProcessedError([]);
      }
      throw error;
    }
  }

  private async writeBackfill(
    session: ClientSession,
    operator: OperatorContext,
    store: StoreRef,
    target: {
      cashPointId: Types.ObjectId;
      gameId: Types.ObjectId;
      count: number;
      unitPrice: number;
    },
  ): Promise<LotteryStocktakeCountBackfillModel> {
    const now = this.clock.now();
    const found = await this.tickets.findMany(
      operator,
      {
        orgId: store.orgId,
        gameId: target.gameId,
        "location.kind": TICKET_LOCATION_KIND.counter,
        "location.cashPointId": target.cashPointId,
        status: TICKET_STATUS.unsold,
        lockedBy: null,
      },
      { session },
    );
    const books = await this.pickBooksOf(
      operator,
      found.map((ticket) => ticket.bookId),
      session,
    );
    const picked = pickForCountSale(
      found.map((ticket) => ({
        id: String(ticket._id),
        bookId: String(ticket.bookId),
        ticketNo: ticket.ticketNo,
        status: ticket.status,
        locked: ticket.lockedBy !== null,
      })),
      books,
      target.count,
    );
    if (!picked.ok) {
      throw validationError(
        "not enough unsold tickets to count as sold",
        ["count"],
        STOCKTAKE_REASONS.countSaleUnavailable,
        { available: picked.available },
      );
    }
    const shift = await this.shiftOf(session, operator, target.cashPointId);
    const refId = new Types.ObjectId();
    const byId = new Map(found.map((ticket) => [String(ticket._id), ticket]));
    const events: TicketEventInput[] = picked.ticketIds.flatMap((id) => {
      const ticket = byId.get(id);
      return ticket === undefined
        ? []
        : [
            {
              ticketId: ticket._id,
              expectedVersion: ticket.version,
              expectedStatuses: [TICKET_STATUS.unsold],
              type: TICKET_EVENT_TYPE.saleStocktake,
              at: now,
              patch: {
                status: TICKET_STATUS.sold,
                sold: { at: now, source: "stocktake" },
                unmatched: true,
              },
              amount: target.unitPrice,
              cashEffect: "increase",
              cashPointId: target.cashPointId,
              shiftId: shift.shiftId,
              postCloseOf: shift.postClose ? shift.shiftId : null,
              refType: STOCKTAKE_REF_TYPE,
              refId,
            },
          ];
    });
    await this.ledger.applyTicketEvents(session, { operator }, events);
    await this.support.publish(store);
    return {
      refId: String(refId),
      count: events.length,
      amount: target.unitPrice * events.length,
      shiftId: String(shift.shiftId),
      postClose: shift.postClose,
    };
  }

  /** 算到哪一班:開著的班(鎖住抽屜)→ 那一班;沒有 → 最近一班的事後更正;從來沒開過班 → 擋下。 */
  private async shiftOf(
    session: ClientSession,
    operator: OperatorContext,
    cashPointId: Types.ObjectId,
  ): Promise<{ shiftId: Types.ObjectId; postClose: boolean }> {
    const open = await this.shifts.findOne(
      operator,
      { cashPointId, closedAt: null },
      { session },
    );
    if (
      open !== null &&
      (await this.support.lockDrawer(operator, open._id)) !== null
    ) {
      return { shiftId: open._id, postClose: false };
    }
    const last = await this.shifts.findOne(
      operator,
      { cashPointId },
      { session, sort: { openedAt: -1 } },
    );
    if (last === null) {
      throw validationError(
        "this cash point has never had a shift",
        ["cashPointId"],
        STOCKTAKE_REASONS.noShift,
      );
    }
    return { shiftId: last._id, postClose: last.closedAt !== null };
  }

  private async pickBooksOf(
    reader: OperatorContext,
    bookIds: readonly Types.ObjectId[],
    session?: ClientSession,
  ): Promise<Map<string, CountPickBook>> {
    if (bookIds.length === 0) {
      return new Map();
    }
    const found = await this.books.findMany(
      reader,
      {
        _id: {
          $in: [...new Set(bookIds.map(String))].map(
            (id) => new Types.ObjectId(id),
          ),
        },
      },
      {
        select: "bookNo firstOpenedAt",
        ...(session === undefined ? {} : { session }),
      },
    );
    return new Map(
      found.map((book) => [
        String(book._id),
        { bookNo: book.bookNo, firstOpenedAt: book.firstOpenedAt ?? null },
      ]),
    );
  }

  // ---- 組盤點單 ----

  /**
   * 張數盤點的組(送出 / 送出前檢查 / 差異核對):每組與開始數那一刻比對(B6 → 要重數),記下
   * [算售出] 寫的張;範圍內還沒數的組(交班盤點不能沒盤完送出)。編號盤點 → 空。
   */
  async build(
    reader: OperatorContext,
    store: StoreRef,
    draft: StocktakeDraft,
    session?: ClientSession,
  ): Promise<BuiltCountLines> {
    const empty: BuiltCountLines = {
      countLines: [],
      uncountedGroups: [],
      evaluations: [],
      reviewLines: [],
      stale: [],
      unhandled: [],
      saleCount: 0,
      saleAmount: 0,
      investigateCount: 0,
      flaggedCount: 0,
    };
    if (stocktakeCountModeOf(draft) !== "count") {
      return empty;
    }
    const options = session === undefined ? {} : { session };
    const evaluations = await this.countFacts.evaluate(
      reader,
      store.orgId,
      draft,
      session,
    );
    const allPoints = await this.support.cashPointsOf(reader, store.orgId);
    const scopeId = parseId(draft.scopeCashPointId ?? "");
    const points = [...allPoints.values()]
      .filter((point) => scopeId === null || point._id.equals(scopeId))
      .toSorted((a, b) => a.order - b.order);
    const groups = await this.countFacts.groupsOf(
      reader,
      store.orgId,
      points.map((point) => point._id),
      options,
    );
    const counted = new Set(
      evaluations.flatMap((item) =>
        item.cashPointId === null || item.gameId === null
          ? []
          : [countGroupKeyOf(item.cashPointId, item.gameId)],
      ),
    );
    const pending = [...groups.values()].filter(
      (group) => !counted.has(countGroupKeyOf(group.cashPointId, group.gameId)),
    );
    const games = await this.support.gamesOf(reader, [
      ...evaluations.flatMap((item) =>
        item.gameId === null ? [] : [item.gameId],
      ),
      ...pending.map((group) => group.gameId),
    ]);
    const saleRows = await this.countFacts.saleRowsOf(
      reader,
      evaluations.flatMap((item) => item.line.saleRefIds),
      options,
    );
    const pointName = (id: Types.ObjectId | null) =>
      id === null ? "" : (allPoints.get(String(id))?.name ?? "");
    const built: BuiltCountLines = { ...empty, evaluations };
    for (const item of evaluations) {
      const game =
        item.gameId === null ? undefined : games.get(String(item.gameId));
      const label = `${game?.gameCode ?? item.line.gameId}@${pointName(item.cashPointId)}`;
      if (item.problem === "stale") {
        built.stale.push(label);
      } else if (item.problem === "unhandled") {
        built.unhandled.push(label);
      }
      const diff = countDiffOf(item.facts.systemCount, item.line.presentCount);
      built.reviewLines.push({
        cashPointId: item.line.cashPointId,
        cashPointName: pointName(item.cashPointId),
        gameId: item.line.gameId,
        gameCode: game?.gameCode ?? "",
        gameName: game?.name ?? "",
        unitPrice: game?.unitPrice ?? 0,
        systemCount: item.facts.systemCount,
        presentCount: item.line.presentCount,
        kind: diff.kind,
        diffCount: diff.count,
        saleCount: item.facts.ownSaleCount,
        stale: item.problem === "stale",
        unhandled: item.problem === "unhandled",
      });
      if (
        item.cashPointId === null ||
        item.gameId === null ||
        game === undefined
      ) {
        continue;
      }
      const refs = new Set(item.line.saleRefIds);
      const sold = saleRows.filter((row) => refs.has(row.refId));
      const flaggedCount =
        item.line.flagged && diff.kind === "over" ? diff.count : 0;
      built.saleCount += item.line.saleCount;
      built.saleAmount += sold.reduce((sum, row) => sum + row.amount, 0);
      built.investigateCount += item.line.investigateCount;
      built.flaggedCount += flaggedCount;
      built.countLines.push({
        gameId: item.gameId,
        gameCode: game.gameCode,
        gameName: game.name,
        cashPointId: item.cashPointId,
        countedAt: new Date(item.line.countedAt),
        systemCount: item.facts.systemCount,
        presentCount: item.line.presentCount,
        recounts: [...item.line.recounts],
        saleCount: item.line.saleCount,
        saleRefIds: item.line.saleRefIds.flatMap((text) => {
          const id = parseId(text);
          return id === null ? [] : [id];
        }),
        investigateCount: item.line.investigateCount,
        flaggedCount,
        diffs: sold.map((row) => ({
          ticketId: row.ticketId,
          ticketNo: row.ticketNo,
          kind: "missing",
          action: "sale_backfill",
          eventId: row.eventId,
          postClose: row.postClose,
          amount: row.amount,
        })),
      });
    }
    const order = new Map(
      points.map((point, index) => [String(point._id), index]),
    );
    built.uncountedGroups = pending
      .map((group) => {
        const game = games.get(String(group.gameId));
        return {
          gameId: group.gameId,
          gameCode: game?.gameCode ?? "",
          gameName: game?.name ?? "",
          cashPointId: group.cashPointId,
        };
      })
      .toSorted(
        (a, b) =>
          (order.get(String(a.cashPointId)) ?? 0) -
            (order.get(String(b.cashPointId)) ?? 0) ||
          a.gameCode.localeCompare(b.gameCode, COLLATION_LOCALE),
      );
    return built;
  }

  // ---- 核准完成 ----

  /**
   * 核准時張數盤點 [待查] 要寫的事件(張數店規格 8.2、14.2「張數列 investigate 核准時挑張記待查·未對號」):
   * 每組照挑張順序挑這一組現在未售、沒被鎖的張(不夠就挑現有的),記待查·未對號、責任分店 = 本店;
   * 開始數之後這一組被別張盤點 / 重刷 / 補點處理過 → 略過(舊盤點晚完成不覆蓋新的結果,比照逐張的 `changedAfter`)。
   * 張、本、事件各一次讀完。回傳要寫的事件與每組挑到的張(記進盤點單)。
   */
  async investigateEvents(
    reader: OperatorContext,
    record: {
      _id: Types.ObjectId;
      orgId: Types.ObjectId;
      countLines: readonly StocktakeCountLine[];
    },
    at: Date,
    session: ClientSession,
  ): Promise<{
    events: TicketEventInput[];
    picked: Map<number, { ticketId: Types.ObjectId; ticketNo: string }[]>;
  }> {
    const lines = record.countLines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.investigateCount > 0);
    const picked = new Map<
      number,
      { ticketId: Types.ObjectId; ticketNo: string }[]
    >();
    if (lines.length === 0) {
      return { events: [], picked };
    }
    const gameIds = [
      ...new Set(lines.map(({ line }) => String(line.gameId))),
    ].map((id) => new Types.ObjectId(id));
    const [candidates, after] = await Promise.all([
      this.tickets.findMany(
        reader,
        {
          orgId: record.orgId,
          gameId: { $in: gameIds },
          status: TICKET_STATUS.unsold,
          "location.kind": TICKET_LOCATION_KIND.counter,
          "location.cashPointId": {
            $in: lines.map(({ line }) => line.cashPointId),
          },
          lockedBy: null,
        },
        { session },
      ),
      this.events.findMany(
        reader,
        {
          orgId: record.orgId,
          gameId: { $in: gameIds },
          refType: STOCKTAKE_REF_TYPE,
          at: {
            $gt: new Date(
              Math.min(...lines.map(({ line }) => line.countedAt.getTime())),
            ),
          },
        },
        { session, select: "eventId at type from to refType refId gameId" },
      ),
    ]);
    const books = await this.pickBooksOf(
      reader,
      candidates.map((ticket) => ticket.bookId),
      session,
    );
    const taken = new Set<string>();
    const events: TicketEventInput[] = [];
    for (const { line, index } of lines) {
      const touched = countLineFactsOf(
        0,
        after
          .filter(
            (event) =>
              event.gameId.equals(line.gameId) &&
              event.at.getTime() > line.countedAt.getTime(),
          )
          .map((event) => ({
            eventId: event.eventId,
            type: event.type,
            from:
              event.from === null
                ? null
                : {
                    status: event.from.status,
                    locationKind: event.from.locationKind,
                    cashPointId:
                      event.from.cashPointId === null
                        ? null
                        : String(event.from.cashPointId),
                  },
            to: {
              status: event.to.status,
              locationKind: event.to.locationKind,
              cashPointId:
                event.to.cashPointId === null
                  ? null
                  : String(event.to.cashPointId),
            },
            refType: event.refType,
            refId: event.refId === null ? null : String(event.refId),
          })),
        String(line.cashPointId),
        new Set(line.saleRefIds.map(String)),
      ).touchedByOther;
      if (touched) {
        continue;
      }
      const here = candidates.filter(
        (ticket) =>
          ticket.gameId.equals(line.gameId) &&
          ticket.location.cashPointId?.equals(line.cashPointId) === true &&
          !taken.has(String(ticket._id)),
      );
      const result = pickForCountSale(
        here.map((ticket) => ({
          id: String(ticket._id),
          bookId: String(ticket.bookId),
          ticketNo: ticket.ticketNo,
          status: ticket.status,
          locked: false,
        })),
        books,
        Math.min(line.investigateCount, here.length),
      );
      if (!result.ok) {
        continue;
      }
      const byId = new Map(here.map((ticket) => [String(ticket._id), ticket]));
      const chosen = result.ticketIds.flatMap((id) => {
        const ticket = byId.get(id);
        return ticket === undefined ? [] : [ticket];
      });
      picked.set(
        index,
        chosen.map((ticket) => ({
          ticketId: ticket._id,
          ticketNo: ticket.ticketNo,
        })),
      );
      for (const ticket of chosen) {
        taken.add(String(ticket._id));
        events.push({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          expectedStatuses: [TICKET_STATUS.unsold],
          type: TICKET_EVENT_TYPE.investigate,
          at,
          patch: {
            status: TICKET_STATUS.investigating,
            responsibleOrgId: record.orgId,
            unmatched: true,
          },
          cashPointId: line.cashPointId,
          refType: STOCKTAKE_REF_TYPE,
          refId: record._id,
        });
      }
    }
    return { events, picked };
  }
}
