import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { type InstantRange, localDayRange } from "@repo/domain/form";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  SCHEDULE_TASK_ROLES,
  exceededTaskRoles,
} from "@repo/domain/project/schedule-settings";

import { AuditService } from "../../../audit/audit.service";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { TransactionService } from "../../../database/transaction";
import {
  ScheduleAttendancePunchesRepository,
  ScheduleDemandsRepository,
  ScheduleEntriesRepository,
  SchedulePeriodsRepository,
  ScheduleTaskAssignmentsRepository,
} from "../../database/schedule/roster.repositories";
import type { ScheduleTemplateTask } from "../../database/schedule/schedule-demand-template.schema";
import { ScheduleDemandTemplatesRepository } from "../../database/schedule/schedule.repositories";
import {
  type PunchRecord,
  SchedulePunchLedger,
} from "../attendance/punch-ledger";
import {
  autoRunInProgressError,
  isAutoRunLocked,
} from "../auto-run/period-lock";
import { ScheduleCalendarService } from "../calendar/schedule-calendar.service";
import {
  type ChangeReason,
  type ChangeReasonInputLike,
  type ScheduleChangeRecord,
  ScheduleChangesService,
} from "../changes/schedule-changes.service";
import {
  ScheduleCheckService,
  rosterRuleError,
} from "../check/schedule-check.service";
import { ScheduleDayOffsService } from "../day-offs/schedule-day-offs.service";
import { ScheduleFieldOptionsService } from "../field-options/schedule-field-options.service";
import { blockedEntryIdsOf } from "../integration/entry-deletion-guards";
import { positionAnnotationsOf } from "../integration/position-annotations";
import { ScheduleClock } from "../shared/schedule-clock";
import {
  clockTextOf,
  dateKeyOf,
  dayKeyRange,
  dayStartOf,
  localDateOfKey,
  monthKeyOf,
  normalizedDay,
} from "../shared/schedule-dates";
import {
  SCHEDULE_REASONS,
  forbiddenError,
  isDuplicateKeyError,
  notFoundError,
  savingUnique,
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
import { ScheduleTemplatesService } from "../templates/schedule-templates.service";
import type {
  DeleteScheduleDemandInput,
  DeleteScheduleEntryInput,
  RemoveScheduleDayEntriesInput,
  SaveScheduleDemandInput,
  SaveScheduleEntryInput,
} from "./dto/schedule-roster.input";
import type {
  DeleteScheduleDemandPayload,
  RemoveScheduleDayEntriesPayload,
  SaveScheduleDemandPayload,
  ScheduleEntryModel,
} from "./models/schedule-roster.model";
import { entriesLockedError } from "./roster-error";
import {
  type DemandRecord,
  demandModelOf,
  entryModelOf,
} from "./roster-models";
import { type EntryRecord, RosterPeopleReader } from "./roster-people";

const DEMAND_TARGET = "schedule_demand";
const ENTRY_TARGET = "schedule_entry";

/** 一筆人力需求 / 排班最長 24 小時。 */
const MAX_SPAN_MS = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60_000;

/** 寫入針對的分店與它的時區。 */
interface RosterScope {
  org: ScheduleOrg;
  timezone: string;
}

/**
 * 排班表的寫入(規格 14.4「手動新增」、14.5「兩種對話框」「移除這天所有排班」;
 * 正本 `docs/modules/project/schedule.md`「排班表」)。
 *
 * - 人力需求:一組執行任務;修改 / 刪除時解除被拿掉的任務上的人,解除後變成零筆的排班一起刪除
 *   (被收銀班次綁定的擋下,`blockedEntryIdsOf`)
 * - 排班:至少填進一筆;一筆執行任務只填一人、同一筆人力需求只能填一筆(唯一索引再擋同時送出);
 *   一個人同一時間只有一筆排班,跨店也不能重疊(`RosterPeopleReader.overlapping`)
 * - 同一家店同一個月的寫入在交易一開始碰 `schedule_periods.version`,同時送出的互相衝突、重跑;
 *   寫排班另先碰這個人的守門文件(`schedule_entry_locks`),兩家店同時排同一人也互相衝突
 * - 存排班時跑這個人的排班類規則:存檔後限制的違反比存檔前嚴重 → `VALIDATION_FAILED`(欄位 `rules`,
 *   `extensions.violations`;`ScheduleCheckService.limitViolationsOfEntry`)
 * - 已發布的月份:要給異動原因,每筆異動寫 `schedule_changes` 並通知牽涉的人(`ScheduleChangesService`)
 */
@Injectable()
export class ScheduleRosterWritesService {
  constructor(
    private readonly demands: ScheduleDemandsRepository,
    private readonly entries: ScheduleEntriesRepository,
    private readonly assignments: ScheduleTaskAssignmentsRepository,
    private readonly periods: SchedulePeriodsRepository,
    private readonly templateRecords: ScheduleDemandTemplatesRepository,
    private readonly orgs: OrgsRepository,
    private readonly permissions: SchedulePermissions,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
    private readonly fieldOptions: ScheduleFieldOptionsService,
    private readonly staff: ScheduleStaffService,
    private readonly calendar: ScheduleCalendarService,
    private readonly dayOffs: ScheduleDayOffsService,
    private readonly templates: ScheduleTemplatesService,
    private readonly people: RosterPeopleReader,
    private readonly personLocks: SchedulePersonLocks,
    private readonly checks: ScheduleCheckService,
    private readonly changes: ScheduleChangesService,
    private readonly clock: ScheduleClock,
    private readonly punches: ScheduleAttendancePunchesRepository,
    private readonly punchLedger: SchedulePunchLedger,
  ) {}

  // ---- 人力需求 ----

  async saveDemand(
    operator: OperatorContext,
    input: SaveScheduleDemandInput,
  ): Promise<SaveScheduleDemandPayload> {
    const scope = await this.scopeOf(operator, input.orgId);
    const span = validatedSpan(input.startAt, input.endAt);
    const date = this.dayOf(scope, span.startAt);
    const isCreate = input.id === undefined || input.id === null;
    const tasksInput = validatedTasks(input.tasks);
    const positionKey = input.positionKey.trim();
    if (positionKey === "") {
      throw validationError("positionKey is required", ["positionKey"]);
    }
    await this.fieldOptions.assertOptions(operator, [
      {
        categoryKey: SCHEDULE_FIELD_CATEGORY_KEYS.position,
        value: positionKey,
        field: "positionKey",
      },
      ...tasksInput.map((task) => ({
        categoryKey: SCHEDULE_FIELD_CATEGORY_KEYS.task,
        value: task.taskKey,
        field: "tasks",
      })),
    ]);
    const existing = isCreate
      ? null
      : await this.mustFindDemand(operator, scope, String(input.id));
    // 店休那天不能建人力需求(跨午夜連隔天);店休日既有的那筆也不能原地改,只能刪除
    await this.assertOpen(operator, scope, span, "demand");
    const templateId =
      isCreate && input.templateId !== undefined && input.templateId !== null
        ? await this.visibleTemplateId(operator, scope, input.templateId)
        : null;
    const copy = isCreate ? (input.saveAsTemplate ?? null) : null;
    if (copy !== null) {
      const holds = await this.permissions.holderOf(operator);
      if (!holds(SCHEDULE_PERMISSIONS.editTemplates)) {
        throw forbiddenError(
          "saving as a demand template needs edit-templates",
          "MISSING_PERMISSION",
        );
      }
    }

    // 執行任務:沿用既有的 taskId(職責不能改)、新的產生新 id
    const tasks = mergedTasks(existing?.tasks ?? [], tasksInput);
    const keptTaskIds = new Set(tasks.map((task) => task.taskId));
    const removedTaskIds = (existing?.tasks ?? [])
      .map((task) => task.taskId)
      .filter((taskId) => !keptTaskIds.has(taskId));

    const months = [
      ...new Set([
        this.monthOf(scope, date),
        ...(existing ? [this.monthOf(scope, existing.date)] : []),
      ]),
    ];
    await this.ensurePeriods(operator, scope, months);
    const { saved, deletedEntryIds } = await savingUnique(
      () =>
        this.transactions.withTransaction(async () => {
          const published = await this.touchPeriods(operator, scope, months);
          const reason = await this.reasonIfPublished(
            operator,
            published,
            input.changeReason,
          );
          const fillersBefore = await this.fillersOf(operator, existing);
          if (existing && existing.date.getTime() !== date.getTime()) {
            const filled = await this.assignments.count(operator, {
              demandId: existing._id,
            });
            if (filled > 0) {
              throw validationError(
                "a demand with assigned people cannot move to another day",
                ["startAt"],
                SCHEDULE_REASONS.demandHasAssignments,
              );
            }
          }
          const released = existing
            ? await this.releaseTasks(operator, scope, existing, removedTaskIds)
            : [];
          let copiedTemplateId: Types.ObjectId | null = null;
          if (copy !== null) {
            const template = await this.templates.saveTemplate(operator, {
              name: copy.name,
              shortName: copy.shortName,
              startTime: this.hhmmOf(scope, span.startAt),
              endTime: this.hhmmOf(scope, span.endAt),
              positionKey,
              tasks: tasks.map((task) => ({
                role: task.role,
                taskKey: task.taskKey,
              })),
              paletteKey: null,
            });
            copiedTemplateId = new Types.ObjectId(template.id);
          }
          const data = {
            date,
            startAt: span.startAt,
            endAt: span.endAt,
            positionKey,
            tasks,
          };
          const record = existing
            ? await this.demands.updateById(operator, existing._id, {
                $set: data,
              })
            : await this.demands.create(operator, {
                orgId: scope.org.id,
                ...data,
                templateId: copiedTemplateId ?? templateId,
                source: "manual",
              });
          if (!record) {
            throw notFoundError(`demand not found: ${String(input.id)}`);
          }
          await this.audit.record(operator, {
            action: existing
              ? "schedule-demand.edit"
              : "schedule-demand.create",
            targetType: DEMAND_TARGET,
            targetId: record._id,
            before: existing ? demandAuditOf(existing) : undefined,
            after: { ...demandAuditOf(record), deletedEntries: released },
          });
          await this.recordChange(operator, scope, reason, published, {
            date,
            previousDate: existing?.date ?? null,
            action: existing ? "demand.edit" : "demand.create",
            targetId: record._id,
            userIds: fillersBefore,
            before: existing ? demandAuditOf(existing) : null,
            after: { ...demandAuditOf(record), deletedEntries: released },
          });
          return { saved: record, deletedEntryIds: released };
        }),
      "task already assigned (concurrent write)",
      ["tasks"],
      SCHEDULE_REASONS.taskTaken,
    );
    return {
      item: await this.demandModel(operator, scope, saved),
      deletedEntryIds,
    };
  }

  async deleteDemand(
    operator: OperatorContext,
    input: DeleteScheduleDemandInput,
  ): Promise<DeleteScheduleDemandPayload> {
    const scope = await this.scopeOf(operator, input.orgId);
    // 交易外先讀一次:要知道月份(先建狀態文件)
    const found = await this.mustFindDemand(operator, scope, input.id);
    const months = [this.monthOf(scope, found.date)];
    await this.ensurePeriods(operator, scope, months);
    const deletedEntryIds = await this.transactions.withTransaction(
      async () => {
        const published = await this.touchPeriods(operator, scope, months);
        // 碰過狀態文件後再讀一次:同時刪同一筆時,後到的一方讀不到 → NOT_FOUND(不重複記稽核 / 異動 / 通知)
        const existing = await this.mustFindDemand(operator, scope, input.id);
        const reason = await this.reasonIfPublished(
          operator,
          published,
          input.changeReason,
        );
        const fillers = await this.fillersOf(operator, existing);
        const released = await this.releaseTasks(
          operator,
          scope,
          existing,
          existing.tasks.map((task) => task.taskId),
        );
        await this.demands.softDeleteById(operator, existing._id);
        await this.audit.record(operator, {
          action: "schedule-demand.delete",
          targetType: DEMAND_TARGET,
          targetId: existing._id,
          before: demandAuditOf(existing),
          after: { deletedEntries: released },
        });
        if (reason !== null) {
          await this.changes.record(operator, scope, reason, {
            month: this.monthOf(scope, existing.date),
            date: existing.date,
            action: "demand.delete",
            targetId: existing._id,
            userIds: fillers,
            before: demandAuditOf(existing),
            after: null,
          });
        }
        return released;
      },
    );
    return { id: String(found._id), deletedEntryIds };
  }

  // ---- 排班 ----

  async saveEntry(
    operator: OperatorContext,
    input: SaveScheduleEntryInput,
  ): Promise<ScheduleEntryModel> {
    const scope = await this.scopeOf(operator, input.orgId);
    const wanted = validatedAssignments(input.assignments);
    const isCreate = input.id === undefined || input.id === null;
    const existing = isCreate
      ? null
      : await this.mustFindEntry(operator, scope, String(input.id));
    const userId = existing
      ? existing.userId
      : parseObjectId(input.userId ?? "", "userId");
    const chosenPunches = await this.chosenPunches(
      operator,
      scope,
      userId,
      input.punchIds,
    );
    const span = validatedSpan(
      ...(await this.spanWithPunchTime(operator, input, chosenPunches)),
    );
    const date = this.dayOf(scope, span.startAt);
    const spanMinutes =
      (span.endAt.getTime() - span.startAt.getTime()) / MS_PER_MINUTE;
    if (
      !Number.isInteger(input.breakMinutes) ||
      input.breakMinutes < 0 ||
      input.breakMinutes >= spanMinutes
    ) {
      throw validationError("invalid breakMinutes", ["breakMinutes"]);
    }
    const candidates = await this.staff.listScheduleCandidates(
      operator,
      scope.org.id,
    );
    const candidate = candidates.find((item) => item.userId === String(userId));
    if (!existing && candidate === undefined) {
      throw validationError(
        `not a schedule candidate: ${String(userId)}`,
        ["userId"],
        SCHEDULE_REASONS.notCandidate,
      );
    }
    // 店休那天不能排;跨午夜的班連隔天一起看(同畫休)
    await this.assertOpen(operator, scope, span, "entry");

    const months = [
      ...new Set([
        this.monthOf(scope, date),
        ...(existing ? [this.monthOf(scope, existing.date)] : []),
      ]),
    ];
    await this.ensurePeriods(operator, scope, months);
    await this.personLocks.ensure(operator, scope.org.tenantId, userId);
    const saved = await savingUnique(
      () =>
        this.transactions.withTransaction(async () => {
          // 先碰這個人的守門文件(跨店同時排同一人互相衝突),再碰這家店這個月的
          await this.personLocks.touch(operator, scope.org.tenantId, userId);
          const published = await this.touchPeriods(operator, scope, months);
          const reason = await this.reasonIfPublished(
            operator,
            published,
            input.changeReason,
          );
          const current = existing
            ? await this.assignments.findMany(operator, {
                entryId: existing._id,
              })
            : [];
          await this.assertAssignable(operator, scope, {
            date,
            wanted,
            current,
            canLead: candidate?.canLead === true,
            excludeEntryId: existing?._id ?? null,
          });
          await this.assertAvailable(operator, scope, userId, span);
          const overlap = await this.people.overlapping(
            operator,
            scope.org.tenantId,
            userId,
            span.startAt,
            span.endAt,
            existing?._id ?? null,
          );
          if (overlap.length > 0) {
            throw validationError(
              "overlaps another schedule entry",
              ["startAt"],
              SCHEDULE_REASONS.entryOverlap,
            );
          }
          const ruleViolations = await this.checks.limitViolationsOfEntry(
            operator,
            scope.org,
            {
              userId,
              entryId: existing?._id ?? null,
              before: existing
                ? {
                    date: this.keyOf(scope, existing.date),
                    demandIds: current.map((item) => item.demandId),
                  }
                : null,
              after: {
                ...span,
                date: this.keyOf(scope, date),
                breakMinutes: input.breakMinutes,
                demandIds: wanted.map((item) => item.demandId),
              },
            },
          );
          if (ruleViolations.length > 0) {
            throw rosterRuleError(ruleViolations, scope.timezone);
          }
          const data = {
            date,
            startAt: span.startAt,
            endAt: span.endAt,
            breakMinutes: input.breakMinutes,
          };
          const record = existing
            ? await this.entries.updateById(operator, existing._id, {
                $set: data,
              })
            : await this.entries.create(operator, {
                orgId: scope.org.id,
                userId,
                ...data,
              });
          if (!record) {
            throw notFoundError(`entry not found: ${String(input.id)}`);
          }
          await this.syncAssignments(operator, scope, record, current, wanted);
          if (chosenPunches.length > 0) {
            await this.punchLedger.reassign(
              operator,
              scope.org.tenantId,
              chosenPunches,
              { entryId: record._id, orgId: scope.org.id },
            );
          }
          await this.audit.record(operator, {
            action: existing ? "schedule-entry.edit" : "schedule-entry.create",
            targetType: ENTRY_TARGET,
            targetId: record._id,
            before: existing
              ? entryAuditOf(existing, keysOf(current))
              : undefined,
            after: entryAuditOf(record, keysOf(wanted)),
          });
          await this.recordChange(operator, scope, reason, published, {
            date,
            previousDate: existing?.date ?? null,
            action: existing ? "entry.edit" : "entry.create",
            targetId: record._id,
            userIds: [userId],
            before: existing ? entryAuditOf(existing, keysOf(current)) : null,
            after: entryAuditOf(record, keysOf(wanted)),
          });
          return record;
        }),
      "task already assigned (concurrent write)",
      ["assignments"],
      SCHEDULE_REASONS.taskTaken,
    );
    return this.entryModel(operator, scope, saved);
  }

  async deleteEntry(
    operator: OperatorContext,
    input: DeleteScheduleEntryInput,
  ): Promise<string> {
    const scope = await this.scopeOf(operator, input.orgId);
    // 交易外先讀一次:要知道月份(先建狀態文件)與是否被收銀班次綁定
    const found = await this.mustFindEntry(operator, scope, input.id);
    const blocked = await blockedEntryIdsOf(String(scope.org.tenantId), [
      String(found._id),
    ]);
    if (blocked.size > 0) {
      throw entriesLockedError([...blocked], ["id"]);
    }
    const months = [this.monthOf(scope, found.date)];
    await this.ensurePeriods(operator, scope, months);
    await this.transactions.withTransaction(async () => {
      const published = await this.touchPeriods(operator, scope, months);
      // 碰過狀態文件後再讀一次:同時刪同一筆時,後到的一方讀不到 → NOT_FOUND(不重複記稽核 / 異動)
      const existing = await this.mustFindEntry(operator, scope, input.id);
      const reason = await this.reasonIfPublished(
        operator,
        published,
        input.changeReason,
      );
      await this.removeEntries(operator, [existing]);
      if (reason !== null) {
        await this.recordEntryDeletions(operator, scope, reason, [existing]);
      }
    });
    return String(found._id);
  }

  /** 移除這天所有排班(颱風停班等):已被開班綁定的略過並列出。 */
  async removeDayEntries(
    operator: OperatorContext,
    input: RemoveScheduleDayEntriesInput,
  ): Promise<RemoveScheduleDayEntriesPayload> {
    const scope = await this.scopeOf(operator, input.orgId);
    const date = normalizedDay(input.date, scope.timezone, "date");
    const months = [this.monthOf(scope, date)];
    await this.ensurePeriods(operator, scope, months);
    return this.transactions.withTransaction(async () => {
      const published = await this.touchPeriods(operator, scope, months);
      const reason = await this.reasonIfPublished(
        operator,
        published,
        input.changeReason,
      );
      const records = await this.entries.findMany(operator, {
        orgId: scope.org.id,
        date,
      });
      const blocked = await blockedEntryIdsOf(
        String(scope.org.tenantId),
        records.map((record) => String(record._id)),
      );
      const removable = records.filter(
        (record) => !blocked.has(String(record._id)),
      );
      await this.removeEntries(operator, removable);
      if (reason !== null) {
        await this.recordEntryDeletions(operator, scope, reason, removable);
      }
      return {
        deletedIds: removable.map((record) => String(record._id)),
        skippedIds: [...blocked],
      };
    });
  }

  // ---- 內部 ----

  /**
   * 排班對話框勾選的未對應排班的打卡(規格 14.5「排班對話框的區塊」):要是這個人在這家店、還沒對應排班的卡;
   * 有一張不是 → `VALIDATION_FAILED`(欄位 `punchIds`)。
   */
  private async chosenPunches(
    operator: OperatorContext,
    scope: RosterScope,
    userId: Types.ObjectId,
    punchIds: readonly string[] | null | undefined,
  ): Promise<PunchRecord[]> {
    const ids = [...new Set(punchIds)];
    if (ids.length === 0) {
      return [];
    }
    const found = await this.punches.findMany(operator, {
      _id: { $in: ids.map((id) => parseObjectId(id, "punchIds")) },
      orgId: scope.org.id,
      userId,
      entryId: null,
    });
    if (found.length !== ids.length) {
      throw validationError(
        "punch not found or already matched",
        ["punchIds"],
        SCHEDULE_REASONS.punchUnavailable,
      );
    }
    return found;
  }

  /**
   * 「上下班時間改用打卡時間」(要 `use-punch-time`,沒有 → `FORBIDDEN`):上班 = 勾選的上班卡中最早的、
   * 下班 = 勾選的下班卡中最晚的;沒勾那一種就照送來的時間。
   */
  private async spanWithPunchTime(
    operator: OperatorContext,
    input: SaveScheduleEntryInput,
    punches: readonly PunchRecord[],
  ): Promise<[Date, Date]> {
    if (input.usePunchTime !== true) {
      return [input.startAt, input.endAt];
    }
    const holds = await this.permissions.holderOf(operator);
    if (!holds(SCHEDULE_PERMISSIONS.usePunchTime)) {
      throw forbiddenError(
        "missing permission schedule.manage.use-punch-time",
        "MISSING_PERMISSION",
      );
    }
    const times = (type: string) =>
      punches
        .filter((punch) => punch.type === type)
        .map((punch) => punch.at.getTime());
    const ins = times("in");
    const outs = times("out");
    return [
      ins.length === 0 ? input.startAt : new Date(Math.min(...ins)),
      outs.length === 0 ? input.endAt : new Date(Math.max(...outs)),
    ];
  }

  /**
   * 店休那天不能排班、也不能建人力需求:碰到的日子(跨午夜含隔天)以這家店的生效行事曆為準
   * (上層設的店休往下沿用)→ 欄位 `startAt`、`STORE_CLOSED`。
   */
  private async assertOpen(
    operator: OperatorContext,
    scope: RosterScope,
    span: { startAt: Date; endAt: Date },
    target: "entry" | "demand",
  ): Promise<void> {
    const calendarDays = await this.calendar.effectiveDays(
      operator,
      scope.org.id,
      this.daysOfSpan(scope, span),
    );
    if (calendarDays.some((day) => day.type === "closed")) {
      throw validationError(
        `store is closed on a day of this ${target}`,
        ["startAt"],
        SCHEDULE_REASONS.storeClosed,
      );
    }
  }

  /**
   * 畫休那段時間不能排(規格 14.5「可排 = 那段時間沒有畫休」;做法同店休):排班碰到的日子(跨午夜含隔天)
   * 有整天畫休、或和時段不可排重疊(頭尾相接不算)→ `VALIDATION_FAILED`(欄位 `startAt`)。
   * 以租戶 + 人查(`unavailableOfPerson`,不經這家店的候選人):修改舊排班時那個人已經不能排這家店,一樣要擋。
   */
  private async assertAvailable(
    operator: OperatorContext,
    scope: RosterScope,
    userId: Types.ObjectId,
    span: { startAt: Date; endAt: Date },
  ): Promise<void> {
    const days = await this.dayOffs.unavailableOfPerson(
      scope.org.tenantId,
      userId,
      this.daysOfSpan(scope, span),
    );
    const start = span.startAt.getTime();
    const end = span.endAt.getTime();
    const blocked = days.some((day) => {
      if (day.fullDay) {
        // 整天 = 租戶時區那天 00:00 到隔天 00:00
        const local = localDateOfKey(this.keyOf(scope, day.date));
        const whole = localDayRange(local, local, scope.timezone);
        return start < whole.to && end > whole.from;
      }
      return day.slots.some(
        (slot) => start < slot.endAt.getTime() && end > slot.startAt.getTime(),
      );
    });
    if (blocked) {
      throw validationError(
        "overlaps a day off of this person",
        ["startAt"],
        SCHEDULE_REASONS.dayOffConflict,
      );
    }
  }

  /**
   * 要填的執行任務:這家店這一天的人力需求裡真的有這筆任務;負責人任務要可以擔任負責人(原本就填著的不再檢查);
   * 別筆排班已經填了 → `VALIDATION_FAILED`(欄位 `assignments`)。
   */
  private async assertAssignable(
    operator: OperatorContext,
    scope: RosterScope,
    check: {
      date: Date;
      wanted: readonly WantedAssignment[];
      current: readonly WantedAssignment[];
      canLead: boolean;
      excludeEntryId: Types.ObjectId | null;
    },
  ): Promise<void> {
    const demands = await this.demands.findMany(operator, {
      _id: { $in: check.wanted.map((item) => item.demandId) },
      orgId: scope.org.id,
    });
    const currentKeys = new Set(keysOf(check.current));
    for (const item of check.wanted) {
      const demand = demands.find(
        (record) => String(record._id) === String(item.demandId),
      );
      const task = demand?.tasks.find((t) => t.taskId === item.taskId);
      if (!demand || !task || demand.date.getTime() !== check.date.getTime()) {
        throw validationError(
          `demand task not on this day: ${String(item.demandId)}/${item.taskId}`,
          ["assignments"],
          SCHEDULE_REASONS.taskNotOnDay,
        );
      }
      if (
        task.role === "leader" &&
        !check.canLead &&
        !currentKeys.has(assignmentKey(item))
      ) {
        throw validationError(
          "this person cannot lead",
          ["assignments"],
          SCHEDULE_REASONS.cannotLead,
        );
      }
    }
    const taken = await this.assignments.findMany(operator, {
      $or: check.wanted.map((item) => ({
        demandId: item.demandId,
        taskId: item.taskId,
      })),
      ...(check.excludeEntryId === null
        ? {}
        : { entryId: { $ne: check.excludeEntryId } }),
    });
    if (taken.length > 0) {
      throw validationError(
        "task already assigned",
        ["assignments"],
        SCHEDULE_REASONS.taskTaken,
      );
    }
  }

  /**
   * 填進紀錄改成 `wanted`:拿掉的軟刪除、新的建立(手動)。留下來的自動填進 → 來源改成手動
   * (規格 14.1:自動填進的被手動改過 → source 改成手動,自動排入標記消失;`autoRunId` / `reason` 照留著追查)。
   */
  private async syncAssignments(
    operator: OperatorContext,
    scope: RosterScope,
    entry: EntryRecord,
    current: readonly (WantedAssignment & {
      _id: Types.ObjectId;
      source: string;
    })[],
    wanted: readonly WantedAssignment[],
  ): Promise<void> {
    const wantedKeys = new Set(keysOf(wanted));
    const currentKeys = new Set(keysOf(current));
    for (const item of current) {
      if (!wantedKeys.has(assignmentKey(item))) {
        await this.assignments.softDeleteById(operator, item._id);
      } else if (item.source === "auto") {
        await this.assignments.updateById(operator, item._id, {
          $set: { source: "manual" },
        });
      }
    }
    for (const item of wanted) {
      if (!currentKeys.has(assignmentKey(item))) {
        await this.assignments.create(operator, {
          orgId: scope.org.id,
          entryId: entry._id,
          demandId: item.demandId,
          taskId: item.taskId,
          source: "manual",
          autoRunId: null,
          reason: null,
        });
      }
    }
  }

  private async scopeOf(
    operator: OperatorContext,
    orgId: string | null | undefined,
  ): Promise<RosterScope> {
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const timezone = await tenantTimezoneOf(this.orgs, operator, org.tenantId);
    return { org, timezone };
  }

  /** 開始時點在租戶時區那一天的 00:00(排班 / 人力需求的 `date`;跨午夜的算開始那天)。 */
  private dayOf(scope: RosterScope, at: Date): Date {
    return dayStartOf(at, scope.timezone);
  }

  /** 日期(時點)→ 租戶時區的日期鍵(規則運算用)。 */
  private keyOf(scope: RosterScope, date: Date): string {
    return dateKeyOf(date, scope.timezone);
  }

  /** 日期(時點)所在的月份鍵 `YYYY-MM`(`schedule_periods` 的鍵)。 */
  private monthOf(scope: RosterScope, date: Date): string {
    return monthKeyOf(this.keyOf(scope, date));
  }

  /** 一段時間碰到的日子(跨午夜含隔天):`[開始那天 00:00, 結束前一刻那天的隔天 00:00)`。 */
  private daysOfSpan(
    scope: RosterScope,
    span: { startAt: Date; endAt: Date },
  ): InstantRange {
    return dayKeyRange(
      this.keyOf(scope, span.startAt),
      this.keyOf(scope, new Date(span.endAt.getTime() - 1)),
      scope.timezone,
    );
  }

  private hhmmOf(scope: RosterScope, at: Date): string {
    return clockTextOf(at, scope.timezone);
  }

  private async mustFindDemand(
    operator: OperatorContext,
    scope: RosterScope,
    id: string,
  ): Promise<DemandRecord> {
    const record = await this.demands.findOne(operator, {
      _id: parseObjectId(id, "id"),
      orgId: scope.org.id,
    });
    if (!record) {
      throw notFoundError(`demand not found: ${id}`);
    }
    return record;
  }

  private async mustFindEntry(
    operator: OperatorContext,
    scope: RosterScope,
    id: string,
  ): Promise<EntryRecord> {
    const record = await this.entries.findOne(operator, {
      _id: parseObjectId(id, "id"),
      orgId: scope.org.id,
    });
    if (!record) {
      throw notFoundError(`entry not found: ${id}`);
    }
    return record;
  }

  /** 範本要是這家店組織鏈上看得到的;否則 `VALIDATION_FAILED`(欄位 `templateId`)。 */
  private async visibleTemplateId(
    operator: OperatorContext,
    scope: RosterScope,
    id: string,
  ): Promise<Types.ObjectId> {
    const record = await this.templateRecords.findOne(operator, {
      _id: parseObjectId(id, "templateId"),
      orgId: { $in: scope.org.chain },
    });
    if (!record) {
      throw validationError(
        `template not visible: ${id}`,
        ["templateId"],
        SCHEDULE_REASONS.referenceNotFound,
      );
    }
    return record._id;
  }

  /**
   * 解除人力需求這些執行任務上的人;解除後變成零筆的排班一起刪除(規格 14.5:排班至少要填進一筆)。
   * 其中被收銀班次綁定的 → 整筆擋下並列出。回刪除的排班 id。
   */
  private async releaseTasks(
    operator: OperatorContext,
    scope: RosterScope,
    demand: DemandRecord,
    taskIds: readonly string[],
  ): Promise<string[]> {
    if (taskIds.length === 0) {
      return [];
    }
    const released = await this.assignments.findMany(operator, {
      demandId: demand._id,
      taskId: { $in: [...taskIds] },
    });
    if (released.length === 0) {
      return [];
    }
    const entryIds = [...new Set(released.map((item) => String(item.entryId)))];
    const remaining = await this.assignments.findMany(operator, {
      entryId: { $in: entryIds.map((id) => new Types.ObjectId(id)) },
      _id: { $nin: released.map((item) => item._id) },
    });
    const stillFilled = new Set(remaining.map((item) => String(item.entryId)));
    const emptied = entryIds.filter((id) => !stillFilled.has(id));
    const blocked = await blockedEntryIdsOf(
      String(scope.org.tenantId),
      emptied,
    );
    if (blocked.size > 0) {
      throw entriesLockedError([...blocked], ["tasks"]);
    }
    await this.assignments.softDeleteMany(
      operator,
      released.map((item) => item._id),
    );
    const emptiedRecords = await this.entries.findMany(operator, {
      _id: { $in: emptied.map((id) => new Types.ObjectId(id)) },
    });
    await this.removeEntries(operator, emptiedRecords);
    return emptied;
  }

  /**
   * 軟刪除排班與它填進的執行任務(稽核每一筆排班)。整批做(TX-06):填進紀錄一次讀、兩次 updateMany 軟刪、
   * 稽核一次寫;筆數不符(讀到後被別人刪了)→ `CONFLICT`,整個交易回復。
   */
  private async removeEntries(
    operator: OperatorContext,
    records: readonly EntryRecord[],
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const filled = await this.assignments.findMany(operator, {
      entryId: { $in: records.map((record) => record._id) },
    });
    const filledOf = new Map<string, typeof filled>();
    for (const item of filled) {
      const key = String(item.entryId);
      const list = filledOf.get(key);
      if (list === undefined) {
        filledOf.set(key, [item]);
      } else {
        list.push(item);
      }
    }
    await this.assignments.softDeleteMany(
      operator,
      filled.map((item) => item._id),
    );
    await this.entries.softDeleteMany(
      operator,
      records.map((record) => record._id),
    );
    await this.audit.recordMany(
      operator,
      records.map((record) => ({
        action: "schedule-entry.delete",
        targetType: ENTRY_TARGET,
        targetId: record._id,
        before: entryAuditOf(
          record,
          keysOf(filledOf.get(String(record._id)) ?? []),
        ),
      })),
    );
  }

  /** 這家店這幾個月的狀態文件先建好(交易外;同時建時唯一索引擋下的那一個略過)。 */
  private async ensurePeriods(
    operator: OperatorContext,
    scope: RosterScope,
    months: readonly string[],
  ): Promise<void> {
    for (const month of months) {
      const key = { orgId: scope.org.id, month };
      if (await this.periods.findOne(operator, key)) {
        continue;
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
  }

  /**
   * 交易一開始碰狀態文件:同一家店同一個月同時進來的寫入互相衝突、由交易重跑(發布也碰同一份,
   * 和寫入互相衝突)。回這幾個月裡已發布的。
   */
  private async touchPeriods(
    operator: OperatorContext,
    scope: RosterScope,
    months: readonly string[],
  ): Promise<Set<string>> {
    const published = new Set<string>();
    for (const month of months.toSorted((left, right) =>
      left.localeCompare(right),
    )) {
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
      // 自動排班執行中鎖定這個月(10 分鐘逾時自動解除;規格 14.1 `schedule_periods`)
      if (isAutoRunLocked(touched, this.clock.now())) {
        throw autoRunInProgressError();
      }
      if (touched.status === "published") {
        published.add(month);
      }
    }
    return published;
  }

  /** 牽涉到已發布的月份 → 異動原因必填(驗過的原因);都未發布 → null(不記異動)。 */
  private async reasonIfPublished(
    operator: OperatorContext,
    published: ReadonlySet<string>,
    input: ChangeReasonInputLike | null | undefined,
  ): Promise<ChangeReason | null> {
    return published.size === 0
      ? null
      : this.changes.validatedReason(operator, input);
  }

  /** 填這筆人力需求的人(userId;新增 = 沒有人)。 */
  private async fillersOf(
    operator: OperatorContext,
    demand: DemandRecord | null,
  ): Promise<Types.ObjectId[]> {
    if (demand === null) {
      return [];
    }
    const filled = await this.assignments.findMany(operator, {
      demandId: demand._id,
    });
    if (filled.length === 0) {
      return [];
    }
    const records = await this.entries.findMany(operator, {
      _id: { $in: filled.map((item) => item.entryId) },
    });
    return records.map((record) => record.userId);
  }

  /**
   * 已發布的月份記一筆異動並通知牽涉的人(未發布 = `reason` null,不記)。
   * 月份 = 異動那天的月份;那個月未發布(改到別的月份)時用改之前那天的月份。
   */
  private async recordChange(
    operator: OperatorContext,
    scope: RosterScope,
    reason: ChangeReason | null,
    published: ReadonlySet<string>,
    change: Omit<ScheduleChangeRecord, "month"> & {
      previousDate: Date | null;
    },
  ): Promise<void> {
    if (reason === null) {
      return;
    }
    const { previousDate, ...rest } = change;
    const month = this.monthOf(scope, change.date);
    await this.changes.record(operator, scope, reason, {
      ...rest,
      month: published.has(month)
        ? month
        : this.monthOf(scope, previousDate ?? change.date),
    });
  }

  /** 刪掉的排班各記一筆異動(同一個原因)並通知那個人(一次寫入,TX-06)。 */
  private async recordEntryDeletions(
    operator: OperatorContext,
    scope: RosterScope,
    reason: ChangeReason,
    records: readonly EntryRecord[],
  ): Promise<void> {
    await this.changes.recordMany(
      operator,
      scope,
      reason,
      records.map((record) => ({
        month: this.monthOf(scope, record.date),
        date: record.date,
        action: "entry.delete",
        targetId: record._id,
        userIds: [record.userId],
        before: entryAuditOf(record, []),
        after: null,
      })),
    );
  }

  private async demandModel(
    operator: OperatorContext,
    scope: RosterScope,
    record: DemandRecord,
  ) {
    const assignments = await this.assignments.findMany(operator, {
      demandId: record._id,
    });
    const entries = await this.entries.findMany(operator, {
      _id: { $in: assignments.map((item) => item.entryId) },
    });
    const entryUser = new Map(
      entries.map((entry) => [String(entry._id), String(entry.userId)]),
    );
    const templates = await this.templateRecords.findMany(operator, {
      orgId: { $in: scope.org.chain },
    });
    const visibleTemplateIds = new Set(
      templates.map((template) => String(template._id)),
    );
    return demandModelOf(record, {
      assignments,
      entryUser,
      names: await this.people.namesOf(entries.map((entry) => entry.userId)),
      positionNotes: await positionAnnotationsOf(
        String(scope.org.tenantId),
        String(scope.org.id),
      ),
      visibleTemplateIds,
    });
  }

  private async entryModel(
    operator: OperatorContext,
    scope: RosterScope,
    record: EntryRecord,
  ): Promise<ScheduleEntryModel> {
    const assignments = await this.assignments.findMany(operator, {
      entryId: record._id,
    });
    const demands = await this.demands.findMany(operator, {
      _id: { $in: assignments.map((item) => item.demandId) },
    });
    const blocked = await blockedEntryIdsOf(String(scope.org.tenantId), [
      String(record._id),
    ]);
    return entryModelOf(record, {
      assignments,
      demands: new Map(demands.map((demand) => [String(demand._id), demand])),
      blocked,
    });
  }
}

interface WantedAssignment {
  demandId: Types.ObjectId;
  taskId: string;
}

function assignmentKey(item: WantedAssignment): string {
  return `${String(item.demandId)}|${item.taskId}`;
}

function keysOf(items: readonly WantedAssignment[]): string[] {
  return items.map((item) => assignmentKey(item));
}

/** 開始早於結束、最長 24 小時;否則 `VALIDATION_FAILED`(欄位 `endAt`)。 */
function validatedSpan(
  startAt: Date,
  endAt: Date,
): { startAt: Date; endAt: Date } {
  const span = endAt.getTime() - startAt.getTime();
  if (Number.isNaN(span) || span <= 0 || span > MAX_SPAN_MS) {
    throw validationError("endAt must be after startAt (within 24 hours)", [
      "endAt",
    ]);
  }
  return { startAt, endAt };
}

function validatedTasks(
  tasks: readonly { taskId?: string | null; role: string; taskKey: string }[],
): { taskId: string | null; role: string; taskKey: string }[] {
  const roleSet: ReadonlySet<string> = new Set(SCHEDULE_TASK_ROLES);
  const valid = tasks.every(
    (task) => roleSet.has(task.role) && task.taskKey.trim() !== "",
  );
  if (!valid || exceededTaskRoles(tasks).length > 0) {
    throw validationError("invalid demand tasks", ["tasks"]);
  }
  return tasks.map((task) => ({
    taskId: task.taskId ?? null,
    role: task.role,
    taskKey: task.taskKey.trim(),
  }));
}

/** 既有的 taskId 沿用(職責以既有的為準);沒給或不認得的產生新 id。 */
function mergedTasks(
  existing: readonly ScheduleTemplateTask[],
  input: readonly { taskId: string | null; role: string; taskKey: string }[],
): ScheduleTemplateTask[] {
  const byId = new Map(existing.map((task) => [task.taskId, task]));
  const used = new Set<string>();
  return input.map((task) => {
    const known = task.taskId === null ? undefined : byId.get(task.taskId);
    if (known !== undefined && !used.has(known.taskId)) {
      if (known.role !== task.role) {
        throw validationError(
          "a task cannot change its role",
          ["tasks"],
          SCHEDULE_REASONS.taskRoleLocked,
        );
      }
      used.add(known.taskId);
      return { taskId: known.taskId, role: known.role, taskKey: task.taskKey };
    }
    return {
      taskId: new Types.ObjectId().toHexString(),
      role: task.role,
      taskKey: task.taskKey,
    };
  });
}

/** 至少一筆;同一筆人力需求只能一筆。 */
function validatedAssignments(
  items: readonly { demandId: string; taskId: string }[],
): { demandId: Types.ObjectId; taskId: string }[] {
  if (items.length === 0) {
    throw validationError("an entry must fill at least one demand task", [
      "assignments",
    ]);
  }
  const demandIds = new Set(items.map((item) => item.demandId));
  if (demandIds.size !== items.length) {
    throw validationError(
      "one demand can only be filled once per entry",
      ["assignments"],
      SCHEDULE_REASONS.demandRepeated,
    );
  }
  return items.map((item) => ({
    demandId: parseObjectId(item.demandId, "assignments"),
    taskId: item.taskId,
  }));
}

function demandAuditOf(record: DemandRecord): Record<string, unknown> {
  return {
    date: record.date,
    startAt: record.startAt,
    endAt: record.endAt,
    positionKey: record.positionKey,
    tasks: record.tasks.map((task) => `${task.role}:${task.taskKey}`),
  };
}

function entryAuditOf(
  record: EntryRecord,
  assignments: readonly string[],
): Record<string, unknown> {
  return {
    userId: record.userId,
    date: record.date,
    startAt: record.startAt,
    endAt: record.endAt,
    breakMinutes: record.breakMinutes,
    assignments: [...assignments],
  };
}
