import { Inject, Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  type Audience,
  type AudienceLeaf,
  type AudienceNode,
  isAudienceGroup,
  validateAudience,
} from "@repo/domain/audience";
import {
  type NotificationSchedule,
  validateSchedule,
} from "@repo/domain/notification-schedule";

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
  type NotificationCategory,
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
  category: NotificationCategory;
  /** 負責人提醒才有;當事人通知 = null */
  orgScope: NotificationOrgScope | null;
  /** 目前生效的人員條件(租戶調整過的,或類型宣告的預設);當事人通知 = null */
  audience: Audience | null;
  /** 收件人沒有調整(用類型宣告的預設);當事人通知一律 true */
  isDefault: boolean;
  defaultAudience: Audience | null;
  /** 當事人通知的收件人說明(類型宣告);負責人提醒或沒宣告 = null */
  recipientNote: string | null;
  /** 目前生效的提醒時間;沒宣告可調時間 = null(一發生就寄) */
  schedule: NotificationSchedule | null;
  defaultSchedule: NotificationSchedule | null;
  /** 提醒時間沒有調整;沒宣告可調時間一律 true */
  isScheduleDefault: boolean;
  /** `days-before` 的日期稱呼(類型宣告,例「到期」);沒有 = null */
  scheduleDateLabel: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface NotificationSettingPage {
  items: NotificationSettingItem[];
  page: number;
  pageSize: number;
  totalCount: number;
}

/** 排程用:目前生效的提醒時間與它的最後修改時間(`scheduleHitAt` 的 `modifiedAt`)。 */
export interface EffectiveSchedule {
  schedule: NotificationSchedule;
  /** 提醒時間最後一次調整 / 還原的時間;沒動過(或用的是預設、存的寫法已不適用)= null */
  modifiedAt: Date | null;
}

/** 還原預設的範圍:收件人或提醒時間;不給 = 這個類型可調的全部。 */
export type NotificationSettingPart = "audience" | "schedule";

interface StoredSetting {
  _id: Types.ObjectId;
  audience: Audience | null;
  schedule: NotificationSchedule | null;
  scheduleUpdatedAt?: Date | null;
  updatedAt: Date;
  updatedBy: Types.ObjectId | null;
}

/**
 * 通知設定(`docs/modules/notification-settings.md`):
 * 租戶管理員調整**負責人提醒**的收件人(人員條件),以及**宣告了可調時間的類型**(負責人提醒或當事人通知)
 * 的提醒時間,存在 `notification_settings`,唯一 `(tenantId, type)`;兩個欄位 null = 用類型宣告的預設。
 * 租戶 = 操作者目前組織所屬的租戶;站在根組織時只能看(預設),不能改(`FORBIDDEN` / `TENANT_ONLY`)。
 * 組織範圍由類型宣告、唯讀;人員條件不能選「所有人」、不含所屬組織欄,使用者與角色必須屬本租戶;
 * 當事人通知的收件人由事件決定,不能調整。
 *
 * 排程工作(B14)用 `effectiveSchedule` 取「這個租戶這個類型目前生效的提醒時間」,
 * 再以 `scheduleHitAt`(`notification-schedule.ts`)判斷這個時點該不該寄。
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

  /** 清單:所有負責人提醒 + 宣告了可調時間的當事人通知(依登記順序)。 */
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
    const matched = this.listedTypes().filter(
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
      .map((type) => this.toItem(type, byType.get(type.key) ?? null));
    return { items, page, pageSize, totalCount: matched.length };
  }

  /**
   * 改某個類型的收件人(人員條件)及 / 或提醒時間;缺席或 null 的欄位不動,兩個都沒給 → `NOTHING_TO_UPDATE`。
   * 下一次觸發 / 下一個時點就依新設定。
   */
  async update(
    operator: OperatorContext,
    input: { type: string; audience?: unknown; schedule?: unknown },
  ): Promise<NotificationSettingItem> {
    const type = this.listedType(input.type);
    const tenantId = await this.requireTenant(operator);
    const changes: { audience?: Audience; schedule?: NotificationSchedule } =
      {};
    if (input.audience !== undefined && input.audience !== null) {
      changes.audience = await this.checkedAudience(
        tenantId,
        type,
        input.audience,
      );
    }
    if (input.schedule !== undefined && input.schedule !== null) {
      changes.schedule = checkedSchedule(type, input.schedule);
    }
    if (Object.keys(changes).length === 0) {
      throw notificationSettingRejected("NOTHING_TO_UPDATE", type.key);
    }
    return this.write(operator, tenantId, type, changes, AUDIT_ACTION_EDIT);
  }

  /**
   * 還原預設:`part` 那一欄寫回 null(之後用類型宣告的預設);不給 `part` = 這個類型可調的欄位全部還原。
   */
  async reset(
    operator: OperatorContext,
    input: { type: string; part?: NotificationSettingPart | null },
  ): Promise<NotificationSettingItem> {
    const type = this.listedType(input.type);
    const tenantId = await this.requireTenant(operator);
    const part = input.part ?? null;
    if (part === "audience" && type.category !== "responsible") {
      throw notificationSettingRejected("AUDIENCE_NOT_ADJUSTABLE", type.key);
    }
    if (part === "schedule" && type.schedule === undefined) {
      throw notificationSettingRejected("SCHEDULE_NOT_ADJUSTABLE", type.key);
    }
    const changes: { audience?: null; schedule?: null } = {};
    if (
      part === "audience" ||
      (part === null && type.category === "responsible")
    ) {
      changes.audience = null;
    }
    if (part === "schedule" || (part === null && type.schedule !== undefined)) {
      changes.schedule = null;
    }
    return this.write(operator, tenantId, type, changes, AUDIT_ACTION_RESET);
  }

  /**
   * 排程工作用:這個租戶這個類型目前生效的提醒時間(調整過的,或類型宣告的預設)與最後修改時間。
   * 類型沒登記或沒宣告可調時間 → 拋錯(程式錯誤)。根組織(`tenantId = null`)只有預設。
   */
  async effectiveSchedule(
    tenantId: Types.ObjectId | null,
    typeKey: string,
  ): Promise<EffectiveSchedule> {
    const declaration = this.types.get(typeKey)?.schedule;
    if (declaration === undefined) {
      throw new Error(`通知類型「${typeKey}」沒有宣告可調時間`);
    }
    if (tenantId === null) {
      return { schedule: declaration.default, modifiedAt: null };
    }
    const stored = await this.settings.findOne(systemContext(), {
      tenantId,
      type: typeKey,
    });
    return {
      schedule:
        storedScheduleOf(declaration.default, stored) ?? declaration.default,
      modifiedAt: stored?.scheduleUpdatedAt ?? null,
    };
  }

  private async checkedAudience(
    tenantId: Types.ObjectId,
    type: NotificationTypeDefinition,
    value: unknown,
  ): Promise<Audience> {
    if (type.category !== "responsible") {
      throw notificationSettingRejected("AUDIENCE_NOT_ADJUSTABLE", type.key);
    }
    const validation = validateAudience(value, NOTIFICATION_AUDIENCE_OPTIONS);
    if (!validation.ok) {
      throw notificationSettingRejected(
        "AUDIENCE_INVALID",
        type.key,
        validation.issue.path,
      );
    }
    await this.assertInTenant(tenantId, type.key, validation.audience);
    return validation.audience;
  }

  private async write(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    type: NotificationTypeDefinition,
    changes: {
      audience?: Audience | null;
      schedule?: NotificationSchedule | null;
    },
    action: string,
  ): Promise<NotificationSettingItem> {
    return this.transactions.withTransaction(async () => {
      const existing = await this.settings.findOne(systemContext(), {
        tenantId,
        type: type.key,
      });
      // 只有提醒時間變動才記它的修改時間(排程補寄看這個,不看 updatedAt)
      const fields =
        changes.schedule === undefined
          ? changes
          : { ...changes, scheduleUpdatedAt: new Date() };
      // TX-04:先查再寫;並發的最終裁決交給唯一索引 (tenantId, type)
      const saved =
        existing === null
          ? await this.settings.create(operator, {
              tenantId,
              type: type.key,
              audience: null,
              schedule: null,
              scheduleUpdatedAt: null,
              ...fields,
            })
          : await this.settings.updateById(operator, existing._id, {
              $set: fields,
            });
      if (saved === null) {
        throw new Error(`通知設定「${type.key}」寫入後讀不到`);
      }
      await this.audit.record(operator, {
        action,
        targetType: AUDIT_TARGET_TYPE,
        targetId: saved._id,
        before: {
          type: type.key,
          audience: existing?.audience ?? null,
          schedule: existing?.schedule ?? null,
        },
        after: {
          type: type.key,
          audience: saved.audience,
          schedule: saved.schedule,
        },
      });
      return this.toItem(type, saved);
    });
  }

  private toItem(
    type: NotificationTypeDefinition,
    setting: StoredSetting | null,
  ): NotificationSettingItem {
    const isResponsible = type.category === "responsible";
    const audience = isResponsible ? (setting?.audience ?? null) : null;
    const defaultAudience = type.defaultAudience ?? null;
    const defaultSchedule = type.schedule?.default ?? null;
    const schedule =
      defaultSchedule === null
        ? null
        : storedScheduleOf(defaultSchedule, setting);
    return {
      type: type.key,
      name: type.name,
      category: type.category,
      orgScope: type.orgScope ?? null,
      audience: audience ?? defaultAudience,
      isDefault: audience === null,
      defaultAudience,
      recipientNote: type.recipientNote ?? null,
      schedule: schedule ?? defaultSchedule,
      defaultSchedule,
      isScheduleDefault: schedule === null,
      scheduleDateLabel: type.schedule?.dateLabel ?? null,
      updatedAt: setting?.updatedAt ?? null,
      updatedBy:
        setting?.updatedBy === null || setting?.updatedBy === undefined
          ? null
          : String(setting.updatedBy),
    };
  }

  /** 通知設定頁上的類型:所有負責人提醒 + 宣告了可調時間的當事人通知。 */
  private listedTypes(): NotificationTypeDefinition[] {
    return [...this.types.values()].filter((type) => isListed(type));
  }

  private listedType(key: string): NotificationTypeDefinition {
    const type = this.types.get(key);
    if (type === undefined || !isListed(type)) {
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

/**
 * 存著的提醒時間;寫法與類型目前宣告的不同(例:類型改了宣告的寫法)就當沒調整,退回預設。
 */
function storedScheduleOf(
  declared: NotificationSchedule,
  setting: { schedule?: NotificationSchedule | null } | null,
): NotificationSchedule | null {
  const stored = setting?.schedule ?? null;
  return stored !== null && stored.kind === declared.kind ? stored : null;
}

function isListed(type: NotificationTypeDefinition): boolean {
  return type.category === "responsible" || type.schedule !== undefined;
}

/** 提醒時間:類型要宣告了可調時間,值要是宣告的寫法且在範圍內。 */
function checkedSchedule(
  type: NotificationTypeDefinition,
  value: unknown,
): NotificationSchedule {
  const declaration = type.schedule;
  if (declaration === undefined) {
    throw notificationSettingRejected("SCHEDULE_NOT_ADJUSTABLE", type.key);
  }
  const validation = validateSchedule(value, declaration.default.kind);
  if (!validation.ok) {
    throw notificationSettingRejected(
      "SCHEDULE_INVALID",
      type.key,
      validation.issue.path,
    );
  }
  return validation.schedule;
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
