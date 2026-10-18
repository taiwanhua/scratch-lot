/**
 * 時間軸的版面尺寸(px)。來源:Figma ScheduleTimeline 示範卡與規則頁;
 * 只有本元件用到,依 STYLE-06 直寫在這裡。
 */

/** 週模式一小時的高(示範卡 08:00 → 09:00 = 36)。 */
export const WEEK_HOUR_HEIGHT = 36;
/** 週模式左側時間欄寬。 */
export const WEEK_TIME_COLUMN_WIDTH = 48;
/** 週模式量不到寬度時(例:測試環境)的一天欄寬:設計稿電腦 1440 的 157。 */
export const DEFAULT_WEEK_DAY_WIDTH = 157;
/** 週模式容器內長條的左邊:容器左 + 20(直排標題)+ 2;長條寬 26、間隔 2(一條佔 28)。 */
export const WEEK_BAR_INSET = 22;
export const WEEK_BAR_WIDTH = 26;
/** 「+N」長條寬 20,放在保留的最右邊 24px 內(左 2、右 2)。 */
export const WEEK_MORE_WIDTH = 20;
export const WEEK_MORE_INSET = 22;

/** 日模式一小時的寬(示範卡 06:00 → 07:00 = 64)。 */
export const DAY_HOUR_WIDTH = 64;
/** 日模式左側凍結的日期欄寬。 */
export const DAY_DATE_COLUMN_WIDTH = 96;
/** 日模式容器:標題列高 + 上下內距;每條高 26、間隔 4。 */
export const DAY_GROUP_PADDING_Y = 6;
export const DAY_GROUP_TITLE_HEIGHT = 18;
export const DAY_BAR_HEIGHT = 26;
export const DAY_SLOT_GAP = 4;
/** 日模式列與列之間、第一列上方的間距。 */
export const DAY_LANE_GAP = 12;

/** 表頭列高。 */
export const HEADER_HEIGHT = 36;

/** 日模式容器高:比裡面所有長條高一點(標題列 + 每條 30 + 上下內距)。 */
export const dayGroupHeight = (slots: number): number =>
  DAY_GROUP_PADDING_Y * 2 +
  DAY_GROUP_TITLE_HEIGHT +
  slots * (DAY_BAR_HEIGHT + DAY_SLOT_GAP);

/** 日模式容器內第 `index` 條的上緣(相對容器)。 */
export const daySlotTop = (index: number): number =>
  DAY_GROUP_PADDING_Y +
  DAY_GROUP_TITLE_HEIGHT +
  DAY_SLOT_GAP +
  index * (DAY_BAR_HEIGHT + DAY_SLOT_GAP);

/** 分鐘 → 週模式的 y / 日模式的 x。 */
export const weekY = (minute: number): number =>
  (minute / 60) * WEEK_HOUR_HEIGHT;
export const dayX = (minute: number): number => (minute / 60) * DAY_HOUR_WIDTH;

/** 週模式一天欄的高 / 日模式時間軌道的寬(00:00–24:00)。 */
export const WEEK_DAY_HEIGHT = 24 * WEEK_HOUR_HEIGHT;
export const DAY_TRACK_WIDTH = 24 * DAY_HOUR_WIDTH;
