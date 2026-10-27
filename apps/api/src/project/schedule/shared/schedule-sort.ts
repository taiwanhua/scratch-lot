/**
 * 排班畫面上的姓名 / 名稱排序:**明寫語系** `zh-Hant`(先例 `forms/lookup-providers.ts`)。
 * 不帶語系的 `localeCompare` 吃執行環境的預設語系 —— 本機 Windows(zh-TW)與 Cloud Run(Linux)排出來的先後不同,
 * 使用者看到的清單順序就會跟著部署環境變。zh-Hant 依筆畫排(王 4 畫在 李 7 畫之前),英文字排在中文之後。
 */
export const SCHEDULE_SORT_LOCALE = "zh-Hant";

/** 依 zh-Hant 比較兩個姓名 / 名稱(給 `toSorted` 用)。 */
export function compareScheduleNames(left: string, right: string): number {
  return left.localeCompare(right, SCHEDULE_SORT_LOCALE);
}
