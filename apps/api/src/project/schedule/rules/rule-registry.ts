import {
  SCHEDULE_RULE_DEFINITIONS,
  type ScheduleRuleDefinition,
  type ScheduleRuleLevel,
  scheduleRuleDefinitionOf,
} from "@repo/domain/project/schedule-settings";

/**
 * 排班規則登記(規格 14.1 `schedule_settings`:`{key, group, label, valueType, unit, range, defaults, run}`)。
 *
 * - **定義**(key … defaults)在 `@repo/domain/project/schedule-settings`,前後端共用;規則頁依它的順序列出
 * - **`run`(檢查函式)由各功能登記**:`registerRuleEvaluator(key, evaluator)`。檢查用到的資料
 *   (排班、畫休、人力需求)由呼叫檢查的一方準備好放進 `data`,檢查函式本身是純函式;
 *   手動排班、自動排班、檢核面板、發布都呼叫同一個檢查函式、吃同一份生效設定(規格 14.2「等級」)
 * - 一個 key 只能登記一次;登記不存在的 key 直接拋錯(打錯字不會靜默變成沒有檢查)
 */

/** 一條規則在某家店的**生效設定**(沿組織樹往上找、最後用程式預設,見 `rule-resolution.ts`)。 */
export interface EffectiveRuleSetting {
  key: string;
  enabled: boolean;
  value: Record<string, unknown>;
  level: ScheduleRuleLevel | null;
  order: number;
}

/** 檢查函式的輸入:這條規則的生效設定 + 呼叫端準備的資料。 */
export interface ScheduleRuleEvaluationContext<TData = unknown> {
  tenantId: string;
  /** 檢查的分店(人的規則用那個人的主要分店的設定,由呼叫端決定傳哪一家) */
  orgId: string;
  setting: EffectiveRuleSetting;
  data: TData;
}

/** 一筆違反:等級照生效設定;`targets` 指到違反的排班 / 人 / 日期(檢核面板的 [查看] 用)。 */
export interface ScheduleRuleViolation {
  key: string;
  level: ScheduleRuleLevel;
  /** 給人看的說明(例「本月畫休 9 天,上限 8 天」) */
  message: string;
  targets: { entryId?: string; userId?: string; date?: string }[];
}

export type ScheduleRuleEvaluator<TData = unknown> = (
  context: ScheduleRuleEvaluationContext<TData>,
) => ScheduleRuleViolation[] | Promise<ScheduleRuleViolation[]>;

/** 規則登記的一列 = 定義 + 檢查函式(還沒登記的為 null)。 */
export interface ScheduleRuleRegistryEntry extends ScheduleRuleDefinition {
  run: ScheduleRuleEvaluator | null;
}

const evaluators = new Map<string, ScheduleRuleEvaluator>();

/** 登記一條規則的檢查函式;key 不在定義清單、或已登記過 → 拋錯。 */
export function registerRuleEvaluator<TData>(
  key: string,
  evaluator: ScheduleRuleEvaluator<TData>,
): void {
  if (scheduleRuleDefinitionOf(key) === undefined) {
    throw new Error(`排班規則 ${key} 不在定義清單裡,不能登記檢查函式`);
  }
  if (evaluators.has(key)) {
    throw new Error(`排班規則 ${key} 的檢查函式已經登記過`);
  }
  evaluators.set(key, evaluator as ScheduleRuleEvaluator);
}

/** 某條規則的檢查函式;沒登記回 null。 */
export function ruleEvaluatorOf(key: string): ScheduleRuleEvaluator | null {
  return evaluators.get(key) ?? null;
}

/** 整份登記(依定義清單的順序)。 */
export function scheduleRuleRegistry(): readonly ScheduleRuleRegistryEntry[] {
  return SCHEDULE_RULE_DEFINITIONS.map((definition) => ({
    ...definition,
    run: ruleEvaluatorOf(definition.key),
  }));
}

/** 只給測試用:清空已登記的檢查函式。 */
export function clearRuleEvaluatorsForTest(): void {
  evaluators.clear();
}
