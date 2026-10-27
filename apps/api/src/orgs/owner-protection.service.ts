import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { OrgsRepository, RolesRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { RelationService } from "../database/relation.service";
import { orgError } from "./org-error";
import { type OrgRecord, isTenantTop } from "./org-mapper";

/**
 * 種子「租戶管理員」模板的 key(正本 `apps/db-migrator/seeds/base/roles.ts`)。
 * 開通租戶時複製到租戶名下的副本另有自己的 `_id`、沒有 `key`(key 全庫唯一),
 * 因此副本以 `settings.templateKey` 標記自己複製自哪個模板 —
 * `provisionTenant`(tenant-ops.service.ts)建副本時寫入這個標記,擁有者保護才認得出那一筆授予。
 */
export const TENANT_ADMIN_ROLE_KEY = "tenant-admin";

/** 副本標記所在的 settings 鍵(`roles.settings.templateKey`,ADR-0009)。 */
export const TEMPLATE_KEY_SETTING = "templateKey";

/** 受保護的三個動作(只影響錯誤訊息,便於除錯)。 */
export type OwnerProtectedAction =
  "disable" | "remove-from-org" | "revoke-tenant-admin";

/** 租戶頂層只有根組織能做的三個動作(ADR-0009;只影響錯誤訊息)。 */
export type TenantTopAction = "set-enabled" | "delete" | "move";

/**
 * 擁有者保護與根組織例外都不該受可見範圍左右:
 * 租戶頂層可能不在操作者的管理範圍 / 可見範圍內(例如擁有組織只到部門層的管理員),
 * 這時若查不到擁有者就等於保護失效 — 安全檢查要 fail-closed,所以以 "all" 讀,
 * 且只取 `ownerUserId` / `parentId` 這類判斷用欄位,不把組織內容交給呼叫端。
 */
function protectionReader(operator: OperatorContext): OperatorContext {
  return {
    actorId: operator.actorId,
    currentOrgId: operator.currentOrgId,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: operator.memberOrgIds,
    roleIds: operator.roleIds,
    memberTenants: operator.memberTenants,
  };
}

/**
 * 擁有者保護(ADR-0009):租戶擁有者不可被停用、不可被移出租戶、
 * 其「租戶管理員」授予不可被解除;**根組織的操作者可執行**(處理擁有者失聯等例外)。
 * 同一支服務也守**租戶頂層保護**(`assertTenantTopOperableBy`):租戶頂層本身的
 * 停用 / 刪除 / 搬移只有根組織能做 — 兩者都是「以組織為主體、以根組織為例外」的同一類判斷。
 *
 * 住在 `orgs/`:判斷的主體是組織(`orgs.ownerUserId`、根組織例外),
 * 使用者管理與租戶作業(轉移擁有者 / 開通租戶)兩邊都靠它,
 * 由 `OrgsModule` 匯出、`UsersModule` import — 單一判斷點,兩個模組不得各寫一套。
 * `isRootOperator` 同時是租戶作業「非根組織即使持權限也拒」的唯一判準。
 */
@Injectable()
export class OwnerProtectionService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly roles: RolesRepository,
    private readonly relations: RelationService,
  ) {}

  /** 操作者的當前組織是不是根組織(`parentId === null`)。 */
  async isRootOperator(operator: OperatorContext): Promise<boolean> {
    if (!operator.currentOrgId) {
      return false;
    }
    const currentOrg = await this.orgs.findById(
      protectionReader(operator),
      operator.currentOrgId,
    );
    return currentOrg?.parentId === null;
  }

  /**
   * 根組織專屬動作(租戶作業、資料範圍、欄位類別作業)的共用判準:**站在根組織**,且管理範圍是 `"all"`。
   * 後者防的是「站在根組織、卻只持有某個租戶的角色」:寫入吃管理範圍,會半套成功(靜默不寫入)。
   * 正常設定下根組織操作者持有的是擁有組織 = 根組織的角色(或超級管理員),管理範圍都是 `"all"`。
   * 呼叫端各自決定拒絕時回哪個錯誤(各模組的錯誤碼 / reason 不同)。
   */
  async canActAsRoot(operator: OperatorContext): Promise<boolean> {
    return (
      operator.managedOrgIds === "all" && (await this.isRootOperator(operator))
    );
  }

  /**
   * 租戶頂層保護(ADR-0009:「租戶頂層本身不可被租戶內的人停用、刪除、搬移」)。
   * 目標不是租戶頂層就直接放行;是租戶頂層則只有**根組織的操作者**能做,其餘 `FORBIDDEN`。
   *
   * 判斷點與擁有者保護、租戶作業共用 `isRootOperator` —「站在哪裡」才是判準,
   * 權限可能經角色被帶到別的組織(`docs/modules/org-manager.md`)。
   */
  async assertTenantTopOperableBy(
    operator: OperatorContext,
    org: OrgRecord,
    action: TenantTopAction = "set-enabled",
  ): Promise<void> {
    if (!isTenantTop(org)) {
      return;
    }
    if (await this.isRootOperator(operator)) {
      return;
    }
    throw orgError(
      "FORBIDDEN",
      `Org ${String(org._id)} is a tenant top; ${action} is only allowed from the root org`,
    );
  }

  /** 該使用者是哪些組織的擁有者(`orgs.ownerUserId`);不是擁有者即空陣列。 */
  async ownedOrgIdsOf(
    operator: OperatorContext,
    targetUserId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const owned = await this.orgs.findMany(protectionReader(operator), {
      ownerUserId: targetUserId,
    });
    return owned.map((org) => org._id);
  }

  /**
   * 擁有者的「租戶管理員」授予(不可解除的那幾筆):
   * 角色的擁有組織 = 該使用者擁有的組織,且該角色是租戶管理員模板或其副本。
   */
  async protectedRoleIdsOf(
    operator: OperatorContext,
    targetUserId: Types.ObjectId,
  ): Promise<Set<string>> {
    const ownedOrgIds = await this.ownedOrgIdsOf(operator, targetUserId);
    if (ownedOrgIds.length === 0) {
      return new Set();
    }
    const ownedOrgKeys = new Set(ownedOrgIds.map(String));
    const grantedRoleIds = await this.relations.listRoleIdsOfUser(targetUserId);
    const ownerLinks = await this.relations.listLinks("org_role", {
      secondIds: grantedRoleIds,
    });
    const candidateIds = ownerLinks
      .filter((link) => ownedOrgKeys.has(String(link.firstId)))
      .map((link) => link.secondId);
    if (candidateIds.length === 0) {
      return new Set();
    }
    const candidates = await this.roles.findMany(protectionReader(operator), {
      _id: { $in: candidateIds },
    });
    return new Set(
      candidates
        .filter((role) => isTenantAdminRole(role.key, role.settings))
        .map((role) => String(role._id)),
    );
  }

  /**
   * 「這個使用者受擁有者保護嗎」的單一判斷點(停用 / 移出租戶皆用它)。
   * 根組織的操作者放行;其餘只要目標是任一組織的擁有者即拒。
   */
  async assertNotProtectedOwner(
    operator: OperatorContext,
    targetUser: { _id: Types.ObjectId },
    action: OwnerProtectedAction = "disable",
  ): Promise<void> {
    if (await this.isRootOperator(operator)) {
      return;
    }
    const ownedOrgIds = await this.ownedOrgIdsOf(operator, targetUser._id);
    if (ownedOrgIds.length > 0) {
      throw orgError(
        "OWNER_PROTECTED",
        `User ${String(targetUser._id)} owns a tenant org; ${action} is only allowed from the root org`,
      );
    }
  }
}

/** 租戶管理員模板本身(有 key),或開通時複製出來、以 `settings.templateKey` 標記的副本。 */
function isTenantAdminRole(
  key: string | undefined,
  settings: Record<string, unknown>,
): boolean {
  return (
    key === TENANT_ADMIN_ROLE_KEY ||
    settings[TEMPLATE_KEY_SETTING] === TENANT_ADMIN_ROLE_KEY
  );
}
