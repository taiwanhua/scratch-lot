import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  addLocalCalendar,
  formatTemporal,
  instantOfLocalTime,
  parseLocalDate,
} from "@repo/domain/form";
import {
  SCHEDULE_AUTO_RUN_MODES,
  SCHEDULE_AUTO_RUN_OVERLAP_CONDITION,
  SCHEDULE_AUTO_RUN_SORT_CONDITIONS,
  SCHEDULE_RULE_DEFINITIONS,
  type ScheduleAutoRunSortCondition,
  type ScheduleBreakTier,
  isIsoDate,
  isIsoMonth,
  minutesOfHhMm,
} from "@repo/domain/project/schedule-settings";

import { AuditService } from "../../../audit/audit.service";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { TransactionService } from "../../../database/transaction";
import {
  ScheduleAutoRunsRepository,
  ScheduleDemandsRepository,
  ScheduleEntriesRepository,
  SchedulePeriodsRepository,
  ScheduleTaskAssignmentsRepository,
} from "../../database/schedule/roster.repositories";
import type { ScheduleAutoRunStats } from "../../database/schedule/schedule-auto-run.schema";
import {
  ScheduleDemandTemplatesRepository,
  ScheduleDemandWeekTemplatesRepository,
} from "../../database/schedule/schedule.repositories";
import { ScheduleCalendarService } from "../calendar/schedule-calendar.service";
import {
  type ChangeReason,
  ScheduleChangesService,
} from "../changes/schedule-changes.service";
import {
  ScheduleCheckService,
  busyOfUnavailability,
} from "../check/schedule-check.service";
import { shiftDate } from "../day-offs/day-off-window";
import { ScheduleDayOffsService } from "../day-offs/schedule-day-offs.service";
import { blockedEntryIdsOf } from "../integration/entry-deletion-guards";
import type { DemandRecord } from "../roster/roster-models";
import { type EntryRecord, RosterPeopleReader } from "../roster/roster-people";
import { monthRange } from "../roster/schedule-roster.service";
import { ScheduleRulesService } from "../rules/schedule-rules.service";
import { ScheduleClock } from "../shared/schedule-clock";
import { isDuplicateKeyError, validationError } from "../shared/schedule-error";
import {
  type ScheduleOrg,
  parseObjectId,
  resolveScheduleOrg,
} from "../shared/schedule-org";
import {
  SCHEDULE_PERMISSIONS,
  SchedulePermissions,
} from "../shared/schedule-permissions";
import { SchedulePersonLocks } from "../shared/schedule-person-locks";
import { ScheduleStaffService } from "../staff/schedule-staff.service";
import type {
  ApplyScheduleTemplatesInput,
  ApplyScheduleTemplatesPayload,
  ClearScheduleAutoAssignmentsPayload,
  RunScheduleAutoRunInput,
  ScheduleApplyWeekTemplateModel,
  ScheduleAutoRunPreviewPayload,
  ScheduleAutoRunRangeInput,
  ScheduleAutoRunStatusPayload,
  ScheduleAutoRunSummaryModel,
} from "./auto-run.models";
import {
  type AutoDemand,
  SCHEDULE_AUTO_RUN_ALGORITHM_VERSION,
  autoSchedule,
} from "./auto-schedule";
import {
  autoRunBlockedError,
  isAutoRunLocked,
  lockExpiredBefore,
} from "./period-lock";
import { newAutoRunSeed } from "./seeded-random";
import {
  type ApplyTemplateLike,
  type TemplateApplyPlan,
  type TemplateApplyRequest,
  planTemplateApply,
} from "./template-apply";

const AUTO_RUN_TARGET = "schedule_auto_run";
const DEMAND_TARGET = "schedule_demand";

/** 規則會跨月(連續上班、兩班之間休息):前後各讀這麼多天。 */
const WIDEN_DAYS = 31;
/** 負責人次數:過去這麼多天、只算這家店(規格 14.5)。 */
const LEADER_COUNT_DAYS = 90;

const AUTO_RUN_CONDITION_KEYS: ReadonlySet<string> = new Set(
  SCHEDULE_RULE_DEFINITIONS.filter(
    (definition) => definition.group === "autoRun",
  ).map((definition) => definition.key),
);

/** 寫入針對的分店與它的時區。 */
interface Scope {
  org: ScheduleOrg;
  timezone: string;
}

/** 套用範本 / 自動排班要的範本內容(這家店組織鏈上看得到的)。 */
interface TemplateBook {
  templates: Map<string, ApplyTemplateLike>;
  weekTemplates: ScheduleApplyWeekTemplateModel[];
}

/** 一次自動排班的設定(驗過的輸入)。 */
interface RunPlan {
  from: string;
  to: string;
  mode: (typeof SCHEDULE_AUTO_RUN_MODES)[number];
  conditions: { key: string; enabled: boolean }[];
  fillWeekTemplate: boolean;
}

/**
 * 排班表的套用範本與自動排班(規格 14.4「套用範本」、14.5「自動排班」;
 * 正本 `docs/modules/project/schedule.md`「套用範本與自動排班」)。
 *
 * - 套用範本:預覽與套用用同一個規劃(`planTemplateApply`);寫入照排班表其他寫入,交易一開始碰
 *   `schedule_periods.version`,已發布的月份要異動原因
 * - 自動排班:先以條件更新標記鎖定這個月(`lockedAt` / `lockedBy`,10 分鐘逾時自動解除;鎖定中其他人
 *   看到「自動排班執行中」),再在一個交易裡補人力需求 → 依方式清除 → 填人(`autoSchedule`)→ 記執行紀錄
 * - 清除自動排入的人:只移除來源 = 自動的填進紀錄,移除後沒有任何執行任務的排班一起刪除
 */
@Injectable()
export class ScheduleAutoRunService {
  constructor(
    private readonly demands: ScheduleDemandsRepository,
    private readonly entries: ScheduleEntriesRepository,
    private readonly assignments: ScheduleTaskAssignmentsRepository,
    private readonly periods: SchedulePeriodsRepository,
    private readonly autoRuns: ScheduleAutoRunsRepository,
    private readonly templateRecords: ScheduleDemandTemplatesRepository,
    private readonly weekTemplateRecords: ScheduleDemandWeekTemplatesRepository,
    private readonly orgs: OrgsRepository,
    private readonly permissions: SchedulePermissions,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
    private readonly staff: ScheduleStaffService,
    private readonly dayOffs: ScheduleDayOffsService,
    private readonly calendar: ScheduleCalendarService,
    private readonly rules: ScheduleRulesService,
    private readonly checks: ScheduleCheckService,
    private readonly changes: ScheduleChangesService,
    private readonly people: RosterPeopleReader,
    private readonly personLocks: SchedulePersonLocks,
    private readonly clock: ScheduleClock,
  ) {}

  // ---- 狀態 ----

  /** 工具列與檢核面板要的:能不能自動排班、是否執行中、最近一次的摘要、週範本選項。 */
  async status(
    operator: OperatorContext,
    input: { orgId?: string | null; month: string },
  ): Promise<ScheduleAutoRunStatusPayload> {
    const scope = await this.scopeOf(operator, input.orgId, input.month);
    const holds = await this.permissions.holderOf(operator);
    const period = await this.periods.findOne(operator, {
      orgId: scope.org.id,
      month: input.month,
    });
    const [latest] = await this.autoRuns.findMany(
      operator,
      { orgId: scope.org.id, month: input.month },
      { sort: { createdAt: -1 }, limit: 1 },
    );
    const book = await this.templateBook(operator, scope);
    const settings = await this.rules.effectiveSettingsForOrg(
      operator,
      scope.org.id,
    );
    const conditions = [...AUTO_RUN_CONDITION_KEYS]
      .flatMap((key) => {
        const setting = settings.get(key);
        return setting === undefined
          ? []
          : [{ key, enabled: setting.enabled, order: setting.order }];
      })
      .toSorted((left, right) => left.order - right.order)
      .map(({ key, enabled }) => ({ key, enabled }));
    return {
      conditions,
      canAutoRun: holds(SCHEDULE_PERMISSIONS.autoRun),
      running:
        period !== null &&
        isAutoRunLocked(period, this.clock.now()) &&
        String(period.lockedBy) !== String(operator.actorId),
      latest: latest === undefined ? null : await this.summaryOf(latest),
      weekTemplates: book.weekTemplates,
    };
  }

  // ---- 套用範本 ----

  async applyTemplates(
    operator: OperatorContext,
    input: ApplyScheduleTemplatesInput,
    options: { dryRun: boolean },
  ): Promise<ApplyScheduleTemplatesPayload> {
    const scope = await this.scopeOf(operator, input.orgId, input.month);
    const dates = validatedDates(input.dates, input.month);
    const book = await this.templateBook(operator, scope);
    const request = templateRequestOf(input, book);
    const plan = async () =>
      this.planApply(operator, scope, input.month, request, dates);
    if (options.dryRun) {
      return payloadOf(await plan());
    }
    await this.ensurePeriod(operator, scope, input.month);
    const result = await this.transactions.withTransaction(async () => {
      const published = await this.touchPeriod(operator, scope, input.month, {
        allowPublished: true,
      });
      const reason = published
        ? await this.changes.validatedReason(operator, input.changeReason)
        : null;
      const planned = await plan();
      await this.createDemands(
        operator,
        scope,
        planned,
        input.kind === "template" ? "template" : "week-template",
        reason,
      );
      return planned;
    });
    return payloadOf(result);
  }

  // ---- 自動排班 ----

  /** [自動排班] 對話框要的:範圍內的人力需求、可以補上的週範本、手動 / 自動排入的人次。 */
  async preview(
    operator: OperatorContext,
    input: ScheduleAutoRunRangeInput,
  ): Promise<ScheduleAutoRunPreviewPayload> {
    const scope = await this.scopeOf(operator, input.orgId, input.month);
    const range = validatedRange(input);
    const closed = await this.closedDates(
      operator,
      scope,
      range.from,
      range.to,
    );
    const demands = await this.openDemands(operator, scope, range, closed);
    const weekFill = await this.weekFillOf(operator, scope, input.month, range);
    const assignments =
      demands.length === 0
        ? []
        : await this.assignments.findMany(operator, {
            orgId: scope.org.id,
            demandId: { $in: demands.map((demand) => demand._id) },
          });
    return {
      demandCount: demands.length,
      weekTemplate: weekFill?.weekTemplate ?? null,
      fillableDays: weekFill?.plan.filledDays ?? 0,
      manualCount: assignments.filter((item) => item.source !== "auto").length,
      autoCount: assignments.filter((item) => item.source === "auto").length,
    };
  }

  async run(
    operator: OperatorContext,
    input: RunScheduleAutoRunInput,
  ): Promise<ScheduleAutoRunSummaryModel> {
    const scope = await this.scopeOf(operator, input.orgId, input.month);
    const plan = validatedRunPlan(input);
    await this.ensurePeriod(operator, scope, input.month);
    const lockedAt = await this.acquireLock(operator, scope, input.month);
    try {
      const candidates = await this.staff.listScheduleCandidates(
        operator,
        scope.org.id,
      );
      for (const candidate of candidates) {
        await this.personLocks.ensure(
          operator,
          scope.org.tenantId,
          new Types.ObjectId(candidate.userId),
        );
      }
      const record = await this.transactions.withTransaction(async () => {
        await this.touchPeriod(operator, scope, input.month, {
          allowPublished: false,
          ownLock: lockedAt,
        });
        // 碰每位候選人的「人」守門文件:同時在別家店手動排同一人會衝突重跑
        for (const candidate of candidates) {
          await this.personLocks.touch(
            operator,
            scope.org.tenantId,
            new Types.ObjectId(candidate.userId),
          );
        }
        return this.runInTransaction(operator, scope, input.month, plan);
      });
      return await this.summaryOf(record);
    } finally {
      await this.releaseLock(operator, scope, input.month, lockedAt);
    }
  }

  /** 清除自動排入的人(檢核面板):只移除來源 = 自動的填進紀錄;零筆的排班一起刪除。 */
  async clear(
    operator: OperatorContext,
    input: ScheduleAutoRunRangeInput,
  ): Promise<ClearScheduleAutoAssignmentsPayload> {
    const scope = await this.scopeOf(operator, input.orgId, input.month);
    const range = validatedRange(input);
    await this.ensurePeriod(operator, scope, input.month);
    return this.transactions.withTransaction(async () => {
      await this.touchPeriod(operator, scope, input.month, {
        allowPublished: false,
      });
      const demands = await this.demands.findMany(operator, {
        orgId: scope.org.id,
        date: { $gte: range.from, $lte: range.to },
      });
      const cleared = await this.clearAssignments(
        operator,
        scope,
        demands,
        "auto",
      );
      await this.audit.record(operator, {
        action: "schedule-auto-run.clear",
        targetType: AUTO_RUN_TARGET,
        after: {
          month: input.month,
          from: range.from,
          to: range.to,
          removed: cleared.removed,
          deletedEntries: cleared.deletedEntryIds,
        },
      });
      return {
        removedCount: cleared.removed,
        deletedEntryIds: cleared.deletedEntryIds,
      };
    });
  }

  // ---- 自動排班(交易內) ----

  private async runInTransaction(
    operator: OperatorContext,
    scope: Scope,
    month: string,
    plan: RunPlan,
  ) {
    const range = { from: plan.from, to: plan.to };
    const stats: ScheduleAutoRunStats = {
      filledCount: 0,
      unfilledCount: 0,
      addedDemandCount: 0,
      addedDemandDays: 0,
      clearedCount: 0,
      createdEntryCount: 0,
      extendedEntryCount: 0,
    };
    // 1. 先以預設人力需求週範本補上人力需求(有 auto-run 就可以補,不需要 edit)
    let weekTemplateId: Types.ObjectId | null = null;
    if (plan.fillWeekTemplate) {
      const weekFill = await this.weekFillOf(operator, scope, month, range);
      if (weekFill !== null) {
        weekTemplateId = new Types.ObjectId(weekFill.weekTemplate.id);
        await this.createDemands(operator, scope, weekFill.plan, "auto", null);
        stats.addedDemandCount = weekFill.plan.created.length;
        stats.addedDemandDays = weekFill.plan.filledDays;
      }
    }
    const closed = await this.closedDates(
      operator,
      scope,
      range.from,
      range.to,
    );
    const demands = await this.openDemands(operator, scope, range, closed);
    // 2. 依方式清除(只填空位 = 不清)
    if (plan.mode !== "fill-empty") {
      const cleared = await this.clearAssignments(
        operator,
        scope,
        demands,
        plan.mode === "redo-auto" ? "auto" : "all",
      );
      stats.clearedCount = cleared.removed;
    }
    // 3. 填人
    const input = await this.scheduleInput(operator, scope, month, {
      demands,
      closed,
      plan,
    });
    const result = autoSchedule(input);
    const run = await this.autoRuns.create(operator, {
      orgId: scope.org.id,
      month,
      from: plan.from,
      to: plan.to,
      mode: plan.mode,
      conditions: plan.conditions,
      weekTemplateId,
      seed: input.seed,
      algorithmVersion: SCHEDULE_AUTO_RUN_ALGORITHM_VERSION,
      stats: {
        ...stats,
        filledCount: result.fills.length,
        unfilledCount: result.unfilledCount,
        createdEntryCount: result.newEntries.length,
        extendedEntryCount: result.changedEntries.length,
      },
    });
    const created = await this.entries.createMany(
      operator,
      result.newEntries.map((entry) => ({
        orgId: scope.org.id,
        userId: new Types.ObjectId(entry.userId),
        date: entry.date,
        startAt: entry.startAt,
        endAt: entry.endAt,
        breakMinutes: entry.breakMinutes,
      })),
    );
    const entryIdOf = new Map(
      result.newEntries.map((entry, index) => [
        entry.key,
        created[index]?._id ?? null,
      ]),
    );
    for (const changed of result.changedEntries) {
      await this.entries.updateById(operator, changed.entryId, {
        $set: {
          startAt: changed.startAt,
          endAt: changed.endAt,
          breakMinutes: changed.breakMinutes,
        },
      });
    }
    await this.assignments.createMany(
      operator,
      result.fills.map((fill) => ({
        orgId: scope.org.id,
        entryId:
          entryIdOf.get(fill.entryKey) ?? new Types.ObjectId(fill.entryKey),
        demandId: new Types.ObjectId(fill.demandId),
        taskId: fill.taskId,
        source: "auto",
        autoRunId: run._id,
        reason: fill.reason,
      })),
    );
    await this.audit.record(operator, {
      action: "schedule-auto-run.run",
      targetType: AUTO_RUN_TARGET,
      targetId: run._id,
      after: {
        month,
        from: plan.from,
        to: plan.to,
        mode: plan.mode,
        conditions: plan.conditions,
        stats: run.stats,
      },
    });
    return run;
  }

  /** 自動排班核心要的資料(候選人、他們的排班與畫休、規則、負責人次數、種子)。 */
  private async scheduleInput(
    operator: OperatorContext,
    scope: Scope,
    month: string,
    context: { demands: DemandRecord[]; closed: Set<string>; plan: RunPlan },
  ) {
    const { from, to } = monthRange(month);
    const wide = {
      from: shiftDate(from, -WIDEN_DAYS),
      to: shiftDate(to, WIDEN_DAYS),
    };
    const candidates = await this.staff.listScheduleCandidates(
      operator,
      scope.org.id,
    );
    const userIds = candidates.map((item) => item.userId);
    const personEntries = await this.people.entriesOfPeople(
      operator,
      scope.org.tenantId,
      userIds.map((id) => new Types.ObjectId(id)),
      wide.from,
      wide.to,
    );
    const storeEntryIds = personEntries
      .filter((entry) => String(entry.orgId) === String(scope.org.id))
      .map((entry) => entry._id);
    const assignments =
      storeEntryIds.length === 0
        ? []
        : await this.assignments.findMany(operator, {
            orgId: scope.org.id,
            entryId: { $in: storeEntryIds },
          });
    const targetIds = new Set(
      context.demands.map((demand) => String(demand._id)),
    );
    const otherDemandIds = [
      ...new Set(
        assignments
          .map((item) => String(item.demandId))
          .filter((id) => !targetIds.has(id)),
      ),
    ];
    const otherDemands =
      otherDemandIds.length === 0
        ? []
        : await this.demands.findMany(operator, {
            _id: { $in: otherDemandIds.map((id) => new Types.ObjectId(id)) },
          });
    const unavailability = await this.dayOffs.listUnavailable(
      operator,
      scope.org.id,
      wide.from,
      wide.to,
    );
    const settings = await this.rules.effectiveSettingsForOrg(
      operator,
      scope.org.id,
    );
    const settingsOf = await this.checks.personSettings(
      scope.org,
      settings,
      userIds,
    );
    const enabled = new Set(
      context.plan.conditions
        .filter((condition) => condition.enabled)
        .map((condition) => condition.key),
    );
    return {
      storeId: String(scope.org.id),
      month,
      seed: newAutoRunSeed(),
      demands: context.demands.map((demand) => autoDemandOf(demand)),
      otherDemands: otherDemands.map((demand) => autoDemandOf(demand)),
      entries: personEntries.map((entry) => autoEntryOf(entry)),
      assignments: assignments.map((item) => ({
        entryId: String(item.entryId),
        demandId: String(item.demandId),
        taskId: item.taskId,
      })),
      candidates: candidates.map((item) => ({
        userId: item.userId,
        canLead: item.canLead,
      })),
      busy: busyOfUnavailability(unavailability, scope.timezone),
      closedDates: context.closed,
      sortConditions: context.plan.conditions
        .map((condition) => condition.key)
        .filter(
          (key): key is ScheduleAutoRunSortCondition =>
            enabled.has(key) &&
            (SCHEDULE_AUTO_RUN_SORT_CONDITIONS as readonly string[]).includes(
              key,
            ),
        ),
      allowOverlap: enabled.has(SCHEDULE_AUTO_RUN_OVERLAP_CONDITION),
      leaderCounts: await this.leaderCounts(operator, scope),
      breakTiers: breakTiersOf(settings.get("defaultBreaks")?.value.tiers),
      settingsOf,
      dateOf: (at: Date) => this.dateOf(scope, at),
    };
  }

  /**
   * 負責人次數(規格 14.5):過去 90 天(今天以前,租戶時區)、只算這家店,以排班為單位
   * (一筆排班任一筆填進的是負責任務就算 1 次)。
   */
  private async leaderCounts(
    operator: OperatorContext,
    scope: Scope,
  ): Promise<Map<string, number>> {
    const today = this.dateOf(scope, this.clock.now());
    const records = await this.entries.findMany(operator, {
      orgId: scope.org.id,
      date: {
        $gte: shiftDate(today, -LEADER_COUNT_DAYS),
        $lte: shiftDate(today, -1),
      },
    });
    if (records.length === 0) {
      return new Map();
    }
    const filled = await this.assignments.findMany(operator, {
      orgId: scope.org.id,
      entryId: { $in: records.map((record) => record._id) },
    });
    const demands = await this.demands.findMany(operator, {
      _id: {
        $in: [...new Set(filled.map((item) => String(item.demandId)))].map(
          (id) => new Types.ObjectId(id),
        ),
      },
    });
    const leaderTasks = new Set(
      demands.flatMap((demand) =>
        demand.tasks
          .filter((task) => task.role === "leader")
          .map((task) => `${String(demand._id)}|${task.taskId}`),
      ),
    );
    const leadEntries = new Set(
      filled
        .filter((item) =>
          leaderTasks.has(`${String(item.demandId)}|${item.taskId}`),
        )
        .map((item) => String(item.entryId)),
    );
    const counts = new Map<string, number>();
    for (const record of records) {
      if (leadEntries.has(String(record._id))) {
        const userId = String(record.userId);
        counts.set(userId, (counts.get(userId) ?? 0) + 1);
      }
    }
    return counts;
  }

  // ---- 清除 ----

  /**
   * 清除這些人力需求上的填進紀錄(`auto` = 只清來源自動的;`all` = 全部);清完沒有任何執行任務的排班一起刪除。
   * 會被刪的排班已被收銀班次綁定(`blockedEntryIdsOf`)→ 那筆排班的填進紀錄整筆留著不清。
   */
  private async clearAssignments(
    operator: OperatorContext,
    scope: Scope,
    demands: readonly DemandRecord[],
    which: "auto" | "all",
  ): Promise<{ removed: number; deletedEntryIds: string[] }> {
    if (demands.length === 0) {
      return { removed: 0, deletedEntryIds: [] };
    }
    const candidates = await this.assignments.findMany(operator, {
      orgId: scope.org.id,
      demandId: { $in: demands.map((demand) => demand._id) },
      ...(which === "auto" ? { source: "auto" } : {}),
    });
    if (candidates.length === 0) {
      return { removed: 0, deletedEntryIds: [] };
    }
    const entryIds = [
      ...new Set(candidates.map((item) => String(item.entryId))),
    ];
    const remaining = await this.assignments.findMany(operator, {
      entryId: { $in: entryIds.map((id) => new Types.ObjectId(id)) },
      _id: { $nin: candidates.map((item) => item._id) },
    });
    const stillFilled = new Set(remaining.map((item) => String(item.entryId)));
    const emptied = entryIds.filter((id) => !stillFilled.has(id));
    const blocked = await blockedEntryIdsOf(
      String(scope.org.tenantId),
      emptied,
    );
    const removing = candidates.filter(
      (item) => !blocked.has(String(item.entryId)),
    );
    for (const item of removing) {
      await this.assignments.softDeleteById(operator, item._id);
    }
    const deletedEntryIds = emptied.filter((id) => !blocked.has(id));
    for (const id of deletedEntryIds) {
      await this.entries.softDeleteById(operator, new Types.ObjectId(id));
    }
    return { removed: removing.length, deletedEntryIds };
  }

  // ---- 套用範本(內部) ----

  private async planApply(
    operator: OperatorContext,
    scope: Scope,
    month: string,
    request: TemplateApplyRequest,
    dates: readonly string[],
  ): Promise<TemplateApplyPlan> {
    const { from, to } = monthRange(month);
    const existing = await this.demands.findMany(operator, {
      orgId: scope.org.id,
      date: { $gte: from, $lte: to },
    });
    return planTemplateApply({
      request,
      dates,
      existing,
      closedDates: await this.closedDates(operator, scope, from, to),
      spanOf: (date, startTime, endTime) =>
        this.spanOf(scope, date, startTime, endTime),
    });
  }

  /** 這家店的預設人力需求週範本可以補上的(沒設定 / 停用 / 看不到 → null)。 */
  private async weekFillOf(
    operator: OperatorContext,
    scope: Scope,
    month: string,
    range: { from: string; to: string },
  ): Promise<{
    weekTemplate: ScheduleApplyWeekTemplateModel;
    plan: TemplateApplyPlan;
  } | null> {
    const settings = await this.rules.effectiveSettingsForOrg(
      operator,
      scope.org.id,
    );
    const id = settings.get("autoDemandWeekTemplateId")?.value.weekTemplateId;
    if (typeof id !== "string") {
      return null;
    }
    const book = await this.templateBook(operator, scope);
    const weekTemplate = book.weekTemplates.find((item) => item.id === id);
    if (weekTemplate === undefined) {
      return null;
    }
    const plan = await this.planApply(
      operator,
      scope,
      month,
      weekRequestOf(weekTemplate, book),
      datesBetween(range.from, range.to),
    );
    return { weekTemplate, plan };
  }

  /** 依規劃建立人力需求(複製執行任務、產生新的 taskId);已發布的月份每筆記一筆異動。 */
  private async createDemands(
    operator: OperatorContext,
    scope: Scope,
    plan: TemplateApplyPlan,
    source: "template" | "week-template" | "auto",
    reason: ChangeReason | null,
  ): Promise<void> {
    const created = await this.demands.createMany(
      operator,
      plan.created.map((item) => ({
        orgId: scope.org.id,
        date: item.date,
        startAt: item.startAt,
        endAt: item.endAt,
        positionKey: item.positionKey,
        tasks: item.tasks.map((task) => ({
          taskId: new Types.ObjectId().toHexString(),
          role: task.role,
          taskKey: task.taskKey,
        })),
        templateId: new Types.ObjectId(item.templateId),
        source,
      })),
    );
    if (created.length === 0) {
      return;
    }
    await this.audit.record(operator, {
      action: "schedule-demand.apply-templates",
      targetType: DEMAND_TARGET,
      after: {
        source,
        demandIds: created.map((record) => record._id),
        skippedSlots: plan.skippedSlots,
        skippedDays: plan.skippedDays,
      },
    });
    if (reason === null) {
      return;
    }
    for (const record of created) {
      await this.changes.record(operator, scope.org, reason, {
        month: record.date.slice(0, 7),
        date: record.date,
        action: "demand.create",
        targetId: record._id,
        userIds: [],
        before: null,
        after: {
          date: record.date,
          startAt: record.startAt,
          endAt: record.endAt,
          positionKey: record.positionKey,
          tasks: record.tasks.map((task) => `${task.role}:${task.taskKey}`),
        },
      });
    }
  }

  /** 這家店組織鏈上看得到的範本與啟用中的週範本(已刪除的範本不列)。 */
  private async templateBook(
    operator: OperatorContext,
    scope: Scope,
  ): Promise<TemplateBook> {
    const templates = await this.templateRecords.findMany(operator, {
      orgId: { $in: scope.org.chain },
    });
    const weekTemplates = await this.weekTemplateRecords.findMany(
      operator,
      { orgId: { $in: scope.org.chain }, enabled: true },
      { sort: { createdAt: 1 } },
    );
    const known = new Set(templates.map((template) => String(template._id)));
    return {
      templates: new Map(
        templates.map((template) => [
          String(template._id),
          {
            id: String(template._id),
            startTime: template.startTime,
            endTime: template.endTime,
            positionKey: template.positionKey,
            tasks: template.tasks.map((task) => ({
              role: task.role,
              taskKey: task.taskKey,
            })),
          },
        ]),
      ),
      weekTemplates: weekTemplates.map((record) => ({
        id: String(record._id),
        name: record.name,
        days: Array.from({ length: 7 }, (_, index) =>
          (record.days[index] ?? []).map(String).filter((id) => known.has(id)),
        ),
      })),
    };
  }

  // ---- 共用 ----

  private async scopeOf(
    operator: OperatorContext,
    orgId: string | null | undefined,
    month: string,
  ): Promise<Scope> {
    if (!isIsoMonth(month)) {
      throw validationError(`invalid month: ${String(month)}`, ["month"]);
    }
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const timezone = await tenantTimezoneOf(this.orgs, operator, org.tenantId);
    return { org, timezone };
  }

  private dateOf(scope: Scope, at: Date): string {
    return formatTemporal(at, { type: "date", timezone: scope.timezone });
  }

  /** 某天的 `HH:mm`–`HH:mm`(租戶時區;結束不晚於開始 = 跨午夜)。 */
  private spanOf(
    scope: Scope,
    date: string,
    startTime: string,
    endTime: string,
  ): { startAt: Date; endAt: Date } {
    const day = parseLocalDate(date);
    if (day === null) {
      throw validationError(`invalid date: ${date}`, ["dates"]);
    }
    const at = (time: string) => {
      const minutes = minutesOfHhMm(time) ?? 0;
      return instantOfLocalTime(
        day,
        Math.floor(minutes / 60),
        minutes % 60,
        scope.timezone,
      );
    };
    const start = at(startTime);
    let end = at(endTime);
    if (end <= start) {
      end = addLocalCalendar(end, 1, "days", scope.timezone);
    }
    return { startAt: new Date(start), endAt: new Date(end) };
  }

  private async closedDates(
    operator: OperatorContext,
    scope: Scope,
    from: string,
    to: string,
  ): Promise<Set<string>> {
    // 跨午夜的班會碰到隔天:多讀一天
    const days = await this.calendar.effectiveDays(
      operator,
      scope.org.id,
      from,
      shiftDate(to, 1),
    );
    return new Set(
      days.filter((day) => day.type === "closed").map((day) => day.date),
    );
  }

  /** 範圍內、不是店休那天的人力需求。 */
  private async openDemands(
    operator: OperatorContext,
    scope: Scope,
    range: { from: string; to: string },
    closed: ReadonlySet<string>,
  ): Promise<DemandRecord[]> {
    const records = await this.demands.findMany(
      operator,
      { orgId: scope.org.id, date: { $gte: range.from, $lte: range.to } },
      { sort: { startAt: 1 } },
    );
    return records.filter((record) => !closed.has(record.date));
  }

  private async ensurePeriod(
    operator: OperatorContext,
    scope: Scope,
    month: string,
  ): Promise<void> {
    const key = { orgId: scope.org.id, month };
    if (await this.periods.findOne(operator, key)) {
      return;
    }
    try {
      await this.periods.create(operator, {
        ...key,
        status: "unpublished",
        publishedAt: null,
        publishedBy: null,
        lockedAt: null,
        lockedBy: null,
        version: 0,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }

  /**
   * 交易一開始碰狀態文件(和同月的寫入、發布互相衝突);別人的自動排班鎖定中 → `AUTO_RUN_IN_PROGRESS`。
   * 已發布:自動排班 / 清除 → `ALREADY_PUBLISHED`;套用範本照常(回 true,要異動原因)。
   */
  private async touchPeriod(
    operator: OperatorContext,
    scope: Scope,
    month: string,
    options: { allowPublished: boolean; ownLock?: Date },
  ): Promise<boolean> {
    const touched = await this.periods.findOneAndUpdate(
      operator,
      { orgId: scope.org.id, month },
      { $inc: { version: 1 } },
    );
    if (!touched) {
      throw new Error(
        `schedule period missing: ${String(scope.org.id)} ${month}`,
      );
    }
    const ownLock =
      options.ownLock !== undefined &&
      touched.lockedAt?.getTime() === options.ownLock.getTime();
    if (!ownLock && isAutoRunLocked(touched, this.clock.now())) {
      throw autoRunBlockedError("AUTO_RUN_IN_PROGRESS");
    }
    const published = touched.status === "published";
    if (published && !options.allowPublished) {
      throw autoRunBlockedError("ALREADY_PUBLISHED");
    }
    return published;
  }

  /** 條件更新標記鎖定(未發布、沒鎖或已逾時);拿不到 → 依狀況回已發布 / 執行中。 */
  private async acquireLock(
    operator: OperatorContext,
    scope: Scope,
    month: string,
  ): Promise<Date> {
    const now = this.clock.now();
    const locked = await this.periods.findOneAndUpdate(
      operator,
      {
        orgId: scope.org.id,
        month,
        status: "unpublished",
        $or: [
          { lockedAt: null },
          { lockedAt: { $lt: lockExpiredBefore(now) } },
        ],
      },
      { $set: { lockedAt: now, lockedBy: operator.actorId } },
    );
    if (locked !== null) {
      return now;
    }
    const period = await this.periods.findOne(operator, {
      orgId: scope.org.id,
      month,
    });
    throw autoRunBlockedError(
      period?.status === "published"
        ? "ALREADY_PUBLISHED"
        : "AUTO_RUN_IN_PROGRESS",
    );
  }

  /** 解除自己標的鎖(別人在逾時後重新標的不動)。 */
  private async releaseLock(
    operator: OperatorContext,
    scope: Scope,
    month: string,
    lockedAt: Date,
  ): Promise<void> {
    await this.periods.findOneAndUpdate(
      operator,
      { orgId: scope.org.id, month, lockedAt },
      { $set: { lockedAt: null, lockedBy: null } },
    );
  }

  private async summaryOf(record: {
    _id: Types.ObjectId;
    createdAt?: Date;
    createdBy?: Types.ObjectId | null;
    from: string;
    to: string;
    stats: ScheduleAutoRunStats;
  }): Promise<ScheduleAutoRunSummaryModel> {
    const by = record.createdBy ?? null;
    const names = await this.people.namesOf(by === null ? [] : [by]);
    return {
      id: String(record._id),
      at: record.createdAt ?? this.clock.now(),
      byName: by === null ? null : (names.get(String(by)) ?? null),
      from: record.from,
      to: record.to,
      filledCount: record.stats.filledCount,
      unfilledCount: record.stats.unfilledCount,
      addedDemandCount: record.stats.addedDemandCount,
      addedDemandDays: record.stats.addedDemandDays,
    };
  }
}

function payloadOf(plan: TemplateApplyPlan): ApplyScheduleTemplatesPayload {
  return {
    createdCount: plan.created.length,
    skippedSlots: plan.skippedSlots,
    filledDays: plan.filledDays,
    skippedDays: plan.skippedDays,
  };
}

/** 範圍要在這個月內、`from` 不晚於 `to`;否則 `VALIDATION_FAILED`(欄位 `from` / `to`)。 */
function validatedRange(input: { month: string; from: string; to: string }): {
  from: string;
  to: string;
} {
  if (
    !isIsoDate(input.from) ||
    !isIsoDate(input.to) ||
    !input.from.startsWith(`${input.month}-`) ||
    !input.to.startsWith(`${input.month}-`) ||
    input.from > input.to
  ) {
    throw validationError(`invalid range: ${input.from}–${input.to}`, [
      "from",
      "to",
    ]);
  }
  return { from: input.from, to: input.to };
}

/** 方式要是三種之一;條件只能是自動排班條件、每條最多一次(沒列的 = 不勾)。 */
function validatedRunPlan(input: RunScheduleAutoRunInput): RunPlan {
  const range = validatedRange(input);
  const mode = SCHEDULE_AUTO_RUN_MODES.find((item) => item === input.mode);
  if (mode === undefined) {
    throw validationError(`invalid mode: ${input.mode}`, ["mode"]);
  }
  const keys = input.conditions.map((condition) => condition.key);
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key) => !AUTO_RUN_CONDITION_KEYS.has(key))
  ) {
    throw validationError("invalid auto-run conditions", ["conditions"]);
  }
  return {
    ...range,
    mode,
    conditions: input.conditions.map((condition) => ({
      key: condition.key,
      enabled: condition.enabled,
    })),
    fillWeekTemplate: input.fillWeekTemplate === true,
  };
}

/** 套用到的日子:都要是這個月的日期。 */
function validatedDates(dates: readonly string[], month: string): string[] {
  if (
    dates.length === 0 ||
    dates.some((date) => !isIsoDate(date) || !date.startsWith(`${month}-`))
  ) {
    throw validationError("dates must be days of this month", ["dates"]);
  }
  return [...new Set(dates)];
}

/** 種類與選的範本 / 週範本(要是這家店組織鏈上看得到的;週範本要啟用中)。 */
function templateRequestOf(
  input: ApplyScheduleTemplatesInput,
  book: TemplateBook,
): TemplateApplyRequest {
  if (input.kind === "template") {
    const ids = [...new Set(input.templateIds)];
    const templates = ids.map((id) => book.templates.get(id));
    if (ids.length === 0 || templates.includes(undefined)) {
      throw validationError("unknown demand templates", ["templateIds"]);
    }
    return {
      kind: "template",
      templates: templates.filter(
        (item): item is ApplyTemplateLike => item !== undefined,
      ),
    };
  }
  if (input.kind === "week-template") {
    const id = input.weekTemplateId ?? "";
    parseObjectId(id, "weekTemplateId");
    const weekTemplate = book.weekTemplates.find((item) => item.id === id);
    if (weekTemplate === undefined) {
      throw validationError(`unknown week template: ${id}`, ["weekTemplateId"]);
    }
    return weekRequestOf(weekTemplate, book);
  }
  throw validationError(`invalid kind: ${input.kind}`, ["kind"]);
}

function weekRequestOf(
  weekTemplate: ScheduleApplyWeekTemplateModel,
  book: TemplateBook,
): TemplateApplyRequest {
  return {
    kind: "week-template",
    days: weekTemplate.days.map((ids) =>
      ids.flatMap((id) => {
        const template = book.templates.get(id);
        return template === undefined ? [] : [template];
      }),
    ),
  };
}

/** `from`–`to` 的每一天(含頭尾)。 */
function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function breakTiersOf(value: unknown): ScheduleBreakTier[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((tier: unknown) => {
    const { minMinutes, breakMinutes } = (tier ?? {}) as Record<
      string,
      unknown
    >;
    return typeof minMinutes === "number" && typeof breakMinutes === "number"
      ? [{ minMinutes, breakMinutes }]
      : [];
  });
}

function autoDemandOf(record: DemandRecord): AutoDemand {
  return {
    id: String(record._id),
    date: record.date,
    startAt: record.startAt,
    endAt: record.endAt,
    tasks: record.tasks.map((task) => ({
      taskId: task.taskId,
      role: task.role,
    })),
  };
}

function autoEntryOf(record: EntryRecord) {
  return {
    id: String(record._id),
    userId: String(record.userId),
    orgId: String(record.orgId),
    date: record.date,
    startAt: record.startAt,
    endAt: record.endAt,
    breakMinutes: record.breakMinutes,
  };
}
