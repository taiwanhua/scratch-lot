import type { LotterySettingsFieldsFragment } from "@repo/graphql";

/** 設定頁要的 i18n(`admin.lotterySettings` namespace 的 `t`)。 */
export type SettingTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export type LotterySettings = LotterySettingsFieldsFragment;
export type LotterySettingItem = LotterySettings["items"][number];
type SettingValue = LotterySettingItem["effective"];

/** 一條設定某個選項的名稱(例「編號盤點」「每月」)。 */
export const optionText = (
  t: SettingTranslate,
  key: string,
  option: string,
): string => t(`options.${key}.${option}`);

/**
 * 值那一欄的文字。盤點制度在分店是轉換中時寫「張數盤點 → 編號盤點(轉換中,等補點編號)」(規格第 4 節)。
 */
export const settingValueText = (
  t: SettingTranslate,
  item: Pick<LotterySettingItem, "key">,
  setting: Pick<SettingValue, "option">,
  storeMode: string | null,
): string =>
  item.key === "count_mode" && storeMode === "converting"
    ? t("converting")
    : optionText(t, item.key, setting.option);

/**
 * 來源那一欄的文字(照排班規則):本層自訂 →「本店自訂」(最上層組織「本層自訂」);
 * 沿用 →「沿用:<上層組織名稱>」,看不到上層 →「沿用上層設定」;都沒設 →「程式預設」。
 */
export const settingSourceText = (
  t: SettingTranslate,
  setting: Pick<SettingValue, "source" | "sourceOrgName">,
  isTenantTop: boolean,
): string => {
  switch (setting.source) {
    case "own": {
      return isTenantTop ? t("source.ownTop") : t("source.own");
    }
    case "inherited": {
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

/** 自訂的列下方灰色小字:「上層:編號盤點」。 */
export const settingParentText = (
  t: SettingTranslate,
  item: Pick<LotterySettingItem, "key">,
  parent: Pick<SettingValue, "option">,
): string => t("parent", { value: optionText(t, item.key, parent.option) });
