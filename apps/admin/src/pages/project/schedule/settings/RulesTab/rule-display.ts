import { ScheduleRuleSource } from "@repo/graphql";

/** 規則頁要的 i18n(`admin.schedule.rules` namespace 的 `t`)。 */
export type RuleTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** 一份設定(生效值或上層值)— 與 codegen 的 `ScheduleRuleSettingFieldsFragment` 同形。 */
export interface RuleSettingLike {
  enabled: boolean;
  value: Record<string, unknown>;
  level?: string | null;
  source: ScheduleRuleSource;
  sourceOrgName?: string | null;
}

export interface RuleLike {
  key: string;
  valueType: string;
  unit?: string | null;
}

/** 顯示值時要查的名稱(週範本、執行任務)。 */
export interface RuleLookups {
  weekTemplateName: (id: string) => string | null;
  taskLabel: (key: string) => string;
}

const numberOf = (value: unknown): number =>
  typeof value === "number" ? value : 0;

const stringOf = (value: unknown): string =>
  typeof value === "string" ? value : "";

const amountText = (
  t: RuleTranslate,
  unit: string | null | undefined,
  n: number,
) => {
  return t(`units.${unit ?? "none"}`, { n });
};

const breakTiersText = (t: RuleTranslate, value: Record<string, unknown>) => {
  const tiers = Array.isArray(value.tiers) ? (value.tiers as unknown[]) : [];
  return tiers
    .map((tier) => {
      const record = (tier ?? {}) as Record<string, unknown>;
      const minutes = numberOf(record.minMinutes);
      return t("value.breakTier", {
        hours: Math.floor(minutes / 60),
        minutes: minutes % 60,
        breakMinutes: numberOf(record.breakMinutes),
      });
    })
    .join(t("value.separator"));
};

/** 值那一欄的文字(例「8 天」「每月 15–25 日」「滿 4 小時 30 分、滿 8 小時 60 分」)。 */
export const ruleValueText = (
  t: RuleTranslate,
  rule: RuleLike,
  setting: RuleSettingLike,
  lookups: RuleLookups,
): string => {
  const { value } = setting;
  switch (rule.valueType) {
    case "amount": {
      return amountText(t, rule.unit, numberOf(value.amount));
    }
    case "dayRange": {
      return t("value.dayRange", {
        start: numberOf(value.startDay),
        end: numberOf(value.endDay),
      });
    }
    case "weekTemplate": {
      const id = stringOf(value.weekTemplateId);
      return id === ""
        ? t("value.notSet")
        : (lookups.weekTemplateName(id) ?? t("value.unknownWeekTemplate"));
    }
    case "grace": {
      return t("value.grace", {
        late: numberOf(value.lateGraceMinutes),
        early: numberOf(value.earlyLeaveGraceMinutes),
      });
    }
    case "breakTiers": {
      return breakTiersText(t, value);
    }
    case "defaultTasks": {
      return t("value.defaultTasks", {
        leader: lookups.taskLabel(stringOf(value.defaultLeaderTaskKey)),
        helper: lookups.taskLabel(stringOf(value.defaultHelperTaskKey)),
      });
    }
    default: {
      if (rule.key === "understaffed") {
        return setting.enabled ? t("value.byDemand") : t("value.off");
      }
      return setting.enabled ? t("value.on") : t("value.off");
    }
  }
};

/**
 * 來源那一欄的文字(規格 14.2):本層自訂 →「本店自訂」(最上層組織「本層自訂」);
 * 沿用 →「沿用:<上層組織名稱>」,看不到上層 →「沿用上層設定」;都沒設 →「系統預設」。
 */
export const ruleSourceText = (
  t: RuleTranslate,
  setting: RuleSettingLike,
  isTenantTop: boolean,
): string => {
  switch (setting.source) {
    case ScheduleRuleSource.Own: {
      return isTenantTop ? t("source.ownTop") : t("source.own");
    }
    case ScheduleRuleSource.Inherited: {
      return setting.sourceOrgName === null ||
        setting.sourceOrgName === undefined
        ? t("source.inheritedHidden")
        : t("source.inherited", { org: setting.sourceOrgName });
    }
    default: {
      return t("source.default");
    }
  }
};

/** 一列的摘要(手機卡片、報讀):「沿用:好運彩券行 8 天」「本店自訂:6 天」。 */
export const ruleSummaryText = (
  t: RuleTranslate,
  rule: RuleLike,
  setting: RuleSettingLike,
  isTenantTop: boolean,
  lookups: RuleLookups,
): string => {
  return t("summary", {
    source: ruleSourceText(t, setting, isTenantTop),
    value: ruleValueText(t, rule, setting, lookups),
  });
};

/** 自訂的列下方灰色小字:「上層:8 天」。 */
export const ruleParentText = (
  t: RuleTranslate,
  rule: RuleLike,
  parent: RuleSettingLike,
  lookups: RuleLookups,
): string => {
  return t("parent", { value: ruleValueText(t, rule, parent, lookups) });
};
