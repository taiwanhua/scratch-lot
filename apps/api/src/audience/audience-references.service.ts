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
  ModulesRepository,
  NotificationSettingsRepository,
  SidebarBadgeSettingsRepository,
  WorkflowInstancesRepository,
  WorkflowVersionsRepository,
} from "../database/database.module";
import { WorkflowsRepository } from "../database/workflows.repository";
import type { NotificationTypeDefinition } from "../notifications/notification-registry";
import { NOTIFICATION_TYPES } from "../notifications/notification-registry.module";
import { SidebarBadgeRegistry } from "../sidebar-badges/sidebar-badge-registry";
import { systemContext } from "../workflows/tenant-directory.service";

/**
 * 人員條件被存放的位置(引用處的種類):
 *
 * | kind                   | 存在哪                                       | 帶的名稱            |
 * | ---------------------- | -------------------------------------------- | ------------------- |
 * | `notification-setting` | `notification_settings.audience`             | 通知類型名稱        |
 * | `workflow-approver`    | `workflow_versions.steps[].assignee`         | 流程名稱 + 關卡名稱 |
 * | `workflow-step-cc`     | `workflow_versions.steps[].cc`               | 流程名稱 + 關卡名稱 |
 * | `workflow-overdue`     | `workflow_versions.steps[].overdue.audience` | 流程名稱 + 關卡名稱 |
 * | `workflow-cc`          | `workflow_versions.cc`(整個流程的知會)       | 流程名稱            |
 * | `data-scope`           | `data_scope_rules.rules[].audience`          | 資料範圍目標名稱    |
 * | `sidebar-badge`        | `sidebar_badge_settings.audience`            | 模組名稱            |
 */
export const AUDIENCE_REFERENCE_KINDS = [
  "notification-setting",
  "workflow-approver",
  "workflow-step-cc",
  "workflow-overdue",
  "workflow-cc",
  "data-scope",
  "sidebar-badge",
] as const;

export type AudienceReferenceKind = (typeof AUDIENCE_REFERENCE_KINDS)[number];

/**
 * 流程引用出自哪裡(決定使用者怎麼處置):
 * - `draft`:草稿 → 到流程設計改這一關並發布
 * - `current`:目前版本 → 同上(發布新版後新送出的單據就不再用到)
 * - `in-use`:進行中單據(`running` / `blocked`)用的版本 → 等單據完成,或撤回 / 作廢
 */
export const AUDIENCE_REFERENCE_SOURCES = [
  "draft",
  "current",
  "in-use",
] as const;

export type AudienceReferenceSource =
  (typeof AUDIENCE_REFERENCE_SOURCES)[number];

/** 一個引用處:前端依 `kind` + `source` 組成「為什麼 + 怎麼做」的一句話。 */
export interface AudienceReference {
  kind: AudienceReferenceKind;
  /** 通知類型 / 流程 / 資料範圍目標 / 模組(側欄數字)的名稱 */
  name: string;
  /** 流程關卡的名稱(只有關卡層級的三種有) */
  stepName?: string;
  /** 流程引用出自哪裡(只有流程的四種有) */
  source?: AudienceReferenceSource;
  /** `source = in-use` 時:用到這個引用的進行中單據數 */
  inUseCount?: number;
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
  steps: StepDef[];
  cc?: AssigneeSource | null;
}

type WorkflowHit = Pick<AudienceReference, "kind" | "stepName">;

/** 一份流程版本裡引用這個角色的位置(依關卡順序;整個流程的知會放最後)。 */
function hitsIn(version: VersionLike, roleId: string): WorkflowHit[] {
  const found: WorkflowHit[] = [];
  for (const step of Array.isArray(version.steps) ? version.steps : []) {
    if (step.kind === "join") {
      continue;
    }
    const stepName = step.name;
    if (sourceRoleIds(step.assignee).includes(roleId)) {
      found.push({ kind: "workflow-approver", stepName });
    }
    if (sourceRoleIds(step.cc).includes(roleId)) {
      found.push({ kind: "workflow-step-cc", stepName });
    }
    if (roleIdsIn(step.overdue?.audience).includes(roleId)) {
      found.push({ kind: "workflow-overdue", stepName });
    }
  }
  if (sourceRoleIds(version.cc).includes(roleId)) {
    found.push({ kind: "workflow-cc" });
  }
  return found;
}

/**
 * 合併重複的引用處:鍵 = kind + 名稱 + 關卡 + source。同一關出現在多個進行中版本時合成一筆、
 * 單據數相加;草稿與目前版本的處置相同但說法不同,各留一筆。
 */
function merge(references: AudienceReference[]): AudienceReference[] {
  const byKey = new Map<string, AudienceReference>();
  for (const reference of references) {
    const key = [
      reference.kind,
      reference.name,
      reference.stepName ?? "",
      reference.source ?? "",
    ].join("\u0000");
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { ...reference });
    } else if (reference.inUseCount !== undefined) {
      existing.inUseCount = (existing.inUseCount ?? 0) + reference.inUseCount;
    }
  }
  return [...byKey.values()];
}

/**
 * 找出引用某個角色的人員條件(角色刪除前置 `REFERENCED_BY_AUDIENCE` 用;
 * 規則正本 docs/modules/role-manager.md 權限表「刪除」)。條件樹走訪沿用
 * `@repo/domain/workflow` 的 `audienceStaticIdsOf`(含巢狀群組)。
 *
 * 掃描範圍(租戶 = 角色擁有組織所屬的租戶;根組織的角色 = `null`):
 * - 通知設定:該租戶的 `notification_settings`,只算目前有登記的通知類型
 * - 側欄數字:該租戶的 `sidebar_badge_settings`,只算目前有登記側欄數字的模組
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
    private readonly sidebarBadgeSettings: SidebarBadgeSettingsRepository,
    private readonly badges: SidebarBadgeRegistry,
    private readonly modules: ModulesRepository,
  ) {}

  async referencesToRole(
    tenantId: Types.ObjectId | null,
    roleId: Types.ObjectId,
  ): Promise<AudienceReference[]> {
    const id = String(roleId);
    const [notifications, sidebarBadges, workflows, dataScopes] =
      await Promise.all([
        tenantId === null ? [] : this.notificationReferences(tenantId, id),
        tenantId === null ? [] : this.sidebarBadgeReferences(tenantId, id),
        this.workflowReferences(tenantId, id),
        this.dataScopeReferences(id),
      ]);
    return merge([
      ...notifications,
      ...sidebarBadges,
      ...workflows,
      ...dataScopes,
    ]);
  }

  private async notificationReferences(
    tenantId: Types.ObjectId,
    roleId: string,
  ): Promise<AudienceReference[]> {
    const settings = await this.notificationSettings.findMany(
      systemContext(),
      { tenantId, audience: { $ne: null } },
      { sort: { type: 1 }, select: { type: 1, audience: 1 } },
    );
    return settings.flatMap((setting) => {
      const type = this.types.get(setting.type);
      return type !== undefined && roleIdsIn(setting.audience).includes(roleId)
        ? [{ kind: "notification-setting" as const, name: type.name }]
        : [];
    });
  }

  /** 側欄數字「誰看得到」引用這個角色的模組(依模組 key 排序;沒登記側欄數字的模組不算)。 */
  private async sidebarBadgeReferences(
    tenantId: Types.ObjectId,
    roleId: string,
  ): Promise<AudienceReference[]> {
    const settings = await this.sidebarBadgeSettings.findMany(
      systemContext(),
      { tenantId, audience: { $ne: null } },
      { sort: { moduleKey: 1 }, select: { moduleKey: 1, audience: 1 } },
    );
    const hits = settings.filter(
      (setting) =>
        this.badges.badgeOf(setting.moduleKey) !== undefined &&
        roleIdsIn(setting.audience).includes(roleId),
    );
    if (hits.length === 0) {
      return [];
    }
    const modules = await this.modules.findMany(systemContext(), {
      key: { $in: hits.map((setting) => setting.moduleKey) },
    });
    const nameOf = new Map(modules.map((module) => [module.key, module.name]));
    return hits.map((setting) => ({
      kind: "sidebar-badge" as const,
      name: nameOf.get(setting.moduleKey) ?? setting.moduleKey,
    }));
  }

  /** 進行中單據用到的版本與單據數:`workflowKey` → (版號 → 單據數)。 */
  private async liveVersionCounts(
    keys: readonly string[],
  ): Promise<Map<string, Map<number, number>>> {
    const live = await this.instances.findMany(
      systemContext(),
      {
        workflowKey: { $in: [...keys] },
        status: { $in: [...LIVE_INSTANCE_STATUSES] },
      },
      { select: { workflowKey: 1, workflowVersion: 1 } },
    );
    const counts = new Map<string, Map<number, number>>();
    for (const { workflowKey, workflowVersion } of live) {
      const byVersion = counts.get(workflowKey) ?? new Map<number, number>();
      byVersion.set(workflowVersion, (byVersion.get(workflowVersion) ?? 0) + 1);
      counts.set(workflowKey, byVersion);
    }
    return counts;
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
    const liveCounts = await this.liveVersionCounts(keys);
    // 只取要看的版本:草稿,加上每個流程的目前版本與進行中單據用的版本
    const wanted = workflows.flatMap((workflow) => {
      const numbers = new Set<number>(liveCounts.get(workflow.key)?.keys());
      if (workflow.currentVersion !== null) {
        numbers.add(workflow.currentVersion);
      }
      return numbers.size === 0
        ? []
        : [{ workflowKey: workflow.key, version: { $in: [...numbers] } }];
    });
    const versions = await this.versions.findMany(
      systemContext(),
      {
        workflowKey: { $in: keys },
        $or: [{ status: "draft" }, ...wanted],
      },
      {
        sort: { workflowKey: 1, version: 1 },
        select: { workflowKey: 1, version: 1, status: 1, steps: 1, cc: 1 },
      },
    );
    // 依流程建立順序列出(同 `findMany` 的排序);同一流程內草稿 → 目前版本 → 進行中
    return workflows.flatMap((workflow) => {
      const own = versions.filter(
        (version) => version.workflowKey === workflow.key,
      );
      const refs = (
        version: VersionLike,
        extra: Pick<AudienceReference, "source" | "inUseCount">,
      ): AudienceReference[] =>
        hitsIn(version, roleId).map((hit) => ({
          ...hit,
          name: workflow.name,
          ...extra,
        }));
      const draft = own
        .filter((version) => version.status === "draft")
        .flatMap((version) => refs(version, { source: "draft" }));
      const current = own
        .filter(
          (version) =>
            version.version !== null &&
            version.version === workflow.currentVersion,
        )
        .flatMap((version) => refs(version, { source: "current" }));
      const inUse = own.flatMap((version) => {
        const count =
          version.version === null
            ? undefined
            : liveCounts.get(workflow.key)?.get(version.version);
        return count === undefined
          ? []
          : refs(version, { source: "in-use", inUseCount: count });
      });
      return [...draft, ...current, ...inUse];
    });
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
