import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { isHhMm } from "@repo/domain/form";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  SCHEDULE_TASK_ROLES,
  WEEK_DAY_COUNT,
  exceededTaskRoles,
  isTemplateShortName,
} from "@repo/domain/project/schedule-settings";
import { isTagPaletteKey } from "@repo/domain/project/tag-palette";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import type { ScheduleTemplateTask } from "../../database/schedule/schedule-demand-template.schema";
import {
  type ScheduleDemandTemplateDocument,
  ScheduleDemandTemplatesRepository,
  type ScheduleDemandWeekTemplateDocument,
  ScheduleDemandWeekTemplatesRepository,
} from "../../database/schedule/schedule.repositories";
import { ScheduleFieldOptionsService } from "../field-options/schedule-field-options.service";
import {
  SCHEDULE_REASONS,
  forbiddenError,
  notFoundError,
  validationError,
} from "../shared/schedule-error";
import {
  type ScheduleOrg,
  loadOrgNames,
  parseObjectId,
  resolveScheduleOrg,
} from "../shared/schedule-org";
import {
  SCHEDULE_PERMISSIONS,
  SchedulePermissions,
} from "../shared/schedule-permissions";
import type {
  SaveScheduleDemandTemplateInput,
  SaveScheduleDemandWeekTemplateInput,
} from "./dto/schedule-template.input";
import type {
  ScheduleDemandTemplateModel,
  ScheduleDemandTemplatesPayload,
  ScheduleDemandWeekTemplateModel,
  ScheduleDemandWeekTemplatesPayload,
} from "./models/schedule-template.model";

type TemplateRecord = Persisted<ScheduleDemandTemplateDocument>;
type WeekTemplateRecord = Persisted<ScheduleDemandWeekTemplateDocument>;

const TEMPLATE_TARGET = "schedule_demand_template";
const WEEK_TEMPLATE_TARGET = "schedule_demand_week_template";

/** 寫入前要做的判斷都需要的東西:當前組織(含鏈)與「能不能改」。 */
interface TemplateScope {
  /** 看哪一家店的範本(組織鏈) */
  org: ScheduleOrg;
  /** 寫入一律寫在當前組織:建立者 = 它的才能改 */
  editOrgId: string;
  canEdit: boolean;
}

/**
 * 人力需求範本與週範本(規格 14.4;正本 `docs/modules/project/schedule.md`「人力需求範本」)。
 *
 * - **可見** = 當前組織這一層 + 所有上層建立的;列表「建立於」= 建立它的組織名稱
 * - **只有建立它的那一層能改 / 刪**:看得到、但不是這一層建立的 → `FORBIDDEN`(`reason: NOT_OWNER`)
 * - 新增的範本屬於當前組織;寫入要 `edit-templates`
 */
@Injectable()
export class ScheduleTemplatesService {
  constructor(
    private readonly templates: ScheduleDemandTemplatesRepository,
    private readonly weekTemplates: ScheduleDemandWeekTemplatesRepository,
    private readonly orgs: OrgsRepository,
    private readonly permissions: SchedulePermissions,
    private readonly audit: AuditService,
    private readonly fieldOptions: ScheduleFieldOptionsService,
  ) {}

  // ---- 人力需求範本 ----

  async listTemplates(
    operator: OperatorContext,
  ): Promise<ScheduleDemandTemplatesPayload> {
    const scope = await this.scopeOf(operator);
    const records = await this.visibleTemplates(operator, scope.org);
    const names = await loadOrgNames(operator, this.orgs, scope.org.chain);
    const items = records.map((record) =>
      templateModelOf(record, scope, names),
    );
    return { items, totalCount: items.length, canCreate: scope.canEdit };
  }

  async saveTemplate(
    operator: OperatorContext,
    input: SaveScheduleDemandTemplateInput,
  ): Promise<ScheduleDemandTemplateModel> {
    const scope = await this.scopeOf(operator);
    const data = validatedTemplate(input);
    await this.fieldOptions.assertOptions(operator, [
      {
        categoryKey: SCHEDULE_FIELD_CATEGORY_KEYS.position,
        value: data.positionKey,
        field: "positionKey",
      },
      ...data.tasks.map((task) => ({
        categoryKey: SCHEDULE_FIELD_CATEGORY_KEYS.task,
        value: task.taskKey,
        field: "tasks",
      })),
    ]);
    const existing =
      input.id === undefined || input.id === null
        ? null
        : await this.mustOwnTemplate(operator, scope, input.id);
    const context = operator;
    const saved = existing
      ? await this.templates.updateById(context, existing._id, { $set: data })
      : await this.templates.create(operator, {
          orgId: scope.org.id,
          ...data,
        });
    if (!saved) {
      throw notFoundError(`demand template not found: ${String(input.id)}`);
    }
    await this.audit.record(operator, {
      action: existing
        ? "schedule-demand-template.edit"
        : "schedule-demand-template.create",
      targetType: TEMPLATE_TARGET,
      targetId: saved._id,
      before: existing ? templateAuditOf(existing) : undefined,
      after: templateAuditOf(saved),
    });
    const names = await loadOrgNames(operator, this.orgs, scope.org.chain);
    return templateModelOf(saved, scope, names);
  }

  async deleteTemplate(operator: OperatorContext, id: string): Promise<string> {
    const scope = await this.scopeOf(operator);
    const existing = await this.mustOwnTemplate(operator, scope, id);
    await this.templates.softDeleteById(operator, existing._id);
    await this.audit.record(operator, {
      action: "schedule-demand-template.delete",
      targetType: TEMPLATE_TARGET,
      targetId: existing._id,
      before: templateAuditOf(existing),
    });
    return String(existing._id);
  }

  // ---- 人力需求週範本 ----

  /**
   * 某家店(缺席 = 當前組織)看得到的週範本:那家店的組織鏈上建立的(同規則「預設人力需求週範本」的選項)。
   * `canEdit` 只有建立它的那一層、有 `edit-templates` 才是 true。
   */
  async listWeekTemplates(
    operator: OperatorContext,
    orgId?: string | null,
  ): Promise<ScheduleDemandWeekTemplatesPayload> {
    const scope = await this.scopeOf(operator, orgId);
    const records = await this.weekTemplates.findMany(
      operator,
      { orgId: { $in: scope.org.chain } },
      { sort: { createdAt: 1 } },
    );
    const visibleTemplateIds = await this.visibleTemplateIds(
      operator,
      scope.org,
    );
    const names = await loadOrgNames(operator, this.orgs, scope.org.chain);
    const items = records.map((record) =>
      weekTemplateModelOf(record, scope, names, visibleTemplateIds),
    );
    return { items, totalCount: items.length, canCreate: scope.canEdit };
  }

  async saveWeekTemplate(
    operator: OperatorContext,
    input: SaveScheduleDemandWeekTemplateInput,
  ): Promise<ScheduleDemandWeekTemplateModel> {
    const scope = await this.scopeOf(operator);
    const name = input.name.trim();
    if (name === "") {
      throw validationError("name is required", ["name"]);
    }
    const visibleTemplateIds = await this.visibleTemplateIds(
      operator,
      scope.org,
    );
    const days = validatedDays(input.days, visibleTemplateIds);
    const existing =
      input.id === undefined || input.id === null
        ? null
        : await this.mustOwnWeekTemplate(operator, scope, input.id);
    const context = operator;
    const set = {
      name,
      days,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    };
    const saved = existing
      ? await this.weekTemplates.updateById(context, existing._id, {
          $set: set,
        })
      : await this.weekTemplates.create(operator, {
          orgId: scope.org.id,
          enabled: input.enabled ?? true,
          ...set,
        });
    if (!saved) {
      throw notFoundError(`week template not found: ${String(input.id)}`);
    }
    await this.audit.record(operator, {
      action: existing
        ? "schedule-demand-week-template.edit"
        : "schedule-demand-week-template.create",
      targetType: WEEK_TEMPLATE_TARGET,
      targetId: saved._id,
      before: existing
        ? { name: existing.name, enabled: existing.enabled }
        : undefined,
      after: { name: saved.name, enabled: saved.enabled },
    });
    const names = await loadOrgNames(operator, this.orgs, scope.org.chain);
    return weekTemplateModelOf(saved, scope, names, visibleTemplateIds);
  }

  async deleteWeekTemplate(
    operator: OperatorContext,
    id: string,
  ): Promise<string> {
    const scope = await this.scopeOf(operator);
    const existing = await this.mustOwnWeekTemplate(operator, scope, id);
    await this.weekTemplates.softDeleteById(operator, existing._id);
    await this.audit.record(operator, {
      action: "schedule-demand-week-template.delete",
      targetType: WEEK_TEMPLATE_TARGET,
      targetId: existing._id,
      before: { name: existing.name },
    });
    return String(existing._id);
  }

  // ---- 內部 ----

  private async scopeOf(
    operator: OperatorContext,
    orgId: string | null = null,
  ): Promise<TemplateScope> {
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const holds = await this.permissions.holderOf(operator);
    return {
      org,
      editOrgId: String(operator.currentOrgId),
      canEdit: holds(SCHEDULE_PERMISSIONS.editTemplates),
    };
  }

  private visibleTemplates(
    operator: OperatorContext,
    org: ScheduleOrg,
  ): Promise<TemplateRecord[]> {
    return this.templates.findMany(
      operator,
      { orgId: { $in: org.chain } },
      { sort: { startTime: 1, createdAt: 1 } },
    );
  }

  private async visibleTemplateIds(
    operator: OperatorContext,
    org: ScheduleOrg,
  ): Promise<Set<string>> {
    const records = await this.visibleTemplates(operator, org);
    return new Set(records.map((record) => String(record._id)));
  }

  /** 看得到(鏈上建立的)→ 否則 `NOT_FOUND`;不是這一層建立的 → `FORBIDDEN`。 */
  private async mustOwnTemplate(
    operator: OperatorContext,
    scope: TemplateScope,
    id: string,
  ): Promise<TemplateRecord> {
    const record = await this.templates.findOne(operator, {
      _id: parseObjectId(id, "id"),
      orgId: { $in: scope.org.chain },
    });
    if (!record) {
      throw notFoundError(`demand template not found: ${id}`);
    }
    assertOwned(record.orgId, scope, id);
    return record;
  }

  private async mustOwnWeekTemplate(
    operator: OperatorContext,
    scope: TemplateScope,
    id: string,
  ): Promise<WeekTemplateRecord> {
    const record = await this.weekTemplates.findOne(operator, {
      _id: parseObjectId(id, "id"),
      orgId: { $in: scope.org.chain },
    });
    if (!record) {
      throw notFoundError(`week template not found: ${id}`);
    }
    assertOwned(record.orgId, scope, id);
    return record;
  }
}

function assertOwned(
  ownerOrgId: Types.ObjectId,
  scope: TemplateScope,
  id: string,
): void {
  if (String(ownerOrgId) !== String(scope.org.id)) {
    throw forbiddenError(
      `template ${id} belongs to an upper org; only the org that created it can change it`,
      "NOT_OWNER",
    );
  }
}

function ownerOf(
  orgId: Types.ObjectId,
  names: ReadonlyMap<string, string>,
): { id: string; name: string } {
  return { id: String(orgId), name: names.get(String(orgId)) ?? "" };
}

function templateModelOf(
  record: TemplateRecord,
  scope: TemplateScope,
  names: ReadonlyMap<string, string>,
): ScheduleDemandTemplateModel {
  return {
    id: String(record._id),
    name: record.name,
    shortName: record.shortName,
    startTime: record.startTime,
    endTime: record.endTime,
    positionKey: record.positionKey,
    tasks: record.tasks.map((task) => ({
      taskId: task.taskId,
      role: task.role,
      taskKey: task.taskKey,
    })),
    paletteKey: record.paletteKey,
    ownerOrg: ownerOf(record.orgId, names),
    canEdit: scope.canEdit && String(record.orgId) === scope.editOrgId,
  };
}

function weekTemplateModelOf(
  record: WeekTemplateRecord,
  scope: TemplateScope,
  names: ReadonlyMap<string, string>,
  visibleTemplateIds: ReadonlySet<string>,
): ScheduleDemandWeekTemplateModel {
  const days = Array.from({ length: WEEK_DAY_COUNT }, (_, index) =>
    (record.days[index] ?? [])
      .map(String)
      .filter((id) => visibleTemplateIds.has(id)),
  );
  return {
    id: String(record._id),
    name: record.name,
    days,
    enabled: record.enabled,
    ownerOrg: ownerOf(record.orgId, names),
    canEdit: scope.canEdit && String(record.orgId) === scope.editOrgId,
  };
}

function templateAuditOf(record: TemplateRecord): Record<string, unknown> {
  return {
    name: record.name,
    shortName: record.shortName,
    startTime: record.startTime,
    endTime: record.endTime,
    positionKey: record.positionKey,
    tasks: record.tasks.map((task) => `${task.role}:${task.taskKey}`),
    paletteKey: record.paletteKey,
  };
}

/** 驗範本內容;回寫入資料庫的欄位。 */
function validatedTemplate(input: SaveScheduleDemandTemplateInput): {
  name: string;
  shortName: string;
  startTime: string;
  endTime: string;
  positionKey: string;
  tasks: ScheduleTemplateTask[];
  paletteKey: string | null;
} {
  const errors: string[] = [];
  const name = input.name.trim();
  const shortName = input.shortName.trim();
  const positionKey = input.positionKey.trim();
  const paletteKey = input.paletteKey ?? null;
  if (name === "") {
    errors.push("name");
  }
  if (!isTemplateShortName(shortName)) {
    errors.push("shortName");
  }
  if (!isHhMm(input.startTime)) {
    errors.push("startTime");
  }
  if (!isHhMm(input.endTime) || input.endTime === input.startTime) {
    errors.push("endTime");
  }
  if (positionKey === "") {
    errors.push("positionKey");
  }
  if (paletteKey !== null && !isTagPaletteKey(paletteKey)) {
    errors.push("paletteKey");
  }
  const roleSet: ReadonlySet<string> = new Set(SCHEDULE_TASK_ROLES);
  const tasksValid = input.tasks.every(
    (task) => roleSet.has(task.role) && task.taskKey.trim() !== "",
  );
  if (!tasksValid || exceededTaskRoles(input.tasks).length > 0) {
    errors.push("tasks");
  }
  if (errors.length > 0) {
    throw validationError(
      `invalid demand template: ${errors.join(", ")}`,
      errors,
    );
  }
  const taskIds = new Set<string>();
  const tasks = input.tasks.map((task) => {
    let taskId = task.taskId ?? new Types.ObjectId().toHexString();
    if (taskIds.has(taskId)) {
      taskId = new Types.ObjectId().toHexString();
    }
    taskIds.add(taskId);
    return { taskId, role: task.role, taskKey: task.taskKey.trim() };
  });
  return {
    name,
    shortName,
    startTime: input.startTime,
    endTime: input.endTime,
    positionKey,
    tasks,
    paletteKey,
  };
}

/** 週範本的 7 格:每格只能是這一層看得到的範本(同一格不重複)。 */
function validatedDays(
  days: readonly (readonly string[])[],
  visibleTemplateIds: ReadonlySet<string>,
): Types.ObjectId[][] {
  if (days.length !== WEEK_DAY_COUNT) {
    throw validationError("days must have 7 entries", ["days"]);
  }
  return days.map((ids) => {
    // 同一格重複是格式錯(不帶 reason);範本不在或看不到才是參照失效
    if (new Set(ids).size !== ids.length) {
      throw validationError("days contains a template twice", ["days"]);
    }
    if (ids.some((id) => !visibleTemplateIds.has(id))) {
      throw validationError(
        "days contains unknown templates",
        ["days"],
        SCHEDULE_REASONS.referenceNotFound,
      );
    }
    return ids.map((id) => new Types.ObjectId(id));
  });
}
