import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Types } from "mongoose";

import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
} from "@repo/domain/project/lottery";

import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import {
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { registerEntryDeletionGuard } from "../../schedule/integration/entry-deletion-guards";
import { registerPositionAnnotationProvider } from "../../schedule/integration/position-annotations";
import { registerCashPointDeactivationGuard } from "../cash-points/cash-point-deactivation";
import { CashLedgerService } from "../cash/cash-ledger.service";
import {
  registerOpenDrawersLister,
  registerOpenShiftResolver,
} from "../cash/open-shift";
import { expectedDrawerCash, registerDrawerCashSource } from "./drawer-cash";

/** 登記名(各登記表全域唯一)。 */
export const STORE_REGISTRATION_NAME = "lottery-store";
export const DRAWER_SOURCE_TICKET_EVENTS = "ticket-events";
export const DRAWER_SOURCE_CASH_MOVEMENTS = "cash-movements";

/**
 * 那一班張數事件的**事後更正淨額**(規格 6.12;`postCloseOf` = 那一班):增加 +、減少 −
 * (例:盤點補登售出時那個收銀點沒有開著的班)。交班結帳、報表把它加到「應有(含事後更正)」。
 */
export async function ticketEventsPostCloseNet(
  events: LotteryTicketEventsRepository,
  reader: OperatorContext,
  shiftId: Types.ObjectId,
): Promise<number> {
  const rows = await events.aggregate(reader, [
    {
      $match: {
        postCloseOf: shiftId,
        cashEffect: { $in: ["increase", "decrease"] },
      },
    },
    {
      $group: {
        _id: null,
        amount: {
          $sum: {
            $cond: [
              { $eq: ["$cashEffect", "increase"] },
              "$amount",
              { $multiply: [-1, "$amount"] },
            ],
          },
        },
      },
    },
  ]);
  return Number(rows[0]?.amount ?? 0);
}

/** 排班與刮刮樂的登記只能加、不能撤(排班的登記表沒有撤銷函式):同一個行程只登記一次。 */
let scheduleSeamsRegistered = false;

/**
 * 店面(收銀班次)向其他功能登記的事(專案規格 5.5、6.6、9、10.2、14.9):
 *
 * - **抽屜應有的來源**(`drawer-cash.ts`):張數事件(售出 + / 撤銷 −)、現金流水(流入抽屜 + / 流出 −)
 * - **收付的現金來源**(`cash/open-shift.ts`):收銀點開著的班、分店開著的抽屜(即時現金帳列出抽屜應有)
 * - **收銀點停用守門**(`cash-points/cash-point-deactivation.ts`):有開著的班、或檯面上還有未售的張 → 不能停用
 * - **排班的登記接縫**(`schedule/integration/`):崗位旁顯示收銀點名稱;被班次綁定的排班不能刪
 *
 * 這些查詢沒有操作者(或問的是整個租戶),以租戶邊界的系統身分讀(登記在 `project/database/tenant-boundary-callers.ts`)。
 */
@Injectable()
export class StoreRegistrations implements OnModuleInit, OnModuleDestroy {
  private readonly unregister: (() => void)[] = [];

  constructor(
    private readonly shifts: LotteryShiftsRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly ledger: CashLedgerService,
    private readonly orgs: OrgsRepository,
  ) {}

  onModuleInit(): void {
    this.unregister.push(
      registerDrawerCashSource(DRAWER_SOURCE_TICKET_EVENTS, (reader, shift) =>
        this.ticketCashOf(reader, shift._id),
      ),
      // 開班領零用金的那一筆出庫已經是期初,不重複算
      registerDrawerCashSource(
        DRAWER_SOURCE_CASH_MOVEMENTS,
        async (reader, shift) =>
          (await this.ledger.sumShiftMovements(reader, shift._id)) -
          (shift.openingMovementId === null ? 0 : shift.openingFloat),
      ),
      registerOpenShiftResolver(async (tenantId, cashPointId) => {
        if (tenantId === null) {
          return null;
        }
        const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
        const shift = await this.shifts.findOne(reader, {
          cashPointId,
          closedAt: null,
        });
        return shift === null
          ? null
          : { shiftId: shift._id, orgId: shift.orgId };
      }),
      registerOpenDrawersLister((reader, orgId) =>
        this.openDrawers(reader, orgId),
      ),
      registerCashPointDeactivationGuard(
        STORE_REGISTRATION_NAME,
        async (tenantId, cashPointId) => {
          if (tenantId === null) {
            return false;
          }
          const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
          const [open, onCounter] = await Promise.all([
            this.shifts.findOne(reader, { cashPointId, closedAt: null }),
            this.tickets.findOne(reader, {
              "location.kind": TICKET_LOCATION_KIND.counter,
              "location.cashPointId": cashPointId,
              status: TICKET_STATUS.unsold,
            }),
          ]);
          return open !== null || onCounter !== null;
        },
      ),
    );
    if (!scheduleSeamsRegistered) {
      scheduleSeamsRegistered = true;
      registerPositionAnnotationProvider((tenantId, orgId) =>
        this.positionAnnotations(tenantId, orgId),
      );
      registerEntryDeletionGuard((tenantId, entryIds) =>
        this.boundEntryIds(tenantId, entryIds),
      );
    }
  }

  onModuleDestroy(): void {
    for (const undo of this.unregister.splice(0)) {
      undo();
    }
  }

  /**
   * 張數事件對抽屜的影響:「增加」(售出)+、「減少」(撤銷)−。事後更正(`postCloseOf`,班已結帳之後才記到
   * 那一班)不算結帳時的應有,另由 `ticketEventsPostCloseNet` 加總。
   */
  private async ticketCashOf(
    reader: OperatorContext,
    shiftId: Types.ObjectId,
  ): Promise<number> {
    const rows = await this.events.aggregate(reader, [
      {
        $match: {
          shiftId,
          postCloseOf: null,
          cashEffect: { $in: ["increase", "decrease"] },
        },
      },
      {
        $group: {
          _id: null,
          amount: {
            $sum: {
              $cond: [
                { $eq: ["$cashEffect", "increase"] },
                "$amount",
                { $multiply: [-1, "$amount"] },
              ],
            },
          },
        },
      },
    ]);
    return Number(rows[0]?.amount ?? 0);
  }

  private async openDrawers(reader: OperatorContext, orgId: Types.ObjectId) {
    const open = await this.shifts.findMany(reader, { orgId, closedAt: null });
    if (open.length === 0) {
      return [];
    }
    const points = await this.cashPoints.findMany(reader, {
      _id: { $in: open.map((shift) => shift.cashPointId) },
    });
    const pointById = new Map(
      points.map((point) => [String(point._id), point]),
    );
    const drawers = await Promise.all(
      open.map(async (shift) => {
        const point = pointById.get(String(shift.cashPointId));
        return {
          cashPointId: shift.cashPointId,
          cashPointName: point?.name ?? "",
          order: point?.order ?? 0,
          shiftId: shift._id,
          openedBy: shift.openedBy,
          openedAt: shift.openedAt,
          expected: await expectedDrawerCash(reader, shift),
        };
      }),
    );
    return drawers
      .toSorted(
        (a, b) =>
          a.order - b.order ||
          a.cashPointName.localeCompare(b.cashPointName, "zh-Hant"),
      )
      .map((drawer) => ({
        cashPointId: drawer.cashPointId,
        cashPointName: drawer.cashPointName,
        shiftId: drawer.shiftId,
        openedBy: drawer.openedBy,
        openedAt: drawer.openedAt,
        expected: drawer.expected,
      }));
  }

  /** 崗位旁的註記:這家店各收銀點的崗位 → 收銀點名稱(規格 14.9)。 */
  private async positionAnnotations(
    tenantId: string,
    orgId: string,
  ): Promise<Record<string, string>> {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(orgId)) {
      return {};
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      null,
      new Types.ObjectId(tenantId),
    );
    const points = await this.cashPoints.findMany(reader, {
      orgId: new Types.ObjectId(orgId),
      enabled: true,
    });
    return Object.fromEntries(
      points.map((point) => [point.positionKey, point.name]),
    );
  }

  /** 已被收銀班次綁定的排班(規格 14.9:不能刪除)。 */
  private async boundEntryIds(
    tenantId: string,
    entryIds: readonly string[],
  ): Promise<Set<string>> {
    const ids = entryIds.filter((id) => Types.ObjectId.isValid(id));
    if (!Types.ObjectId.isValid(tenantId) || ids.length === 0) {
      return new Set();
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      null,
      new Types.ObjectId(tenantId),
    );
    const bound = await this.shifts.findMany(reader, {
      scheduleEntryId: { $in: ids.map((id) => new Types.ObjectId(id)) },
    });
    return new Set(bound.map((shift) => String(shift.scheduleEntryId)));
  }
}
