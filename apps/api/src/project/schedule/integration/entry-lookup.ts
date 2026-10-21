import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import {
  ScheduleAttendancePunchesRepository,
  ScheduleEntriesRepository,
} from "../../database/schedule/roster.repositories";
import type { MySchedulePunchModel } from "../my/models/my-schedule.model";
import {
  MyScheduleService,
  type PunchRequestMeta,
} from "../my/my-schedule.service";
import { PublishedEntries } from "../my/published-entries";
import type { EntryRecord } from "../roster/roster-people";
import { ScheduleRulesService } from "../rules/schedule-rules.service";
import {
  forbiddenError,
  notFoundError,
  validationError,
} from "../shared/schedule-error";
import { parseObjectId } from "../shared/schedule-org";
import {
  SCHEDULE_PERMISSIONS,
  SchedulePermissions,
} from "../shared/schedule-permissions";
import {
  type FilledTask,
  closestEntryAt,
  taskSnapshotOf,
} from "./entry-matching";

/** 規則 `entryMatchToleranceMinutes` 讀不到時的預設(規格 14.2:60 分鐘)。 */
const DEFAULT_TOLERANCE_MINUTES = 60;

/** 給刮刮樂的一筆排班(已發布)。 */
export interface ScheduleEntryForShift {
  id: string;
  orgId: string;
  userId: string;
  /** `YYYY-MM-DD` */
  date: string;
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
  /** 範本簡稱;未套用範本 = null(畫面顯示「臨」) */
  shortName: string | null;
  /** 填進的執行任務(負責那一筆優先,再依人力需求開始時點) */
  tasks: FilledTask[];
}

/** 任務快照:寫進收銀班次的職責與任務內容。 */
export interface ScheduleTaskSnapshot {
  demandId: string;
  taskId: string;
  /** `leader` 負責人 / `helper` 協同 */
  role: string;
  taskKey: string;
  positionKey: string;
}

interface EntryScope {
  tenantId: Types.ObjectId | string;
  userId: Types.ObjectId | string;
  orgId: Types.ObjectId | string;
}

const idOf = (value: Types.ObjectId | string, field: string) =>
  value instanceof Types.ObjectId ? value : parseObjectId(value, field);

/**
 * **給刮刮樂的排班查詢**(規格 14.9;正本 `docs/modules/project/schedule.md`「給其他模組的查詢」)。
 * 刮刮樂只能透過這個檔案讀排班與打上班卡(依賴方向刮刮樂 → 排班;排班不 import 刮刮樂)。
 *
 * - 讀取照**操作者的可見範圍**(開班的人看得到自己的店),條件另釘 `tenantId`(租戶邊界);
 *   店不在可見範圍 → `NOT_FOUND`
 * - 只回**已發布**月份的班(員工看得到的班表;規格 14.6)
 * - 不提供寫入排班;打卡只開「打這一班的上班卡」(`punchStart`)
 */
@Injectable()
export class ScheduleEntryLookup {
  constructor(
    private readonly entries: ScheduleEntriesRepository,
    private readonly punches: ScheduleAttendancePunchesRepository,
    private readonly published: PublishedEntries,
    private readonly rules: ScheduleRulesService,
    private readonly mySchedule: MyScheduleService,
    private readonly permissions: SchedulePermissions,
  ) {}

  /**
   * 某人在某店某時間的排班:時間落在 `[上班 − 容許, 下班 + 容許]` 的都算,多筆取上班時點最接近的;
   * 容許 = 這家店的規則 `entryMatchToleranceMinutes`(預設 60 分鐘)。都不在 → null。
   */
  async findEntryForShift(
    operator: OperatorContext,
    input: EntryScope & { at: Date },
  ): Promise<ScheduleEntryForShift | null> {
    const scope = this.scopeOf(operator, input);
    const settings = await this.rules.effectiveSettingsForOrg(
      operator,
      scope.orgId,
    );
    const amount = Number(
      settings.get("entryMatchToleranceMinutes")?.value.amount,
    );
    const tolerance = Number.isFinite(amount)
      ? amount
      : DEFAULT_TOLERANCE_MINUTES;
    const margin = tolerance * 60_000;
    const candidates = await this.publishedOf(operator, scope, {
      startAt: { $lte: new Date(input.at.getTime() + margin) },
      endAt: { $gte: new Date(input.at.getTime() - margin) },
    });
    const best = closestEntryAt(candidates, input.at, tolerance);
    if (best === null) {
      return null;
    }
    const [item] = await this.withDetails(operator, scope.tenantId, [best]);
    return item ?? null;
  }

  /** 這個人某天(`YYYY-MM-DD`)在這家店的排班(開班可以手動改選;補打卡的「對應排班」下拉)。 */
  async listEntriesOfDay(
    operator: OperatorContext,
    input: EntryScope & { date: string },
  ): Promise<ScheduleEntryForShift[]> {
    const scope = this.scopeOf(operator, input);
    const entries = await this.publishedOf(operator, scope, {
      date: input.date,
    });
    return this.withDetails(operator, scope.tenantId, entries);
  }

  /**
   * 任務快照:這筆排班填進的執行任務裡,人力需求崗位 = 收銀點崗位的那一筆
   * (同崗位多筆:先負責、再開始較早的)。排班不存在 / 未發布 / 對不到 → null。
   */
  async taskSnapshotFor(
    operator: OperatorContext,
    input: {
      tenantId: Types.ObjectId | string;
      entryId: Types.ObjectId | string;
      positionKey: string;
    },
  ): Promise<ScheduleTaskSnapshot | null> {
    const tenantId = idOf(input.tenantId, "tenantId");
    const entry = await this.entries.findOne(operator, {
      _id: idOf(input.entryId, "entryId"),
      tenantId,
    });
    if (entry === null) {
      return null;
    }
    const [item] = await this.withDetails(
      operator,
      tenantId,
      await this.published.publishedOnly(operator, tenantId, [entry]),
    );
    const best =
      item === undefined ? null : taskSnapshotOf(item.tasks, input.positionKey);
    return best === null
      ? null
      : {
          demandId: best.demandId,
          taskId: best.taskId,
          role: best.role,
          taskKey: best.taskKey,
          positionKey: best.positionKey,
        };
  }

  /**
   * 開班彈窗「你還沒打上班卡 [打卡]」:打這一班的上班卡。這裡再查一次 `schedule.my.punch`
   * (呼叫端的端點守的是開班權限;沒有 → `FORBIDDEN`,`reason: MISSING_PERMISSION`)。
   * 只能替自己打(`userId` 要是操作者本人);排班要是自己的、已發布、今天的班。
   */
  async punchStart(
    operator: OperatorContext,
    input: {
      userId: Types.ObjectId | string;
      entryId: Types.ObjectId | string;
    },
    meta: PunchRequestMeta,
  ): Promise<MySchedulePunchModel> {
    if (
      operator.actorId === null ||
      String(operator.actorId) !== String(input.userId)
    ) {
      throw validationError("can only punch for yourself", ["userId"]);
    }
    const holds = await this.permissions.holderOf(operator);
    if (!holds(SCHEDULE_PERMISSIONS.myPunch)) {
      throw forbiddenError(
        "missing permission schedule.my.punch",
        "MISSING_PERMISSION",
      );
    }
    return this.mySchedule.punchStartOf(
      operator,
      String(idOf(input.entryId, "entryId")),
      meta,
    );
  }

  /**
   * 開班彈窗的「你還沒打上班卡」:這一班有沒有(未標重複的)上班卡。讀取照操作者的可見範圍,
   * 條件釘 `tenantId`;排班不存在或看不到 → false。
   */
  async hasStartPunch(
    operator: OperatorContext,
    input: {
      tenantId: Types.ObjectId | string;
      entryId: Types.ObjectId | string;
    },
  ): Promise<boolean> {
    const found = await this.punches.findOne(operator, {
      tenantId: idOf(input.tenantId, "tenantId"),
      entryId: idOf(input.entryId, "entryId"),
      type: "in",
      duplicate: false,
    });
    return found !== null;
  }

  // ---- 內部 ----

  private scopeOf(
    operator: OperatorContext,
    input: EntryScope,
  ): {
    tenantId: Types.ObjectId;
    userId: Types.ObjectId;
    orgId: Types.ObjectId;
  } {
    const orgId = idOf(input.orgId, "orgId");
    if (!isOrgVisible(operator, orgId)) {
      throw notFoundError(`org not found: ${String(orgId)}`);
    }
    return {
      tenantId: idOf(input.tenantId, "tenantId"),
      userId: idOf(input.userId, "userId"),
      orgId,
    };
  }

  private async publishedOf(
    operator: OperatorContext,
    scope: {
      tenantId: Types.ObjectId;
      userId: Types.ObjectId;
      orgId: Types.ObjectId;
    },
    filter: Record<string, unknown>,
  ): Promise<EntryRecord[]> {
    const entries = await this.entries.findMany(
      operator,
      {
        ...filter,
        tenantId: scope.tenantId,
        userId: scope.userId,
        orgId: scope.orgId,
      },
      { sort: { startAt: 1 } },
    );
    return this.published.publishedOnly(operator, scope.tenantId, entries);
  }

  private async withDetails(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    entries: readonly EntryRecord[],
  ): Promise<ScheduleEntryForShift[]> {
    const details = await this.published.detailsOf(operator, tenantId, entries);
    return entries.map((entry) => {
      const detail = details.get(String(entry._id));
      return {
        id: String(entry._id),
        orgId: String(entry.orgId),
        userId: String(entry.userId),
        date: entry.date,
        startAt: entry.startAt,
        endAt: entry.endAt,
        breakMinutes: entry.breakMinutes,
        shortName: detail?.shortName ?? null,
        tasks: detail?.tasks ?? [],
      };
    });
  }
}
