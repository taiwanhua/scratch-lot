import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  SCHEDULE_RULE_DEFINITIONS,
  SCHEDULE_RULE_LEVELS,
  type ScheduleRuleDefinition,
  type ScheduleRuleLevel,
  hasRuleLevel,
  scheduleRuleDefinitionOf,
  scheduleRuleValueErrors,
} from "@repo/domain/project/schedule-settings";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { TransactionService } from "../../../database/transaction";
import {
  ScheduleDemandWeekTemplatesRepository,
  type ScheduleSettingDocument,
  ScheduleSettingsRepository,
} from "../../database/schedule/schedule.repositories";
import {
  forbiddenError,
  notFoundError,
  validationError,
} from "../shared/schedule-error";
import {
  type ScheduleOrg,
  isVisibleOrg,
  loadOrgNames,
  resolveScheduleOrg,
  scheduleReadContext,
} from "../shared/schedule-org";
import {
  SCHEDULE_PERMISSIONS,
  SchedulePermissions,
} from "../shared/schedule-permissions";
import type {
  CustomizeScheduleAutoRunInput,
  CustomizeScheduleRuleInput,
  RestoreScheduleRuleInput,
} from "./dto/schedule-rule.input";
import {
  type ScheduleRuleModel,
  type ScheduleRuleSettingModel,
  ScheduleRuleSourceEnum,
  type ScheduleRulesPayload,
} from "./models/schedule-rule.model";
import type { EffectiveRuleSetting } from "./rule-registry";
import {
  type ResolvedSetting,
  type SettingRow,
  effectiveRuleSettings,
  resolveRules,
} from "./rule-resolution";

type SettingRecord = Persisted<ScheduleSettingDocument>;

const AUDIT_TARGET_TYPE = "schedule_setting";

const AUTO_RUN_DEFINITIONS = SCHEDULE_RULE_DEFINITIONS.filter(
  (definition) => definition.group === "autoRun",
);

const SOURCE_ENUM: Record<ResolvedSetting["source"], ScheduleRuleSourceEnum> = {
  own: ScheduleRuleSourceEnum.OWN,
  inherited: ScheduleRuleSourceEnum.INHERITED,
  default: ScheduleRuleSourceEnum.DEFAULT,
};

function isLevel(value: unknown): value is ScheduleRuleLevel {
  return (SCHEDULE_RULE_LEVELS as readonly unknown[]).includes(value);
}

function toRow(record: SettingRecord): SettingRow {
  return {
    orgId: String(record.orgId),
    key: record.key,
    enabled: record.enabled,
    value: record.value,
    level: isLevel(record.level) ? record.level : null,
    order: record.order,
  };
}

/** 寫進資料庫的一列(本層自訂)。 */
interface SettingWrite {
  key: string;
  enabled: boolean;
  value: Record<string, unknown>;
  level: ScheduleRuleLevel | null;
  order: number;
}

/**
 * 排班規則(規格 14.2;正本 `docs/modules/project/schedule.md`「規則」)。
 *
 * - **讀**:某個組織的整份規則 = 定義清單 × 組織鏈上的自訂(`rule-resolution.ts`)
 * - **寫**:最上層組織的規則要 `edit-default-rules`、其他組織要 `edit-org-rules`(沒有 → `FORBIDDEN`)
 * - 檢查用的生效設定(`effectiveSettingsForOrg`)給排班作業的檢查共用,不看操作者的可見範圍
 */
@Injectable()
export class ScheduleRulesService {
  constructor(
    private readonly settings: ScheduleSettingsRepository,
    private readonly weekTemplates: ScheduleDemandWeekTemplatesRepository,
    private readonly orgs: OrgsRepository,
    private readonly permissions: SchedulePermissions,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  /** 規則頁:某個組織(缺席 = 當前組織)的整份規則。 */
  async list(
    operator: OperatorContext,
    orgId: string | null | undefined,
  ): Promise<ScheduleRulesPayload> {
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    return this.payloadOf(operator, org);
  }

  /** 自訂一條規則;自動排班條件 = 整組變本層自訂。 */
  async customize(
    operator: OperatorContext,
    input: CustomizeScheduleRuleInput,
  ): Promise<ScheduleRulesPayload> {
    const definition = this.mustDefinition(input.key);
    const org = await this.mustEditableOrg(operator, input.orgId);
    const current = await this.resolvedOf(operator, org);
    const effective = current.get(definition.key);
    if (!effective) {
      throw notFoundError(`schedule rule not found: ${input.key}`);
    }
    const write = await this.validatedWrite(operator, org, definition, {
      key: definition.key,
      enabled: input.enabled ?? effective.enabled,
      value: input.value ?? effective.value,
      level:
        input.level === undefined
          ? effective.level
          : (input.level as ScheduleRuleLevel),
      order: input.order ?? effective.order,
    });
    const writes =
      definition.group === "autoRun"
        ? AUTO_RUN_DEFINITIONS.map((item) =>
            item.key === definition.key
              ? write
              : writeOf(current.get(item.key), item),
          )
        : [write];
    await this.saveOwn(operator, org, writes);
    return this.payloadOf(operator, org);
  }

  /** 自訂整組自動排班條件(勾選與順序)。 */
  async customizeAutoRun(
    operator: OperatorContext,
    input: CustomizeScheduleAutoRunInput,
  ): Promise<ScheduleRulesPayload> {
    const keys = input.conditions.map((condition) => condition.key);
    const expected = AUTO_RUN_DEFINITIONS.map((definition) => definition.key);
    if (
      keys.length !== expected.length ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !expected.includes(key))
    ) {
      throw validationError(
        `conditions must list every auto-run condition once: ${expected.join(", ")}`,
        ["conditions"],
      );
    }
    const org = await this.mustEditableOrg(operator, input.orgId);
    await this.saveOwn(
      operator,
      org,
      input.conditions.map((condition, index) => ({
        key: condition.key,
        enabled: condition.enabled,
        value: {},
        level: null,
        order: index + 1,
      })),
    );
    return this.payloadOf(operator, org);
  }

  /** [還原]:刪掉本層這條(自動排班條件:整組)的自訂。 */
  async restore(
    operator: OperatorContext,
    input: RestoreScheduleRuleInput,
  ): Promise<ScheduleRulesPayload> {
    const definition = this.mustDefinition(input.key);
    const org = await this.mustEditableOrg(operator, input.orgId);
    const keys =
      definition.group === "autoRun"
        ? AUTO_RUN_DEFINITIONS.map((item) => item.key)
        : [definition.key];
    await this.transactions.withTransaction(async () => {
      const own = await this.settings.findMany(scheduleReadContext(operator), {
        orgId: org.id,
        key: { $in: keys },
      });
      for (const record of own) {
        await this.settings.softDeleteById(
          scheduleReadContext(operator),
          record._id,
        );
        await this.audit.record(operator, {
          action: "schedule-setting.restore",
          targetType: AUDIT_TARGET_TYPE,
          targetId: record._id,
          before: { key: record.key, value: record.value },
        });
      }
    });
    return this.payloadOf(operator, org);
  }

  /**
   * 某家店的檢查用生效設定(key → 設定):沿組織樹往上找、最後用程式預設。
   * 排班作業的檢查(手動、自動、檢核面板、發布)都讀這一份;不看操作者看不看得到上層。
   */
  async effectiveSettingsForOrg(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<Map<string, EffectiveRuleSetting>> {
    const org = await this.orgs.findById(scheduleReadContext(operator), orgId);
    if (!org) {
      throw notFoundError(`org not found: ${String(orgId)}`);
    }
    const chain = [org._id, ...org.ancestors.slice(1).toReversed()];
    const rows = await this.rowsOf(operator, chain);
    return effectiveRuleSettings(chain.map(String), rows);
  }

  // ---- 內部 ----

  private mustDefinition(key: string): ScheduleRuleDefinition {
    const definition = scheduleRuleDefinitionOf(key);
    if (!definition) {
      throw validationError(`unknown schedule rule: ${key}`, ["key"]);
    }
    return definition;
  }

  /** 看得到、而且操作者有這個組織要的權限。 */
  private async mustEditableOrg(
    operator: OperatorContext,
    orgId: string | null | undefined,
  ): Promise<ScheduleOrg> {
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const holds = await this.permissions.holderOf(operator);
    if (!holds(this.editPermissionOf(org))) {
      throw forbiddenError(
        `missing ${this.editPermissionOf(org)} for org ${String(org.id)}`,
        "MISSING_PERMISSION",
      );
    }
    return org;
  }

  private editPermissionOf(org: ScheduleOrg): string {
    return org.isTenantTop
      ? SCHEDULE_PERMISSIONS.editDefaultRules
      : SCHEDULE_PERMISSIONS.editOrgRules;
  }

  private async validatedWrite(
    operator: OperatorContext,
    org: ScheduleOrg,
    definition: ScheduleRuleDefinition,
    write: SettingWrite,
  ): Promise<SettingWrite> {
    const valueErrors = scheduleRuleValueErrors(definition, write.value);
    if (valueErrors.length > 0) {
      throw validationError(
        `invalid value for ${definition.key}: ${valueErrors.join(", ")}`,
        valueErrors.map((field) => `value.${field}`),
      );
    }
    if (
      hasRuleLevel(definition) ? !isLevel(write.level) : write.level !== null
    ) {
      throw validationError(`invalid level for ${definition.key}`, ["level"]);
    }
    if (!Number.isInteger(write.order) || write.order < 0) {
      throw validationError(`invalid order for ${definition.key}`, ["order"]);
    }
    if (definition.valueType === "weekTemplate") {
      await this.assertWeekTemplate(operator, org, write.value.weekTemplateId);
    }
    return write;
  }

  /** 預設人力需求週範本:要是這家店看得到(自己這一層 + 上層建立的)、啟用中的週範本。 */
  private async assertWeekTemplate(
    operator: OperatorContext,
    org: ScheduleOrg,
    weekTemplateId: unknown,
  ): Promise<void> {
    if (weekTemplateId === null) {
      return;
    }
    const id = typeof weekTemplateId === "string" ? weekTemplateId : "";
    const found = Types.ObjectId.isValid(id)
      ? await this.weekTemplates.findOne(scheduleReadContext(operator), {
          _id: new Types.ObjectId(id),
          orgId: { $in: org.chain },
          enabled: true,
        })
      : null;
    if (!found) {
      throw validationError(`week template not found: ${id}`, [
        "value.weekTemplateId",
      ]);
    }
  }

  /** 本層寫入(已自訂就更新、沒有就新增);一個使用者動作一個交易。 */
  private async saveOwn(
    operator: OperatorContext,
    org: ScheduleOrg,
    writes: readonly SettingWrite[],
  ): Promise<void> {
    const context = scheduleReadContext(operator);
    await this.transactions.withTransaction(async () => {
      for (const write of writes) {
        const existing = await this.settings.findOne(context, {
          orgId: org.id,
          key: write.key,
        });
        const saved = existing
          ? await this.settings.updateById(context, existing._id, {
              $set: {
                enabled: write.enabled,
                value: write.value,
                level: write.level,
                order: write.order,
              },
            })
          : await this.settings.create(operator, { orgId: org.id, ...write });
        if (!saved) {
          throw notFoundError(`schedule setting vanished: ${write.key}`);
        }
        await this.audit.record(operator, {
          action: "schedule-setting.customize",
          targetType: AUDIT_TARGET_TYPE,
          targetId: saved._id,
          before: existing
            ? {
                enabled: existing.enabled,
                value: existing.value,
                level: existing.level,
                order: existing.order,
              }
            : undefined,
          after: {
            key: write.key,
            enabled: write.enabled,
            value: write.value,
            level: write.level,
            order: write.order,
          },
        });
      }
    });
  }

  private async rowsOf(
    operator: OperatorContext,
    chain: readonly Types.ObjectId[],
  ): Promise<SettingRow[]> {
    const records = await this.settings.findMany(
      scheduleReadContext(operator),
      { orgId: { $in: [...chain] } },
    );
    return records.map((record) => toRow(record));
  }

  private async resolvedOf(
    operator: OperatorContext,
    org: ScheduleOrg,
  ): Promise<Map<string, ResolvedSetting>> {
    const rows = await this.rowsOf(operator, org.chain);
    return new Map(
      resolveRules(org.chain.map(String), rows).map((rule) => [
        rule.definition.key,
        rule.effective,
      ]),
    );
  }

  private async payloadOf(
    operator: OperatorContext,
    org: ScheduleOrg,
  ): Promise<ScheduleRulesPayload> {
    const rows = await this.rowsOf(operator, org.chain);
    const rules = resolveRules(org.chain.map(String), rows);
    const names = await loadOrgNames(operator, this.orgs, org.chain);
    const holds = await this.permissions.holderOf(operator);
    const settingOf = (setting: ResolvedSetting): ScheduleRuleSettingModel => {
      const sourceOrgId =
        setting.sourceOrgId === null
          ? null
          : new Types.ObjectId(setting.sourceOrgId);
      return {
        enabled: setting.enabled,
        value: setting.value,
        level: setting.level,
        order: setting.order,
        source: SOURCE_ENUM[setting.source],
        sourceOrgName:
          sourceOrgId !== null && isVisibleOrg(operator, sourceOrgId)
            ? (names.get(String(sourceOrgId)) ?? null)
            : null,
      };
    };
    const items = rules.map(
      ({ definition, effective, parent }): ScheduleRuleModel => ({
        key: definition.key,
        group: definition.group,
        valueType: definition.valueType,
        unit: definition.unit,
        hasLevel: hasRuleLevel(definition),
        effective: settingOf(effective),
        parent: parent === null ? null : settingOf(parent),
      }),
    );
    return {
      orgId: String(org.id),
      orgName: org.name,
      isTenantTop: org.isTenantTop,
      canEdit: holds(this.editPermissionOf(org)),
      items,
    };
  }
}

/** 整組自訂時,沒改的條件照抄目前的生效值(沒有生效值就用程式預設)。 */
function writeOf(
  effective: ResolvedSetting | undefined,
  definition: ScheduleRuleDefinition,
): SettingWrite {
  return {
    key: definition.key,
    enabled: effective?.enabled ?? definition.defaults.enabled,
    value: effective?.value ?? definition.defaults.value,
    level: effective?.level ?? definition.defaults.level,
    order: effective?.order ?? definition.defaults.order,
  };
}
