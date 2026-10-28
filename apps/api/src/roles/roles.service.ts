import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  type AudienceReference,
  AudienceReferencesService,
} from "../audience/audience-references.service";
import { AuditService } from "../audit/audit.service";
import { OrgsRepository, RolesRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { RelationService } from "../database/relation.service";
import { tenantIdOfOrg } from "../database/tenant-id";
import { TransactionService } from "../database/transaction";
import type { DeletePayload } from "../orgs/models/org-payloads.model";
import type { CreateRoleInput } from "./dto/create-role.input";
import type { DeleteRoleInput } from "./dto/delete-role.input";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type RolesInput,
} from "./dto/roles.input";
import type { SetRoleEnabledInput } from "./dto/set-role-enabled.input";
import type { UpdateRoleInput } from "./dto/update-role.input";
import type { RolesPayload } from "./models/role-payloads.model";
import type { RoleModel } from "./models/role.model";
import { RoleKind } from "./models/role.model";
import {
  type RoleRecord,
  canToggleEnabled,
  isSeedRole,
  isTemplateCopy,
  roleKindOf,
} from "./role-rules";
import { RoleScopeService, toObjectId } from "./role-scope.service";
import {
  ROLE_NOT_DELETABLE_REASONS,
  type RoleNotDeletableReason,
  forbiddenError,
  notFoundError,
  roleNotDeletableError,
  validationError,
} from "./roles-error";

/** 審計動作名(docs/modules/role-manager.md「審計動作」;`targetType` 一律 role)。 */
export const AUDIT_TARGET_TYPE = "role";
export const AUDIT_ACTIONS = {
  create: "role.create",
  edit: "role.edit",
  editMatrix: "role.edit-matrix",
  grantUser: "role.grant-user",
  revokeUser: "role.revoke-user",
  toggleEnabled: "role.toggle-enabled",
  delete: "role.delete",
} as const;

/** 關鍵字做部分比對,使用者輸入的 regex 特殊字元一律當字面值。 */
function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw validationError(`${field} is required`, [field]);
  }
  return trimmed;
}

/**
 * 角色管理的 CRUD(`system.role-manager`)。resolver 薄、service 厚(STRUCT-01):
 * **管理範圍**(治理模組吃它,不吃可見範圍;ADR-0005 的分工表)、刪除前置與稽核都在這裡,
 * 寫入一律經 BaseRepository / RelationService。
 *
 * 權限矩陣見 `role-matrix.service.ts`、分配使用者見 `role-users.service.ts`;
 * 「角色在不在我的管理範圍內」三支共用 `RoleScopeService`,不各寫一套。
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly relations: RelationService,
    private readonly audit: AuditService,
    private readonly scope: RoleScopeService,
    private readonly orgs: OrgsRepository,
    private readonly audienceReferences: AudienceReferencesService,
    private readonly transactions: TransactionService,
  ) {}

  // ---- 讀 ----

  /**
   * 清單:擁有組織在操作者**管理範圍**內的角色(ADR-0003 / ADR-0005);
   * `ownerOrgId` 在那之內再篩一個擁有組織,`keyword` 比對名稱與描述。
   */
  async list(
    operator: OperatorContext,
    input: RolesInput,
  ): Promise<RolesPayload> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const managed = await this.scope.managedRoleFilter(
      operator,
      input.ownerOrgId ?? undefined,
    );
    if (managed === null) {
      return { items: [], totalCount: 0, page, pageSize };
    }
    const keyword = input.keyword?.trim();
    const filter = {
      ...managed,
      ...(keyword
        ? {
            $or: [
              { name: { $regex: escapeRegex(keyword), $options: "i" } },
              { description: { $regex: escapeRegex(keyword), $options: "i" } },
            ],
          }
        : {}),
    };
    const totalCount = await this.roles.count(operator, filter);
    const documents = await this.roles.findMany(operator, filter, {
      sort: { createdAt: -1, _id: -1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    return {
      items: await this.scope.decorate(operator, documents),
      totalCount,
      page,
      pageSize,
    };
  }

  /** 單筆;管理範圍外視同不存在(`NOT_FOUND`)。 */
  async findOne(operator: OperatorContext, id: string): Promise<RoleModel> {
    const role = await this.scope.loadManagedRole(operator, id);
    return this.scope.decorateOne(operator, role);
  }

  // ---- 寫 ----

  /**
   * 新增角色:擁有組織 = 這個角色的管轄邊界(ADR-0003),限操作者管理範圍內,
   * 不給則預設當前組織。新角色不綁任何模組 / 權限 — 矩陣是另一個動作(另一個權限 key)。
   */
  async create(
    operator: OperatorContext,
    input: CreateRoleInput,
  ): Promise<RoleModel> {
    return this.transactions.withTransaction(async () => {
      const name = requireText(input.name, "name");
      const description = input.description?.trim();
      const ownerOrgId =
        input.ownerOrgId === undefined || input.ownerOrgId === null
          ? operator.currentOrgId
          : toObjectId(input.ownerOrgId, "ownerOrgId");
      if (ownerOrgId === null) {
        throw validationError(
          "ownerOrgId is required when the operator has no current org",
          ["ownerOrgId"],
        );
      }
      const ownerOrg = await this.scope.findManagedOrg(operator, ownerOrgId);
      if (ownerOrg === null) {
        throw forbiddenError(
          `Org ${String(ownerOrgId)} is outside the operator's managed scope`,
        );
      }

      const role = await this.roles.create(operator, {
        name,
        ...(description === undefined || description === ""
          ? {}
          : { description }),
        enabled: true,
        isSystem: false,
        settings: {},
      });
      await this.relations.setRoleOwnerOrg(operator, ownerOrg._id, role._id);
      await this.audit.record(operator, {
        action: AUDIT_ACTIONS.create,
        targetType: AUDIT_TARGET_TYPE,
        targetId: role._id,
        after: {
          name,
          ...(description === undefined ? {} : { description }),
          ownerOrgId: String(ownerOrg._id),
        },
      });
      return this.scope.decorateOne(operator, role);
    });
  }

  /**
   * 編輯名稱 / 描述(GQL-06:`description` 缺席 = 不動、null = 清空)。
   * 種子角色不可改(規則表):它隨底座出貨,改了下一次 seed 又被蓋回去。
   */
  async update(
    operator: OperatorContext,
    input: UpdateRoleInput,
  ): Promise<RoleModel> {
    return this.transactions.withTransaction(async () => {
      const role = await this.scope.loadManagedRole(operator, input.id);
      if (isSeedRole(role)) {
        throw forbiddenError(
          `Role ${input.id} is a seed role and cannot be renamed`,
          "SYSTEM_ROLE",
        );
      }
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const update: Record<string, unknown> = {};

      if (input.name !== undefined && input.name !== null) {
        const name = requireText(input.name, "name");
        if (name !== role.name) {
          before.name = role.name;
          after.name = name;
          update.name = name;
        }
      }
      if (input.description !== undefined) {
        const description = input.description?.trim() ?? "";
        const current = role.description ?? "";
        if (description !== current) {
          before.description = role.description ?? null;
          after.description = description === "" ? null : description;
          update.description = description === "" ? null : description;
        }
      }
      if (Object.keys(update).length === 0) {
        return this.scope.decorateOne(operator, role);
      }

      const updated =
        (await this.roles.updateById(operator, role._id, { $set: update })) ??
        role;
      await this.audit.record(operator, {
        action: AUDIT_ACTIONS.edit,
        targetType: AUDIT_TARGET_TYPE,
        targetId: role._id,
        before,
        after,
      });
      return this.scope.decorateOne(operator, updated);
    });
  }

  /**
   * 停用 / 啟用:停用後持有者的該角色立即不生效(授予仍在,PermissionResolver 排除,ADR-0011)。
   *
   * 三道擋(規則表;判準正本 `role-rules.ts` 的 `canToggleEnabled`):
   * 1. 種子角色一律不可切(`SYSTEM_ROLE`)
   * 2. 預設角色(租戶副本)只有根組織的操作者可切(`TEMPLATE_COPY_ROOT_ONLY`)
   * 3. **自鎖保護**:不可停用操作者自己正持有的角色(`SELF_LOCK`)—— 做得成就把自己
   *    鎖在角色管理之外,沒有別的入口能開回來。啟用不受這一條限制。
   */
  async setEnabled(
    operator: OperatorContext,
    input: SetRoleEnabledInput,
  ): Promise<RoleModel> {
    return this.transactions.withTransaction(async () => {
      const role = await this.scope.loadManagedRole(operator, input.id);
      await this.assertToggleAllowed(operator, role, input.enabled);
      if (role.enabled === input.enabled) {
        return this.scope.decorateOne(operator, role);
      }
      const updated =
        (await this.roles.updateById(operator, role._id, {
          $set: { enabled: input.enabled },
        })) ?? role;
      await this.audit.record(operator, {
        action: AUDIT_ACTIONS.toggleEnabled,
        targetType: AUDIT_TARGET_TYPE,
        targetId: role._id,
        before: { enabled: role.enabled },
        after: { enabled: input.enabled },
      });
      return this.scope.decorateOne(operator, updated);
    });
  }

  /**
   * 刪除:前置四項(無授予 / 非種子角色 / 非租戶副本 / 沒被人員條件引用)全過才可;
   * 任一不過回 `ROLE_NOT_DELETABLE` 附 reasons,前端提示改用停用。刪除 = 軟刪除(ADR-0007)。
   *
   * 軟刪除只動 `roles` 文件:`org_role` / `role_module` / `role_permission` 留著 —
   * 關聯是「有/沒有」的事實(RelationService 的硬刪除註解),角色一旦查不到,
   * PermissionResolver 與清單都不再看得到它,復原時綁定也還在。
   *
   * 前置檢查在交易外做完(交易只留寫入,TX-01);交易內再核對會被並發改變的兩項
   * (授予、人員條件引用),檢查後才被授予 / 引用的仍擋下。種子與副本身分不會在檢查後改變。
   */
  async remove(
    operator: OperatorContext,
    input: DeleteRoleInput,
  ): Promise<DeletePayload> {
    const role = await this.scope.loadManagedRole(operator, input.id);
    const tenantId = await this.tenantIdOfRole(operator, role);
    const fixed = fixedNotDeletableReasons(role);
    const changing = await this.changingNotDeletableReasons(role, tenantId);
    const reasons = [...changing.reasons, ...fixed];
    if (reasons.length > 0) {
      throw roleNotDeletableError(orderedReasons(reasons), changing.references);
    }
    return this.transactions.withTransaction(async () => {
      const recheck = await this.changingNotDeletableReasons(role, tenantId);
      if (recheck.reasons.length > 0) {
        throw roleNotDeletableError(
          orderedReasons(recheck.reasons),
          recheck.references,
        );
      }
      // 同時有人刪了同一個角色(或交易重跑時已刪):查不到 = 不存在,不再寫稽核
      const deleted = await this.roles.softDeleteById(operator, role._id);
      if (deleted === null) {
        throw notFoundError(`Role ${String(role._id)} not found`);
      }
      await this.audit.record(operator, {
        action: AUDIT_ACTIONS.delete,
        targetType: AUDIT_TARGET_TYPE,
        targetId: role._id,
        before: { name: role.name, enabled: role.enabled },
      });
      return { success: true, deletedId: String(role._id) };
    });
  }

  /**
   * 刪除前置中會被並發改變的兩項(role-manager.md 權限表「刪除」):授予、人員條件引用。
   * 交易外先查一次,交易內再核對一次。
   */
  private async changingNotDeletableReasons(
    role: RoleRecord,
    tenantId: Types.ObjectId | null,
  ): Promise<{
    reasons: RoleNotDeletableReason[];
    references: AudienceReference[];
  }> {
    const reasons: RoleNotDeletableReason[] = [];
    const grantedUserIds = await this.relations.listUserIdsOfRole(role._id);
    if (grantedUserIds.length > 0) {
      reasons.push("HAS_GRANTS");
    }
    const references = await this.audienceReferences.referencesToRole(
      tenantId,
      role._id,
    );
    if (references.length > 0) {
      reasons.push("REFERENCED_BY_AUDIENCE");
    }
    return { reasons, references };
  }

  /**
   * 角色所屬的租戶 = 擁有組織所屬的租戶(根組織的角色 = `null`)。找不到擁有組織是資料損毀
   * (`loadManagedRole` 已先擋過),直接丟錯,不退成根組織 —— 退了會少掃租戶的引用。
   */
  private async tenantIdOfRole(
    operator: OperatorContext,
    role: RoleRecord,
  ): Promise<Types.ObjectId | null> {
    const ownerOrgId = await this.scope.ownerOrgIdOf(role);
    const org =
      ownerOrgId === null
        ? null
        : await this.orgs.findById(operator, ownerOrgId);
    if (org === null) {
      throw new Error(
        `Role ${String(role._id)} has no owner org; cannot resolve its tenant`,
      );
    }
    return tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors });
  }

  /**
   * 停用 / 啟用的三道擋;判準與 `Role.abilities.canToggleEnabled` 是同一個純函式,
   * 這裡只負責把「不行」翻成哪一個 `reason`(前端據此顯示不同的一句話)。
   */
  private async assertToggleAllowed(
    operator: OperatorContext,
    role: RoleRecord,
    nextEnabled: boolean,
  ): Promise<void> {
    const facts = await this.scope.factsOf(operator, role);
    if (canToggleEnabled(role, facts)) {
      return;
    }
    const kind = roleKindOf(role);
    if (kind === RoleKind.SYSTEM) {
      throw forbiddenError(
        `Role ${String(role._id)} is a seed role; enabling and disabling it is not allowed`,
        "SYSTEM_ROLE",
      );
    }
    if (kind === RoleKind.TEMPLATE_COPY && !facts.isRootOperator) {
      throw forbiddenError(
        `Role ${String(role._id)} is a tenant-admin copy; set-enabled is only allowed from the root org`,
        "TEMPLATE_COPY_ROOT_ONLY",
      );
    }
    throw forbiddenError(
      `Role ${String(role._id)} is held by the operator; disabling it would lock them out (enabled=${String(nextEnabled)})`,
      "SELF_LOCK",
    );
  }
}

/** 依 `ROLE_NOT_DELETABLE_REASONS` 的順序列出(前端逐項顯示)。 */
function orderedReasons(
  reasons: readonly RoleNotDeletableReason[],
): RoleNotDeletableReason[] {
  return ROLE_NOT_DELETABLE_REASONS.filter((reason) =>
    reasons.includes(reason),
  );
}

/** 刪除前置中角色本身的身分(種子、租戶副本);檢查後不會被並發改變。 */
function fixedNotDeletableReasons(role: RoleRecord): RoleNotDeletableReason[] {
  return [
    ...(isSeedRole(role) ? (["SYSTEM_ROLE"] as const) : []),
    ...(isTemplateCopy(role) ? (["TEMPLATE_COPY"] as const) : []),
  ];
}
