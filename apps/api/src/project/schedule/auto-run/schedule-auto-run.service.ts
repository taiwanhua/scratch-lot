import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  type InstantRange,
  addLocalDays,
  instantOfLocalHhMm,
  minutesOfHhMm,
  parseLocalMonth,
} from "@repo/domain/form";
import {
  SCHEDULE_AUTO_RUN_MODES,
  SCHEDULE_AUTO_RUN_OVERLAP_CONDITION,
  SCHEDULE_AUTO_RUN_SORT_CONDITIONS,
  SCHEDULE_RULE_DEFINITIONS,
  type ScheduleAutoRunSortCondition,
  type ScheduleBreakTier,
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
import type {
  ScheduleAutoRunExtendedEntry,
  ScheduleAutoRunStats,
} from "../../database/schedule/schedule-auto-run.schema";
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
import { ScheduleDayOffsService } from "../day-offs/schedule-day-offs.service";
import { blockedEntryIdsOf } from "../integration/entry-deletion-guards";
import type { DemandRecord } from "../roster/roster-models";
import { type EntryRecord, RosterPeopleReader } from "../roster/roster-people";
import { ScheduleRulesService } from "../rules/schedule-rules.service";
import { ScheduleClock } from "../shared/schedule-clock";
import {
  dateKeyOf,
  dateKeysOfRange,
  dayKeyRange,
  instantOfKey,
  instantRangeFilter,
  localDateOfKey,
  monthKeyOf,
  monthKeyRange,
  normalizedDay,
  normalizedDayRange,
  shiftDateKey,
} from "../shared/schedule-dates";
import {
  SCHEDULE_REASONS,
  isDuplicateKeyError,
  validationError,
} from "../shared/schedule-error";
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

/** 要清的填進紀錄與一起刪的排班。 */
interface ClearPlan {
  assignmentIds: Types.ObjectId[];
  /** 清完沒有任何執行任務、一起刪的排班 */
  entryIds: string[];
  /** 有填進被清、但還留著的排班(清除自動排入的人時,被延續延長的要縮回) */
  touchedEntryIds: string[];
}

/** 要建立的一筆人力需求(id 先產生;`date` = 那天租戶時區 00:00 的時點)。 */
interface DemandDoc {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  date: Date;
  startAt: Date;
  endAt: Date;
  positionKey: string;
  tasks: { taskId: string; role: string; taskKey: string }[];
  templateId: Types.ObjectId;
  source: string;
}

/** 交易外算好的一次自動排班(`prepareRun`)。 */
interface PreparedRun {
  candidateIds: string[];
  weekFill: {
    weekTemplate: ScheduleApplyWeekTemplateModel;
    plan: TemplateApplyPlan;
  } | null;
  weekDocs: DemandDoc[];
  cleared: ClearPlan;
  seed: number;
  result: ReturnType<typeof autoSchedule>;
  extended: ScheduleAutoRunExtendedEntry[];
}

/** 一次自動排班的設定(驗過的輸入;範圍是半開的時點區間)。 */
interface RunPlan {
  range: InstantRange;
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
    const dates = validatedDates(input.dates, input.month, scope.timezone);
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
        this.demandDocsOf(
          scope,
          planned,
          input.kind === "template" ? "template" : "week-template",
        ),
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
    const range = validatedRange(input, scope.timezone);
    const closed = await this.closedDates(operator, scope, range);
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
    const plan = validatedRunPlan(input, scope.timezone);
    await this.ensurePeriod(operator, scope, input.month);
    const lock = await this.acquireLock(operator, scope, input.month);
    const { lockedAt } = lock;
    try {
      // 已持有月鎖:讀資料與計算放在交易外(不讓長時間的計算撐住交易);交易內只寫入
      const prepared = await this.prepareRun(
        operator,
        scope,
        input.month,
        plan,
      );
      const candidateIds = prepared.candidateIds.map(
        (userId) => new Types.ObjectId(userId),
      );
      await this.personLocks.ensureMany(
        operator,
        scope.org.tenantId,
        candidateIds,
      );
      const record = await this.transactions.withTransaction(async () => {
        // 重核鎖仍是自己的、計算期間沒有別的寫入:逾時被別人搶走,或逾時期間別人寫了這個月 → 不寫入
        await this.touchPeriod(operator, scope, input.month, {
          allowPublished: false,
          ownLock: lock,
        });
        // 碰每位候選人的「人」守門文件:同時在別家店手動排同一人會衝突重跑(一次 updateMany)
        await this.personLocks.touchMany(
          operator,
          scope.org.tenantId,
          candidateIds,
        );
        return this.writeRun(operator, scope, input.month, plan, prepared);
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
    const range = validatedRange(input, scope.timezone);
    await this.ensurePeriod(operator, scope, input.month);
    return this.transactions.withTransaction(async () => {
      await this.touchPeriod(operator, scope, input.month, {
        allowPublished: false,
      });
      const demands = await this.demands.findMany(operator, {
        orgId: scope.org.id,
        date: instantRangeFilter(range),
      });
      const cleared = await this.planClear(
        operator,
        scope,
        demands.map((demand) => demand._id),
        "auto",
      );
      await this.applyClear(operator, cleared);
      const shrunk = await this.shrinkExtended(
        operator,
        scope,
        cleared.touchedEntryIds,
      );
      await this.audit.record(operator, {
        action: "schedule-auto-run.clear",
        targetType: AUTO_RUN_TARGET,
        after: {
          month: input.month,
          from: new Date(range.from),
          to: new Date(range.to),
          removed: cleared.assignmentIds.length,
          deletedEntries: cleared.entryIds,
          shrunkEntries: shrunk,
        },
      });
      return {
        removedCount: cleared.assignmentIds.length,
        deletedEntryIds: cleared.entryIds,
      };
    });
  }

  // ---- 自動排班(交易內) ----

  /**
   * 自動排班的計算(交易外、已持有月鎖):週範本要補的人力需求(先產生 id)、依方式要清的填進紀錄、
   * 填人的結果(`autoSchedule`)。不寫任何資料。
   */
  private async prepareRun(
    operator: OperatorContext,
    scope: Scope,
    month: string,
    plan: RunPlan,
  ): Promise<PreparedRun> {
    const { range } = plan;
    // 1. 先以預設人力需求週範本補上人力需求(有 auto-run 就可以補,不需要 edit)
    const weekFill = plan.fillWeekTemplate
      ? await this.weekFillOf(operator, scope, month, range)
      : null;
    const weekDocs =
      weekFill === null ? [] : this.demandDocsOf(scope, weekFill.plan, "auto");
    const closed = await this.closedDates(operator, scope, range);
    const existing = await this.openDemands(operator, scope, range, closed);
    // 2. 依方式要清的(只填空位 = 不清)
    const clearWhich = plan.mode === "redo-auto" ? "auto" : "all";
    const cleared: ClearPlan =
      plan.mode === "fill-empty"
        ? { assignmentIds: [], entryIds: [], touchedEntryIds: [] }
        : await this.planClear(
            operator,
            scope,
            existing.map((demand) => demand._id),
            clearWhich,
          );
    // 3. 填人(補上的人力需求也一起填;要清的當作已經不在)
    const input = await this.scheduleInput(operator, scope, month, {
      demands: [
        ...existing.map((demand) => autoDemandOf(demand, scope.timezone)),
        ...weekDocs
          .filter((doc) => !closed.has(dateKeyOf(doc.date, scope.timezone)))
          .map((doc) => autoDemandOf(doc, scope.timezone)),
      ],
      closed,
      plan,
      excluded: {
        assignmentIds: new Set(cleared.assignmentIds.map(String)),
        entryIds: new Set(cleared.entryIds),
      },
    });
    const result = autoSchedule(input);
    const entryBefore = new Map(
      input.entries.map((entry) => [entry.id, entry]),
    );
    return {
      candidateIds: input.candidates.map((candidate) => candidate.userId),
      weekFill,
      weekDocs,
      cleared,
      seed: input.seed,
      result,
      extended: result.changedEntries.flatMap((changed) => {
        const before = entryBefore.get(changed.entryId);
        return before === undefined
          ? []
          : [
              {
                entryId: new Types.ObjectId(changed.entryId),
                before: {
                  startAt: before.startAt,
                  endAt: before.endAt,
                  breakMinutes: before.breakMinutes,
                },
                after: {
                  startAt: changed.startAt,
                  endAt: changed.endAt,
                  breakMinutes: changed.breakMinutes,
                },
              },
            ];
      }),
    };
  }

  /** 把計算好的結果寫進去(交易內;呼叫前已重核月鎖仍是自己的)。 */
  private async writeRun(
    operator: OperatorContext,
    scope: Scope,
    month: string,
    plan: RunPlan,
    prepared: PreparedRun,
  ) {
    const { weekFill, result } = prepared;
    if (weekFill !== null && prepared.weekDocs.length > 0) {
      await this.createDemands(
        operator,
        scope,
        weekFill.plan,
        prepared.weekDocs,
        null,
      );
    }
    await this.applyClear(operator, prepared.cleared);
    const stats: ScheduleAutoRunStats = {
      filledCount: result.fills.length,
      unfilledCount: result.unfilledCount,
      addedDemandCount: prepared.weekDocs.length,
      addedDemandDays: weekFill?.plan.filledDays ?? 0,
      clearedCount: prepared.cleared.assignmentIds.length,
      createdEntryCount: result.newEntries.length,
      extendedEntryCount: result.changedEntries.length,
    };
    const run = await this.autoRuns.create(operator, {
      orgId: scope.org.id,
      month,
      from: new Date(plan.range.from),
      to: new Date(plan.range.to),
      mode: plan.mode,
      conditions: plan.conditions,
      weekTemplateId:
        weekFill === null ? null : new Types.ObjectId(weekFill.weekTemplate.id),
      seed: prepared.seed,
      algorithmVersion: SCHEDULE_AUTO_RUN_ALGORITHM_VERSION,
      stats,
      extendedEntries: prepared.extended,
    });
    const created = await this.entries.createMany(
      operator,
      result.newEntries.map((entry) => ({
        orgId: scope.org.id,
        userId: new Types.ObjectId(entry.userId),
        date: instantOfKey(entry.date, scope.timezone),
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
    // 每筆延長後的時間都不同:一次 bulkWrite(TX-06)
    await this.entries.bulkUpdateByIds(
      operator,
      result.changedEntries.map((changed) => ({
        id: changed.entryId,
        update: {
          $set: {
            startAt: changed.startAt,
            endAt: changed.endAt,
            breakMinutes: changed.breakMinutes,
          },
        },
      })),
    );
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
        from: new Date(plan.range.from),
        to: new Date(plan.range.to),
        mode: plan.mode,
        conditions: plan.conditions,
        stats,
      },
    });
    return run;
  }

  /** 自動排班核心要的資料(候選人、他們的排班與畫休、規則、負責人次數、種子)。 */
  private async scheduleInput(
    operator: OperatorContext,
    scope: Scope,
    month: string,
    context: {
      demands: AutoDemand[];
      closed: Set<string>;
      plan: RunPlan;
      /** 這次要清掉的填進紀錄與一起刪的排班(還沒寫入,計算時當作已經不在) */
      excluded: { assignmentIds: Set<string>; entryIds: Set<string> };
    },
  ) {
    const own = monthKeyRange(month, scope.timezone);
    const wide = dayKeyRange(
      shiftDateKey(dateKeyOf(own.from, scope.timezone), -WIDEN_DAYS),
      shiftDateKey(dateKeyOf(own.to - 1, scope.timezone), WIDEN_DAYS),
      scope.timezone,
    );
    const candidates = await this.staff.listScheduleCandidates(
      operator,
      scope.org.id,
    );
    const userIds = candidates.map((item) => item.userId);
    const allPersonEntries = await this.people.entriesOfPeople(
      operator,
      scope.org.tenantId,
      userIds.map((id) => new Types.ObjectId(id)),
      wide,
    );
    const personEntries = allPersonEntries.filter(
      (entry) => !context.excluded.entryIds.has(String(entry._id)),
    );
    const storeEntryIds = personEntries
      .filter((entry) => String(entry.orgId) === String(scope.org.id))
      .map((entry) => entry._id);
    const assignments = (
      storeEntryIds.length === 0
        ? []
        : await this.assignments.findMany(operator, {
            orgId: scope.org.id,
            entryId: { $in: storeEntryIds },
          })
    ).filter((item) => !context.excluded.assignmentIds.has(String(item._id)));
    const targetIds = new Set(context.demands.map((demand) => demand.id));
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
      wide,
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
      demands: context.demands,
      otherDemands: otherDemands.map((demand) =>
        autoDemandOf(demand, scope.timezone),
      ),
      entries: personEntries.map((entry) => autoEntryOf(entry, scope.timezone)),
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
      dateOf: (at: Date) => dateKeyOf(at, scope.timezone),
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
    const today = dateKeyOf(this.clock.now(), scope.timezone);
    const records = await this.entries.findMany(operator, {
      orgId: scope.org.id,
      date: instantRangeFilter(
        dayKeyRange(
          shiftDateKey(today, -LEADER_COUNT_DAYS),
          shiftDateKey(today, -1),
          scope.timezone,
        ),
      ),
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
   * 這些人力需求上要清的填進紀錄(`auto` = 只清來源自動的;`all` = 全部)與清完沒有任何執行任務、要一起刪的排班。
   * 會被刪的排班已被收銀班次綁定(`blockedEntryIdsOf`)→ 那筆排班的填進紀錄整筆留著不清。只讀不寫。
   */
  private async planClear(
    operator: OperatorContext,
    scope: Scope,
    demandIds: readonly Types.ObjectId[],
    which: "auto" | "all",
  ): Promise<ClearPlan> {
    if (demandIds.length === 0) {
      return { assignmentIds: [], entryIds: [], touchedEntryIds: [] };
    }
    const candidates = await this.assignments.findMany(operator, {
      orgId: scope.org.id,
      demandId: { $in: [...demandIds] },
      ...(which === "auto" ? { source: "auto" } : {}),
    });
    if (candidates.length === 0) {
      return { assignmentIds: [], entryIds: [], touchedEntryIds: [] };
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
    const deleted = new Set(emptied.filter((id) => !blocked.has(id)));
    return {
      assignmentIds: removing.map((item) => item._id),
      entryIds: [...deleted],
      touchedEntryIds: [
        ...new Set(removing.map((item) => String(item.entryId))),
      ].filter((id) => !deleted.has(id)),
    };
  }

  /**
   * 清除自動排入的人時,被「延續同一人的排班」延長的排班縮回延長前的時段(使用者 10/21 定案):
   * 依執行紀錄 `extendedEntries` 由新到舊,排班目前的時間仍等於那次延長後的時間才縮回那次的延長前;
   * 延長後被手動改過(時間或休息不同)→ 不縮回、維持現狀。回縮回的排班 id。
   */
  private async shrinkExtended(
    operator: OperatorContext,
    scope: Scope,
    entryIds: readonly string[],
  ): Promise<string[]> {
    if (entryIds.length === 0) {
      return [];
    }
    const ids = entryIds.map((id) => new Types.ObjectId(id));
    const runs = await this.autoRuns.findMany(
      operator,
      { orgId: scope.org.id, "extendedEntries.entryId": { $in: ids } },
      { sort: { createdAt: -1 } },
    );
    const records = await this.entries.findMany(operator, {
      _id: { $in: ids },
    });
    const restored: {
      id: Types.ObjectId;
      startAt: number;
      endAt: number;
      breakMinutes: number;
    }[] = [];
    for (const record of records) {
      const current = {
        startAt: record.startAt.getTime(),
        endAt: record.endAt.getTime(),
        breakMinutes: record.breakMinutes,
      };
      let changed = false;
      for (const run of runs) {
        const extension = run.extendedEntries.find(
          (item) => String(item.entryId) === String(record._id),
        );
        if (extension === undefined) {
          continue;
        }
        const isSame =
          new Date(extension.after.startAt).getTime() === current.startAt &&
          new Date(extension.after.endAt).getTime() === current.endAt &&
          extension.after.breakMinutes === current.breakMinutes;
        if (!isSame) {
          break;
        }
        current.startAt = new Date(extension.before.startAt).getTime();
        current.endAt = new Date(extension.before.endAt).getTime();
        current.breakMinutes = extension.before.breakMinutes;
        changed = true;
      }
      if (changed) {
        restored.push({ id: record._id, ...current });
      }
    }
    // 每筆縮回的時間都不同:一次 bulkWrite(TX-06)
    await this.entries.bulkUpdateByIds(
      operator,
      restored.map((item) => ({
        id: item.id,
        update: {
          $set: {
            startAt: new Date(item.startAt),
            endAt: new Date(item.endAt),
            breakMinutes: item.breakMinutes,
          },
        },
      })),
    );
    return restored.map((item) => String(item.id));
  }

  /**
   * 軟刪除要清的填進紀錄與一起刪的排班(各一次 updateMany,TX-06);筆數不符(規劃後被別人刪了)
   * → `CONFLICT`,整個交易回復。
   */
  private async applyClear(
    operator: OperatorContext,
    cleared: ClearPlan,
  ): Promise<void> {
    await this.assignments.softDeleteMany(operator, cleared.assignmentIds);
    await this.entries.softDeleteMany(operator, cleared.entryIds);
  }

  // ---- 套用範本(內部) ----

  private async planApply(
    operator: OperatorContext,
    scope: Scope,
    month: string,
    request: TemplateApplyRequest,
    dates: readonly string[],
  ): Promise<TemplateApplyPlan> {
    const own = monthKeyRange(month, scope.timezone);
    const existing = await this.demands.findMany(operator, {
      orgId: scope.org.id,
      date: instantRangeFilter(own),
    });
    return planTemplateApply({
      request,
      dates,
      existing: existing.map((demand) => ({
        date: dateKeyOf(demand.date, scope.timezone),
        startAt: demand.startAt,
        endAt: demand.endAt,
        positionKey: demand.positionKey,
      })),
      closedDates: await this.closedDates(operator, scope, own),
      spanOf: (date, startTime, endTime) =>
        this.spanOf(scope, date, startTime, endTime),
    });
  }

  /** 這家店的預設人力需求週範本可以補上的(沒設定 / 停用 / 看不到 → null)。 */
  private async weekFillOf(
    operator: OperatorContext,
    scope: Scope,
    month: string,
    range: InstantRange,
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
      dateKeysOfRange(range, scope.timezone),
    );
    return { weekTemplate, plan };
  }

  /** 規劃 → 要建立的人力需求(先產生 id 與每筆執行任務的新 taskId,自動排班計算時就能引用)。 */
  private demandDocsOf(
    scope: Scope,
    plan: TemplateApplyPlan,
    source: "template" | "week-template" | "auto",
  ): DemandDoc[] {
    return plan.created.map((item) => ({
      _id: new Types.ObjectId(),
      orgId: scope.org.id,
      date: instantOfKey(item.date, scope.timezone),
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
    }));
  }

  /** 依規劃建立人力需求(複製執行任務、產生新的 taskId);已發布的月份每筆記一筆異動。 */
  private async createDemands(
    operator: OperatorContext,
    scope: Scope,
    plan: TemplateApplyPlan,
    docs: readonly DemandDoc[],
    reason: ChangeReason | null,
  ): Promise<void> {
    const source = docs[0]?.source ?? null;
    const created = await this.demands.createMany(operator, docs);
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
    // 每筆需求一列異動,一次寫入(TX-06)
    await this.changes.recordMany(
      operator,
      scope,
      reason,
      created.map((record) => ({
        month: monthKeyOf(dateKeyOf(record.date, scope.timezone)),
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
      })),
    );
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
    if (parseLocalMonth(month) === null) {
      throw validationError(`invalid month: ${month}`, ["month"]);
    }
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const timezone = await tenantTimezoneOf(this.orgs, operator, org.tenantId);
    return { org, timezone };
  }

  /**
   * 某天(日期鍵)的範本時段 `HH:mm`–`HH:mm` → 時點(租戶時區;`instantOfLocalHhMm`)。
   * 結束不晚於開始 = 跨午夜,結束算隔天(含結束 00:00 = 隔天 00:00)。
   * 範本的時刻存檔時已驗過;讀到不合法的 → `VALIDATION_FAILED`(欄位 `templateIds`),不當成 00:00。
   */
  private spanOf(
    scope: Scope,
    date: string,
    startTime: string,
    endTime: string,
  ): { startAt: Date; endAt: Date } {
    const day = localDateOfKey(date);
    const start = minutesOfHhMm(startTime);
    const end = minutesOfHhMm(endTime);
    if (start === null || end === null) {
      throw validationError(`invalid template time: ${startTime}–${endTime}`, [
        "templateIds",
      ]);
    }
    const startAt = instantOfLocalHhMm(day, startTime, scope.timezone);
    const endAt = instantOfLocalHhMm(
      end <= start ? addLocalDays(day, 1) : day,
      endTime,
      scope.timezone,
    );
    if (startAt === null || endAt === null) {
      throw validationError(`invalid template time: ${startTime}–${endTime}`, [
        "templateIds",
      ]);
    }
    return { startAt: new Date(startAt), endAt: new Date(endAt) };
  }

  /** 範圍內店休的日子(日期鍵);跨午夜的班會碰到隔天,多讀一天。 */
  private async closedDates(
    operator: OperatorContext,
    scope: Scope,
    range: InstantRange,
  ): Promise<Set<string>> {
    const days = await this.calendar.effectiveDays(operator, scope.org.id, {
      from: range.from,
      to: instantOfKey(
        shiftDateKey(dateKeyOf(range.to, scope.timezone), 1),
        scope.timezone,
      ).getTime(),
    });
    return new Set(
      days
        .filter((day) => day.type === "closed")
        .map((day) => dateKeyOf(day.date, scope.timezone)),
    );
  }

  /** 範圍內、不是店休那天的人力需求。 */
  private async openDemands(
    operator: OperatorContext,
    scope: Scope,
    range: InstantRange,
    closed: ReadonlySet<string>,
  ): Promise<DemandRecord[]> {
    const records = await this.demands.findMany(
      operator,
      { orgId: scope.org.id, date: instantRangeFilter(range) },
      { sort: { startAt: 1 } },
    );
    return records.filter(
      (record) => !closed.has(dateKeyOf(record.date, scope.timezone)),
    );
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
    options: {
      allowPublished: boolean;
      /** 自動排班:自己標的鎖(時點)與標記後的 `version`(這次 $inc 後要剛好多 1) */
      ownLock?: { lockedAt: Date; version: number };
    },
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
    if (options.ownLock === undefined) {
      if (isAutoRunLocked(touched, this.clock.now())) {
        throw autoRunBlockedError("AUTO_RUN_IN_PROGRESS");
      }
    } else if (
      touched.lockedAt?.getTime() !== options.ownLock.lockedAt.getTime() ||
      touched.version !== options.ownLock.version + 1
    ) {
      // 自己的鎖已經不在(計算期間逾時、被別人重新標記),或鎖逾時期間別人寫了這個月
      // (version 多了,交易外算好的計畫已過期)→ 不寫入
      throw autoRunBlockedError("AUTO_RUN_IN_PROGRESS");
    }
    const published = touched.status === "published";
    if (published && !options.allowPublished) {
      throw autoRunBlockedError("ALREADY_PUBLISHED");
    }
    return published;
  }

  /**
   * 條件更新標記鎖定(未發布、沒鎖或已逾時),回標記的時點與當時的 `version`;
   * 拿不到 → 依狀況回已發布 / 執行中。
   */
  private async acquireLock(
    operator: OperatorContext,
    scope: Scope,
    month: string,
  ): Promise<{ lockedAt: Date; version: number }> {
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
      return { lockedAt: now, version: locked.version };
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
    from: Date;
    to: Date;
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

/**
 * 範圍 `[from, to)`(以租戶時區正規化成 00:00)要在這個月內、迄晚於起;
 * 否則 `VALIDATION_FAILED`(欄位 `from` / `to`)。
 */
function validatedRange(
  input: { month: string; from: Date; to: Date },
  timezone: string,
): InstantRange {
  const range = normalizedDayRange(input.from, input.to, timezone);
  const month = monthKeyRange(input.month, timezone);
  if (range.from < month.from || range.to > month.to) {
    throw validationError(
      `range not in ${input.month}: ${new Date(range.from).toISOString()}–${new Date(range.to).toISOString()}`,
      ["from", "to"],
    );
  }
  return range;
}

/** 方式要是三種之一;條件只能是自動排班條件、每條最多一次(沒列的 = 不勾)。 */
function validatedRunPlan(
  input: RunScheduleAutoRunInput,
  timezone: string,
): RunPlan {
  const range = validatedRange(input, timezone);
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
    range,
    mode,
    // 記下這次實際用的整組條件與順序:沒列的補在後面、視為不勾
    conditions: [
      ...input.conditions.map((condition) => ({
        key: condition.key,
        enabled: condition.enabled,
      })),
      ...[...AUTO_RUN_CONDITION_KEYS]
        .filter((key) => !keys.includes(key))
        .map((key) => ({ key, enabled: false })),
    ],
    fillWeekTemplate: input.fillWeekTemplate === true,
  };
}

/** 套用到的日子(時點,以租戶時區正規化)→ 日期鍵;都要是這個月的日子,否則 `VALIDATION_FAILED`。 */
function validatedDates(
  dates: readonly Date[],
  month: string,
  timezone: string,
): string[] {
  const keys = dates.map((date) =>
    dateKeyOf(normalizedDay(date, timezone, "dates"), timezone),
  );
  if (keys.length === 0 || keys.some((key) => monthKeyOf(key) !== month)) {
    throw validationError("dates must be days of this month", ["dates"]);
  }
  return [...new Set(keys)];
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
      throw validationError(
        "unknown demand templates",
        ["templateIds"],
        SCHEDULE_REASONS.referenceNotFound,
      );
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
      throw validationError(
        `unknown week template: ${id}`,
        ["weekTemplateId"],
        SCHEDULE_REASONS.referenceNotFound,
      );
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

/** 自動排班核心吃的人力需求(`date` = 租戶時區的日期鍵)。 */
function autoDemandOf(
  record: DemandRecord | DemandDoc,
  timezone: string,
): AutoDemand {
  return {
    id: String(record._id),
    date: dateKeyOf(record.date, timezone),
    startAt: record.startAt,
    endAt: record.endAt,
    tasks: record.tasks.map((task) => ({
      taskId: task.taskId,
      role: task.role,
    })),
  };
}

/** 自動排班核心吃的排班(`date` = 租戶時區的日期鍵)。 */
function autoEntryOf(record: EntryRecord, timezone: string) {
  return {
    id: String(record._id),
    userId: String(record.userId),
    orgId: String(record.orgId),
    date: dateKeyOf(record.date, timezone),
    startAt: record.startAt,
    endAt: record.endAt,
    breakMinutes: record.breakMinutes,
  };
}
