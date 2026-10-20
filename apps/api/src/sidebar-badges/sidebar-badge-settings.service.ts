import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { type Audience, validateAudience } from "@repo/domain/audience";

import { outOfTenantPath } from "../audience/audience-tenant-check";
import { AuditService } from "../audit/audit.service";
import {
  ModulesRepository,
  OrgsRepository,
  RolesRepository,
  SidebarBadgeSettingsRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { RelationService } from "../database/relation.service";
import { tenantIdOfOrg } from "../database/tenant-id";
import { TransactionService } from "../database/transaction";
import { findTenantAdminCopy } from "../orgs/tenant-admin-copy";
import {
  TenantDirectoryService,
  systemContext,
} from "../workflows/tenant-directory.service";
import {
  SIDEBAR_BADGE_AUDIENCE_OPTIONS,
  type SidebarBadgeRegistration,
  SidebarBadgeRegistry,
} from "./sidebar-badge-registry";
import {
  sidebarBadgeSettingRejected,
  sidebarBadgeSettingTenantOnly,
} from "./sidebar-badges-error";

/** 審計動作名(`docs/modules/notification-settings.md`「稽核」)。 */
const AUDIT_ACTION_EDIT = "sidebar-badge-settings.edit";
const AUDIT_ACTION_RESET = "sidebar-badge-settings.reset";
const AUDIT_TARGET_TYPE = "sidebar_badge_setting";

export interface SidebarBadgeSettingItem {
  moduleKey: string;
  /** 模組名稱(`modules.name`);模組文件不存在時退回模組 key */
  moduleName: string;
  /** 「數什麼」的說明文字 key(登記時給);沒給 = null */
  descriptionKey: string | null;
  /** 程式預設要求的權限 key(登記的 `requires`);沒有 = null */
  requires: string | null;
  /** 租戶調整過的人員條件;沒調整(用程式預設)= null */
  audience: Audience | null;
  /** 沒有調整(用程式預設) */
  isDefault: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

interface StoredSetting {
  moduleKey: string;
  audience: Audience | null;
  updatedAt: Date;
  updatedBy: Types.ObjectId | null;
}

/**
 * 側欄數字「誰看得到」的租戶設定(`docs/modules/notification-settings.md`「側欄數字」):
 * 存法照通知設定 —— 程式預設(登記:綁了模組就算,有 `requires` 時再要那條權限)+ 租戶覆寫(人員條件)
 * + 還原預設,存在 `sidebar_badge_settings`,唯一 `(tenantId, moduleKey)`;`audience` null = 程式預設。
 *
 * 列出的是**程式有登記、而且這個租戶有開通**的模組(租戶管理員副本綁了那個模組;ADR-0009 開通時勾選的模組)。
 * 找不到副本(資料不完整)時不收窄,列出全部登記。站在根組織時只能看(全部登記、都是預設),不能改。
 */
@Injectable()
export class SidebarBadgeSettingsService {
  constructor(
    private readonly registry: SidebarBadgeRegistry,
    private readonly settings: SidebarBadgeSettingsRepository,
    private readonly orgs: OrgsRepository,
    private readonly roles: RolesRepository,
    private readonly modules: ModulesRepository,
    private readonly relations: RelationService,
    private readonly directory: TenantDirectoryService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  /** 清單:這個租戶看得到的側欄數字(依登記順序,一次全取)。 */
  async list(operator: OperatorContext): Promise<SidebarBadgeSettingItem[]> {
    const tenantId = await this.tenantOf(operator);
    const badges = await this.listedBadges(tenantId);
    const keys = badges.map((badge) => badge.moduleKey);
    const [names, stored] = await Promise.all([
      this.moduleNames(keys),
      this.storedOf(tenantId, keys),
    ]);
    return badges.map((badge) =>
      toItem(badge, names, stored.get(badge.moduleKey) ?? null),
    );
  }

  /** 改某個模組的側欄數字「誰看得到」;下一次查側欄數字就依新條件。 */
  async update(
    operator: OperatorContext,
    input: { moduleKey: string; audience: unknown },
  ): Promise<SidebarBadgeSettingItem> {
    const tenantId = await this.requireTenant(operator);
    const badge = await this.listedBadge(tenantId, input.moduleKey);
    const validation = validateAudience(
      input.audience,
      SIDEBAR_BADGE_AUDIENCE_OPTIONS,
    );
    if (!validation.ok) {
      throw sidebarBadgeSettingRejected(
        "AUDIENCE_INVALID",
        badge.moduleKey,
        validation.issue.path,
      );
    }
    const path = await outOfTenantPath(
      this.directory,
      tenantId,
      validation.audience,
    );
    if (path !== null) {
      throw sidebarBadgeSettingRejected("OUT_OF_TENANT", badge.moduleKey, path);
    }
    return this.write(
      operator,
      tenantId,
      badge,
      validation.audience,
      AUDIT_ACTION_EDIT,
    );
  }

  /** 還原預設:`audience` 寫回 null(之後用程式登記的預設;保留這筆,記下還原的人與時間)。 */
  async reset(
    operator: OperatorContext,
    input: { moduleKey: string },
  ): Promise<SidebarBadgeSettingItem> {
    const tenantId = await this.requireTenant(operator);
    const badge = await this.listedBadge(tenantId, input.moduleKey);
    return this.write(operator, tenantId, badge, null, AUDIT_ACTION_RESET);
  }

  /**
   * 計算側欄數字用:這個租戶調整過的人員條件(模組 key → 條件);根組織(`tenantId = null`)沒有調整。
   */
  async overridesOf(
    tenantId: Types.ObjectId | null,
    moduleKeys: readonly string[],
  ): Promise<Map<string, Audience>> {
    if (tenantId === null || moduleKeys.length === 0) {
      return new Map();
    }
    const stored = await this.settings.findMany(systemContext(), {
      tenantId,
      moduleKey: { $in: [...moduleKeys] },
      audience: { $ne: null },
    });
    return new Map(
      stored.flatMap((setting) =>
        setting.audience === null
          ? []
          : [[setting.moduleKey, setting.audience] as const],
      ),
    );
  }

  /** 操作者目前組織所屬的租戶;根組織(或沒有目前組織)= null。 */
  async tenantOf(operator: OperatorContext): Promise<Types.ObjectId | null> {
    if (operator.currentOrgId === null) {
      return null;
    }
    const org = await this.orgs.findById(
      systemContext(),
      operator.currentOrgId,
    );
    return org === null
      ? null
      : tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors });
  }

  private async write(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    badge: SidebarBadgeRegistration,
    audience: Audience | null,
    action: string,
  ): Promise<SidebarBadgeSettingItem> {
    const saved = await this.transactions.withTransaction(async () => {
      const existing = await this.settings.findOne(systemContext(), {
        tenantId,
        moduleKey: badge.moduleKey,
      });
      // TX-04:先查再寫;並發的最終裁決交給唯一索引 (tenantId, moduleKey)
      const written =
        existing === null
          ? await this.settings.create(operator, {
              tenantId,
              moduleKey: badge.moduleKey,
              audience,
            })
          : await this.settings.updateById(operator, existing._id, {
              $set: { audience },
            });
      if (written === null) {
        throw new Error(`側欄數字設定「${badge.moduleKey}」寫入後讀不到`);
      }
      await this.audit.record(operator, {
        action,
        targetType: AUDIT_TARGET_TYPE,
        targetId: written._id,
        before: {
          moduleKey: badge.moduleKey,
          audience: existing?.audience ?? null,
        },
        after: { moduleKey: badge.moduleKey, audience: written.audience },
      });
      return written;
    });
    const names = await this.moduleNames([badge.moduleKey]);
    return toItem(badge, names, saved);
  }

  /** 這個租戶列得出來的登記(依登記順序);根組織 = 全部。 */
  private async listedBadges(
    tenantId: Types.ObjectId | null,
  ): Promise<SidebarBadgeRegistration[]> {
    const badges = [...this.registry.badges()];
    if (tenantId === null) {
      return badges;
    }
    const opened = await this.openedModuleKeys(tenantId);
    return opened === null
      ? badges
      : badges.filter((badge) => opened.has(badge.moduleKey));
  }

  private async listedBadge(
    tenantId: Types.ObjectId,
    moduleKey: string,
  ): Promise<SidebarBadgeRegistration> {
    const listed = await this.listedBadges(tenantId);
    const badge = listed.find((item) => item.moduleKey === moduleKey);
    if (badge === undefined) {
      throw sidebarBadgeSettingRejected("UNKNOWN_BADGE", moduleKey);
    }
    return badge;
  }

  /**
   * 這個租戶開通的模組 key:租戶頂層擁有的「租戶管理員副本」綁的模組(開通時勾選、之後只能縮;
   * `orgs/tenant-admin-copy.ts`,與撤銷開通同一支)。找不到副本 = null(不收窄)。
   */
  private async openedModuleKeys(
    tenantId: Types.ObjectId,
  ): Promise<Set<string> | null> {
    const copy = await findTenantAdminCopy(
      { relations: this.relations, roles: this.roles },
      systemContext(),
      tenantId,
    );
    if (copy === null) {
      return null;
    }
    const moduleIds = await this.relations.listModuleIdsOfRoles([copy._id]);
    const bound =
      moduleIds.length === 0
        ? []
        : await this.modules.findMany(systemContext(), {
            _id: { $in: moduleIds },
          });
    return new Set(bound.map((module) => module.key));
  }

  private async moduleNames(
    moduleKeys: readonly string[],
  ): Promise<Map<string, string>> {
    if (moduleKeys.length === 0) {
      return new Map();
    }
    const found = await this.modules.findMany(systemContext(), {
      key: { $in: [...moduleKeys] },
    });
    return new Map(found.map((module) => [module.key, module.name]));
  }

  private async storedOf(
    tenantId: Types.ObjectId | null,
    moduleKeys: readonly string[],
  ): Promise<Map<string, StoredSetting>> {
    if (tenantId === null || moduleKeys.length === 0) {
      return new Map();
    }
    const stored = await this.settings.findMany(systemContext(), {
      tenantId,
      moduleKey: { $in: [...moduleKeys] },
    });
    return new Map(stored.map((setting) => [setting.moduleKey, setting]));
  }

  private async requireTenant(
    operator: OperatorContext,
  ): Promise<Types.ObjectId> {
    const tenantId = await this.tenantOf(operator);
    if (tenantId === null) {
      throw sidebarBadgeSettingTenantOnly();
    }
    return tenantId;
  }
}

function toItem(
  badge: SidebarBadgeRegistration,
  names: ReadonlyMap<string, string>,
  setting: StoredSetting | null,
): SidebarBadgeSettingItem {
  const audience = setting?.audience ?? null;
  return {
    moduleKey: badge.moduleKey,
    moduleName: names.get(badge.moduleKey) ?? badge.moduleKey,
    descriptionKey: badge.descriptionKey ?? null,
    requires: badge.requires ?? null,
    audience,
    isDefault: audience === null,
    updatedAt: setting?.updatedAt ?? null,
    updatedBy:
      setting?.updatedBy === null || setting?.updatedBy === undefined
        ? null
        : String(setting.updatedBy),
  };
}
