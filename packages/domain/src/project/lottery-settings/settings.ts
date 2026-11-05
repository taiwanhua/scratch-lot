import {
  COUNT_MODE,
  type CountModeSetting,
  RENUMBER_CYCLES,
  type RenumberCycle,
} from "../lottery/count-mode";
import {
  type ChainSettingSource,
  chainRowOf,
  rowsByOrg,
} from "../org-setting-chain";

/**
 * 刮刮樂設定的**定義**(張數店規格第 4 節「第一批設定」、5.5):前後端共用同一份清單,設定頁依本清單順序一條一列。
 *
 * 每條設定都是「從幾個選項選一個」,存進 `lottery_settings.value` 的形狀一律 `{ option: string }`;
 * `lottery_settings` 整張照抄 `schedule_settings`(`enabled` 一律 true、`level` null、`order` 0,這批設定沒有開關與等級)。
 * 生效值沿組織樹往上找:分店 → 區域 → 最上層組織 → 程式預設(共用的 `@repo/domain/project/org-setting-chain`)。
 */

export const LOTTERY_SETTING_KEYS = {
  countMode: "count_mode",
  renumberRequired: "renumber_required",
  renumberReminder: "renumber_reminder",
  transferGridPick: "transfer_grid_pick",
} as const;
export type LotterySettingKey =
  (typeof LOTTERY_SETTING_KEYS)[keyof typeof LOTTERY_SETTING_KEYS];

/** 張數店補點編號:只提醒 / 必須(擋關帳)。 */
export const RENUMBER_REQUIREMENTS = ["remind", "required"] as const;
export type RenumberRequirement = (typeof RENUMBER_REQUIREMENTS)[number];

/** 調貨單可點格子選張:開 / 關。 */
export const TRANSFER_GRID_PICK_OPTIONS = ["on", "off"] as const;
export type TransferGridPick = (typeof TRANSFER_GRID_PICK_OPTIONS)[number];

/** 盤點制度設定的選項(轉換中是分店的狀態,不是設定值)。 */
export const COUNT_MODE_SETTINGS: readonly CountModeSetting[] = [
  COUNT_MODE.numbered,
  COUNT_MODE.count,
];

export interface LotterySettingDefinition {
  key: LotterySettingKey;
  /** 規格名詞(api 端的稽核與錯誤訊息用;admin 的畫面文字在 i18n `lotterySettings.labels.<key>`) */
  label: string;
  /** 可選的值,依畫面上的順序 */
  options: readonly string[];
  /** 程式預設(整條鏈上都沒有設定時用它) */
  defaultOption: string;
}

/** 規格第 4 節表的每一條,依表的順序。 */
export const LOTTERY_SETTING_DEFINITIONS: readonly LotterySettingDefinition[] =
  [
    {
      key: LOTTERY_SETTING_KEYS.countMode,
      label: "盤點制度",
      options: COUNT_MODE_SETTINGS,
      defaultOption: COUNT_MODE.numbered,
    },
    {
      key: LOTTERY_SETTING_KEYS.renumberRequired,
      label: "張數店補點編號",
      options: RENUMBER_REQUIREMENTS,
      defaultOption: "remind",
    },
    {
      key: LOTTERY_SETTING_KEYS.renumberReminder,
      label: "補點編號提醒",
      options: RENUMBER_CYCLES,
      defaultOption: "monthly",
    },
    {
      key: LOTTERY_SETTING_KEYS.transferGridPick,
      label: "調貨單可點格子選張",
      options: TRANSFER_GRID_PICK_OPTIONS,
      defaultOption: "on",
    },
  ];

export function lotterySettingDefinitionOf(
  key: string,
): LotterySettingDefinition | undefined {
  return LOTTERY_SETTING_DEFINITIONS.find(
    (definition) => definition.key === key,
  );
}

/** 存進 `value` 的形狀。 */
export function lotterySettingValueOf(option: string): { option: string } {
  return { option };
}

/** 一列自訂(`lottery_settings` 的必要欄位;orgId 以字串比對)。 */
export interface LotterySettingRow {
  orgId: string;
  key: string;
  value: Record<string, unknown>;
}

/** 一條設定在某條組織鏈上的生效值。 */
export interface ResolvedLotterySetting {
  option: string;
  source: ChainSettingSource;
  /** 生效值所在的組織;程式預設為 null */
  sourceOrgId: string | null;
}

export interface ResolvedLotterySettingItem {
  definition: LotterySettingDefinition;
  effective: ResolvedLotterySetting;
  /** 本層自訂時,上層的生效值(畫面上的「上層:編號盤點」);沒有自訂時為 null */
  parent: ResolvedLotterySetting | null;
}

/** 列上存的選項;壞資料(不在選項裡)當作沒有這列。 */
function optionOfRow(
  definition: LotterySettingDefinition,
  row: LotterySettingRow,
): string | undefined {
  const option = row.value.option;
  return typeof option === "string" && definition.options.includes(option)
    ? option
    : undefined;
}

function resolveOne(
  definition: LotterySettingDefinition,
  chain: readonly string[],
  byOrg: ReadonlyMap<string, readonly LotterySettingRow[]>,
): ResolvedLotterySetting {
  const hit = chainRowOf(
    chain,
    new Map(
      [...byOrg].map(([orgId, rows]) => [
        orgId,
        rows.filter((row) => optionOfRow(definition, row) !== undefined),
      ]),
    ),
    definition.key,
  );
  if (hit === null) {
    return {
      option: definition.defaultOption,
      source: "default",
      sourceOrgId: null,
    };
  }
  return {
    option: optionOfRow(definition, hit.value) ?? definition.defaultOption,
    source: hit.source,
    sourceOrgId: hit.orgId,
  };
}

/**
 * 整份設定(依定義清單順序)在這條組織鏈上的生效值;`chain[0]` 是自己。
 * `rows` 只需要是鏈上組織的自訂(其他組織的列被忽略)。
 */
export function resolveLotterySettings(
  chain: readonly string[],
  rows: readonly LotterySettingRow[],
): ResolvedLotterySettingItem[] {
  const byOrg = rowsByOrg(rows);
  const parentChain = chain.slice(1);
  return LOTTERY_SETTING_DEFINITIONS.map((definition) => {
    const effective = resolveOne(definition, chain, byOrg);
    if (effective.source !== "own") {
      return { definition, effective, parent: null };
    }
    const upper = resolveOne(definition, parentChain, byOrg);
    return {
      definition,
      effective,
      parent:
        upper.source === "own" ? { ...upper, source: "inherited" } : upper,
    };
  });
}

/** 某一條設定在這條鏈上的生效選項。 */
export function lotterySettingOptionOf(
  key: LotterySettingKey,
  chain: readonly string[],
  rows: readonly LotterySettingRow[],
): string {
  const definition = lotterySettingDefinitionOf(key);
  if (definition === undefined) {
    throw new Error(`沒有這條刮刮樂設定:${key}`);
  }
  return resolveOne(definition, chain, rowsByOrg(rows)).option;
}

/** 盤點制度設定的生效值(編號 / 張數)。 */
export function countModeSettingOf(
  chain: readonly string[],
  rows: readonly LotterySettingRow[],
): CountModeSetting {
  return lotterySettingOptionOf(LOTTERY_SETTING_KEYS.countMode, chain, rows) ===
    COUNT_MODE.count
    ? COUNT_MODE.count
    : COUNT_MODE.numbered;
}

/** 補點編號提醒週期的生效值。 */
export function renumberCycleOf(
  chain: readonly string[],
  rows: readonly LotterySettingRow[],
): RenumberCycle {
  return lotterySettingOptionOf(
    LOTTERY_SETTING_KEYS.renumberReminder,
    chain,
    rows,
  ) as RenumberCycle;
}
