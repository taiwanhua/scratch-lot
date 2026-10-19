/**
 * 側欄模組圖示的 key 白名單(前後端同一份,STRUCT-07;規則正本:`docs/modules/module-manager.md`)。
 *
 * 為什麼是白名單而不是自由字串:圖示最終要對應到 ui 的登錄表(`@repo/ui` 的
 * `moduleIcons`),登錄表以本檔為**型別來源** — 兩邊都吃 `ModuleIconKey`,
 * 少一個就 `check-types` 紅,不會出現「api 存得進去、admin 畫不出來」的值。
 *
 * 只有 key 陣列與型別,不含任何圖示元件(本包不碰 React,STRUCT-07 入包門檻①)。
 * 新增一個 key = 同一份 PR 同時補 ui 登錄表,否則側欄會拿到畫不出來的 key。
 */

/** 可選的側欄圖示 key(30 個;語意對照見 `docs/modules/module-manager.md`「側欄圖示」)。 */
export const MODULE_ICON_KEYS = [
  "dashboard",
  "home",
  "business",
  "account-tree",
  "people",
  "person",
  "shield",
  "key",
  "lock",
  "apps",
  "extension",
  "tune",
  "settings",
  "filter",
  "label",
  "category",
  "grid",
  "list",
  "folder",
  "description",
  "inventory",
  "store",
  "receipt",
  "chart",
  "calendar",
  "mail",
  "notifications",
  "restaurant",
  "star",
  "print",
] as const;

/** 白名單內的一個圖示 key。 */
export type ModuleIconKey = (typeof MODULE_ICON_KEYS)[number];

/**
 * 是不是白名單內的 key。`null` / `undefined` 不是 —— 「沒有圖示」是合法狀態,
 * 但那是呼叫端先判掉的分支,不由本函式代表(api 的 `setModuleIcon` 先放行 null,再用本函式驗值)。
 */
export function isModuleIconKey(value: unknown): value is ModuleIconKey {
  return (
    typeof value === "string" &&
    (MODULE_ICON_KEYS as readonly string[]).includes(value)
  );
}
