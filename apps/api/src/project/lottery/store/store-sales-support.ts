import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantIdOfOrg } from "../../../database/tenant-id";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import {
  type LotteryCashPointDocument,
  LotteryCashPointsRepository,
} from "../../database/lottery-cash-points/lottery-cash-points.repository";
import {
  type LotteryGameDocument,
  LotteryGamesRepository,
} from "../../database/lottery-games/lottery-games.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import type { ShiftRecord } from "./shift-views";
import { parseId } from "./shift-views";
import { publishStoreBoard } from "./store-board-signal";
import { STORE_REASONS, notFoundError, validationError } from "./store-error";

export type CashPointRecord = Persisted<LotteryCashPointDocument>;
export type GameRecord = Persisted<LotteryGameDocument>;

/** 看板所在的那家店(操作者看得到)。 */
export interface StoreRef {
  orgId: Types.ObjectId;
  tenantId: Types.ObjectId | null;
}

/**
 * 銷售 / 拆本 / 移櫃共用的讀取:店、收銀點、開著的班、遊戲;以及鎖住一班的抽屜
 * (`drawerVersion` +1,同時改動同一班抽屜的動作互相衝突、交易重跑時重新檢查)。
 */
@Injectable()
export class StoreSalesSupport {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly games: LotteryGamesRepository,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** 看得到的店;看不到 / 不存在 → `NOT_FOUND`。 */
  async mustStore(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<StoreRef> {
    const orgId = parseId(orgIdText);
    const org =
      orgId === null || !isOrgVisible(operator, orgId)
        ? null
        : await this.orgs.findById(operator, orgId);
    if (orgId === null || org === null) {
      throw notFoundError(`store not found: ${orgIdText}`);
    }
    return {
      orgId,
      tenantId: tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors }),
    };
  }

  /** 這家店啟用中的收銀點(依 id)。 */
  async cashPointsOf(
    operator: OperatorContext,
    orgId: Types.ObjectId | readonly Types.ObjectId[],
  ): Promise<Map<string, CashPointRecord>> {
    const points = await this.cashPoints.findMany(operator, {
      orgId: isOrgList(orgId) ? { $in: [...orgId] } : orgId,
      enabled: true,
    });
    return new Map(points.map((point) => [String(point._id), point]));
  }

  /** 這家店啟用中的收銀點;不是 → `VALIDATION_FAILED`(`fields`)。 */
  async mustCashPoint(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    idText: string,
    field: string,
  ): Promise<CashPointRecord> {
    const id = parseId(idText);
    const point =
      id === null ? null : await this.cashPoints.findById(operator, id);
    if (point?.orgId.equals(orgId) !== true) {
      throw notFoundError(`cash point not found: ${idText}`);
    }
    if (!point.enabled) {
      throw validationError(
        "this cash point is disabled",
        [field],
        STORE_REASONS.cashPointDisabled,
      );
    }
    return point;
  }

  /** 收銀點開著的班(依收銀點 id);沒有 = 不在 map 裡。 */
  async openShiftsOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<Map<string, ShiftRecord>> {
    const open = await this.shifts.findMany(
      operator,
      { orgId, closedAt: null },
      session === undefined ? {} : { session },
    );
    return new Map(open.map((shift) => [String(shift.cashPointId), shift]));
  }

  /** 鎖住一班的抽屜(要開著);已結帳 → null。 */
  lockDrawer(
    operator: OperatorContext,
    shiftId: Types.ObjectId,
  ): Promise<ShiftRecord | null> {
    return this.shifts.findOneAndUpdate(
      operator,
      { _id: shiftId, closedAt: null },
      { $inc: { drawerVersion: 1 } },
    );
  }

  async gamesOf(
    operator: OperatorContext,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, GameRecord>> {
    if (ids.length === 0) {
      return new Map();
    }
    const games = await this.games.findMany(operator, {
      _id: { $in: [...ids] },
    });
    return new Map(games.map((game) => [String(game._id), game]));
  }

  /** 看板有變:對 `board:<分店>` 送信號(交易內 → 提交後送)。 */
  publish(store: StoreRef): Promise<void> {
    return publishStoreBoard(this.realtime, store.tenantId, store.orgId);
  }
}

function isOrgList(
  value: Types.ObjectId | readonly Types.ObjectId[],
): value is readonly Types.ObjectId[] {
  return Array.isArray(value);
}
