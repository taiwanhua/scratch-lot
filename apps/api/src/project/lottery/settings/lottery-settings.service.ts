import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  COUNT_MODE,
  type CountModeChangeCause,
  type CountModeSetting,
} from "@repo/domain/project/lottery";
import {
  LOTTERY_SETTINGS_PERMISSIONS,
  LOTTERY_SETTING_KEYS,
  type LotterySettingDefinition,
  type ResolvedLotterySetting,
  canCancelConversion,
  lotterySettingDefinitionOf,
  lotterySettingValueOf,
  resolveLotterySettings,
} from "@repo/domain/project/lottery-settings";

import { AuditService } from "../../../audit/audit.service";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { TransactionService } from "../../../database/transaction";
import {
  PermissionResolver,
  holdsPermission,
} from "../../../permission/permission-resolver";
import { LotterySettingsRepository } from "../../database/lottery-settings/lottery-settings.repositories";
import { isDuplicateKeyError } from "../../schedule/shared/schedule-error";
import {
  type ScheduleOrg,
  isVisibleOrg,
  loadOrgNames,
  resolveScheduleOrg,
} from "../../schedule/shared/schedule-org";
import type {
  CancelLotteryCountModeConversionInput,
  CustomizeLotterySettingInput,
  LotteryCountModeChangeCheckInput,
  RestoreLotterySettingInput,
} from "./dto/lottery-settings.input";
import {
  LOTTERY_SETTINGS_REASONS,
  missingPermissionError,
  validationError,
} from "./lottery-settings-error";
import type {
  LotteryCountModeChangeCheckModel,
  LotterySettingValueModel,
  LotterySettingsPayload,
  LotteryStoreCountModeHistoryModel,
} from "./models/lottery-settings.model";
import {
  type CountModePlan,
  StoreCountModeService,
  toSettingRow,
} from "./store-count-mode.service";

const AUDIT_TARGET_TYPE = "lottery_setting";

/**
 * 刮刮樂設定(張數店規格第 4 節、5.5、9.1、9.2;正本 `docs/modules/project/lottery-settings.md`)。
 * 照抄排班規則(`schedule/rules/`):組織解析、沿組織樹的生效值、[自訂] / [還原]、權限分法都同一套。
 *
 * - **讀**:某個組織的整份設定 = 定義清單 × 組織鏈上的自訂;分店另附實際的盤點制度
 * - **寫**:最上層組織要 `edit-default`、其他組織要 `edit-org`(沒有 → `FORBIDDEN`);異動留稽核紀錄
 * - **盤點制度**:改 `count_mode`(自訂、還原、取消轉換)時同一個交易重算子樹裡分店的實際制度
 *   (`StoreCountModeService`);有分店被擋(檯面待標註、進行中的盤點 / 重刷 / 補點)整筆不存
 */
@Injectable()
export class LotterySettingsService {
  constructor(
    private readonly settings: LotterySettingsRepository,
    private readonly orgs: OrgsRepository,
    private readonly modes: StoreCountModeService,
    private readonly permissions: PermissionResolver,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  /** 設定頁:某個組織(缺席 = 當前組織)的整份設定。 */
  async list(
    operator: OperatorContext,
    orgId: string | null | undefined,
  ): Promise<LotterySettingsPayload> {
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    return this.payloadOf(operator, org);
  }

  /** 改盤點制度前的檢查(不寫入):會跟著改的分店、擋下的明細。 */
  async checkCountModeChange(
    operator: OperatorContext,
    input: LotteryCountModeChangeCheckInput,
  ): Promise<LotteryCountModeChangeCheckModel> {
    const org = await resolveScheduleOrg(operator, this.orgs, input.orgId);
    const option =
      input.option === undefined || input.option === null
        ? null
        : this.mustOption(
            this.mustDefinition(LOTTERY_SETTING_KEYS.countMode),
            input.option,
          );
    const plan = await this.modes.planCountModeChange(
      operator,
      { orgId: org.id, tenantId: org.tenantId },
      option as CountModeSetting | null,
      new Date(),
    );
    return checkModelOf(plan);
  }

  /** [自訂] 一條設定;盤點制度同一個交易重算下層分店。 */
  async customize(
    operator: OperatorContext,
    input: CustomizeLotterySettingInput,
  ): Promise<LotterySettingsPayload> {
    const definition = this.mustDefinition(input.key);
    const option = this.mustOption(definition, input.option);
    const org = await this.mustEditableOrg(operator, input.orgId);
    await this.writeOwn(operator, org, definition, option, "setting");
    return this.payloadOf(operator, org);
  }

  /** [還原]:刪掉本層這條的自訂;盤點制度同一個交易重算下層分店。 */
  async restore(
    operator: OperatorContext,
    input: RestoreLotterySettingInput,
  ): Promise<LotterySettingsPayload> {
    const definition = this.mustDefinition(input.key);
    const org = await this.mustEditableOrg(operator, input.orgId);
    await this.writeOwn(operator, org, definition, null, "setting");
    return this.payloadOf(operator, org);
  }

  /**
   * [取消轉換](9.2):轉換中的分店當下回到張數 = 幫這家店自訂一筆「張數」(之後上層預設再改也不跟著動,
   * 要按 [還原] 才恢復沿用);歷程記「轉換中 → 張數」(`convert_cancelled`)。
   */
  async cancelConversion(
    operator: OperatorContext,
    input: CancelLotteryCountModeConversionInput,
  ): Promise<LotterySettingsPayload> {
    const org = await this.mustEditableOrg(operator, input.orgId);
    if (!(await this.modes.isStore(operator, org.id))) {
      throw validationError(
        "only a store has a count mode",
        ["orgId"],
        LOTTERY_SETTINGS_REASONS.notStore,
      );
    }
    if (!canCancelConversion(await this.modes.modeOf(operator, org.id))) {
      throw validationError(
        "the store is not converting",
        ["orgId"],
        LOTTERY_SETTINGS_REASONS.notConverting,
      );
    }
    await this.writeOwn(
      operator,
      org,
      this.mustDefinition(LOTTERY_SETTING_KEYS.countMode),
      COUNT_MODE.count,
      "convert_cancelled",
    );
    return this.payloadOf(operator, org);
  }

  /** [變更紀錄]:某家分店的盤點制度歷程(新到舊)。 */
  async history(
    operator: OperatorContext,
    orgId: string,
  ): Promise<LotteryStoreCountModeHistoryModel> {
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const items = await this.modes.historyOf(operator, org.id);
    return {
      orgId: String(org.id),
      orgName: org.name,
      items,
    };
  }

  // ---- 內部 ----

  private mustDefinition(key: string): LotterySettingDefinition {
    const definition = lotterySettingDefinitionOf(key);
    if (!definition) {
      throw validationError(`unknown lottery setting: ${key}`, ["key"]);
    }
    return definition;
  }

  private mustOption(
    definition: LotterySettingDefinition,
    option: string,
  ): string {
    if (!definition.options.includes(option)) {
      throw validationError(`invalid option for ${definition.key}: ${option}`, [
        "option",
      ]);
    }
    return option;
  }

  private async holderOf(
    operator: OperatorContext,
  ): Promise<(key: string) => boolean> {
    if (operator.actorId === null) {
      return () => false;
    }
    const resolution = await this.permissions.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    return (key) => holdsPermission(resolution, key);
  }

  private editPermissionOf(org: ScheduleOrg): string {
    return org.isTenantTop
      ? LOTTERY_SETTINGS_PERMISSIONS.editDefault
      : LOTTERY_SETTINGS_PERMISSIONS.editOrg;
  }

  /** 看得到、而且操作者有這個組織要的權限。 */
  private async mustEditableOrg(
    operator: OperatorContext,
    orgId: string | null | undefined,
  ): Promise<ScheduleOrg> {
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const holds = await this.holderOf(operator);
    const required = this.editPermissionOf(org);
    if (!holds(required)) {
      throw missingPermissionError(
        `missing ${required} for org ${String(org.id)}`,
      );
    }
    return org;
  }

  /**
   * 本層寫入(`option` = 自訂成這個值;null = 還原)。一個使用者動作一個交易;盤點制度先算計畫,
   * 有分店被擋就整筆不存,否則同一個交易寫設定、重算分店實際制度、留稽核紀錄。
   */
  private async writeOwn(
    operator: OperatorContext,
    org: ScheduleOrg,
    definition: LotterySettingDefinition,
    option: string | null,
    cause: CountModeChangeCause,
  ): Promise<void> {
    const isCountMode = definition.key === LOTTERY_SETTING_KEYS.countMode;
    try {
      await this.transactions.withTransaction(async () => {
        const now = new Date();
        const plan = isCountMode
          ? await this.modes.planCountModeChange(
              operator,
              { orgId: org.id, tenantId: org.tenantId },
              option as CountModeSetting | null,
              now,
            )
          : null;
        if (plan !== null && !plan.canSave) {
          throw validationError(
            "count mode change is blocked",
            ["option"],
            LOTTERY_SETTINGS_REASONS.countModeChangeBlocked,
            { check: checkModelOf(plan) },
          );
        }
        await (option === null
          ? this.deleteOwn(operator, org, definition)
          : this.saveOwn(operator, org, definition, option));
        if (plan !== null) {
          await this.modes.applyCountModeChange(
            operator,
            org.tenantId,
            plan,
            cause,
            now,
          );
        }
      });
    } catch (error) {
      // 兩個請求同時第一次自訂同一條:唯一索引擋下第二筆
      if (isDuplicateKeyError(error)) {
        throw validationError(
          "lottery setting customized twice at the same time",
          ["key"],
          LOTTERY_SETTINGS_REASONS.concurrentEdit,
        );
      }
      throw error;
    }
  }

  private async saveOwn(
    operator: OperatorContext,
    org: ScheduleOrg,
    definition: LotterySettingDefinition,
    option: string,
  ): Promise<void> {
    const existing = await this.settings.findOne(operator, {
      orgId: org.id,
      key: definition.key,
    });
    const value = lotterySettingValueOf(option);
    const saved = existing
      ? await this.settings.updateById(operator, existing._id, {
          $set: { value },
        })
      : await this.settings.create(operator, {
          orgId: org.id,
          key: definition.key,
          enabled: true,
          value,
          level: null,
          order: 0,
        });
    if (!saved) {
      throw validationError(
        `lottery setting vanished: ${definition.key}`,
        ["key"],
        LOTTERY_SETTINGS_REASONS.concurrentEdit,
      );
    }
    await this.audit.record(operator, {
      action: "lottery-setting.customize",
      targetType: AUDIT_TARGET_TYPE,
      targetId: saved._id,
      before: existing
        ? { key: definition.key, value: existing.value }
        : undefined,
      after: { key: definition.key, value },
    });
  }

  private async deleteOwn(
    operator: OperatorContext,
    org: ScheduleOrg,
    definition: LotterySettingDefinition,
  ): Promise<void> {
    const own = await this.settings.findMany(operator, {
      orgId: org.id,
      key: definition.key,
    });
    for (const record of own) {
      await this.settings.softDeleteById(operator, record._id);
      await this.audit.record(operator, {
        action: "lottery-setting.restore",
        targetType: AUDIT_TARGET_TYPE,
        targetId: record._id,
        before: { key: record.key, value: record.value },
      });
    }
  }

  private async payloadOf(
    operator: OperatorContext,
    org: ScheduleOrg,
  ): Promise<LotterySettingsPayload> {
    const [records, names, holds, isStore] = await Promise.all([
      this.settings.findMany(operator, { orgId: { $in: org.chain } }),
      loadOrgNames(operator, this.orgs, org.chain),
      this.holderOf(operator),
      this.modes.isStore(operator, org.id),
    ]);
    const canEdit = holds(this.editPermissionOf(org));
    const valueOf = (
      setting: ResolvedLotterySetting,
    ): LotterySettingValueModel => {
      const sourceOrgId =
        setting.sourceOrgId === null
          ? null
          : new Types.ObjectId(setting.sourceOrgId);
      return {
        option: setting.option,
        source: setting.source,
        sourceOrgName:
          sourceOrgId !== null && isVisibleOrg(operator, sourceOrgId)
            ? (names.get(String(sourceOrgId)) ?? null)
            : null,
      };
    };
    const items = resolveLotterySettings(
      org.chain.map(String),
      records.map((record) => toSettingRow(record)),
    ).map(({ definition, effective, parent }) => ({
      key: definition.key,
      options: [...definition.options],
      effective: valueOf(effective),
      parent: parent === null ? null : valueOf(parent),
    }));
    const record = isStore ? await this.modes.recordOf(operator, org.id) : null;
    const mode = record?.mode ?? COUNT_MODE.numbered;
    return {
      orgId: String(org.id),
      orgName: org.name,
      isTenantTop: org.isTenantTop,
      isStore,
      canEdit,
      items,
      storeCountMode: isStore
        ? {
            mode,
            since: record?.since ?? null,
            lastRenumberAt: record?.lastRenumberAt ?? null,
            canCancelConversion: canEdit && canCancelConversion(mode),
          }
        : null,
    };
  }
}

/** 計畫 → 檢查的回傳形狀。 */
function checkModelOf(plan: CountModePlan): LotteryCountModeChangeCheckModel {
  return {
    stores: plan.outcomes.map((outcome) => ({
      orgId: outcome.orgId,
      orgName: outcome.orgName,
      from: outcome.from,
      to: outcome.to,
      problems: outcome.problems,
    })),
    pendingSkipBooks: plan.pendingSkipBooks,
    busyStores: plan.busyStores,
    canSave: plan.canSave,
  };
}
