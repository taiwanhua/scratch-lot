import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { type ClientSession, Types } from "mongoose";

import {
  STOCKTAKE_REASONS,
  STOCKTAKE_TYPES,
  STORE_PERMISSIONS,
  type StocktakeSessionEntry,
  type StocktakeType,
  isSessionLive,
  isWholeStoreSession,
  parseStocktakeDraft,
  sessionExpiresAtOf,
  sessionMinutesLeftOf,
  stocktakeSessionPlacesOf,
  stocktakeSessionStartOf,
  wholeStoreSessionOf,
} from "@repo/domain/project/lottery";

import { AuditService } from "../../../audit/audit.service";
import type { OperatorContext } from "../../../database/operator-context";
import { TransactionService } from "../../../database/transaction";
import type { CountModeStocktakeSession } from "../../database/lottery-settings/lottery-store-count-mode.schema";
import { StoreCountModeService } from "../settings/store-count-mode.service";
import { StoreShiftViews } from "../store/shift-views";
import { StoreAccess, isStoreManager } from "../store/store-access";
import { StoreClock } from "../store/store-clock";
import { type StoreRef, StoreSalesSupport } from "../store/store-sales-support";
import type {
  EndLotteryStocktakeSessionInput,
  SaveLotteryStocktakeSessionInput,
  StartLotteryStocktakeSessionInput,
} from "./dto/stocktake.input";
import type {
  LotteryStocktakeSessionModel,
  LotteryStocktakeSessionsModel,
} from "./models/stocktake-count.model";
import { forbiddenError, validationError } from "./stocktake-error";

/**
 * 分店那一筆的登記 → 一般物件(讀到的是 Mongoose 子文件,展開 `...item` 會帶進內部欄位;
 * 寫回時整個陣列換掉,所以先換成只有欄位的物件)。
 */
function sessionsOfRecord(
  record: { stocktakeSessions: readonly CountModeStocktakeSession[] } | null,
): CountModeStocktakeSession[] {
  return (record?.stocktakeSessions ?? []).map((item) => ({
    sessionId: item.sessionId,
    type: item.type,
    cashPointIds: [...item.cashPointIds],
    by: item.by,
    startedAt: item.startedAt,
    lastActiveAt: item.lastActiveAt,
    draft: item.draft,
    endedAt: item.endedAt ?? null,
    endedBy: item.endedBy ?? null,
  }));
}

/** 登記裡的一筆 → 共用規則要的形狀(id 換成字串;庫存 = null)。 */
function entryOf(item: CountModeStocktakeSession): StocktakeSessionEntry {
  return {
    sessionId: item.sessionId,
    type: item.type,
    cashPointIds: item.cashPointIds.map((id) =>
      id === null ? null : String(id),
    ),
    by: String(item.by),
    startedAt: item.startedAt,
    lastActiveAt: item.lastActiveAt,
    endedAt: item.endedAt ?? null,
  };
}

const isType = (value: string): value is StocktakeType =>
  (STOCKTAKE_TYPES as readonly string[]).includes(value);

/** 同一個範圍(送出時解除自己那一筆):全店 = 含庫存;單一收銀點 = 只有那台。 */
const sameScope = (
  item: CountModeStocktakeSession,
  scopeCashPointId: string | null,
): boolean =>
  scopeCashPointId === null
    ? item.cashPointIds.includes(null)
    : item.cashPointIds.length === 1 &&
      String(item.cashPointIds[0]) === scopeCashPointId;

/** 登記的錯誤(GQL-04:通用碼 `CONFLICT`,`extensions.reason` 細分、`extensions.session` = 擋住的那一筆)。 */
function sessionError(
  reason: string,
  session: LotteryStocktakeSessionModel | null,
): GraphQLError {
  return new GraphQLError("stocktake session unavailable", {
    extensions: {
      code: "CONFLICT",
      reason,
      ...(session === null
        ? {}
        : {
            session: {
              sessionId: session.sessionId,
              type: session.type,
              wholeStore: session.wholeStore,
              cashPointId: session.cashPointId,
              cashPointName: session.cashPointName,
              byId: session.byId,
              byName: session.byName,
              mine: session.mine,
              canEnd: session.canEnd,
              startedAt: session.startedAt.toISOString(),
              lastActiveAt: session.lastActiveAt.toISOString(),
              expiresAt: session.expiresAt.toISOString(),
              minutesLeft: session.minutesLeft,
              live: session.live,
              ended: session.ended,
            },
          }),
    },
  });
}

/**
 * 盤點中登記(張數店規格 5.6 `stocktakeSessions[]`、8.5a、14.2「另新增」;兩種店統一做法):
 *
 * - `start`:按進入盤點(交班、日結、臨時盤點)時登記這些位置;位置和別人有效的登記重疊 → 擋下
 *   (「A 台正在由 OO 盤點(10:05 開始,剩 52 分鐘自動結束)」);[繼續] 一筆 = 同一個 `sessionId`
 * - `save`:盤點進度每次變動就存到登記上、重算倒數(1 小時沒操作自動失效,進度保留)
 * - `end`:自己的 = [放棄](解除);別人的 = 店長 [結束這個盤點](解除登記、進度保留、留稽核)
 * - `releaseOnSubmit`:送出時解除送出的人這個範圍的登記(和申請同一個交易)
 * - `wholeStoreOf`:全店盤點中各台不能交班
 *
 * 登記與重刷的「開始刷這個位置」(T6)在同一個交易裡檢查、更新同一筆分店文件(`$inc version`),兩邊一定有先後。
 * 讀寫分店那一筆一律經 `StoreCountModeService`。
 */
@Injectable()
export class StocktakeSessions {
  constructor(
    private readonly countModes: StoreCountModeService,
    private readonly transactions: TransactionService,
    private readonly support: StoreSalesSupport,
    private readonly views: StoreShiftViews,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
    private readonly audit: AuditService,
  ) {}

  // ---- 讀 ----

  /** 這家店的登記:有效的(別人的不給進度)與自己的(含失效、被結束的;給 [繼續])。 */
  async list(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryStocktakeSessionsModel> {
    const grant = await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, orgIdText);
    const now = this.clock.now();
    const record = await this.countModes.sessionRecordOf(operator, store.orgId);
    const items = sessionsOfRecord(record).filter(
      (item) =>
        isSessionLive(entryOf(item), now) ||
        (operator.actorId !== null && item.by.equals(operator.actorId)),
    );
    return {
      serverNow: now,
      items: await this.modelsOf(
        operator,
        store,
        items,
        now,
        isStoreManager(grant),
      ),
    };
  }

  /** 全店盤點中的那一筆(交班被擋);沒有 → null。 */
  async wholeStoreOf(
    operator: OperatorContext,
    store: StoreRef,
  ): Promise<LotteryStocktakeSessionModel | null> {
    const now = this.clock.now();
    const record = await this.countModes.sessionRecordOf(operator, store.orgId);
    const items = sessionsOfRecord(record);
    const found = wholeStoreSessionOf(
      items.map((item) => entryOf(item)),
      now,
    );
    const item = items.find(
      (candidate) => candidate.sessionId === found?.sessionId,
    );
    if (item === undefined) {
      return null;
    }
    const [model] = await this.modelsOf(operator, store, [item], now, false);
    return model ?? null;
  }

  // ---- 登記 / 存進度 / 解除 ----

  async start(
    operator: OperatorContext,
    input: StartLotteryStocktakeSessionInput,
  ): Promise<LotteryStocktakeSessionModel> {
    const grant = await this.access.grantOf(operator);
    if (!grant.has(STORE_PERMISSIONS.stocktake) || operator.actorId === null) {
      throw forbiddenError(`Missing permission ${STORE_PERMISSIONS.stocktake}`);
    }
    if (!isType(input.type)) {
      throw validationError("invalid stocktake type", ["type"]);
    }
    const type = input.type;
    const store = await this.support.mustStore(operator, input.orgId);
    const points = await this.support.cashPointsOf(operator, store.orgId);
    const scope = input.cashPointId ?? null;
    if (scope !== null && !points.has(scope)) {
      throw validationError("cash point not found", ["cashPointId"]);
    }
    const by = operator.actorId;
    const places = stocktakeSessionPlacesOf(scope, [...points.keys()]);
    const outcome = await this.retryCreate(() =>
      this.transactions.withTransaction(async (session) => {
        const now = this.clock.now();
        const record = await this.countModes.sessionRecordOf(
          operator,
          store.orgId,
          session,
        );
        const items = sessionsOfRecord(record);
        const decision = stocktakeSessionStartOf(
          items.map((item) => entryOf(item)),
          {
            type,
            cashPointIds: places,
            by: String(by),
            sessionId: input.sessionId ?? null,
          },
          now,
        );
        if (decision.kind === "missing") {
          return { kind: "missing" as const };
        }
        if (decision.kind === "blocked") {
          const blocking = items.find(
            (item) => item.sessionId === decision.entry.sessionId,
          );
          return { kind: "blocked" as const, own: decision.own, blocking, now };
        }
        let next: CountModeStocktakeSession[];
        let sessionId: string;
        if (decision.kind === "resume") {
          sessionId = decision.sessionId;
          next = items.map((item) =>
            item.sessionId === sessionId
              ? { ...item, lastActiveAt: now, endedAt: null, endedBy: null }
              : item,
          );
        } else {
          sessionId = randomUUID();
          // 自己同一個範圍、已失效或被結束的舊登記:這次是新的盤點,舊的不再接續
          next = [
            ...items.filter(
              (item) =>
                !(
                  item.by.equals(by) &&
                  !isSessionLive(entryOf(item), now) &&
                  sameScope(item, scope)
                ),
            ),
            {
              sessionId,
              type,
              cashPointIds: places.map((id) =>
                id === null ? null : new Types.ObjectId(id),
              ),
              by,
              startedAt: now,
              lastActiveAt: now,
              draft: null,
              endedAt: null,
              endedBy: null,
            },
          ];
        }
        await this.countModes.writeSessions(
          operator,
          store,
          record,
          next,
          session,
        );
        await this.support.publish(store);
        const item = next.find(
          (candidate) => candidate.sessionId === sessionId,
        );
        return { kind: "ok" as const, item, now };
      }),
    );
    if (outcome.kind === "missing") {
      throw sessionError(STOCKTAKE_REASONS.sessionEnded, null);
    }
    if (outcome.kind === "blocked") {
      const [view] =
        outcome.blocking === undefined
          ? []
          : await this.modelsOf(
              operator,
              store,
              [outcome.blocking],
              outcome.now,
              isStoreManager(grant),
            );
      throw sessionError(
        outcome.own
          ? STOCKTAKE_REASONS.sessionOwn
          : STOCKTAKE_REASONS.sessionBusy,
        view ?? null,
      );
    }
    if (outcome.item === undefined) {
      throw sessionError(STOCKTAKE_REASONS.sessionEnded, null);
    }
    const [model] = await this.modelsOf(
      operator,
      store,
      [outcome.item],
      outcome.now,
      false,
    );
    if (model === undefined) {
      throw sessionError(STOCKTAKE_REASONS.sessionEnded, null);
    }
    return model;
  }

  /**
   * 存盤點進度、重算倒數。登記已解除(送出、放棄)、被店長結束 → `sessionEnded`;失效後還沒被別人接手 → 重新生效;
   * 被別人接手同位置 → `sessionEnded`(畫面提示,進度留在畫面上)。
   */
  async save(
    operator: OperatorContext,
    input: SaveLotteryStocktakeSessionInput,
  ): Promise<LotteryStocktakeSessionModel> {
    const store = await this.support.mustStore(operator, input.orgId);
    const parsed = parseStocktakeDraft(input.draft);
    if (!parsed.ok || parsed.draft.orgId !== String(store.orgId)) {
      throw validationError(
        "stocktake draft is invalid",
        ["draft"],
        STOCKTAKE_REASONS.invalid,
      );
    }
    const by = operator.actorId;
    if (by === null) {
      throw forbiddenError("no operator");
    }
    const saved = await this.transactions.withTransaction(async (session) => {
      const now = this.clock.now();
      const record = await this.countModes.sessionRecordOf(
        operator,
        store.orgId,
        session,
      );
      const items = sessionsOfRecord(record);
      const mine = items.find(
        (item) => item.sessionId === input.sessionId && item.by.equals(by),
      );
      if (mine === undefined || (mine.endedAt ?? null) !== null) {
        return null;
      }
      const decision = stocktakeSessionStartOf(
        items.map((item) => entryOf(item)),
        {
          type: mine.type,
          cashPointIds: [],
          by: String(by),
          sessionId: mine.sessionId,
        },
        now,
      );
      if (decision.kind !== "resume") {
        return null;
      }
      const next = items.map((item) =>
        item.sessionId === mine.sessionId
          ? { ...item, draft: input.draft, lastActiveAt: now }
          : item,
      );
      await this.countModes.writeSessions(
        operator,
        store,
        record,
        next,
        session,
      );
      return {
        item: { ...mine, draft: input.draft, lastActiveAt: now },
        now,
      };
    });
    if (saved === null) {
      throw sessionError(STOCKTAKE_REASONS.sessionEnded, null);
    }
    const [model] = await this.modelsOf(
      operator,
      store,
      [saved.item],
      saved.now,
      false,
    );
    if (model === undefined) {
      throw sessionError(STOCKTAKE_REASONS.sessionEnded, null);
    }
    return model;
  }

  /**
   * 解除:自己的 = [放棄](整筆拿掉);別人的 = 店長 [結束這個盤點](記結束的時間與人、進度保留,本人回來仍可 [繼續];
   * 留稽核紀錄)。不是店長 → `FORBIDDEN`;已不在 → 當作已解除。
   */
  async end(
    operator: OperatorContext,
    input: EndLotteryStocktakeSessionInput,
  ): Promise<boolean> {
    const grant = await this.access.grantOf(operator);
    const store = await this.support.mustStore(operator, input.orgId);
    const by = operator.actorId;
    if (by === null) {
      throw forbiddenError("no operator");
    }
    const ended = await this.transactions.withTransaction(async (session) => {
      const now = this.clock.now();
      const record = await this.countModes.sessionRecordOf(
        operator,
        store.orgId,
        session,
      );
      const items = sessionsOfRecord(record);
      const target = items.find((item) => item.sessionId === input.sessionId);
      if (target === undefined) {
        return null;
      }
      const mine = target.by.equals(by);
      if (!mine && !isStoreManager(grant)) {
        throw forbiddenError(`Missing permission ${STORE_PERMISSIONS.edit}`);
      }
      const next = mine
        ? items.filter((item) => item.sessionId !== target.sessionId)
        : items.map((item) =>
            item.sessionId === target.sessionId
              ? { ...item, endedAt: now, endedBy: by }
              : item,
          );
      await this.countModes.writeSessions(
        operator,
        store,
        record,
        next,
        session,
      );
      await this.support.publish(store);
      return { target, mine };
    });
    if (ended !== null && !ended.mine) {
      await this.audit.record(operator, {
        action: "lottery-stocktake-session.end",
        targetType: "lottery_store_count_mode",
        targetId: store.orgId,
        before: {
          sessionId: ended.target.sessionId,
          type: ended.target.type,
          by: String(ended.target.by),
          startedAt: ended.target.startedAt.toISOString(),
        },
        after: { ended: true },
      });
    }
    return true;
  }

  /**
   * 送出盤點時解除送出的人這個範圍的登記(和申請同一個交易;8.5a「送出就解除」)。
   * 讀寫身分由呼叫端給(掛接點是租戶邊界的系統身分)。
   */
  async releaseOnSubmit(
    session: ClientSession,
    reader: OperatorContext,
    store: StoreRef,
    by: Types.ObjectId | null,
    scopeCashPointId: string | null,
  ): Promise<void> {
    if (by === null) {
      return;
    }
    const record = await this.countModes.sessionRecordOf(
      reader,
      store.orgId,
      session,
    );
    const items = sessionsOfRecord(record);
    const next = items.filter(
      (item) => !(item.by.equals(by) && sameScope(item, scopeCashPointId)),
    );
    if (next.length === items.length) {
      return;
    }
    await this.countModes.writeSessions(reader, store, record, next, session);
    await this.support.publish(store);
  }

  // ---- 內部 ----

  /** 第一次登記時兩人同時新增分店那一筆 → 唯一索引擋下後到的;重跑一次就會讀到先到的那一筆。 */
  private async retryCreate<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if ((error as { code?: unknown }).code === 11_000) {
        return run();
      }
      throw error;
    }
  }

  private async modelsOf(
    operator: OperatorContext,
    store: StoreRef,
    items: readonly CountModeStocktakeSession[],
    now: Date,
    manager: boolean,
  ): Promise<LotteryStocktakeSessionModel[]> {
    if (items.length === 0) {
      return [];
    }
    const [names, points] = await Promise.all([
      this.views.userNames(
        operator,
        store.tenantId,
        items.map((item) => item.by),
      ),
      this.support.cashPointsOf(operator, store.orgId),
    ]);
    return items.map((item) => {
      const entry = entryOf(item);
      const mine =
        operator.actorId !== null && item.by.equals(operator.actorId);
      const live = isSessionLive(entry, now);
      const whole = isWholeStoreSession(entry);
      const pointId = whole ? null : (entry.cashPointIds[0] ?? null);
      return {
        sessionId: item.sessionId,
        type: item.type,
        wholeStore: whole,
        cashPointId: pointId,
        cashPointName:
          pointId === null ? null : (points.get(pointId)?.name ?? ""),
        byId: String(item.by),
        byName: names.get(String(item.by)) ?? "",
        mine,
        canEnd: manager && !mine && live,
        startedAt: item.startedAt,
        lastActiveAt: item.lastActiveAt,
        expiresAt: sessionExpiresAtOf(entry),
        minutesLeft: live ? sessionMinutesLeftOf(entry, now) : 0,
        live,
        ended: (item.endedAt ?? null) !== null,
        draft: mine ? item.draft : null,
      };
    });
  }
}
