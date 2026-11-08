import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { type ClientSession, Types } from "mongoose";

import {
  type ActiveRescan,
  type CountPickBook,
  type CountPlace,
  type MatchTicket,
  RESCAN_REASONS,
  type RescanPlaceState,
  type RescanTicket,
  STOCKTAKE_REF_TYPE,
  STOCKTAKE_STATUS,
  STORE_PERMISSIONS,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  canCancelRescan,
  isMatchingCountMode,
  isRescanLive,
  isSessionLive,
  normalizeBookNo,
  parseTicketInput,
  rescanMinutesLeftOf,
  rescanPlaceStartOf,
  rescanPlaceStateOf,
  rescanResultOf,
  rescanStartBlockOf,
  sessionMinutesLeftOf,
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
import type { TicketLocation } from "../../database/lottery-inventory/lottery-ticket.schema";
import type {
  StocktakeRescan,
  StocktakeRescanPlace,
  StocktakeRescanResult,
} from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import {
  type LotteryStocktakeDocument,
  LotteryStocktakesRepository,
} from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import {
  StoreCountModeService,
  livePausesOf,
} from "../settings/store-count-mode.service";
import { StoreShiftViews, parseId } from "../store/shift-views";
import { StoreAccess, isStoreManager } from "../store/store-access";
import { StoreClock } from "../store/store-clock";
import { matchEventsOf } from "../store/store-matching";
import { type StoreRef, StoreSalesSupport } from "../store/store-sales-support";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";
import type {
  FinishLotteryRescanPlaceInput,
  LotteryRescanInput,
  ScanLotteryRescanTicketInput,
  StartLotteryRescanInput,
} from "./dto/rescan.input";
import type {
  LotteryRescanBriefModel,
  LotteryRescanItemModel,
  LotteryRescanModel,
  LotteryRescanPlaceModel,
  LotteryRescanScanPayload,
} from "./models/rescan.model";

type TicketRecord = Persisted<LotteryTicketDocument>;
type RescanRecord = Persisted<LotteryStocktakeDocument> & {
  rescan: StocktakeRescan;
};

/** 全店重刷的業務錯誤(GQL-04:通用碼 + `extensions.reason`)。 */
function rescanError(
  code: "CONFLICT" | "VALIDATION_FAILED" | "NOT_FOUND" | "FORBIDDEN",
  reason: string,
  extra: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(`rescan: ${reason}`, {
    extensions: { code, reason, ...extra },
  });
}

/** 按刷完要記下的結果(沒問題、不是這個遊戲、不是本店不記)。 */
const RECORDED_OUTCOMES: ReadonlySet<string> = new Set([
  "matched",
  "recovered",
  "moved",
  "sold_here",
  "skipped",
  "scrapped",
  "locked",
  "unopened",
]);

/** 重刷單的狀態 → 重刷頁的狀態(進行中 / 完成 / 取消)。 */
function rescanStatusOf(status: string): string {
  if (status === STOCKTAKE_STATUS.confirmed) {
    return "finished";
  }
  return status === STOCKTAKE_STATUS.rejected ? "cancelled" : "in_progress";
}

/** 位置(null = 庫存)→ 對號用的位置。 */
const placeOf = (cashPointId: Types.ObjectId | null): CountPlace =>
  cashPointId === null
    ? { locationKind: TICKET_LOCATION_KIND.stock, cashPointId: null }
    : {
        locationKind: TICKET_LOCATION_KIND.counter,
        cashPointId: String(cashPointId),
      };

const samePoint = (
  left: Types.ObjectId | null,
  right: Types.ObjectId | null,
): boolean =>
  left === null || right === null ? left === right : left.equals(right);

/** 子文件 → 純物件(寫回整個陣列時不帶 Mongoose 的內部欄位)。 */
const plainPlace = (place: StocktakeRescanPlace): StocktakeRescanPlace => ({
  cashPointId: place.cashPointId ?? null,
  scannedTicketIds: [...place.scannedTicketIds],
  scanningBy: place.scanningBy ?? null,
  lastScanAt: place.lastScanAt ?? null,
  doneAt: place.doneAt ?? null,
  doneBy: place.doneBy ?? null,
});

const factsOf = (place: StocktakeRescanPlace) => ({
  scanningBy: place.scanningBy === null ? null : String(place.scanningBy),
  lastScanAt: place.lastScanAt,
  doneAt: place.doneAt,
  scannedCount: place.scannedTicketIds.length,
});

/** 刷到的張 → 規則要的事實。 */
function rescanTicketOf(
  ticket: TicketRecord,
  orgId: Types.ObjectId,
): RescanTicket {
  return {
    id: String(ticket._id),
    gameId: String(ticket.gameId),
    bookId: String(ticket.bookId),
    inThisStore: ticket.orgId.equals(orgId),
    status: ticket.status,
    unmatched: ticket.unmatched,
    locked: ticket.lockedBy !== null,
    locationKind: ticket.location.kind,
    cashPointId:
      ticket.location.cashPointId == null
        ? null
        : String(ticket.location.cashPointId),
  };
}

function matchTicketOf(ticket: TicketRecord): MatchTicket {
  return {
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
  };
}

/**
 * 全店重刷(張數店規格 8.3–8.5a、14.2;正本 `docs/modules/project/store.md`「全店重刷」):
 *
 * - `start`:[開始全店重刷 遊戲 X] → 一張 `purpose: rescan` 的盤點單(不需核准)+ 分店那一筆 `movePauses` 加一筆
 *   (同一個交易、以 `version` 條件更新,和移櫃一定有先後;B3:同遊戲已在重刷、補點編號中 → 擋)
 * - `scan`:在一個位置刷到一張就存進清單(重新整理不會不見、換裝置可接著刷);第一次在這個位置刷 = 「開始刷這個位置」:
 *   有人登記盤點中這個位置 → 擋(8.5a);別人正在刷 → 擋;和盤點中登記更新同一筆分店文件
 * - `finishPlace`:[這裡刷完了] → 照 `rescanResultOf` 在同一個交易裡對號、尋回、記到這裡、沒刷到的未售記待查
 *   (帳本整批寫,TX-06);全部位置刷完 → 這次重刷完成、解除移櫃暫停
 * - `cancel`:開始重刷的人或店長;已刷完的位置的更正保留,其餘不處理,解除移櫃暫停
 * - 1 小時沒有任何位置刷到或按刷完 → 自動取消(`StoreCountModeService.releaseExpiredRescans`;每個動作前、移櫃前與排程)
 *
 * 開始、每個位置刷完、結束都送 `board` 信號(交易提交後才送)。
 */
@Injectable()
export class RescanService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly countModes: StoreCountModeService,
    private readonly ledger: TicketLedgerService,
    private readonly transactions: TransactionService,
    private readonly support: StoreSalesSupport,
    private readonly views: StoreShiftViews,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
  ) {}

  // ---- 讀 ----

  /** 重刷頁(CS-10b / CS-10d)。 */
  async view(
    operator: OperatorContext,
    input: LotteryRescanInput,
  ): Promise<LotteryRescanModel> {
    const grant = await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, input.orgId);
    await this.expire(operator, store);
    const record = await this.mustRescan(operator, store, input.rescanId);
    return this.modelOf(operator, store, record, isStoreManager(grant));
  }

  /** 這家店進行中的重刷(看板橫幅、盤點頁 B5;1 小時沒動作的先自動取消)。 */
  async activeOf(
    operator: OperatorContext,
    store: StoreRef,
  ): Promise<LotteryRescanBriefModel[]> {
    await this.expire(operator, store);
    const reader = await this.readerOf(operator, store);
    const records = (await this.stocktakes.findMany(
      reader,
      {
        orgId: store.orgId,
        purpose: "rescan",
        status: STOCKTAKE_STATUS.pending,
      },
      { sort: { startedAt: 1 } },
    )) as RescanRecord[];
    const now = this.clock.now();
    const live = records.filter((record) =>
      isRescanLive(record.rescan.lastActiveAt, now),
    );
    if (live.length === 0) {
      return [];
    }
    const [points, names] = await Promise.all([
      this.support.cashPointsOf(operator, store.orgId),
      this.views.userNames(
        operator,
        store.tenantId,
        live.flatMap((record) => [
          record.rescan.startedBy,
          ...record.rescan.places.flatMap((place) =>
            place.scanningBy === null ? [] : [place.scanningBy],
          ),
        ]),
      ),
    ]);
    return live.map((record) => ({
      id: String(record._id),
      gameId: String(record.rescan.gameId),
      gameCode: record.rescan.gameCode,
      gameName: record.rescan.gameName,
      startedByName: names.get(String(record.rescan.startedBy)) ?? "",
      startedAt: record.startedAt,
      minutesLeft: rescanMinutesLeftOf(record.rescan.lastActiveAt, now),
      doneCount: record.rescan.places.filter((place) => place.doneAt !== null)
        .length,
      places: record.rescan.places.map((place) =>
        this.placeModelOf(place, points, names, operator, now, []),
      ),
    }));
  }

  /** B5 用:進行中的重刷與各位置狀態(交易內給 `session`)。 */
  async activeRescansOf(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<(ActiveRescan & { gameCode: string })[]> {
    const records = (await this.stocktakes.findMany(
      reader,
      { orgId, purpose: "rescan", status: STOCKTAKE_STATUS.pending },
      session === undefined ? {} : { session },
    )) as RescanRecord[];
    const now = this.clock.now();
    return records
      .filter((record) => isRescanLive(record.rescan.lastActiveAt, now))
      .map((record) => ({
        gameId: String(record.rescan.gameId),
        gameCode: record.rescan.gameCode,
        places: record.rescan.places.map((place) => ({
          cashPointId:
            place.cashPointId === null ? null : String(place.cashPointId),
          state: rescanPlaceStateOf(factsOf(place), now),
        })),
      }));
  }

  // ---- 開始 ----

  async start(
    operator: OperatorContext,
    input: StartLotteryRescanInput,
  ): Promise<LotteryRescanModel> {
    const grant = await this.access.grantOf(operator);
    const store = await this.support.mustStore(operator, input.orgId);
    const by = operator.actorId;
    if (by === null) {
      throw rescanError("FORBIDDEN", "no operator");
    }
    const gameId = parseId(input.gameId);
    if (gameId === null) {
      throw rescanError("VALIDATION_FAILED", "invalid game", {
        fields: ["gameId"],
      });
    }
    const mode = await this.countModes.modeOf(operator, store.orgId);
    if (!isMatchingCountMode(mode)) {
      throw rescanError("VALIDATION_FAILED", RESCAN_REASONS.notCountStore);
    }
    const [games, points] = await Promise.all([
      this.support.gamesOf(operator, [gameId]),
      this.support.cashPointsOf(operator, store.orgId),
    ]);
    const game = games.get(String(gameId));
    if (game === undefined) {
      throw rescanError("NOT_FOUND", "game not found");
    }
    const placeIds: (Types.ObjectId | null)[] = [
      ...[...points.values()]
        .toSorted((left, right) => left.order - right.order)
        .map((point) => point._id),
      null,
    ];
    const id = await this.transactions.withTransaction(async (session) => {
      const now = this.clock.now();
      await this.countModes.releaseExpiredRescans(
        operator,
        store,
        now,
        session,
      );
      const record = await this.countModes.sessionRecordOf(
        operator,
        store.orgId,
        session,
      );
      if (record === null) {
        throw rescanError("VALIDATION_FAILED", RESCAN_REASONS.notCountStore);
      }
      // 補點編號的暫停只算登記還有效的(8.5a B3;送出後審核中不算)
      const block = rescanStartBlockOf(
        livePausesOf(record, now),
        String(gameId),
      );
      if (block !== null) {
        throw rescanError("CONFLICT", RESCAN_REASONS.startBlocked, { block });
      }
      const writer = await this.readerOf(operator, store);
      const created = await this.stocktakes.create(
        writer,
        {
          orgId: store.orgId,
          type: "adhoc",
          status: STOCKTAKE_STATUS.pending,
          scopeCashPointId: null,
          startedAt: now,
          submittedBy: by,
          submittedAt: now,
          firstSubmittedAt: now,
          confirmedAt: null,
          closedAt: null,
          confirmedBy: null,
          attempts: [],
          submissionId: new Types.ObjectId(),
          countMode: "count",
          purpose: "rescan",
          lines: [],
          countLines: [],
          unopenedLines: [],
          lostReviewLines: [],
          uncountedBooks: [],
          uncountedGroups: [],
          summary: {
            books: 0,
            backfillCount: 0,
            backfillAmount: 0,
            newInvestigate: 0,
            flagged: 0,
            confirmLost: 0,
            confirmLostCost: 0,
            uncountedCount: 0,
          },
          rescan: {
            gameId,
            gameCode: game.gameCode,
            gameName: game.name,
            startedBy: by,
            lastActiveAt: now,
            finishedAt: null,
            cancelledAt: null,
            cancelledBy: null,
            cancelCause: null,
            places: placeIds.map((cashPointId) => ({
              cashPointId,
              scannedTicketIds: [],
              scanningBy: null,
              lastScanAt: null,
              doneAt: null,
              doneBy: null,
            })),
            results: [],
          },
          version: 0,
        },
        { session },
      );
      await this.countModes.addRescanPause(
        operator,
        store,
        record,
        { stocktakeId: created._id, gameId },
        session,
      );
      await this.support.publish(store);
      return created._id;
    });
    const record = await this.mustRescan(operator, store, String(id));
    return this.modelOf(operator, store, record, isStoreManager(grant));
  }

  // ---- 刷到一張 ----

  async scan(
    operator: OperatorContext,
    input: ScanLotteryRescanTicketInput,
  ): Promise<LotteryRescanScanPayload> {
    const grant = await this.access.grantOf(operator);
    const store = await this.support.mustStore(operator, input.orgId);
    const by = operator.actorId;
    if (by === null) {
      throw rescanError("FORBIDDEN", "no operator");
    }
    const cashPointId = this.placeIdOf(input.cashPointId);
    const rescanId = this.mustId(input.rescanId);
    const head = await this.mustRescan(operator, store, input.rescanId);
    const ticket = await this.ticketOfCode(
      operator,
      store,
      input.code,
      head.rescan.gameId,
    );
    const outcome = await this.transactions.withTransaction(async (session) => {
      const now = this.clock.now();
      await this.countModes.releaseExpiredRescans(
        operator,
        store,
        now,
        session,
      );
      const record = await this.liveRescan(operator, store, rescanId, session);
      const index = record.rescan.places.findIndex((place) =>
        samePoint(place.cashPointId ?? null, cashPointId),
      );
      const place = record.rescan.places[index];
      if (place === undefined) {
        throw rescanError("VALIDATION_FAILED", "place not in this rescan", {
          fields: ["cashPointId"],
        });
      }
      const facts = factsOf(place);
      const startable = rescanPlaceStartOf(facts, String(by), now);
      if (startable.kind === "done") {
        throw rescanError("CONFLICT", RESCAN_REASONS.placeDone);
      }
      if (startable.kind === "busy") {
        const names = await this.views.userNames(operator, store.tenantId, [
          new Types.ObjectId(startable.by),
        ]);
        throw rescanError("CONFLICT", RESCAN_REASONS.placeBusy, {
          byName: names.get(startable.by) ?? "",
        });
      }
      const state = rescanPlaceStateOf(facts, now);
      if (state !== "scanning" || facts.scanningBy !== String(by)) {
        await this.startPlace(operator, store, cashPointId, now, session);
      }
      const duplicate = place.scannedTicketIds.some((id) =>
        id.equals(ticket._id),
      );
      const places = record.rescan.places.map((item, at) =>
        at === index
          ? {
              ...plainPlace(item),
              scannedTicketIds: duplicate
                ? [...item.scannedTicketIds]
                : [...item.scannedTicketIds, ticket._id],
              scanningBy: by,
              lastScanAt: now,
            }
          : plainPlace(item),
      );
      await this.writeRescan(operator, store, record, session, {
        "rescan.places": places,
        "rescan.lastActiveAt": now,
      });
      return { duplicate };
    });
    const record = await this.mustRescan(operator, store, input.rescanId);
    const model = await this.modelOf(
      operator,
      store,
      record,
      isStoreManager(grant),
    );
    const placeModel = model.places.find((place) =>
      cashPointId === null
        ? place.cashPointId === null
        : place.cashPointId === String(cashPointId),
    );
    const item = placeModel?.items.find(
      (one) => one.ticketId === String(ticket._id),
    );
    return {
      item: item ?? {
        ticketId: String(ticket._id),
        gameCode: "",
        bookNo: ticket.bookNo,
        ticketNo: ticket.ticketNo,
        outcome: "ok",
        partnerTicketNo: null,
        cashPointId: cashPointId === null ? null : String(cashPointId),
      },
      duplicate: outcome.duplicate,
      rescan: model,
    };
  }

  // ---- 這裡刷完了 ----

  /**
   * [這裡刷完了](8.4 第 3、4 點;要在一個交易):刷到的張、這個位置的未售、本各一次讀,照 `rescanResultOf` 寫事件
   * (對號兩筆 `match`、尋回 / 記到這裡 / 待查各一筆,`refType: stocktake`、`refId` = 重刷單),帳本整批寫;
   * 全部位置刷完 → 重刷完成、解除移櫃暫停。指令數不隨張數成長(TX-06)。
   */
  async finishPlace(
    operator: OperatorContext,
    input: FinishLotteryRescanPlaceInput,
  ): Promise<LotteryRescanModel> {
    const grant = await this.access.grantOf(operator);
    const store = await this.support.mustStore(operator, input.orgId);
    const by = operator.actorId;
    if (by === null) {
      throw rescanError("FORBIDDEN", "no operator");
    }
    const cashPointId = this.placeIdOf(input.cashPointId);
    const rescanId = this.mustId(input.rescanId);
    await this.transactions.withTransaction(async (session) => {
      const now = this.clock.now();
      await this.countModes.releaseExpiredRescans(
        operator,
        store,
        now,
        session,
      );
      const record = await this.liveRescan(operator, store, rescanId, session);
      const index = record.rescan.places.findIndex((place) =>
        samePoint(place.cashPointId ?? null, cashPointId),
      );
      const place = record.rescan.places[index];
      if (place === undefined) {
        throw rescanError("VALIDATION_FAILED", "place not in this rescan", {
          fields: ["cashPointId"],
        });
      }
      const startable = rescanPlaceStartOf(factsOf(place), String(by), now);
      if (startable.kind === "done") {
        throw rescanError("CONFLICT", RESCAN_REASONS.placeDone);
      }
      if (startable.kind === "busy") {
        const names = await this.views.userNames(operator, store.tenantId, [
          new Types.ObjectId(startable.by),
        ]);
        throw rescanError("CONFLICT", RESCAN_REASONS.placeBusy, {
          byName: names.get(startable.by) ?? "",
        });
      }
      if (rescanPlaceStateOf(factsOf(place), now) === "pending") {
        // 一張都沒刷就按刷完(這個位置沒有這個遊戲):照樣是「開始刷這個位置」,要檢查盤點中登記
        await this.startPlace(operator, store, cashPointId, now, session);
      }
      const { events, results } = await this.placeWritesOf(
        operator,
        store,
        record,
        place,
        now,
        session,
      );
      await this.ledger.applyTicketEvents(session, { operator }, events);
      const places = record.rescan.places.map((item, at) =>
        at === index
          ? {
              ...plainPlace(item),
              scanningBy: null,
              doneAt: now,
              doneBy: by,
            }
          : plainPlace(item),
      );
      const finished = places.every((item) => item.doneAt !== null);
      const confirmed = finished
        ? await this.confirmUnmatchedOf(operator, store, record, now, session)
        : { events: [], results: [] };
      await this.ledger.applyTicketEvents(
        session,
        { operator },
        confirmed.events,
      );
      await this.writeRescan(operator, store, record, session, {
        "rescan.places": places,
        "rescan.results": [
          ...record.rescan.results.map((row) => ({
            cashPointId: row.cashPointId ?? null,
            ticketId: row.ticketId,
            outcome: row.outcome,
            partnerTicketId: row.partnerTicketId ?? null,
          })),
          ...results,
          ...confirmed.results,
        ],
        "rescan.lastActiveAt": now,
        ...(finished
          ? {
              status: STOCKTAKE_STATUS.confirmed,
              confirmedAt: now,
              confirmedBy: by,
              "rescan.finishedAt": now,
            }
          : {}),
      });
      if (finished) {
        await this.countModes.removeRescanPause(
          operator,
          store,
          record._id,
          session,
        );
      }
      await this.support.publish(store);
    });
    const record = await this.mustRescan(operator, store, input.rescanId);
    return this.modelOf(operator, store, record, isStoreManager(grant));
  }

  // ---- 取消 ----

  async cancel(
    operator: OperatorContext,
    input: LotteryRescanInput,
  ): Promise<LotteryRescanModel> {
    const grant = await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, input.orgId);
    const rescanId = this.mustId(input.rescanId);
    await this.transactions.withTransaction(async (session) => {
      const now = this.clock.now();
      await this.countModes.releaseExpiredRescans(
        operator,
        store,
        now,
        session,
      );
      const record = await this.liveRescan(operator, store, rescanId, session);
      if (
        !canCancelRescan(
          String(record.rescan.startedBy),
          operator.actorId === null ? null : String(operator.actorId),
          isStoreManager(grant),
        )
      ) {
        throw rescanError(
          "FORBIDDEN",
          `Missing permission ${STORE_PERMISSIONS.edit}`,
        );
      }
      await this.writeRescan(operator, store, record, session, {
        status: STOCKTAKE_STATUS.rejected,
        closedAt: now,
        "rescan.cancelledAt": now,
        "rescan.cancelledBy": operator.actorId,
        "rescan.cancelCause": "manual",
      });
      await this.countModes.removeRescanPause(
        operator,
        store,
        record._id,
        session,
      );
      await this.support.publish(store);
    });
    const record = await this.mustRescan(operator, store, input.rescanId);
    return this.modelOf(operator, store, record, isStoreManager(grant));
  }

  /** 排程與每個動作前:1 小時沒動作的重刷自動取消(有取消才送信號)。 */
  async expire(operator: OperatorContext, store: StoreRef): Promise<number> {
    const record = await this.countModes.sessionRecordOf(operator, store.orgId);
    if (record?.movePauses.some((pause) => pause.gameId !== null) !== true) {
      return 0;
    }
    return this.transactions.withTransaction(async (session) => {
      const count = await this.countModes.releaseExpiredRescans(
        operator,
        store,
        this.clock.now(),
        session,
      );
      if (count > 0) {
        await this.support.publish(store);
      }
      return count;
    });
  }

  // ---- 內部 ----

  /**
   * 「開始刷這個位置」(8.5a):這個位置有人有效的盤點中登記 → 擋(誰、幾點開始、剩幾分鐘);
   * 沒擋 → 分店那一筆 `version` +1(和登記一定有先後)。
   */
  private async startPlace(
    operator: OperatorContext,
    store: StoreRef,
    cashPointId: Types.ObjectId | null,
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    const record = await this.countModes.sessionRecordOf(
      operator,
      store.orgId,
      session,
    );
    if (record === null) {
      return;
    }
    const blocking = record.stocktakeSessions.find(
      (item) =>
        isSessionLive(
          { lastActiveAt: item.lastActiveAt, endedAt: item.endedAt ?? null },
          now,
        ) && item.cashPointIds.some((id) => samePoint(id ?? null, cashPointId)),
    );
    if (blocking !== undefined) {
      const names = await this.views.userNames(operator, store.tenantId, [
        blocking.by,
      ]);
      throw rescanError("CONFLICT", RESCAN_REASONS.placeStocktaking, {
        byName: names.get(String(blocking.by)) ?? "",
        startedAt: blocking.startedAt.toISOString(),
        minutesLeft: sessionMinutesLeftOf(
          { lastActiveAt: blocking.lastActiveAt },
          now,
        ),
      });
    }
    await this.countModes.touchForRescanPlace(operator, store, record, session);
  }

  /** 一個位置按刷完要寫的事件與結果(刷到的張、這個位置的未售、本各一次讀)。 */
  private async placeWritesOf(
    operator: OperatorContext,
    store: StoreRef,
    record: RescanRecord,
    place: StocktakeRescanPlace,
    now: Date,
    session: ClientSession,
  ): Promise<{ events: TicketEventInput[]; results: StocktakeRescanResult[] }> {
    const reader = await this.readerOf(operator, store);
    const cashPointId = place.cashPointId ?? null;
    const target = placeOf(cashPointId);
    const [scannedRows, candidates] = await Promise.all([
      place.scannedTicketIds.length === 0
        ? Promise.resolve([] as TicketRecord[])
        : this.tickets.findMany(
            reader,
            { _id: { $in: [...place.scannedTicketIds] } },
            { session },
          ),
      this.tickets.findMany(
        reader,
        {
          orgId: store.orgId,
          gameId: record.rescan.gameId,
          status: TICKET_STATUS.unsold,
          ...(cashPointId === null
            ? { "location.kind": TICKET_LOCATION_KIND.stock }
            : {
                "location.kind": TICKET_LOCATION_KIND.counter,
                "location.cashPointId": cashPointId,
              }),
        },
        { session },
      ),
    ]);
    const books = await this.booksOf(
      reader,
      [...scannedRows, ...candidates].map((ticket) => ticket.bookId),
      session,
    );
    const byId = new Map(
      [...scannedRows, ...candidates].map((ticket) => [
        String(ticket._id),
        ticket,
      ]),
    );
    const scanned = place.scannedTicketIds.flatMap((id) => {
      const ticket = byId.get(String(id));
      return ticket === undefined ? [] : [ticket];
    });
    const result = rescanResultOf({
      gameId: String(record.rescan.gameId),
      place: target,
      scanned: scanned.map((ticket) => rescanTicketOf(ticket, store.orgId)),
      candidates: candidates.map((ticket) => matchTicketOf(ticket)),
      books,
    });
    const ref = { refType: STOCKTAKE_REF_TYPE, refId: record._id };
    const location: TicketLocation =
      cashPointId === null
        ? { kind: TICKET_LOCATION_KIND.stock, cashPointId: null }
        : { kind: TICKET_LOCATION_KIND.counter, cashPointId };
    const events: TicketEventInput[] = [];
    const results: StocktakeRescanResult[] = [];
    for (const item of result.items) {
      const ticket = byId.get(item.ticketId);
      if (ticket === undefined || !RECORDED_OUTCOMES.has(item.outcome)) {
        continue;
      }
      const partner =
        item.partnerId === null ? undefined : byId.get(item.partnerId);
      results.push({
        cashPointId,
        ticketId: ticket._id,
        outcome: item.outcome,
        partnerTicketId: partner?._id ?? null,
      });
      events.push(
        ...this.itemEventsOf(item.outcome, ticket, partner, {
          cashPointId,
          location,
          at: now,
          ref,
        }),
      );
    }
    for (const id of result.investigate) {
      const ticket = byId.get(id);
      if (ticket === undefined) {
        continue;
      }
      results.push({
        cashPointId,
        ticketId: ticket._id,
        outcome: "investigated",
        partnerTicketId: null,
      });
      events.push({
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        expectedStatuses: [TICKET_STATUS.unsold],
        type: TICKET_EVENT_TYPE.investigate,
        at: now,
        patch: {
          status: TICKET_STATUS.investigating,
          responsibleOrgId: store.orgId,
        },
        cashPointId,
        ...ref,
      });
    }
    return { events, results };
  }

  /**
   * 全部位置刷完(8.3、8.4 第 4 點):這個遊戲到這時還是待查·未對號、遺失·未對號的張,全店都沒刷到,確定不在,
   * 每張一筆 `renumber_confirm` 清掉記號(同補點編號,帳本整批寫)。已售·未對號不動:重刷分不出賣掉或遺失
   * (5.1,補點編號才清)。鎖定中的張可能刷到過(8.4 第 5 點),不動。一次讀,不隨張數成長(TX-06)。
   */
  private async confirmUnmatchedOf(
    operator: OperatorContext,
    store: StoreRef,
    record: RescanRecord,
    now: Date,
    session: ClientSession,
  ): Promise<{ events: TicketEventInput[]; results: StocktakeRescanResult[] }> {
    const reader = await this.readerOf(operator, store);
    const tickets = await this.tickets.findMany(
      reader,
      {
        orgId: store.orgId,
        gameId: record.rescan.gameId,
        status: { $in: [TICKET_STATUS.investigating, TICKET_STATUS.lost] },
        unmatched: true,
        lockedBy: null,
      },
      { session },
    );
    return {
      events: tickets.map((ticket) => ({
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        expectedStatuses: [ticket.status],
        type: TICKET_EVENT_TYPE.renumberConfirm,
        at: now,
        patch: { unmatched: false },
        refType: STOCKTAKE_REF_TYPE,
        refId: record._id,
      })),
      results: tickets.map((ticket) => ({
        cashPointId: ticket.location.cashPointId ?? null,
        ticketId: ticket._id,
        outcome: "investigated",
        partnerTicketId: null,
      })),
    };
  }

  /** 刷到的一張按刷完要寫的事件:對號兩筆 `match`、尋回、記到這裡;其他(記已售但還在、要先更正)不動。 */
  private itemEventsOf(
    outcome: string,
    ticket: TicketRecord,
    partner: TicketRecord | undefined,
    context: {
      cashPointId: Types.ObjectId | null;
      location: TicketLocation;
      at: Date;
      ref: { refType: string; refId: Types.ObjectId };
    },
  ): TicketEventInput[] {
    if (outcome === "matched" && partner !== undefined) {
      return matchEventsOf(ticket, partner, context.at);
    }
    if (outcome === "recovered") {
      return [
        {
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          expectedStatuses: [TICKET_STATUS.investigating, TICKET_STATUS.lost],
          type: TICKET_EVENT_TYPE.recover,
          at: context.at,
          patch: {
            status: TICKET_STATUS.unsold,
            location: context.location,
            responsibleOrgId: null,
          },
          cashPointId: context.cashPointId,
          ...context.ref,
        },
      ];
    }
    if (outcome === "moved") {
      return [
        this.movedEventOf(ticket, context.cashPointId, context.at, context.ref),
      ];
    }
    return [];
  }

  /**
   * 系統記在別的位置的未售、這個位置已沒有可對號的張 → 記到這裡(狀態不變、只換位置):
   * 收銀點之間 = 移櫃;檯面 → 庫存 = 收回;庫存 → 檯面 = 拆本(上檯面)。
   */
  private movedEventOf(
    ticket: TicketRecord,
    cashPointId: Types.ObjectId | null,
    at: Date,
    ref: { refType: string; refId: Types.ObjectId },
  ): TicketEventInput {
    const base = {
      ticketId: ticket._id,
      expectedVersion: ticket.version,
      expectedStatuses: [TICKET_STATUS.unsold],
      at,
      ...ref,
    };
    if (cashPointId === null) {
      return {
        ...base,
        type: TICKET_EVENT_TYPE.recall,
        patch: {
          location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
        },
        cashPointId: ticket.location.cashPointId ?? null,
      };
    }
    return {
      ...base,
      type:
        ticket.location.kind === TICKET_LOCATION_KIND.stock
          ? TICKET_EVENT_TYPE.open
          : TICKET_EVENT_TYPE.move,
      patch: {
        location: { kind: TICKET_LOCATION_KIND.counter, cashPointId },
      },
      cashPointId,
    };
  }

  private async booksOf(
    reader: OperatorContext,
    ids: readonly Types.ObjectId[],
    session?: ClientSession,
  ): Promise<Map<string, CountPickBook & { gameCode: string }>> {
    const unique = [...new Map(ids.map((id) => [String(id), id])).values()];
    if (unique.length === 0) {
      return new Map();
    }
    const rows = await this.books.findMany(
      reader,
      { _id: { $in: unique } },
      {
        select: "bookNo firstOpenedAt gameCode",
        ...(session === undefined ? {} : { session }),
      },
    );
    return new Map(
      rows.map((book) => [
        String(book._id),
        {
          bookNo: book.bookNo,
          firstOpenedAt: book.firstOpenedAt ?? null,
          gameCode: book.gameCode,
        },
      ]),
    );
  }

  /** 刷到的碼 → 張(本號對到好幾款遊戲 → 先取重刷的遊戲;本店沒有 → 別店的那張,結果是「不是本店」)。 */
  private async ticketOfCode(
    operator: OperatorContext,
    store: StoreRef,
    code: string,
    gameId: Types.ObjectId,
  ): Promise<TicketRecord> {
    const parsed = parseTicketInput(code);
    const bookNo = parsed === null ? null : normalizeBookNo(parsed.bookNo);
    if (parsed === null || bookNo === null) {
      throw rescanError("NOT_FOUND", RESCAN_REASONS.notFound);
    }
    const reader = await this.readerOf(operator, store);
    const books = await this.books.findMany(reader, {
      bookNo,
      ...(parsed.gameCode === undefined ? {} : { gameCode: parsed.gameCode }),
    });
    const found =
      books.length === 0
        ? []
        : await this.tickets.findMany(reader, {
            bookId: { $in: books.map((book) => book._id) },
            ticketNo: parsed.ticketNo,
          });
    const mine = found.filter((ticket) => ticket.orgId.equals(store.orgId));
    const picked =
      mine.find((ticket) => ticket.gameId.equals(gameId)) ??
      mine.at(0) ??
      found.at(0);
    if (picked === undefined) {
      throw rescanError("NOT_FOUND", RESCAN_REASONS.notFound);
    }
    return picked;
  }

  private placeIdOf(text: string | null | undefined): Types.ObjectId | null {
    if (text == null || text === "") {
      return null;
    }
    const id = parseId(text);
    if (id === null) {
      throw rescanError("VALIDATION_FAILED", "invalid cash point", {
        fields: ["cashPointId"],
      });
    }
    return id;
  }

  private mustId(text: string): Types.ObjectId {
    const id = parseId(text);
    if (id === null) {
      throw rescanError("NOT_FOUND", "rescan not found");
    }
    return id;
  }

  private readerOf(
    operator: OperatorContext,
    store: StoreRef,
  ): Promise<OperatorContext> {
    return tenantBoundaryContext(this.orgs, operator, store.tenantId);
  }

  private async mustRescan(
    operator: OperatorContext,
    store: StoreRef,
    idText: string,
  ): Promise<RescanRecord> {
    const id = this.mustId(idText);
    const record = await this.stocktakes.findOne(operator, {
      _id: id,
      orgId: store.orgId,
      purpose: "rescan",
    });
    if (record?.rescan == null) {
      throw rescanError("NOT_FOUND", "rescan not found");
    }
    return record as RescanRecord;
  }

  /** 交易內讀進行中的那一次(已結束 → `RESCAN_ENDED`)。 */
  private async liveRescan(
    operator: OperatorContext,
    store: StoreRef,
    id: Types.ObjectId,
    session: ClientSession,
  ): Promise<RescanRecord> {
    const record = await this.stocktakes.findOne(
      operator,
      { _id: id, orgId: store.orgId, purpose: "rescan" },
      { session },
    );
    if (record?.rescan == null) {
      throw rescanError("NOT_FOUND", "rescan not found");
    }
    if (record.status !== STOCKTAKE_STATUS.pending) {
      throw rescanError("CONFLICT", RESCAN_REASONS.ended);
    }
    return record as RescanRecord;
  }

  /** 重刷單的條件更新(版本對不上 → 重試)。 */
  private async writeRescan(
    operator: OperatorContext,
    store: StoreRef,
    record: RescanRecord,
    session: ClientSession,
    set: Record<string, unknown>,
  ): Promise<void> {
    const writer = await this.readerOf(operator, store);
    const updated = await this.stocktakes.findOneAndUpdate(
      writer,
      { _id: record._id, version: record.version },
      { $set: set, $inc: { version: 1 } },
      { session },
    );
    if (updated === null) {
      throw rescanError("CONFLICT", "rescan changed, please retry");
    }
  }

  /**
   * 重刷頁的資料:各位置的狀態;還沒刷完的位置照現在的清單預先算出結果(刷到的張、這些位置的未售、本各一次讀),
   * 刷完的位置用寫下的結果。
   */
  private async modelOf(
    operator: OperatorContext,
    store: StoreRef,
    record: RescanRecord,
    manager: boolean,
  ): Promise<LotteryRescanModel> {
    const now = this.clock.now();
    const rescan = record.rescan;
    const reader = await this.readerOf(operator, store);
    const open = record.status === STOCKTAKE_STATUS.pending;
    const pendingPlaces = open
      ? rescan.places.filter((place) => place.doneAt === null)
      : [];
    const scannedIds = pendingPlaces.flatMap((place) => place.scannedTicketIds);
    const resultIds = rescan.results.flatMap((row) => [
      row.ticketId,
      ...(row.partnerTicketId == null ? [] : [row.partnerTicketId]),
    ]);
    const pointIds = pendingPlaces.flatMap((place) =>
      place.cashPointId === null ? [] : [place.cashPointId],
    );
    const withStock = pendingPlaces.some((place) => place.cashPointId === null);
    const [listed, candidates, points, names] = await Promise.all([
      scannedIds.length + resultIds.length === 0
        ? Promise.resolve([] as TicketRecord[])
        : this.tickets.findMany(reader, {
            _id: { $in: [...scannedIds, ...resultIds] },
          }),
      pendingPlaces.length === 0 || scannedIds.length === 0
        ? Promise.resolve([] as TicketRecord[])
        : this.tickets.findMany(reader, {
            orgId: store.orgId,
            gameId: rescan.gameId,
            status: TICKET_STATUS.unsold,
            $or: [
              ...(pointIds.length === 0
                ? []
                : [
                    {
                      "location.kind": TICKET_LOCATION_KIND.counter,
                      "location.cashPointId": { $in: pointIds },
                    },
                  ]),
              ...(withStock
                ? [{ "location.kind": TICKET_LOCATION_KIND.stock }]
                : []),
            ],
          }),
      this.support.cashPointsOf(operator, store.orgId),
      this.views.userNames(operator, store.tenantId, [
        rescan.startedBy,
        ...rescan.places.flatMap((place) => [
          ...(place.scanningBy === null ? [] : [place.scanningBy]),
          ...(place.doneBy === null ? [] : [place.doneBy]),
        ]),
      ]),
    ]);
    const books = await this.booksOf(
      reader,
      [...listed, ...candidates].map((ticket) => ticket.bookId),
    );
    const byId = new Map(
      [...listed, ...candidates].map((ticket) => [String(ticket._id), ticket]),
    );
    const itemOf = (
      ticketId: string,
      outcome: string,
      partnerId: string | null,
      cashPointId: Types.ObjectId | null,
    ): LotteryRescanItemModel | null => {
      const ticket = byId.get(ticketId);
      if (ticket === undefined) {
        return null;
      }
      return {
        ticketId,
        gameCode: books.get(String(ticket.bookId))?.gameCode ?? "",
        bookNo: ticket.bookNo,
        ticketNo: ticket.ticketNo,
        outcome,
        partnerTicketNo:
          partnerId === null ? null : (byId.get(partnerId)?.ticketNo ?? null),
        cashPointId: cashPointId === null ? null : String(cashPointId),
      };
    };
    const results = rescan.results.flatMap((row) => {
      const item = itemOf(
        String(row.ticketId),
        row.outcome,
        row.partnerTicketId == null ? null : String(row.partnerTicketId),
        row.cashPointId ?? null,
      );
      return item === null ? [] : [item];
    });
    const places = rescan.places.map((place) => {
      const cashPointId = place.cashPointId ?? null;
      let items: LotteryRescanItemModel[];
      if (place.doneAt !== null || !open) {
        items = results.filter((item) =>
          cashPointId === null
            ? item.cashPointId === null
            : item.cashPointId === String(cashPointId),
        );
      } else {
        const scanned = place.scannedTicketIds.flatMap((id) => {
          const ticket = byId.get(String(id));
          return ticket === undefined ? [] : [ticket];
        });
        const preview = rescanResultOf({
          gameId: String(rescan.gameId),
          place: placeOf(cashPointId),
          scanned: scanned.map((ticket) => rescanTicketOf(ticket, store.orgId)),
          candidates: candidates.map((ticket) => matchTicketOf(ticket)),
          books,
        });
        items = preview.items.flatMap((item) => {
          const model = itemOf(
            item.ticketId,
            item.outcome,
            item.partnerId,
            cashPointId,
          );
          return model === null ? [] : [model];
        });
      }
      return this.placeModelOf(place, points, names, operator, now, items);
    });
    return {
      id: String(record._id),
      orgId: String(store.orgId),
      gameId: String(rescan.gameId),
      gameCode: rescan.gameCode,
      gameName: rescan.gameName,
      status: rescanStatusOf(record.status),
      cancelCause: rescan.cancelCause ?? null,
      startedAt: record.startedAt,
      startedByName: names.get(String(rescan.startedBy)) ?? "",
      finishedAt: rescan.finishedAt ?? null,
      minutesLeft: open ? rescanMinutesLeftOf(rescan.lastActiveAt, now) : 0,
      canCancel:
        open &&
        canCancelRescan(
          String(rescan.startedBy),
          operator.actorId === null ? null : String(operator.actorId),
          manager,
        ),
      doneCount: rescan.places.filter((place) => place.doneAt !== null).length,
      places,
      results,
    };
  }

  private placeModelOf(
    place: StocktakeRescanPlace,
    points: ReadonlyMap<string, { name: string }>,
    names: ReadonlyMap<string, string>,
    operator: OperatorContext,
    now: Date,
    items: LotteryRescanItemModel[],
  ): LotteryRescanPlaceModel {
    const state: RescanPlaceState = rescanPlaceStateOf(factsOf(place), now);
    const cashPointId = place.cashPointId ?? null;
    return {
      cashPointId: cashPointId === null ? null : String(cashPointId),
      name:
        cashPointId === null
          ? ""
          : (points.get(String(cashPointId))?.name ?? ""),
      state,
      scanningByName:
        place.scanningBy === null
          ? null
          : (names.get(String(place.scanningBy)) ?? ""),
      mine:
        place.scanningBy !== null &&
        operator.actorId !== null &&
        place.scanningBy.equals(operator.actorId),
      doneAt: place.doneAt ?? null,
      doneByName:
        place.doneBy === null ? null : (names.get(String(place.doneBy)) ?? ""),
      scannedCount: place.scannedTicketIds.length,
      items,
    };
  }
}
