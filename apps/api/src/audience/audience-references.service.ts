import { Inject, Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type { Audience } from "@repo/domain/audience";
import {
  type AssigneeSource,
  LIVE_INSTANCE_STATUSES,
  type StepDef,
  audienceStaticIdsOf,
} from "@repo/domain/workflow";

import {
  DataScopeRulesRepository,
  DataScopeTargetsRepository,
  NotificationSettingsRepository,
  WorkflowInstancesRepository,
  WorkflowVersionsRepository,
} from "../database/database.module";
import { WorkflowsRepository } from "../database/workflows.repository";
import type { NotificationTypeDefinition } from "../notifications/notification-registry";
import { NOTIFICATION_TYPES } from "../notifications/notification-registry.module";
import { systemContext } from "../workflows/tenant-directory.service";

/**
 * 人員條件被存放的位置(引用處的種類):
 *
 * | kind                   | 存在哪                                   | 帶的名稱                 |
 * | ---------------------- | ---------------------------------------- | ------------------------ |
 * | `notification-setting` | `notification_settings.audience`         | 通知類型名稱             |
 * | `workflow-approver`    | `workflow_versions.steps[].assignee`     | 流程名稱 + 關卡名稱      |
 * | `workflow-step-cc`     | `workflow_versions.steps[].cc`           | 流程名稱 + 關卡名稱      |
 * | `workflow-overdue`     | `workflow_versions.steps[].overdue`      | 流程名稱 + 關卡名稱      |
 * | `workflow-cc`          | `workflow_versions.cc`(整個流程的知會) | 流程名稱                 |
 * | `data-scope`           | `data_scope_rules.rules[].audience`      | 資料範圍目標名稱         |
 */
export const AUDIENCE_REFERENCE_KINDS = [
  "notification-setting",
  "workflow-approver",
  "workflow-step-cc",
  "workflow-overdue",
  "workflow-cc",
  "data-scope",
] as const;

export type AudienceReferenceKind = (typeof AUDIENCE_REFERENCE_KINDS)[number];

/** 一個引用處:前端依 `kind` 組成一句話(例:流程「請購單」關卡「財務審核」的審核者)。 */
export interface AudienceReference {
  kind: AudienceReferenceKind;
  /** 通知類型 / 流程 / 資料範圍目標的名稱 */
  name: string;
  /** 流程關卡的名稱(只有關卡層級的三種有) */
  stepName?: string;
}

/**
 * 存放的人員條件裡寫死的角色 id。存放的值是 Mixed:流程草稿會原樣保留格式不對的條件
 * (格式錯交給檢查器),形狀不對就當作沒有引用,不讓檢查本身丟錯。
 */
function roleIdsIn(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) {
    return [];
  }
  const { mode, filter } = raw as { mode?: unknown; filter?: unknown };
  if (mode !== "match" || typeof filter !== "object" || filter === null) {
    return [];
  }
  try {
    return audienceStaticIdsOf(raw as Audience, "role");
  } catch {
    return [];
  }
}

function sourceRoleIds(source: AssigneeSource | null | undefined): string[] {
  return source?.kind === "audience" ? roleIdsIn(source.audience) : [];
}

interface VersionLike {
  workflowKey: string;
  steps: StepDef[];
  cc?: AssigneeSource | null;
}

/** 一份流程版本裡引用這個角色的位置(依關卡順序;整個流程的知會放最後)。 */
function workflowReferences(
  version: VersionLike,
  workflowName: string,
  roleId: string,
): AudienceReference[] {
  const found: AudienceReference[] = [];
  for (const step of Array.isArray(version.steps) ? version.steps : []) {
    if (step.kind === "join") {
      continue;
    }
    const stepName = step.name;
    if (sourceRoleIds(step.assignee).includes(roleId)) {
      found.push({ kind: "workflow-approver", name: workflowName, stepName });
    }
    if (sourceRoleIds(step.cc).includes(roleId)) {
      found.push({ kind: "workflow-step-cc", name: workflowName, stepName });
    }
    if (roleIdsIn(step.overdue?.audience).includes(roleId)) {
      found.push({ kind: "workflow-overdue", name: workflowName, stepName });
    }
  }
  if (sourceRoleIds(version.cc).includes(roleId)) {
    found.push({ kind: "workflow-cc", name: workflowName });
  }
  return found;
}

function dedupe(references: AudienceReference[]): AudienceReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const id = `${reference.kind}\u0000${reference.name}\u0000${reference.stepName ?? ""}`;
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

/**
 * 找出引用某個角色的人員條件(角色刪除前置 `REFERENCED_BY_AUDIENCE` 用;
 * 規則正本 docs/modules/role-manager.md 權限表「刪除」)。條件樹走訪沿用
 * `@repo/domain/workflow` 的 `audienceStaticIdsOf`(含巢狀群組)。
 *
 * 掃描範圍(租戶 = 角色擁有組織所屬的租戶;根組織的角色 = `null`):
 * - 通知設定:該租戶的 `notification_settings`
 * - 流程:該租戶的流程(租戶為 `null` 時是共用流程),看**草稿、目前版本、還有進行中單據的版本**
 *   —— 退役且沒有單據在跑的版本不會再派出審核,不算引用
 * - 資料範圍:所有規則(根組織設定、本來就跨租戶;角色 id 全域唯一,寫到就是真的引用)
 */
@Injectable()
export class AudienceReferencesService {
  constructor(
    private readonly notificationSettings: NotificationSettingsRepository,
    private readonly workflows: WorkflowsRepository,
    private readonly versions: WorkflowVersionsRepository,
    private readonly instances: WorkflowInstancesRepository,
    private readonly dataScopeRules: DataScopeRulesRepository,
    private readonly dataScopeTargets: DataScopeTargetsRepository,
    @Inject(NOTIFICATION_TYPES)
    private readonly types: ReadonlyMap<string, NotificationTypeDefinition>,
  ) {}

  async referencesToRole(
    tenantId: Types.ObjectId | null,
    roleId: Types.ObjectId,
  ): Promise<AudienceReference[]> {
    const id = String(roleId);
    const [notifications, workflows, dataScopes] = await Promise.all([
      tenantId === null ? [] : this.notificationReferences(tenantId, id),
      this.workflowReferences(tenantId, id),
      this.dataScopeReferences(id),
    ]);
    return dedupe([...notifications, ...workflows, ...dataScopes]);
  }

  private async notificationReferences(
    tenantId: Types.ObjectId,
    roleId: string,
  ): Promise<AudienceReference[]> {
    const settings = await this.notificationSettings.findMany(
      systemContext(),
      { tenantId, audience: { $ne: null } },
      { sort: { type: 1 } },
    );
    return settings
      .filter((setting) => roleIdsIn(setting.audience).includes(roleId))
      .map((setting) => ({
        kind: "notification-setting" as const,
        name: this.types.get(setting.type)?.name ?? setting.type,
      }));
  }

  private async workflowReferences(
    tenantId: Types.ObjectId | null,
    roleId: string,
  ): Promise<AudienceReference[]> {
    const workflows = await this.workflows.findMany(tenantId);
    if (workflows.length === 0) {
      return [];
    }
    const keys = workflows.map((workflow) => workflow.key);
    const live = await this.instances.findMany(
      systemContext(),
      {
        workflowKey: { $in: keys },
        status: { $in: [...LIVE_INSTANCE_STATUSES] },
      },
      { select: { workflowKey: 1, workflowVersion: 1 } },
    );
    const versionsInUse = new Map<string, Set<number>>();
    for (const workflow of workflows) {
      versionsInUse.set(
        workflow.key,
        new Set(
          workflow.currentVersion === null ? [] : [workflow.currentVersion],
        ),
      );
    }
    for (const instance of live) {
      versionsInUse.get(instance.workflowKey)?.add(instance.workflowVersion);
    }
    const versions = await this.versions.findMany(
      systemContext(),
      { workflowKey: { $in: keys } },
      { sort: { workflowKey: 1, version: 1 } },
    );
    const nameByKey = new Map(
      workflows.map((workflow) => [workflow.key, workflow.name]),
    );
    const counted = versions.filter(
      (version) =>
        version.status === "draft" ||
        (version.version !== null &&
          versionsInUse.get(version.workflowKey)?.has(version.version) ===
            true),
    );
    // 依流程建立順序列出(同 `findMany` 的排序)
    return workflows.flatMap((workflow) =>
      counted
        .filter((version) => version.workflowKey === workflow.key)
        .flatMap((version) =>
          workflowReferences(
            version,
            nameByKey.get(workflow.key) ?? workflow.key,
            roleId,
          ),
        ),
    );
  }

  private async dataScopeReferences(
    roleId: string,
  ): Promise<AudienceReference[]> {
    const rules = await this.dataScopeRules.findMany(systemContext());
    const hits = rules.filter((rule) =>
      (Array.isArray(rule.rules) ? rule.rules : []).some((entry) =>
        roleIdsIn((entry as { audience?: unknown }).audience).includes(roleId),
      ),
    );
    if (hits.length === 0) {
      return [];
    }
    const targets = await this.dataScopeTargets.findMany(systemContext(), {
      $or: hits.map((rule) => ({
        collection: rule.collection,
        moduleKey: rule.moduleKey,
      })),
    });
    const nameOf = (collection: string, moduleKey: string): string =>
      targets.find(
        (target) =>
          target.collection === collection && target.moduleKey === moduleKey,
      )?.name ?? `${collection} / ${moduleKey}`;
    return hits.map((rule) => ({
      kind: "data-scope" as const,
      name: nameOf(rule.collection, rule.moduleKey),
    }));
  }
}
