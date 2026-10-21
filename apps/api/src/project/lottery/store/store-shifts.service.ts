import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { localDateOf, localDateText } from "@repo/domain/form";
import {
  STORE_PERMISSIONS,
  openingFloatPlanOf,
  shiftLabelOf,
} from "@repo/domain/project/lottery";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { TransactionService } from "../../../database/transaction";
import { FieldOptionsService } from "../../../fields/field-options.service";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import {
  type LotteryCashPointDocument,
  LotteryCashPointsRepository,
} from "../../database/lottery-cash-points/lottery-cash-points.repository";
import type {
  ShiftPositionMismatch,
  ShiftTaskSnapshot,
} from "../../database/lottery-store/lottery-shift.schema";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import {
  type ScheduleEntryForShift,
  ScheduleEntryLookup,
} from "../../schedule/integration/entry-lookup";
import type { PunchRequestMeta } from "../../schedule/my/my-schedule.service";
import { isDuplicateKeyError } from "../accounts/accounts-error";
import { CashLedgerService } from "../cash/cash-ledger.service";
import type {
  OpenLotteryShiftInput,
  ReassignLotteryShiftEntryInput,
} from "./dto/lottery-store.input";
import type {
  LotteryShiftInfoModel,
  LotteryStoreEntryOptionModel,
  LotteryStoreEntryTaskModel,
  LotteryStoreOpenShiftFormModel,
  LotteryStorePunchPayload,
  LotteryStoreShiftModel,
} from "./models/lottery-store.model";
import { handoverAmountOf, isCoveredByDailyClose } from "./previous-shift";
import { type ShiftRecord, StoreShiftViews, parseId } from "./shift-views";
import { StoreAccess, isStoreManager } from "./store-access";
import { publishStoreBoard } from "./store-board-signal";
import { StoreClock } from "./store-clock";
import {
  STORE_REASONS,
  forbiddenError,
  notFoundError,
  validationError,
} from "./store-error";
import { StorePersonLocks } from "./store-person-locks";
import { StoreVaultGuard } from "./store-vault-guard";

type CashPointRecord = Persisted<LotteryCashPointDocument>;

/** 改對應排班的原因只收這一個類別(底座 `FieldOptionsService` 的白名單)。 */
const REASSIGN_REASON_CATEGORIES: readonly string[] = [
  SCHEDULE_FIELD_CATEGORY_KEYS.entryReassignReason,
];

/** 稽核的 targetType 與動作名(模組文件「稽核」節)。 */
export const STORE_AUDIT = {
  shiftTarget: "lottery_shift",
  reassignEntry: "lottery-shift.reassign-entry",
} as const;

/** 排班的一筆任務 → 畫面。 */
function taskModelOf(task: {
  role: string;
  taskKey: string;
  positionKey: string;
}): LotteryStoreEntryTaskModel {
  return {
    role: task.role,
    taskKey: task.taskKey,
    positionKey: task.positionKey,
  };
}

/** 收銀點崗位那一筆任務(任務已依「負責優先、人力需求開始較早」排好);對不到 = null。 */
function snapshotTaskOf(
  entry: ScheduleEntryForShift,
  positionKey: string,
): LotteryStoreEntryTaskModel | null {
  const task = entry.tasks.find((item) => item.positionKey === positionKey);
  return task === undefined ? null : taskModelOf(task);
}

/** 崗位不一致的紀錄:這筆排班沒有填進收銀點崗位的人力需求。 */
function mismatchOf(
  entry: ScheduleEntryForShift,
  positionKey: string,
): ShiftPositionMismatch {
  return {
    cashPointPositionKey: positionKey,
    entryPositionKeys: [
      ...new Set(entry.tasks.map((task) => task.positionKey)),
    ],
  };
}

/** 選排班的輸入:選一筆排班,或「沒有排班(臨時代班)」;兩者都沒有 / 都有 → 不合法。 */
function entryChoiceOf(input: {
  scheduleEntryId?: string | null;
  temporaryCover: boolean;
}): Types.ObjectId | null {
  const entryId = parseId(input.scheduleEntryId ?? null);
  if (input.temporaryCover) {
    if (input.scheduleEntryId != null) {
      throw validationError("choose an entry or temporary cover", [
        "scheduleEntryId",
      ]);
    }
    return null;
  }
  if (entryId === null) {
    throw validationError("schedule entry is required", ["scheduleEntryId"]);
  }
  return entryId;
}

/**
 * 收銀班次(專案規格 6.6、14.9;正本 `docs/modules/project/store.md`):開班、開班視窗的資料、[打卡]、
 * 班次資訊與改對應排班。排班只經 `ScheduleEntryLookup` 讀(依賴方向刮刮樂 → 排班)。
 */
@Injectable()
export class StoreShiftsService {
  constructor(
    private readonly shifts: LotteryShiftsRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly orgs: OrgsRepository,
    private readonly lookup: ScheduleEntryLookup,
    private readonly ledger: CashLedgerService,
    private readonly fieldOptions: FieldOptionsService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
    private readonly realtime: RealtimePublisher,
    private readonly views: StoreShiftViews,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
    private readonly personLocks: StorePersonLocks,
    private readonly vault: StoreVaultGuard,
  ) {}

  /** 開班視窗:期初零用金的來源、可以選的排班(系統找到的預選)、打卡狀態。 */
  async openShiftForm(
    operator: OperatorContext,
    cashPointIdText: string,
  ): Promise<LotteryStoreOpenShiftFormModel> {
    const point = await this.mustCashPoint(operator, cashPointIdText);
    await this.assertNoOpenShift(operator, point._id);
    const grant = await this.access.grantOf(operator);
    const previous = await this.previousShiftOf(operator, point);
    const plan = openingFloatPlanOf(previous?.state ?? null);
    const { entries, suggestedId } = await this.candidateEntries(
      operator,
      point,
    );
    const names =
      previous === null
        ? new Map<string, string>()
        : await this.views.userNames(operator, point.tenantId, [
            previous.shift.openedBy,
          ]);
    return {
      cashPoint: { id: String(point._id), name: point.name },
      positionKey: point.positionKey,
      plan: plan.kind,
      handoverAmount: plan.kind === "handover" ? plan.amount : 0,
      previousOpenedBy:
        plan.kind === "handover" && previous !== null
          ? {
              id: String(previous.shift.openedBy),
              name: names.get(String(previous.shift.openedBy)) ?? "",
            }
          : null,
      previousClosedAt:
        plan.kind === "handover" ? (previous?.shift.closedAt ?? null) : null,
      canTakeFloat:
        plan.kind === "first" && grant.has(STORE_PERMISSIONS.withdraw),
      suggestedEntryId: suggestedId,
      entries: await this.entryOptions(operator, point, entries),
    };
  }

  /**
   * 開班:開班的人是負責人;同一人只能同時開同一家店的班;同一個收銀點同時只能有一班
   * (部分唯一索引擋同時開班)。第一班領零用金時同一個交易寫一筆出庫(原因 = 開班零用金)。
   */
  async open(
    operator: OperatorContext,
    input: OpenLotteryShiftInput,
  ): Promise<LotteryStoreShiftModel> {
    const actorId = operator.actorId;
    if (actorId === null) {
      throw forbiddenError("operator required");
    }
    const entryId = entryChoiceOf(input);
    const point = await this.mustCashPoint(operator, input.cashPointId);
    const tenantId = point.tenantId;
    await this.assertNoOpenShift(operator, point._id);
    if (tenantId !== null) {
      await this.personLocks.ensure(operator, tenantId, actorId);
    }

    const grant = await this.access.grantOf(operator);
    const previous = await this.previousShiftOf(operator, point);
    const plan = openingFloatPlanOf(previous?.state ?? null);
    const float = input.floatFromVault ?? 0;
    if (!Number.isInteger(float) || float < 0) {
      throw validationError("float must be a non-negative integer", [
        "floatFromVault",
      ]);
    }
    if (
      float > 0 &&
      (plan.kind !== "first" || !grant.has(STORE_PERMISSIONS.withdraw))
    ) {
      throw validationError(
        "opening float can only be taken on the first shift with withdraw permission",
        ["floatFromVault"],
        STORE_REASONS.openingFloatNotAllowed,
      );
    }
    if (float > 0) {
      await this.vault.prepare(operator, point.orgId);
    }

    const binding = await this.bindingOf(
      operator,
      point,
      actorId,
      entryId,
      this.clock.now(),
    );
    const openedAt = this.clock.now();
    const ownerNames = await this.views.userNames(operator, tenantId, [
      actorId,
    ]);
    const label = shiftLabelOf({
      cashPointName: point.name,
      ownerName: ownerNames.get(String(actorId)) ?? "",
      openedAt,
      timezone: await tenantTimezoneOf(this.orgs, operator, tenantId),
    });
    let openingFloatSource: "vault" | "none" | "handover" = "handover";
    if (plan.kind === "first") {
      openingFloatSource = float > 0 ? "vault" : "none";
    }
    let created: ShiftRecord;
    try {
      created = await this.transactions.withTransaction(async (session) => {
        // 同一個人在兩家店同時開班:在「人」守門文件上衝突、重跑,重跑時讀得到對方剛開的班
        if (tenantId !== null) {
          await this.personLocks.touch(operator, tenantId, actorId);
        }
        await this.assertNotOpenElsewhere(
          operator,
          tenantId,
          actorId,
          point.orgId,
        );
        const shift = await this.shifts.create(operator, {
          orgId: point.orgId,
          cashPointId: point._id,
          openedBy: actorId,
          openedAt,
          openingFloat: plan.kind === "first" ? float : plan.amount,
          openingFloatSource,
          previousShiftId:
            plan.kind === "handover" ? (previous?.shift._id ?? null) : null,
          openingMovementId: null,
          scheduleEntryId: binding.entryId,
          scheduleTaskSnapshot: binding.snapshot,
          positionMismatch: binding.mismatch,
          closedAt: null,
          checkoutId: null,
          drawerVersion: 0,
          label,
        });
        await publishStoreBoard(this.realtime, tenantId, point.orgId);
        if (float === 0) {
          return shift;
        }
        // 從小金庫領零用金不能超過小金庫應有(同一家店同時拿錢在小金庫守門文件上序列化)
        await this.vault.assertCovers(
          session,
          operator,
          tenantId,
          point.orgId,
          float,
          "floatFromVault",
        );
        const movement = await this.ledger.recordCashMovement(undefined, {
          operator,
          orgId: point.orgId,
          type: "withdraw",
          from: "vault",
          to: "drawer",
          amount: float,
          occurredAt: openedAt,
          reason: "opening_float",
          cashPointId: point._id,
          shiftId: shift._id,
        });
        return (
          (await this.shifts.updateById(operator, shift._id, {
            $set: { openingMovementId: movement._id },
          })) ?? shift
        );
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw shiftAlreadyOpen();
      }
      throw error;
    }
    const [model] = await this.views.toModels(
      operator,
      [created],
      new Map([[String(point._id), point.name]]),
    );
    if (model === undefined) {
      throw notFoundError("shift not found");
    }
    return model;
  }

  /** 開班視窗的 [打卡]:打這一班的上班卡(排班模組再查 `schedule.my.punch`)。 */
  async punchStart(
    operator: OperatorContext,
    entryIdText: string,
    meta: PunchRequestMeta,
  ): Promise<LotteryStorePunchPayload> {
    if (operator.actorId === null) {
      throw forbiddenError("operator required");
    }
    const punch = await this.lookup.punchStart(
      operator,
      { userId: operator.actorId, entryId: entryIdText },
      meta,
    );
    return { entryId: punch.entryId, at: punch.at };
  }

  /** 班次資訊(ST-42a):開班時間、期初、對應排班、任務快照;能不能改對應排班。 */
  async info(
    operator: OperatorContext,
    shiftIdText: string,
  ): Promise<LotteryShiftInfoModel> {
    await this.access.assertView(operator);
    const shift = await this.mustShift(operator, shiftIdText);
    return this.infoOf(operator, shift);
  }

  /**
   * 改對應排班(規格 6.6、14.9):只有這一班的負責人或店長、交班結帳送出前;原因必填;
   * 重寫任務快照與崗位不一致紀錄、寫稽核。
   */
  async reassign(
    operator: OperatorContext,
    input: ReassignLotteryShiftEntryInput,
  ): Promise<LotteryShiftInfoModel> {
    const shift = await this.mustShift(operator, input.shiftId);
    const grant = await this.access.grantOf(operator);
    if (!this.canReassign(operator, shift, grant)) {
      throw forbiddenError("only the shift owner or a store manager");
    }
    if (shift.closedAt !== null) {
      throw shiftClosed();
    }
    const entryId = entryChoiceOf(input);
    const reason = await this.fieldOptions.assertReason(
      operator,
      SCHEDULE_FIELD_CATEGORY_KEYS.entryReassignReason,
      {
        reasonKey: input.reasonKey ?? null,
        reasonNote: input.reasonNote ?? null,
      },
      REASSIGN_REASON_CATEGORIES,
    );
    const point = await this.cashPoints.findById(operator, shift.cashPointId);
    if (point === null) {
      throw notFoundError("cash point not found");
    }
    const binding = await this.bindingOf(
      operator,
      point,
      shift.openedBy,
      entryId,
      shift.openedAt,
    );
    const updated = await this.transactions.withTransaction(async () => {
      const next = await this.shifts.findOneAndUpdate(
        operator,
        { _id: shift._id, closedAt: null },
        {
          $set: {
            scheduleEntryId: binding.entryId,
            scheduleTaskSnapshot: binding.snapshot,
            positionMismatch: binding.mismatch,
          },
        },
      );
      if (next === null) {
        throw shiftClosed();
      }
      await this.audit.record(operator, {
        action: STORE_AUDIT.reassignEntry,
        targetType: STORE_AUDIT.shiftTarget,
        targetId: shift._id,
        before: {
          scheduleEntryId:
            shift.scheduleEntryId === null
              ? null
              : String(shift.scheduleEntryId),
          scheduleTaskSnapshot: shift.scheduleTaskSnapshot,
        },
        after: {
          scheduleEntryId:
            binding.entryId === null ? null : String(binding.entryId),
          scheduleTaskSnapshot: binding.snapshot,
          reasonKey: reason.reasonKey,
          reasonNote: reason.reasonNote,
        },
      });
      await publishStoreBoard(this.realtime, shift.tenantId, shift.orgId);
      return next;
    });
    return this.infoOf(operator, updated);
  }

  // ---- 內部 ----

  private canReassign(
    operator: OperatorContext,
    shift: ShiftRecord,
    grant: { has: (key: string) => boolean },
  ): boolean {
    const isOwner =
      operator.actorId !== null && shift.openedBy.equals(operator.actorId);
    return isOwner || isStoreManager(grant);
  }

  private async infoOf(
    operator: OperatorContext,
    shift: ShiftRecord,
  ): Promise<LotteryShiftInfoModel> {
    const grant = await this.access.grantOf(operator);
    const point = await this.cashPoints.findById(operator, shift.cashPointId);
    if (point === null) {
      throw notFoundError("cash point not found");
    }
    const closed = shift.closedAt !== null;
    const canReassign = !closed && this.canReassign(operator, shift, grant);
    const day = await this.entriesOfDay(
      operator,
      point,
      shift.openedBy,
      shift.openedAt,
    );
    const options = await this.entryOptions(operator, point, day);
    const names = await this.views.userNames(operator, shift.tenantId, [
      shift.openedBy,
    ]);
    const snapshot = shift.scheduleTaskSnapshot;
    return {
      id: String(shift._id),
      cashPoint: { id: String(point._id), name: point.name },
      openedBy: {
        id: String(shift.openedBy),
        name: names.get(String(shift.openedBy)) ?? "",
      },
      openedAt: shift.openedAt,
      openingFloat: shift.openingFloat,
      openingFloatSource: shift.openingFloatSource,
      entry:
        shift.scheduleEntryId === null
          ? null
          : (options.find(
              (option) => option.id === String(shift.scheduleEntryId),
            ) ?? null),
      taskSnapshot: snapshot === null ? null : taskModelOf(snapshot),
      positionMismatch: shift.positionMismatch !== null,
      closed,
      canReassign,
      entryOptions: canReassign ? options : [],
    };
  }

  /** 選到的排班要在「這個人那天在這家店的排班」裡;寫入的任務快照與崗位不一致紀錄。 */
  private async bindingOf(
    operator: OperatorContext,
    point: CashPointRecord,
    userId: Types.ObjectId,
    entryId: Types.ObjectId | null,
    at: Date,
  ): Promise<{
    entryId: Types.ObjectId | null;
    snapshot: ShiftTaskSnapshot | null;
    mismatch: ShiftPositionMismatch | null;
  }> {
    if (entryId === null) {
      return { entryId: null, snapshot: null, mismatch: null };
    }
    const candidates = await this.entriesOfDay(operator, point, userId, at);
    const isSelf = operator.actorId !== null && userId.equals(operator.actorId);
    const suggested =
      isSelf && point.tenantId !== null
        ? await this.lookup.findEntryForShift(operator, {
            tenantId: point.tenantId,
            userId,
            orgId: point.orgId,
            at,
          })
        : null;
    const entry = [
      ...candidates,
      ...(suggested === null ? [] : [suggested]),
    ].find((item) => item.id === String(entryId));
    if (entry === undefined || point.tenantId === null) {
      throw validationError(
        "entry is not one of this person's entries at this store today",
        ["scheduleEntryId"],
        STORE_REASONS.entryNotAvailable,
      );
    }
    const snapshot = await this.lookup.taskSnapshotFor(operator, {
      tenantId: point.tenantId,
      entryId,
      positionKey: point.positionKey,
    });
    return {
      entryId,
      snapshot,
      mismatch: snapshot === null ? mismatchOf(entry, point.positionKey) : null,
    };
  }

  /** 開班的人今天在這家店的排班 + 系統依時間找到的那一筆(可能是昨天跨夜的班)。 */
  private async candidateEntries(
    operator: OperatorContext,
    point: CashPointRecord,
  ): Promise<{ entries: ScheduleEntryForShift[]; suggestedId: string | null }> {
    const actorId = operator.actorId;
    if (actorId === null || point.tenantId === null) {
      return { entries: [], suggestedId: null };
    }
    const now = this.clock.now();
    const [day, suggested] = await Promise.all([
      this.entriesOfDay(operator, point, actorId, now),
      this.lookup.findEntryForShift(operator, {
        tenantId: point.tenantId,
        userId: actorId,
        orgId: point.orgId,
        at: now,
      }),
    ]);
    const entries =
      suggested === null || day.some((entry) => entry.id === suggested.id)
        ? day
        : [suggested, ...day];
    return { entries, suggestedId: suggested?.id ?? null };
  }

  /** 某人某時點那一天(租戶時區)在這家店的排班(已發布)。 */
  private async entriesOfDay(
    operator: OperatorContext,
    point: CashPointRecord,
    userId: Types.ObjectId,
    at: Date,
  ): Promise<ScheduleEntryForShift[]> {
    if (point.tenantId === null) {
      return [];
    }
    const timezone = await tenantTimezoneOf(
      this.orgs,
      operator,
      point.tenantId,
    );
    return this.lookup.listEntriesOfDay(operator, {
      tenantId: point.tenantId,
      userId,
      orgId: point.orgId,
      date: localDateText(localDateOf(at.getTime(), timezone)),
    });
  }

  private async entryOptions(
    operator: OperatorContext,
    point: CashPointRecord,
    entries: readonly ScheduleEntryForShift[],
  ): Promise<LotteryStoreEntryOptionModel[]> {
    const tenantId = point.tenantId;
    const punched = await Promise.all(
      entries.map((entry) =>
        tenantId === null
          ? Promise.resolve(false)
          : this.lookup.hasStartPunch(operator, {
              tenantId,
              entryId: entry.id,
            }),
      ),
    );
    return entries.map((entry, index) => ({
      id: entry.id,
      startAt: entry.startAt,
      endAt: entry.endAt,
      shortName: entry.shortName,
      tasks: entry.tasks.map((task) => taskModelOf(task)),
      snapshot: snapshotTaskOf(entry, point.positionKey),
      hasStartPunch: punched[index] ?? false,
    }));
  }

  /** 上一班(已結束的最近一班)與它的交班 / 日結狀態;沒有 = null。 */
  private async previousShiftOf(
    operator: OperatorContext,
    point: CashPointRecord,
  ): Promise<{
    shift: ShiftRecord;
    state: {
      closed: boolean;
      coveredByDailyClose: boolean;
      leftForNext: number;
    };
  } | null> {
    const [shift] = await this.shifts.findMany(
      operator,
      { cashPointId: point._id, closedAt: { $ne: null } },
      { sort: { openedAt: -1, _id: -1 }, limit: 1 },
    );
    if (shift === undefined) {
      return null;
    }
    const [coveredByDailyClose, leftForNext] = await Promise.all([
      isCoveredByDailyClose(point.tenantId, shift._id),
      handoverAmountOf(point.tenantId, shift._id),
    ]);
    return {
      shift,
      state: { closed: true, coveredByDailyClose, leftForNext },
    };
  }

  private async mustCashPoint(
    operator: OperatorContext,
    idText: string,
  ): Promise<CashPointRecord> {
    const id = parseId(idText);
    const point =
      id === null ? null : await this.cashPoints.findById(operator, id);
    if (point === null || !isOrgVisible(operator, point.orgId)) {
      throw notFoundError(`cash point not found: ${idText}`);
    }
    if (!point.enabled) {
      throw validationError(
        "cash point is disabled",
        ["cashPointId"],
        STORE_REASONS.cashPointDisabled,
      );
    }
    return point;
  }

  private async mustShift(
    operator: OperatorContext,
    idText: string,
  ): Promise<ShiftRecord> {
    const id = parseId(idText);
    const shift = id === null ? null : await this.shifts.findById(operator, id);
    if (shift === null) {
      throw notFoundError(`shift not found: ${idText}`);
    }
    return shift;
  }

  private async assertNoOpenShift(
    operator: OperatorContext,
    cashPointId: Types.ObjectId,
  ): Promise<void> {
    const open = await this.shifts.findOne(operator, {
      cashPointId,
      closedAt: null,
    });
    if (open !== null) {
      throw shiftAlreadyOpen();
    }
  }

  /**
   * 一個人只能同時開同一家店的班:別家店還有開著的班 → 擋下(以人為準,跨店讀)。
   * 在開班的交易內、碰過「人」守門文件之後呼叫(同時在兩家店開班由守門文件序列化)。
   */
  private async assertNotOpenElsewhere(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    actorId: Types.ObjectId,
    orgId: Types.ObjectId,
  ): Promise<void> {
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const elsewhere = await this.shifts.findOne(reader, {
      openedBy: actorId,
      closedAt: null,
      orgId: { $ne: orgId },
    });
    if (elsewhere !== null) {
      throw validationError(
        "you still have an open shift at another store",
        ["cashPointId"],
        STORE_REASONS.shiftInOtherStore,
      );
    }
  }
}

function shiftAlreadyOpen() {
  return validationError(
    "this cash point already has an open shift",
    ["cashPointId"],
    STORE_REASONS.shiftAlreadyOpen,
  );
}

function shiftClosed() {
  return validationError(
    "this shift has been checked out",
    ["shiftId"],
    STORE_REASONS.shiftClosed,
  );
}
