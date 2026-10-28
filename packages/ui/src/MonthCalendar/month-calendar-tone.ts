import type { MonthCalendarDayTone } from "./month-calendar-types";

/**
 * 底色語意 → 主題 token(色碼由主題決定,深色模式跟著換)。兩者都是中性灰階,不用狀態色:
 * - `special`:`action.selected`(灰 16%),和 `closed`、停用色(24%)深淺分開
 * - `closed`:`action.hover`(灰 8%)
 *
 * 月曆以外要畫同一個底色時(例:同一份資料的清單檢視)引用這裡,不另抄 token。
 */
export const MONTH_CALENDAR_TONE_BACKGROUND: Readonly<
  Record<MonthCalendarDayTone, string>
> = {
  special: "action.selected",
  closed: "action.hover",
};
