import {
  SCHEDULE_RULE_DEFINITIONS,
  type ScheduleRuleDefinition,
  type ScheduleRuleLevel,
} from "@repo/domain/project/schedule-settings";

import type { EffectiveRuleSetting } from "./rule-registry";

/**
 * 規則的生效值(規格 14.1、14.2;純函式,表格測試在 `rule-resolution.test.ts`):
 *
 * - **規則**:每條各自沿組織鏈(自己 → 上層 → … → 最上層組織)找第一個有自訂的組織,找不到用程式預設
 * - **自動排班條件整組繼承**:鏈上第一個「有任何一條自動排班條件自訂」的組織,整組以它為準
 *   (那個組織沒寫到的條件用程式預設);鏈上都沒有 → 整組程式預設
 * - 一列自訂的整筆(開關、值、等級、排序)一起覆寫,不分欄位繼承
 */

/** 一列自訂(`schedule_settings` 的必要欄位;orgId 以字串比對)。 */
export interface SettingRow {
  orgId: string;
  key: string;
  enabled: boolean;
  value: Record<string, unknown>;
  level: ScheduleRuleLevel | null;
  order: number;
}

/** 生效值從哪裡來:本層自訂 / 沿用某個上層 / 程式預設。 */
export type RuleSource = "own" | "inherited" | "default";

export interface ResolvedSetting extends EffectiveRuleSetting {
  source: RuleSource;
  /** 生效值所在的組織;程式預設為 null */
  sourceOrgId: string | null;
}

export interface ResolvedRule {
  definition: ScheduleRuleDefinition;
  effective: ResolvedSetting;
  /** 本層自訂時,上層的生效值(畫面上的「上層:8 天」);沒有自訂時為 null */
  parent: ResolvedSetting | null;
}

function defaultsOf(definition: ScheduleRuleDefinition): ResolvedSetting {
  return {
    key: definition.key,
    enabled: definition.defaults.enabled,
    value: definition.defaults.value,
    level: definition.defaults.level,
    order: definition.defaults.order,
    source: "default",
    sourceOrgId: null,
  };
}

function fromRow(row: SettingRow, source: RuleSource): ResolvedSetting {
  return {
    key: row.key,
    enabled: row.enabled,
    value: row.value,
    level: row.level,
    order: row.order,
    source,
    sourceOrgId: row.orgId,
  };
}

function rowsByOrg(rows: readonly SettingRow[]): Map<string, SettingRow[]> {
  const byOrg = new Map<string, SettingRow[]>();
  for (const row of rows) {
    byOrg.set(row.orgId, [...(byOrg.get(row.orgId) ?? []), row]);
  }
  return byOrg;
}

/** 一條規則在這條鏈上的生效值;`chain[0]` 是自己。 */
function resolveRule(
  definition: ScheduleRuleDefinition,
  chain: readonly string[],
  byOrg: ReadonlyMap<string, SettingRow[]>,
): ResolvedSetting {
  for (const [index, orgId] of chain.entries()) {
    const row = byOrg.get(orgId)?.find((item) => item.key === definition.key);
    if (row) {
      return fromRow(row, index === 0 ? "own" : "inherited");
    }
  }
  return defaultsOf(definition);
}

const AUTO_RUN_KEYS: ReadonlySet<string> = new Set(
  SCHEDULE_RULE_DEFINITIONS.filter(
    (definition) => definition.group === "autoRun",
  ).map((definition) => definition.key),
);

/** 自動排班條件整組:鏈上第一個有任何一條自訂的組織。 */
function resolveAutoRun(
  definition: ScheduleRuleDefinition,
  chain: readonly string[],
  byOrg: ReadonlyMap<string, SettingRow[]>,
): ResolvedSetting {
  for (const [index, orgId] of chain.entries()) {
    const groupRows = (byOrg.get(orgId) ?? []).filter((row) =>
      AUTO_RUN_KEYS.has(row.key),
    );
    if (groupRows.length === 0) {
      continue;
    }
    const source: RuleSource = index === 0 ? "own" : "inherited";
    const row = groupRows.find((item) => item.key === definition.key);
    return row
      ? fromRow(row, source)
      : { ...defaultsOf(definition), source, sourceOrgId: orgId };
  }
  return defaultsOf(definition);
}

function resolveOne(
  definition: ScheduleRuleDefinition,
  chain: readonly string[],
  byOrg: ReadonlyMap<string, SettingRow[]>,
): ResolvedSetting {
  return definition.group === "autoRun"
    ? resolveAutoRun(definition, chain, byOrg)
    : resolveRule(definition, chain, byOrg);
}

/** 上層的生效值:從自己看出去,鏈上第一個(父)也是「沿用」,不是本層自訂。 */
function asUpper(setting: ResolvedSetting): ResolvedSetting {
  return setting.source === "own"
    ? { ...setting, source: "inherited" }
    : setting;
}

/**
 * 整份規則(依定義清單順序)在這條組織鏈上的生效值。
 * `rows` 只需要是鏈上組織的自訂(其他組織的列被忽略)。
 */
export function resolveRules(
  chain: readonly string[],
  rows: readonly SettingRow[],
): ResolvedRule[] {
  const byOrg = rowsByOrg(rows);
  const parentChain = chain.slice(1);
  return SCHEDULE_RULE_DEFINITIONS.map((definition) => {
    const effective = resolveOne(definition, chain, byOrg);
    return {
      definition,
      effective,
      parent:
        effective.source === "own"
          ? asUpper(resolveOne(definition, parentChain, byOrg))
          : null,
    };
  });
}

/** 檢查用的生效設定(key → 設定);手動排班、自動排班、檢核面板、發布都讀這一份。 */
export function effectiveRuleSettings(
  chain: readonly string[],
  rows: readonly SettingRow[],
): Map<string, EffectiveRuleSetting> {
  return new Map(
    resolveRules(chain, rows).map(({ definition, effective }) => [
      definition.key,
      {
        key: effective.key,
        enabled: effective.enabled,
        value: effective.value,
        level: effective.level,
        order: effective.order,
      },
    ]),
  );
}
