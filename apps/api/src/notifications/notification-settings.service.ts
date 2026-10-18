import { Inject, Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  type Audience,
  type AudienceLeaf,
  type AudienceNode,
  isAudienceGroup,
  validateAudience,
} from "@repo/domain/audience";

import { AuditService } from "../audit/audit.service";
import {
  NotificationSettingsRepository,
  OrgsRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { tenantIdOfOrg } from "../database/tenant-id";
import { TransactionService } from "../database/transaction";
import {
  TenantDirectoryService,
  systemContext,
} from "../workflows/tenant-directory.service";
import {
  NOTIFICATION_AUDIENCE_OPTIONS,
  type NotificationOrgScope,
  type NotificationTypeDefinition,
} from "./notification-registry";
import { NOTIFICATION_TYPES } from "./notification-registry.module";
import {
  notificationSettingRejected,
  notificationSettingTenantOnly,
} from "./notifications-error";

/** 審計動作名(`docs/modules/notification-settings.md`「審計」)。 */
const AUDIT_ACTION_EDIT = "notification-settings.edit";
const AUDIT_ACTION_RESET = "notification-settings.reset";
const AUDIT_TARGET_TYPE = "notification_setting";

/** 清單每頁上限(GQL-03)。 */
const MAX_PAGE_SIZE = 100;

export interface NotificationSettingItem {
  type: string;
  name: string;
  orgScope: NotificationOrgScope;
  /** 目前生效的人員條件(租戶調整過的,或類型宣告的預設) */
  audience: Audience;
  /** true = 沒有調整(用類型宣告的預設) */
  isDefault: boolean;
  defaultAudience: Audience;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface NotificationSettingPage {
  items: NotificationSettingItem[];
  page: number;
  pageSize: number;
  totalCount: number;
}

/**
 * 通知設定(`docs/modules/notification-settings.md`):
 * 租戶管理員調整**負責人提醒**類型的收件人(人員條件),存在 `notification_settings`,唯一 `(tenantId, type)`。
 * 租戶 = 操作者目前組織所屬的租戶;站在根組織時只能看(預設),不能改(`FORBIDDEN` / `TENANT_ONLY`)。
 * 組織範圍由類型宣告、唯讀;人員條件不能選「所有人」、不含所屬組織欄,使用者與角色必須屬本租戶。
 */
@Injectable()
export class NotificationSettingsService {
  constructor(
    @Inject(NOTIFICATION_TYPES)
    private readonly types: ReadonlyMap<string, NotificationTypeDefinition>,
    private readonly settings: NotificationSettingsRepository,
    private readonly orgs: OrgsRepository,
    private readonly directory: TenantDirectoryService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  async list(
    operator: OperatorContext,
    input: { keyword?: string | null; page?: number; pageSize?: number },
  ): Promise<NotificationSettingPage> {
    const page = Math.max(1, Math.trunc(input.page ?? 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(input.pageSize ?? 20)),
    );
    const keyword = input.keyword?.trim().toLowerCase() ?? "";
    const matched = this.responsibleTypes().filter(
      (type) =>
        keyword === "" ||
        type.name.toLowerCase().includes(keyword) ||
        type.key.includes(keyword),
    );
    const tenantId = await this.tenantOf(operator);
    const stored =
      tenantId === null
        ? []
        : await this.settings.findMany(systemContext(), {
            tenantId,
            type: { $in: matched.map((type) => type.key) },
          });
    const byType = new Map(stored.map((setting) => [setting.type, setting]));
    const items = matched
      .slice((page - 1) * pageSize, page * pageSize)
      .map((type) => {
        const setting = byType.get(type.key);
        return this.toItem(type, setting?.audience ?? null, setting ?? null);
      });
    return { items, page, pageSize, totalCount: matched.length };
  }

  /** 改某個負責人提醒類型的收件人(人員條件);下一次觸發就依新條件。 */
  async update(
    operator: OperatorContext,
    input: { type: string; audience: unknown },
  ): Promise<NotificationSettingItem> {
    const type = this.responsibleType(input.type);
    const tenantId = await this.requireTenant(operator);
    const validation = validateAudience(
      input.audience,
      NOTIFICATION_AUDIENCE_OPTIONS,
    );
    if (!validation.ok) {
      throw notificationSettingRejected(
        "AUDIENCE_INVALID",
        type.key,
        validation.issue.path,
      );
    }
    const audience = validation.audience;
    await this.assertInTenant(tenantId, type.key, audience);
    return this.write(operator, tenantId, type, audience, AUDIT_ACTION_EDIT);
  }

  /** 還原預設:`audience` 寫回 null,之後用類型宣告的預設人員條件。 */
  async reset(
    operator: OperatorContext,
    input: { type: string },
  ): Promise<NotificationSettingItem> {
    const type = this.responsibleType(input.type);
    const tenantId = await this.requireTenant(operator);
    return this.write(operator, tenantId, type, null, AUDIT_ACTION_RESET);
  }

  private async write(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    type: NotificationTypeDefinition,
    audience: Audience | null,
    action: string,
  ): Promise<NotificationSettingItem> {
    return this.transactions.withTransaction(async () => {
      const existing = await this.settings.findOne(systemContext(), {
        tenantId,
        type: type.key,
      });
      // TX-04:先查再寫;並發的最終裁決交給唯一索引 (tenantId, type)
      const saved =
        existing === null
          ? await this.settings.create(operator, {
              tenantId,
              type: type.key,
              audience,
            })
          : await this.settings.updateById(operator, existing._id, {
              $set: { audience },
            });
      if (saved === null) {
        throw new Error(`通知設定「${type.key}」寫入後讀不到`);
      }
      await this.audit.record(operator, {
        action,
        targetType: AUDIT_TARGET_TYPE,
        targetId: saved._id,
        before: { type: type.key, audience: existing?.audience ?? null },
        after: { type: type.key, audience },
      });
      return this.toItem(type, audience, saved);
    });
  }

  private toItem(
    type: NotificationTypeDefinition,
    audience: Audience | null,
    setting: { updatedAt: Date; updatedBy: Types.ObjectId | null } | null,
  ): NotificationSettingItem {
    const { orgScope, defaultAudience } = type;
    if (orgScope === undefined || defaultAudience === undefined) {
      throw new Error(`通知類型「${type.key}」不是負責人提醒`);
    }
    return {
      type: type.key,
      name: type.name,
      orgScope,
      audience: audience ?? defaultAudience,
      isDefault: audience === null,
      defaultAudience,
      updatedAt: setting?.updatedAt ?? null,
      updatedBy:
        setting?.updatedBy === null || setting?.updatedBy === undefined
          ? null
          : String(setting.updatedBy),
    };
  }

  private responsibleTypes(): NotificationTypeDefinition[] {
    return [...this.types.values()].filter(
      (type) => type.category === "responsible",
    );
  }

  private responsibleType(key: string): NotificationTypeDefinition {
    const type = this.types.get(key);
    if (type?.category !== "responsible") {
      throw notificationSettingRejected("UNKNOWN_TYPE", key);
    }
    return type;
  }

  /** 操作者目前組織所屬的租戶;根組織(或沒有目前組織)= null。 */
  private async tenantOf(
    operator: OperatorContext,
  ): Promise<Types.ObjectId | null> {
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

  private async requireTenant(
    operator: OperatorContext,
  ): Promise<Types.ObjectId> {
    const tenantId = await this.tenantOf(operator);
    if (tenantId === null) {
      throw notificationSettingTenantOnly();
    }
    return tenantId;
  }

  /** 條件裡指定的使用者與角色都要屬本租戶(格式檢查不知道租戶,由使用處在儲存時檢查)。 */
  private async assertInTenant(
    tenantId: Types.ObjectId,
    typeKey: string,
    audience: Audience,
  ): Promise<void> {
    if (audience.mode !== "match") {
      return;
    }
    const leaves = leavesOf(audience.filter, "filter");
    const userIds = leaves.flatMap(({ leaf }) =>
      leaf.field === "user" && leaf.value.kind === "static"
        ? leaf.value.values
        : [],
    );
    const roleIds = leaves.flatMap(({ leaf }) =>
      leaf.field === "role" && leaf.value.kind === "static"
        ? leaf.value.values
        : [],
    );
    const tenantUsers =
      userIds.length === 0
        ? new Map<string, unknown>()
        : await this.directory.userFacts(tenantId, userIds);
    const tenantRoles =
      roleIds.length === 0
        ? new Set<string>()
        : await this.directory.tenantRoleIds(tenantId);
    for (const { leaf, path } of leaves) {
      if (leaf.value.kind !== "static") {
        continue;
      }
      const values = leaf.value.values;
      const outside = values.findIndex((value) =>
        leaf.field === "user"
          ? !tenantUsers.has(value)
          : leaf.field === "role" && !tenantRoles.has(value),
      );
      if (outside !== -1) {
        throw notificationSettingRejected(
          "OUT_OF_TENANT",
          typeKey,
          `${path}.value.values[${String(outside)}]`,
        );
      }
    }
  }
}

/** 條件樹的每個條件列與它的路徑(與 `validateAudience` 的 `path` 同一種寫法)。 */
function leavesOf(
  node: AudienceNode,
  path: string,
): { leaf: AudienceLeaf; path: string }[] {
  if (!isAudienceGroup(node)) {
    return [{ leaf: node, path }];
  }
  return node.children.flatMap((child, index) =>
    leavesOf(child, `${path}.children[${String(index)}]`),
  );
}
