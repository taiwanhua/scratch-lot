import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { formatTemporal } from "@repo/domain/form";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  SCHEDULE_TASK_ROLES,
  exceededTaskRoles,
  isIsoDate,
} from "@repo/domain/project/schedule-settings";

import { AuditService } from "../../../audit/audit.service";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { TransactionService } from "../../../database/transaction";
import {
  ScheduleDemandsRepository,
  ScheduleEntriesRepository,
  SchedulePeriodsRepository,
  ScheduleTaskAssignmentsRepository,
} from "../../database/schedule/roster.repositories";
import type { ScheduleTemplateTask } from "../../database/schedule/schedule-demand-template.schema";
import { ScheduleDemandTemplatesRepository } from "../../database/schedule/schedule.repositories";
import { ScheduleCalendarService } from "../calendar/schedule-calendar.service";
import { ScheduleFieldOptionsService } from "../field-options/schedule-field-options.service";
import { blockedEntryIdsOf } from "../integration/entry-deletion-guards";
import { positionAnnotationsOf } from "../integration/position-annotations";
import {
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

const monthOf = (date: string) => date.slice(0, 7);

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
    private readonly templates: ScheduleTemplatesService,
    private readonly people: RosterPeopleReader,
  ) {}

  // ---- 人力需求 ----

  async saveDemand(
    operator: OperatorContext,
    input: SaveScheduleDemandInput,
  ): Promise<SaveScheduleDemandPayload> {
    const scope = await this.scopeOf(operator, input.orgId);
    const span = validatedSpan(input.startAt, input.endAt);
    const date = this.dateOf(scope, span.startAt);
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
        monthOf(date),
        ...(existing ? [monthOf(existing.date)] : []),
      ]),
    ];
    await this.ensurePeriods(operator, scope, months);
    const { saved, deletedEntryIds } = await savingUnique(
      () =>
        this.transactions.withTransaction(async () => {
          await this.touchPeriods(operator, scope, months);
          if (existing && existing.date !== date) {
            const filled = await this.assignments.count(operator, {
              demandId: existing._id,
            });
            if (filled > 0) {
              throw validationError(
                "a demand with assigned people cannot move to another day",
                ["startAt"],
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
          return { saved: record, deletedEntryIds: released };
        }),
      "task already assigned (concurrent write)",
      ["tasks"],
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
    const existing = await this.mustFindDemand(operator, scope, input.id);
    const months = [monthOf(existing.date)];
    await this.ensurePeriods(operator, scope, months);
    const deletedEntryIds = await this.transactions.withTransaction(
      async () => {
        await this.touchPeriods(operator, scope, months);
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
        return released;
      },
    );
    return { id: String(existing._id), deletedEntryIds };
  }

  // ---- 排班 ----

  async saveEntry(
    operator: OperatorContext,
    input: SaveScheduleEntryInput,
  ): Promise<ScheduleEntryModel> {
    const scope = await this.scopeOf(operator, input.orgId);
    const span = validatedSpan(input.startAt, input.endAt);
    const date = this.dateOf(scope, span.startAt);
    const spanMinutes =
      (span.endAt.getTime() - span.startAt.getTime()) / MS_PER_MINUTE;
    if (
      !Number.isInteger(input.breakMinutes) ||
      input.breakMinutes < 0 ||
      input.breakMinutes >= spanMinutes
    ) {
      throw validationError("invalid breakMinutes", ["breakMinutes"]);
    }
    const wanted = validatedAssignments(input.assignments);
    const isCreate = input.id === undefined || input.id === null;
    const existing = isCreate
      ? null
      : await this.mustFindEntry(operator, scope, String(input.id));
    const userId = existing
      ? existing.userId
      : parseObjectId(input.userId ?? "", "userId");
    const candidates = await this.staff.listScheduleCandidates(
      operator,
      scope.org.id,
    );
    const candidate = candidates.find((item) => item.userId === String(userId));
    if (!existing && candidate === undefined) {
      throw validationError(`not a schedule candidate: ${String(userId)}`, [
        "userId",
      ]);
    }
    const calendarDays = await this.calendar.effectiveDays(
      operator,
      scope.org.id,
      date,
      date,
    );
    if (calendarDays.some((day) => day.type === "closed")) {
      throw validationError(`store is closed on ${date}`, ["startAt"]);
    }

    const months = [
      ...new Set([
        monthOf(date),
        ...(existing ? [monthOf(existing.date)] : []),
      ]),
    ];
    await this.ensurePeriods(operator, scope, months);
    await this.people.ensurePersonLock(operator, scope.org.tenantId, userId);
    const saved = await savingUnique(
      () =>
        this.transactions.withTransaction(async () => {
          // 先碰這個人的守門文件(跨店同時排同一人互相衝突),再碰這家店這個月的
          await this.people.touchPersonLock(
            operator,
            scope.org.tenantId,
            userId,
          );
          await this.touchPeriods(operator, scope, months);
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
          const overlap = await this.people.overlapping(
            operator,
            scope.org.tenantId,
            userId,
            span.startAt,
            span.endAt,
            existing?._id ?? null,
          );
          if (overlap.length > 0) {
            throw validationError("overlaps another schedule entry", [
              "startAt",
            ]);
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
          await this.audit.record(operator, {
            action: existing ? "schedule-entry.edit" : "schedule-entry.create",
            targetType: ENTRY_TARGET,
            targetId: record._id,
            before: existing
              ? entryAuditOf(existing, keysOf(current))
              : undefined,
            after: entryAuditOf(record, keysOf(wanted)),
          });
          return record;
        }),
      "task already assigned (concurrent write)",
      ["assignments"],
    );
    return this.entryModel(operator, scope, saved);
  }

  async deleteEntry(
    operator: OperatorContext,
    input: DeleteScheduleEntryInput,
  ): Promise<string> {
    const scope = await this.scopeOf(operator, input.orgId);
    const existing = await this.mustFindEntry(operator, scope, input.id);
    const blocked = await blockedEntryIdsOf(String(scope.org.tenantId), [
      String(existing._id),
    ]);
    if (blocked.size > 0) {
      throw entriesLockedError([...blocked], ["id"]);
    }
    const months = [monthOf(existing.date)];
    await this.ensurePeriods(operator, scope, months);
    await this.transactions.withTransaction(async () => {
      await this.touchPeriods(operator, scope, months);
      await this.removeEntries(operator, [existing]);
    });
    return String(existing._id);
  }

  /** 移除這天所有排班(颱風停班等):已被開班綁定的略過並列出。 */
  async removeDayEntries(
    operator: OperatorContext,
    input: RemoveScheduleDayEntriesInput,
  ): Promise<RemoveScheduleDayEntriesPayload> {
    const scope = await this.scopeOf(operator, input.orgId);
    if (!isIsoDate(input.date)) {
      throw validationError(`invalid date: ${String(input.date)}`, ["date"]);
    }
    const months = [monthOf(input.date)];
    await this.ensurePeriods(operator, scope, months);
    return this.transactions.withTransaction(async () => {
      await this.touchPeriods(operator, scope, months);
      const records = await this.entries.findMany(operator, {
        orgId: scope.org.id,
        date: input.date,
      });
      const blocked = await blockedEntryIdsOf(
        String(scope.org.tenantId),
        records.map((record) => String(record._id)),
      );
      const removable = records.filter(
        (record) => !blocked.has(String(record._id)),
      );
      await this.removeEntries(operator, removable);
      return {
        deletedIds: removable.map((record) => String(record._id)),
        skippedIds: [...blocked],
      };
    });
  }

  // ---- 內部 ----

  /**
   * 要填的執行任務:這家店這一天的人力需求裡真的有這筆任務;負責人任務要可以擔任負責人(原本就填著的不再檢查);
   * 別筆排班已經填了 → `VALIDATION_FAILED`(欄位 `assignments`)。
   */
  private async assertAssignable(
    operator: OperatorContext,
    scope: RosterScope,
    check: {
      date: string;
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
      if (!demand || !task || demand.date !== check.date) {
        throw validationError(
          `demand task not on this day: ${String(item.demandId)}/${item.taskId}`,
          ["assignments"],
        );
      }
      if (
        task.role === "leader" &&
        !check.canLead &&
        !currentKeys.has(assignmentKey(item))
      ) {
        throw validationError("this person cannot lead", ["assignments"]);
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
      throw validationError("task already assigned", ["assignments"]);
    }
  }

  /** 填進紀錄改成 `wanted`:拿掉的軟刪除、新的建立(手動);沒變的保留原來的來源。 */
  private async syncAssignments(
    operator: OperatorContext,
    scope: RosterScope,
    entry: EntryRecord,
    current: readonly (WantedAssignment & { _id: Types.ObjectId })[],
    wanted: readonly WantedAssignment[],
  ): Promise<void> {
    const wantedKeys = new Set(keysOf(wanted));
    const currentKeys = new Set(keysOf(current));
    for (const item of current) {
      if (!wantedKeys.has(assignmentKey(item))) {
        await this.assignments.softDeleteById(operator, item._id);
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

  /** 開始時點在租戶時區的那一天(跨午夜的算開始那天)。 */
  private dateOf(scope: RosterScope, at: Date): string {
    return formatTemporal(at, { type: "date", timezone: scope.timezone });
  }

  private hhmmOf(scope: RosterScope, at: Date): string {
    return formatTemporal(at, {
      type: "datetime",
      timezone: scope.timezone,
    }).slice(11);
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
      throw validationError(`template not visible: ${id}`, ["templateId"]);
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
    for (const item of released) {
      await this.assignments.softDeleteById(operator, item._id);
    }
    const emptiedRecords = await this.entries.findMany(operator, {
      _id: { $in: emptied.map((id) => new Types.ObjectId(id)) },
    });
    await this.removeEntries(operator, emptiedRecords);
    return emptied;
  }

  /** 軟刪除排班與它填進的執行任務(稽核每一筆)。 */
  private async removeEntries(
    operator: OperatorContext,
    records: readonly EntryRecord[],
  ): Promise<void> {
    for (const record of records) {
      const filled = await this.assignments.findMany(operator, {
        entryId: record._id,
      });
      for (const item of filled) {
        await this.assignments.softDeleteById(operator, item._id);
      }
      await this.entries.softDeleteById(operator, record._id);
      await this.audit.record(operator, {
        action: "schedule-entry.delete",
        targetType: ENTRY_TARGET,
        targetId: record._id,
        before: entryAuditOf(record, keysOf(filled)),
      });
    }
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

  /** 交易一開始碰狀態文件:同一家店同一個月同時進來的寫入互相衝突、由交易重跑。 */
  private async touchPeriods(
    operator: OperatorContext,
    scope: RosterScope,
    months: readonly string[],
  ): Promise<void> {
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
    }
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
        throw validationError("a task cannot change its role", ["tasks"]);
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
    throw validationError("one demand can only be filled once per entry", [
      "assignments",
    ]);
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
