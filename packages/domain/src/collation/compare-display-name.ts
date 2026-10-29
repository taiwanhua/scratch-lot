/**
 * 字串排序的語系(STRUCT-10):`localeCompare` 一律明給 `zh-Hant`,不留給執行環境決定。
 *
 * 不帶語系時 `localeCompare` 吃執行環境的預設語系:開發機通常是 zh-TW、CI 與 Cloud Run
 * (Linux)通常退回 en-US,中文字的先後跟著不同,使用者看到的清單順序與測試斷言都會隨環境變。
 * zh-Hant 依筆畫排中文(王 4 畫在李 7 畫之前),拉丁字母排在中文之後。
 *
 * key / 代號 / 日期字串這類純 ASCII 的排序也明給同一個語系:ASCII 在 zh-Hant 與 en 的
 * ICU 排序規則相同,統一後不改變既有順序,只是不再依賴執行環境。
 */
export const COLLATION_LOCALE = "zh-Hant";

const displayNameCollator = new Intl.Collator(COLLATION_LOCALE);

/**
 * 比較兩個給人看的名稱(姓名、組織名、選項名…),給 `toSorted` 用。
 *
 * 固定 `zh-Hant`:中文依筆畫,英文字排在中文之後;同一組輸入在任何環境排出同一個順序。
 */
export function compareDisplayName(left: string, right: string): number {
  return displayNameCollator.compare(left, right);
}
