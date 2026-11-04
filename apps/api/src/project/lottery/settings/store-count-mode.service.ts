import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { type ClientSession, Types } from "mongoose";

import { compareDisplayName } from "@repo/domain/collation";
import {
  COUNT_MODE,
  type CountMode,
  type CountModeChangeCause,
  type CountModeSetting,
  type MovePauseBlock,
  STOCKTAKE_STATUS,
  type StoreBusy,
  canRenumber,
  displayBookNo,
  isRescanLive,
  liveMovePausesOf,
  movePauseBlockOf,
  pendingSkipCountOf,
  renumberApprovalOf,
  renumberStoreDueAtOf,
  storeBusyOf,
} from "@repo/domain/project/lottery";
import {
  type CountModeChangeOutcome,
  type CountModeChangeStore,
  LOTTERY_SETTING_KEYS,
  type LotterySettingKey,
  type LotterySettingRow,
  countModeChangeOutcomesOf,
  countModeSettingOf,
  lotterySettingOptionOf,
  lotterySettingValueOf,
} from "@repo/domain/project/lottery-settings";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import {
  OrgsRepository,
  UsersRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  LotteryBooksRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import {
  LotterySettingsRepository,
  type LotteryStoreCountModeDocument,
  LotteryStoreCountModesRepository,
} from "../../database/lottery-settings/lottery-settings.repositories";
import type {
  CountModeHistoryEntry,
  CountModeMovePause,
  CountModeStocktakeSession,
} from "../../database/lottery-settings/lottery-store-count-mode.schema";
import { LotteryStocktakesRepository } from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { tenantOfOperator } from "../../tenant-scope/operator-tenant";
import { bookStateConditionsOf } from "../inventory/book-state-filter";
import { type TenantOrg, isStoreOrg } from "../inventory/store-orgs";

type CountModeRecord = Persisted<LotteryStoreCountModeDocument>;

/** 一家分店的實際盤點制度(沒有筆或 mode 空 = 編號店)。 */
function modeOfRecord(record: CountModeRecord | null | undefined): CountMode {
  return record?.mode ?? COUNT_MODE.numbered;
}

/**
 * 分店那一筆上有效的移櫃暫停(張數店規格 5.6、8.5):全店重刷照舊;補點編號(`gameId: null`)只有它的盤點中登記
 * 還有效時才算(`liveMovePausesOf`)。id 換成字串。
 */
export function livePausesOf(
  record: Pick<CountModeRecord, "movePauses" | "stocktakeSessions"> | null,
  now: Date,
): { stocktakeId: string; gameId: string | null }[] {
  return liveMovePausesOf(
    (record?.movePauses ?? []).map((pause) => ({
      stocktakeId: String(pause.stocktakeId),
      gameId: pause.gameId === null ? null : String(pause.gameId),
    })),
    (record?.stocktakeSessions ?? []).map((item) => ({
      renumberPauseId:
        (item.renumberPauseId ?? null) === null
          ? null
          : String(item.renumberPauseId),
      lastActiveAt: item.lastActiveAt,
      endedAt: item.endedAt ?? null,
    })),
    now,
  );
}

/** 組織鏈:自己 → 父 → … → 租戶頂層(ancestors = [根, 租戶頂層, …, 父])。 */
function chainOf(org: Pick<TenantOrg, "id" | "ancestors">): string[] {
  return [org.id, ...org.ancestors.slice(1).toReversed()].map(String);
}

/** 檯面上還有待標註的一本(在某家店的某個收銀點)。 */
export interface PendingSkipBook {
  orgId: string;
  orgName: string;
  cashPointId: string;
  cashPointName: string;
  gameCode: string;
  gameName: string;
  /** 顯示用本號(開頭 0 時 6 位) */
  bookNo: string;
  pendingCount: number;
}

/** 會跟著改的一家分店。 */
export interface CountModePlanOutcome extends CountModeChangeOutcome {
  orgName: string;
}

/** 進行中工作的一家分店。 */
export interface CountModeBusyStore extends StoreBusy {
  orgId: string;
  orgName: string;
}

/**
 * 一次盤點制度改動的計畫:會跟著改的分店(與各自擋下的原因)、擋下的明細;`records` 給寫入用。
 * 任何一家有問題就整筆不能存(9.1、13.1)。
 */
export interface CountModePlan {
  outcomes: CountModePlanOutcome[];
  pendingSkipBooks: PendingSkipBook[];
  busyStores: CountModeBusyStore[];
  canSave: boolean;
  records: Map<string, CountModeRecord>;
}

/** 盤點制度的一筆歷程(顯示用)。 */
export interface CountModeHistoryView {
  from: CountMode | null;
  to: CountMode;
  at: Date;
  byName: string | null;
  cause: CountModeChangeCause;
  stocktakeId: string | null;
}

/**
 * 分店實際盤點制度(`lottery_store_count_modes`,張數店規格 5.6)的**唯一讀寫入口**:
 * 「誰讀:一律經 StoreCountModeService」。之後的票(銷售、盤點、重刷、補點、調貨、關帳)都從這裡讀。
 *
 * - `modeOf` / `modesOf`:分店實際的盤點制度(沒有筆 = 編號店)
 * - `settingOf`:分店某一條刮刮樂設定的生效值(沿組織樹往上找)
 * - `movePauseOf`:進行中的全店重刷 / 補點編號(移櫃暫停;重刷經 `addRescanPause` / `removeRescanPause` 寫,補點是 T8)
 * - `busyOf`:有沒有進行中的盤點 / 重刷 / 補點(改盤點制度的檢查;9.1)
 * - `planCountModeChange` / `applyCountModeChange`:改盤點制度時重算下層分店(同一個交易,一次 aggregate + 一次批次寫)
 *
 * 組織樹、整個租戶的設定、分店那一筆、張與本的計數一律以**租戶邊界**讀:上層改預設時下層分店不一定都在
 * 操作者的可見範圍,但它們的實際制度一定要跟著重算(登記在 `PROJECT_TENANT_BOUNDARY_CONTEXT_CALLERS`,
 * 用途「系統重算」「反查」)。
 */
@Injectable()
export class StoreCountModeService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
    private readonly settings: LotterySettingsRepository,
    private readonly countModes: LotteryStoreCountModesRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly games: LotteryGamesRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly audit: AuditService,
  ) {}

  // ---- 讀 ----

  /** 分店實際的盤點制度(沒有筆或 mode 空 = 編號店)。 */
  async modeOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<CountMode> {
    return modeOfRecord(await this.recordOf(operator, orgId));
  }

  /** 多家分店的實際盤點制度(一次讀;沒列到的 = 編號店)。 */
  async modesOf(
    operator: OperatorContext,
    orgIds: readonly Types.ObjectId[],
  ): Promise<Map<string, CountMode>> {
    const records = await this.countModes.findMany(operator, {
      orgId: { $in: [...orgIds] },
    });
    const byOrg = new Map(
      records.map((record) => [String(record.orgId), record]),
    );
    return new Map(
      orgIds.map((id) => [String(id), modeOfRecord(byOrg.get(String(id)))]),
    );
  }

  /** 分店那一筆(歷程、上次補點、進行中的工作);沒有 → null。 */
  async recordOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<CountModeRecord | null> {
    const reader = await this.tenantReaderOf(operator);
    return this.countModes.findOne(reader, { orgId });
  }

  /**
   * 多家分店那一筆的制度與歷程(營運報表判斷期間內的制度、補點編號、估算;張數店規格 11.1、11.4)。一次讀,
   * 沒列到的分店 = 編號店、沒有歷程(TX-07)。
   */
  async historiesOf(
    operator: OperatorContext,
    orgIds: readonly Types.ObjectId[],
  ): Promise<
    Map<string, Pick<CountModeRecord, "mode" | "history" | "lastRenumberAt">>
  > {
    if (orgIds.length === 0) {
      return new Map();
    }
    const reader = await this.tenantReaderOf(operator);
    const records = await this.countModes.findMany(
      reader,
      { orgId: { $in: [...orgIds] } },
      { select: "orgId mode history lastRenumberAt" },
    );
    return new Map(
      records.map((record) => [
        String(record.orgId),
        {
          mode: record.mode,
          history: record.history,
          lastRenumberAt: record.lastRenumberAt,
        },
      ]),
    );
  }

  /** 這個組織是不是分店(租戶裡沒有下層組織;下層不一定在操作者的可見範圍,以租戶邊界讀)。 */
  async isStore(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<boolean> {
    const reader = await this.tenantReaderOf(operator);
    return (await this.orgs.findOne(reader, { parentId: orgId })) === null;
  }

  /** 分店某一條刮刮樂設定的生效值(沿組織樹往上找,最後用程式預設)。 */
  async settingOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    key: LotterySettingKey,
  ): Promise<string> {
    const reader = await this.tenantReaderOf(operator);
    const org = await this.orgs.findById(reader, orgId);
    if (!org) {
      return lotterySettingOptionOf(key, [String(orgId)], []);
    }
    const chain = chainOf({ id: org._id, ancestors: org.ancestors });
    const rows = await this.settings.findMany(reader, {
      orgId: { $in: chain.map((id) => new Types.ObjectId(id)) },
      key,
    });
    return lotterySettingOptionOf(
      key,
      chain,
      rows.map((record) => toSettingRow(record)),
    );
  }

  /** 進行中的全店重刷 / 補點編號(移櫃暫停;空 = 不暫停;補點編號只算登記還有效的)。 */
  async movePauseOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    now: Date,
  ): Promise<{ stocktakeId: string; gameId: string | null }[]> {
    return livePausesOf(await this.recordOf(operator, orgId), now);
  }

  /**
   * 移櫃前的檢查與先後(張數店規格 5.6、8.5、8.5a B1 / B2;要在移櫃的交易內):讀分店那一筆的 `movePauses`,
   * 1 小時沒動作的全店重刷當場自動取消(8.4 第 6 點,同 `releaseExpiredRescans`);
   * 要移的遊戲在重刷中、或補點編號中 → 回擋下的原因、不寫;沒擋 → `$inc version`(和「開始重刷」更新同一份文件,
   * 後到的一方寫入衝突、整個交易重跑,結果只會是「先移後重刷」或「移櫃被擋」)。沒有那一筆(編號店、沒設過制度)
   * → 不會有重刷或補點,不寫。
   */
  async guardMove(
    operator: OperatorContext,
    target: { orgId: Types.ObjectId; tenantId: Types.ObjectId | null },
    gameIds: readonly Types.ObjectId[],
    session: ClientSession,
    now: Date,
  ): Promise<MovePauseBlock | null> {
    const record = await this.sessionRecordOf(operator, target.orgId, session);
    if (record === null) {
      return null;
    }
    const expired = await this.expiredRescansOf(operator, record, now, session);
    const block = movePauseBlockOf(
      livePausesOf(record, now)
        .filter((pause) => !expired.has(pause.stocktakeId))
        .map((pause) => ({ gameId: pause.gameId })),
      gameIds.map(String),
    );
    if (block !== null) {
      return block;
    }
    const writer = await tenantBoundaryContext(
      this.orgs,
      operator,
      target.tenantId,
    );
    const ids = [...expired.values()];
    if (ids.length > 0) {
      await this.cancelExpiredRescans(writer, ids, now, session);
    }
    await this.countModes.findOneAndUpdate(
      writer,
      { _id: record._id },
      {
        $inc: { version: 1 },
        ...(ids.length === 0
          ? {}
          : { $pull: { movePauses: { stocktakeId: { $in: ids } } } }),
      },
      { session },
    );
    return null;
  }

  // ---- 全店重刷的移櫃暫停(8.4、8.5;重刷服務經這裡寫分店那一筆) ----

  /**
   * 開始全店重刷:`movePauses` 加一筆(遊戲 = 重刷的遊戲)、`$inc version`(要在交易內;以讀到的 `version` 條件更新,
   * 和移櫃、盤點中登記一定有先後)。版本對不上 → `CONFLICT`。
   */
  async addRescanPause(
    operator: OperatorContext,
    target: { orgId: Types.ObjectId; tenantId: Types.ObjectId | null },
    record: CountModeRecord,
    pause: { stocktakeId: Types.ObjectId; gameId: Types.ObjectId },
    session: ClientSession,
  ): Promise<void> {
    const writer = await tenantBoundaryContext(
      this.orgs,
      operator,
      target.tenantId,
    );
    const updated = await this.countModes.findOneAndUpdate(
      writer,
      { _id: record._id, version: record.version },
      { $push: { movePauses: pause }, $inc: { version: 1 } },
      { session },
    );
    if (updated === null) {
      throw conflictError();
    }
  }

  /** 全店重刷結束(完成或取消):拿掉這次重刷的暫停、`$inc version`(要在交易內)。 */
  async removeRescanPause(
    operator: OperatorContext,
    target: { orgId: Types.ObjectId; tenantId: Types.ObjectId | null },
    stocktakeId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const writer = await tenantBoundaryContext(
      this.orgs,
      operator,
      target.tenantId,
    );
    await this.countModes.findOneAndUpdate(
      writer,
      { orgId: target.orgId },
      { $pull: { movePauses: { stocktakeId } }, $inc: { version: 1 } },
      { session },
    );
  }

  /**
   * 重刷「開始刷這個位置」:和盤點中登記檢查、更新同一筆分店文件(8.5a;以讀到的 `version` 條件 `$inc`,
   * 兩邊一定有先後)。版本對不上 → `CONFLICT`。
   */
  async touchForRescanPlace(
    operator: OperatorContext,
    target: { orgId: Types.ObjectId; tenantId: Types.ObjectId | null },
    record: CountModeRecord,
    session: ClientSession,
  ): Promise<void> {
    const writer = await tenantBoundaryContext(
      this.orgs,
      operator,
      target.tenantId,
    );
    const updated = await this.countModes.findOneAndUpdate(
      writer,
      { _id: record._id, version: record.version },
      { $inc: { version: 1 } },
      { session },
    );
    if (updated === null) {
      throw conflictError();
    }
  }

  /**
   * 把 1 小時沒動作的全店重刷自動取消(8.4 第 6 點「同 [取消重刷]」;要在交易內):重刷單記成取消、
   * 拿掉移櫃暫停、`$inc version`;已刷完的位置的更正保留。回傳取消了幾個。重刷的每個動作、移櫃前與排程都會呼叫。
   */
  async releaseExpiredRescans(
    operator: OperatorContext,
    target: { orgId: Types.ObjectId; tenantId: Types.ObjectId | null },
    now: Date,
    session: ClientSession,
  ): Promise<number> {
    const record = await this.sessionRecordOf(operator, target.orgId, session);
    if (record === null) {
      return 0;
    }
    const expired = await this.expiredRescansOf(operator, record, now, session);
    if (expired.size === 0) {
      return 0;
    }
    const writer = await tenantBoundaryContext(
      this.orgs,
      operator,
      target.tenantId,
    );
    const ids = [...expired.values()];
    await this.cancelExpiredRescans(writer, ids, now, session);
    await this.countModes.findOneAndUpdate(
      writer,
      { _id: record._id },
      {
        $pull: { movePauses: { stocktakeId: { $in: ids } } },
        $inc: { version: 1 },
      },
      { session },
    );
    return ids.length;
  }

  /** 移櫃暫停裡已結束或 1 小時沒動作的全店重刷(一次讀;補點編號的暫停不在這裡處理)。 */
  private async expiredRescansOf(
    operator: OperatorContext,
    record: CountModeRecord,
    now: Date,
    session: ClientSession,
  ): Promise<Map<string, Types.ObjectId>> {
    const ids = record.movePauses.flatMap((pause) =>
      pause.gameId === null ? [] : [pause.stocktakeId],
    );
    if (ids.length === 0) {
      return new Map();
    }
    const reader = await this.tenantReaderOf(operator);
    const rows = await this.stocktakes.findMany(
      reader,
      { _id: { $in: ids }, purpose: "rescan" },
      { session, select: "status rescan.lastActiveAt" },
    );
    // 找不到重刷單的暫停照舊(不猜);重刷單已結束或 1 小時沒動作 → 取消
    return new Map(
      rows
        .filter(
          (row) =>
            row.status !== STOCKTAKE_STATUS.pending ||
            row.rescan == null ||
            !isRescanLive(row.rescan.lastActiveAt, now),
        )
        .map((row) => [String(row._id), row._id]),
    );
  }

  /** 自動取消的重刷單:記成取消(一次寫)。已經結束的不動。 */
  private async cancelExpiredRescans(
    writer: OperatorContext,
    ids: readonly Types.ObjectId[],
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    await this.stocktakes.updateMany(
      writer,
      {
        _id: { $in: [...ids] },
        purpose: "rescan",
        status: STOCKTAKE_STATUS.pending,
      },
      {
        $set: {
          status: STOCKTAKE_STATUS.rejected,
          closedAt: now,
          "rescan.cancelledAt": now,
          "rescan.cancelCause": "expired",
        },
        $inc: { version: 1 },
      },
      { session },
    );
  }

  /**
   * 進行中的盤點 / 全店重刷 / 補點編號(改盤點制度的檢查,9.1)。來源是分店那一筆的
   * `stocktakeSessions`(盤點中登記,T4 寫)與 `movePauses`(全店重刷寫;補點 T8 寫);沒有時都是空 = 沒有。
   */
  busyOf(
    record: CountModeRecord | null | undefined,
    now: Date,
  ): StoreBusy | null {
    return storeBusyOf(
      {
        movePauses: livePausesOf(record ?? null, now),
        stocktakeSessions: record?.stocktakeSessions ?? [],
      },
      now,
    );
  }

  /** 盤點制度歷程(新到舊),附操作者名稱。 */
  async historyOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<CountModeHistoryView[]> {
    const reader = await this.tenantReaderOf(operator);
    const record = await this.countModes.findOne(reader, { orgId });
    const history = record?.history ?? [];
    const userIds = [
      ...new Set(
        history.flatMap((entry) =>
          entry.by === null ? [] : [String(entry.by)],
        ),
      ),
    ];
    const users =
      userIds.length === 0
        ? []
        : await this.users.findMany(reader, {
            _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
          });
    const names = new Map(users.map((user) => [String(user._id), user.name]));
    return history
      .map((entry) => ({
        from: entry.from,
        to: entry.to,
        at: entry.at,
        byName:
          entry.by === null ? null : (names.get(String(entry.by)) ?? null),
        cause: entry.cause,
        stocktakeId:
          entry.stocktakeId === null ? null : String(entry.stocktakeId),
      }))
      .toSorted((left, right) => right.at.getTime() - left.at.getTime());
  }

  // ---- 盤點中登記(8.5a;讀寫分店那一筆的 `stocktakeSessions[]`) ----

  /**
   * 分店那一筆(盤點中登記用;交易內給 `session` 讀交易的快照)。以租戶邊界讀(店員看得到這家店,
   * 但分店那一筆的登記要全店的人都算進去)。
   */
  async sessionRecordOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<CountModeRecord | null> {
    const reader = await this.tenantReaderOf(operator);
    return this.countModes.findOne(
      reader,
      { orgId },
      session === undefined ? {} : { session },
    );
  }

  /**
   * 寫盤點中登記(要在交易內):整個 `stocktakeSessions` 換成 `sessions`,`$inc version`(和全店重刷的
   * 「開始刷這個位置」、改盤點制度互相有先後,8.5a)。還沒有那一筆 → 新增一筆(`mode` 留空 = 編號店,5.6)。
   * 版本對不上(交易外有人改過)→ `CONFLICT`。
   */
  async writeSessions(
    operator: OperatorContext,
    target: { orgId: Types.ObjectId; tenantId: Types.ObjectId | null },
    record: CountModeRecord | null,
    sessions: CountModeStocktakeSession[],
    session: ClientSession,
  ): Promise<void> {
    const writer = await tenantBoundaryContext(
      this.orgs,
      operator,
      target.tenantId,
    );
    const pauses = pausesWithSessions(record?.movePauses ?? [], sessions);
    if (record === null) {
      await this.countModes.create(
        writer,
        {
          orgId: target.orgId,
          mode: null,
          stocktakeSessions: sessions,
          movePauses: pauses,
          version: 1,
        },
        { session },
      );
      return;
    }
    const updated = await this.countModes.findOneAndUpdate(
      writer,
      { _id: record._id, version: record.version },
      {
        $set: { stocktakeSessions: sessions, movePauses: pauses },
        $inc: { version: 1 },
      },
      { session },
    );
    if (updated === null) {
      throw conflictError();
    }
  }

  /**
   * 多家分店的刮刮樂設定生效值與分店那一筆(關帳第四項、補點編號提醒;一次讀,不逐店):組織樹 1、
   * 這幾條設定在整個租戶的自訂 1、分店那一筆 1。沒有那一筆的店 `record` = null(編號店)。
   */
  async storesOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    orgIds: readonly Types.ObjectId[],
    keys: readonly LotterySettingKey[],
  ): Promise<
    Map<
      string,
      {
        record: CountModeRecord | null;
        settings: Map<LotterySettingKey, string>;
      }
    >
  > {
    if (orgIds.length === 0) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const [tenantOrgs, rows, records] = await Promise.all([
      this.tenantOrgsOf(reader, tenantId),
      this.settings.findMany(reader, { key: { $in: [...keys] } }),
      this.countModes.findMany(reader, { orgId: { $in: [...orgIds] } }),
    ]);
    const orgById = new Map(tenantOrgs.map((org) => [String(org.id), org]));
    const settingRows = rows.map((record) => toSettingRow(record));
    const recordByOrg = new Map(
      records.map((record) => [String(record.orgId), record]),
    );
    return new Map(
      orgIds.map((id) => {
        const org = orgById.get(String(id));
        const chain = org === undefined ? [String(id)] : chainOf(org);
        return [
          String(id),
          {
            record: recordByOrg.get(String(id)) ?? null,
            settings: new Map(
              keys.map((key) => [
                key,
                lotterySettingOptionOf(key, chain, settingRows),
              ]),
            ),
          },
        ];
      }),
    );
  }

  /**
   * 看板頂部的「建議補點編號(上次 MM/DD)」(張數店規格第 10 節、13.2):張數店與轉換中的店依「補點編號提醒」
   * 的週期到了 → `due`;`lastRenumberAt` = 上次補點編號核准(沒有 = null)。編號店 → null。
   */
  async renumberReminderOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    orgId: Types.ObjectId,
    now: Date,
  ): Promise<{
    mode: CountMode;
    due: boolean;
    required: boolean;
    lastRenumberAt: Date | null;
  } | null> {
    if (tenantId === null) {
      return null;
    }
    const stores = await this.storesOf(
      operator,
      tenantId,
      [orgId],
      [
        LOTTERY_SETTING_KEYS.renumberReminder,
        LOTTERY_SETTING_KEYS.renumberRequired,
      ],
    );
    const store = stores.get(String(orgId));
    const record = store?.record ?? null;
    if (record === null || !canRenumber(modeOfRecord(record))) {
      return null;
    }
    const lastRenumberAt = record.lastRenumberAt ?? null;
    const dueAt = renumberStoreDueAtOf(
      store?.settings.get(LOTTERY_SETTING_KEYS.renumberReminder) ?? "",
      { lastRenumberAt, since: record.since ?? null },
    );
    return {
      mode: modeOfRecord(record),
      due: dueAt !== null && now.getTime() >= dueAt.getTime(),
      required:
        store?.settings.get(LOTTERY_SETTING_KEYS.renumberRequired) ===
        "required",
      lastRenumberAt,
    };
  }

  /** 這個租戶的張數店與轉換中的店(補點編號提醒;一次讀)。 */
  async countStoreIdsOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const records = await this.countModes.findMany(
      reader,
      { mode: { $in: [COUNT_MODE.count, COUNT_MODE.converting] } },
      { select: "orgId" },
    );
    return records.map((record) => record.orgId);
  }

  // ---- 補點編號核准(9.3 第 4 點) ----

  /**
   * 補點編號核准後寫分店那一筆(要在交易內):`lastRenumberAt`、`lastRenumberStocktakeId`;轉換中 → 編號
   * (`since` 換成現在);每次核准都記一筆歷程 `renumber_approved`(沒改制度時 from = to);`$inc version`、留稽核。
   * 生效設定已是張數(含審核中 [取消轉換])→ 不改制度(`renumberApprovalOf`)。
   */
  async applyRenumberApproval(
    writer: OperatorContext,
    orgId: Types.ObjectId,
    approval: {
      stocktakeId: Types.ObjectId;
      by: Types.ObjectId | null;
      at: Date;
    },
    session: ClientSession,
  ): Promise<void> {
    const record = await this.countModes.findOne(
      writer,
      { orgId },
      { session },
    );
    const current = modeOfRecord(record);
    const outcome = renumberApprovalOf(current);
    const entry: CountModeHistoryEntry = {
      ...outcome.history,
      at: approval.at,
      by: approval.by,
      stocktakeId: approval.stocktakeId,
    };
    const fields = {
      lastRenumberAt: approval.at,
      lastRenumberStocktakeId: approval.stocktakeId,
      ...(outcome.mode === current
        ? {}
        : { mode: outcome.mode, since: approval.at }),
    };
    await (record === null
      ? this.countModes.create(
          writer,
          {
            orgId,
            mode: outcome.mode,
            history: [entry],
            version: 1,
            ...fields,
          },
          { session },
        )
      : this.countModes.findOneAndUpdate(
          writer,
          { _id: record._id },
          { $set: fields, $push: { history: entry }, $inc: { version: 1 } },
          { session },
        ));
    // 稽核記核准的人(掛接點是系統身分;每一關都跳過時是申請人);都沒有 → 不寫
    if (approval.by === null) {
      return;
    }
    await this.audit.recordMany({ ...writer, actorId: approval.by }, [
      {
        action: "lottery-store-count-mode.renumber",
        targetType: "lottery_store_count_mode",
        targetId: orgId,
        before: { mode: current },
        after: {
          mode: outcome.mode,
          stocktakeId: String(approval.stocktakeId),
        },
      },
    ]);
  }

  // ---- 改盤點制度 ----

  /**
   * 改盤點制度的計畫(9.1、9.2、13.1):`org` 這一層的 `count_mode` 自訂改成 `nextOwn`(null = 還原成沿用)後,
   * 子樹裡生效設定會變的分店各自怎麼變、哪些擋下。在交易裡呼叫時讀到的就是交易的快照。
   *
   * 查詢次數固定(不逐店):組織樹 1、整個租戶的 `count_mode` 自訂 1、分店那一筆 1、未對號張數 1 次 aggregate、
   * 檯面待標註的本 1 + 它們在哪個收銀點 1 次 aggregate、名稱(收銀點、遊戲)各 1。
   */
  async planCountModeChange(
    operator: OperatorContext,
    target: { orgId: Types.ObjectId; tenantId: Types.ObjectId },
    nextOwn: CountModeSetting | null,
    now: Date,
  ): Promise<CountModePlan> {
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      target.tenantId,
    );
    const tenantOrgs = await this.tenantOrgsOf(reader, target.tenantId);
    const stores = tenantOrgs.filter(
      (org) =>
        (org.id.equals(target.orgId) ||
          org.ancestors.some((id) => id.equals(target.orgId))) &&
        isStoreOrg(org, tenantOrgs),
    );
    const settingRecords = await this.settings.findMany(reader, {
      key: LOTTERY_SETTING_KEYS.countMode,
    });
    const rows = settingRecords.map((record) => toSettingRow(record));
    const targetId = String(target.orgId);
    const rowsAfter: LotterySettingRow[] = [
      ...rows.filter((row) => row.orgId !== targetId),
      ...(nextOwn === null
        ? []
        : [
            {
              orgId: targetId,
              key: LOTTERY_SETTING_KEYS.countMode,
              value: lotterySettingValueOf(nextOwn),
            },
          ]),
    ];
    const changing = stores
      .map((org) => ({
        org,
        before: countModeSettingOf(chainOf(org), rows),
        after: countModeSettingOf(chainOf(org), rowsAfter),
      }))
      .filter((item) => item.before !== item.after);
    const changingIds = changing.map((item) => item.org.id);
    const records =
      changingIds.length === 0
        ? []
        : await this.countModes.findMany(reader, {
            orgId: { $in: changingIds },
          });
    const recordByOrg = new Map(
      records.map((record) => [String(record.orgId), record]),
    );
    const toCount = changing.filter(
      (item) =>
        item.after === COUNT_MODE.count &&
        modeOfRecord(recordByOrg.get(String(item.org.id))) ===
          COUNT_MODE.numbered,
    );
    const [unmatched, pendingSkipBooks] = await Promise.all([
      this.unmatchedCountsOf(reader, changingIds),
      this.pendingSkipBooksOf(
        reader,
        toCount.map((item) => item.org),
      ),
    ]);
    const pendingByOrg = new Map<string, number>();
    for (const book of pendingSkipBooks) {
      pendingByOrg.set(book.orgId, (pendingByOrg.get(book.orgId) ?? 0) + 1);
    }
    const names = new Map(tenantOrgs.map((org) => [String(org.id), org.name]));
    const inputs: CountModeChangeStore[] = changing.map((item) => {
      const id = String(item.org.id);
      const record = recordByOrg.get(id);
      return {
        orgId: id,
        before: item.before,
        after: item.after,
        current: modeOfRecord(record),
        unmatchedCount: unmatched.get(id) ?? 0,
        pendingSkipBooks: pendingByOrg.get(id) ?? 0,
        busy: this.busyOf(record, now),
      };
    });
    const outcomes = countModeChangeOutcomesOf(inputs).map((outcome) => ({
      ...outcome,
      orgName: names.get(outcome.orgId) ?? "",
    }));
    const busyStores = inputs.flatMap((input) =>
      input.busy === null
        ? []
        : [
            {
              orgId: input.orgId,
              orgName: names.get(input.orgId) ?? "",
              ...input.busy,
            },
          ],
    );
    return {
      outcomes,
      pendingSkipBooks,
      busyStores,
      canSave: outcomes.every((outcome) => outcome.problems.length === 0),
      records: recordByOrg,
    };
  }

  /**
   * 照計畫寫下層分店的實際制度與歷程(要在交易內;呼叫端先確認 `canSave`):已有那一筆的一次批次更新
   * (`$inc version`,和移櫃、重刷、盤點中登記互相有先後),還沒有的一次批次新增;每家店一筆稽核(一次寫)。
   * 實際制度沒變的(例:本來就是編號)不寫。
   */
  async applyCountModeChange(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    plan: CountModePlan,
    cause: CountModeChangeCause,
    now: Date,
  ): Promise<void> {
    const changed = plan.outcomes.filter(
      (outcome) => outcome.from !== outcome.to,
    );
    if (changed.length === 0) {
      return;
    }
    const writer = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const entryOf = (outcome: CountModePlanOutcome): CountModeHistoryEntry => ({
      from: outcome.from,
      to: outcome.to,
      at: now,
      by: operator.actorId,
      cause,
      stocktakeId: null,
    });
    const existing = changed.filter((outcome) =>
      plan.records.has(outcome.orgId),
    );
    const missing = changed.filter(
      (outcome) => !plan.records.has(outcome.orgId),
    );
    await this.countModes.bulkUpdateByIds(
      writer,
      existing.map((outcome) => ({
        id: plan.records.get(outcome.orgId)?._id ?? new Types.ObjectId(),
        update: {
          $set: { mode: outcome.to, since: now },
          $push: { history: entryOf(outcome) },
          $inc: { version: 1 },
        },
      })),
    );
    if (missing.length > 0) {
      await this.countModes.createMany(
        writer,
        missing.map((outcome) => ({
          orgId: new Types.ObjectId(outcome.orgId),
          mode: outcome.to,
          since: now,
          history: [entryOf(outcome)],
          version: 1,
        })),
      );
    }
    await this.audit.recordMany(
      operator,
      changed.map((outcome) => ({
        action: "lottery-store-count-mode.change",
        targetType: "lottery_store_count_mode",
        targetId: new Types.ObjectId(outcome.orgId),
        before: { mode: outcome.from },
        after: { mode: outcome.to, cause },
      })),
    );
  }

  // ---- 內部 ----

  /**
   * 操作者當前組織所在租戶的租戶邊界上下文(分店那一筆、上層鏈的設定、歷程的人名)。
   * 呼叫端(各功能的 service)已先確認操作者看得到這家店;別的租戶的店在這個上下文裡讀不到。
   */
  private tenantReaderOf(operator: OperatorContext): Promise<OperatorContext> {
    return tenantBoundaryContext(
      this.orgs,
      operator,
      tenantOfOperator(operator)?.tenantId ?? null,
    );
  }

  private async tenantOrgsOf(
    reader: OperatorContext,
    tenantId: Types.ObjectId,
  ): Promise<TenantOrg[]> {
    const found = await this.orgs.findMany(reader, {
      $or: [{ _id: tenantId }, { ancestors: tenantId }],
    });
    return found.map((org) => ({
      id: org._id,
      name: org.name,
      parentId: org.parentId ?? null,
      ancestors: org.ancestors,
    }));
  }

  /** 各分店的未對號張數(一次 aggregate;走 `unmatched: true` 的 partial 索引)。 */
  private async unmatchedCountsOf(
    reader: OperatorContext,
    orgIds: readonly Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (orgIds.length === 0) {
      return new Map();
    }
    const grouped = await this.tickets.aggregate(reader, [
      { $match: { orgId: { $in: [...orgIds] }, unmatched: true } },
      { $group: { _id: "$orgId", count: { $sum: 1 } } },
    ]);
    return new Map(grouped.map((row) => [String(row._id), Number(row.count)]));
  }

  /**
   * 這些分店檯面上還有待標註的本(9.1、7.5):持有分店含這些店、檯面上有張、迄號 − 標準張數 − 已標跳號 > 0 的本
   * (條件沿用庫存分頁「有待標註」篩選 `bookStateConditionsOf("pending_skip")`),再看它們在檯面上的張在哪家店的哪個收銀點。
   */
  private async pendingSkipBooksOf(
    reader: OperatorContext,
    stores: readonly TenantOrg[],
  ): Promise<PendingSkipBook[]> {
    if (stores.length === 0) {
      return [];
    }
    const storeIds = stores.map((org) => org.id);
    const books = await this.books.findMany(reader, {
      holderOrgIds: { $in: storeIds },
      status: "normal",
      "ticketCounts.counter": { $gt: 0 },
      $and: bookStateConditionsOf("pending_skip"),
    });
    if (books.length === 0) {
      return [];
    }
    const placements = await this.tickets.aggregate(reader, [
      {
        $match: {
          bookId: { $in: books.map((book) => book._id) },
          orgId: { $in: storeIds },
          "location.kind": "counter",
          status: "unsold",
        },
      },
      {
        $group: {
          _id: {
            orgId: "$orgId",
            bookId: "$bookId",
            cashPointId: "$location.cashPointId",
          },
        },
      },
    ]);
    const keys = placements.map(
      (row) =>
        row._id as {
          orgId: Types.ObjectId;
          bookId: Types.ObjectId;
          cashPointId: Types.ObjectId | null;
        },
    );
    const [games, points] = await Promise.all([
      this.games.findMany(reader, {
        _id: {
          $in: [...new Set(books.map((book) => String(book.gameId)))].map(
            (id) => new Types.ObjectId(id),
          ),
        },
      }),
      this.cashPoints.findMany(reader, {
        _id: {
          $in: keys.flatMap((key) =>
            key.cashPointId === null ? [] : [key.cashPointId],
          ),
        },
      }),
    ]);
    const bookById = new Map(books.map((book) => [String(book._id), book]));
    const gameName = new Map(
      games.map((game) => [String(game._id), game.name]),
    );
    const pointName = new Map(
      points.map((point) => [String(point._id), point.name]),
    );
    const storeName = new Map(stores.map((org) => [String(org.id), org.name]));
    return keys
      .flatMap((key): PendingSkipBook[] => {
        const book = bookById.get(String(key.bookId));
        if (!book) {
          return [];
        }
        return [
          {
            orgId: String(key.orgId),
            orgName: storeName.get(String(key.orgId)) ?? "",
            cashPointId: String(key.cashPointId),
            cashPointName: pointName.get(String(key.cashPointId)) ?? "",
            gameCode: book.gameCode,
            gameName: gameName.get(String(book.gameId)) ?? "",
            bookNo: displayBookNo(book.bookNo),
            pendingCount: pendingSkipCountOf(
              Number(book.lastTicketNo),
              book.standardTickets,
              book.skippedTicketNos.length,
            ),
          },
        ];
      })
      .toSorted(
        (left, right) =>
          compareDisplayName(left.orgName, right.orgName) ||
          compareDisplayName(left.cashPointName, right.cashPointName) ||
          left.gameCode.localeCompare(right.gameCode) ||
          left.bookNo.localeCompare(right.bookNo),
      );
  }
}

/**
 * 補點編號的移櫃暫停跟著盤點中登記走(5.6、8.5):全店重刷的暫停照舊;補點編號(`gameId: null`)只留登記還在的,
 * 登記帶了 `renumberPauseId` 而暫停還沒有 → 加一筆。
 */
function pausesWithSessions(
  current: readonly CountModeMovePause[],
  sessions: readonly CountModeStocktakeSession[],
): CountModeMovePause[] {
  const ids = sessions.flatMap((item) =>
    item.renumberPauseId == null ? [] : [item.renumberPauseId],
  );
  const kept = current
    .filter(
      (pause) =>
        pause.gameId !== null || ids.some((id) => id.equals(pause.stocktakeId)),
    )
    .map((pause) => ({ stocktakeId: pause.stocktakeId, gameId: pause.gameId }));
  const added = ids
    .filter((id) => !kept.some((pause) => pause.stocktakeId.equals(id)))
    .map((id) => ({ stocktakeId: id, gameId: null }));
  return [...kept, ...added];
}

/** 分店那一筆在讀之後被改過(交易外有人改):請重試。 */
function conflictError(): GraphQLError {
  return new GraphQLError("store count mode changed, please retry", {
    extensions: { code: "CONFLICT" },
  });
}

/** `lottery_settings` 的一列 → 共用的生效值解析要的形狀。 */
export function toSettingRow(record: {
  orgId: Types.ObjectId;
  key: string;
  value: Record<string, unknown>;
}): LotterySettingRow {
  return { orgId: String(record.orgId), key: record.key, value: record.value };
}
