import type { ReactNode } from "react";

/** 角標小圓點可用的色系(只用主題的語意色,STYLE-01)。 */
export type MonthCalendarCornerColor =
  "primary" | "info" | "success" | "warning" | "error";

/**
 * 日期格右上角的角標:
 * - `dot`:小圓點(例:有異動、缺卡),顏色由使用處決定;`label` 是給報讀器的說明。
 * - `badge`:error badge,內容由使用處決定(例:「資料待補」)。
 */
export type MonthCalendarCorner =
  | { variant: "dot"; color: MonthCalendarCornerColor; label: string }
  | { variant: "badge"; content: ReactNode };

/**
 * 日期格的底色(顏色由主題 token 提供,使用處只給語意):
 * - `special`:特殊日(例:店慶)——淡藍底(`info.lighter`)
 * - `closed`:休息日但仍可點(例:店休)——淡灰底(`action.hover`);不能點的日子用 `disabled`
 */
export type MonthCalendarDayTone = "special" | "closed";

/** 使用處對單一日期的設定;只對本月的日期生效(前後補的日子只顯示數字)。 */
export interface MonthCalendarDayInfo {
  /** 不能選的日子(例:公休):停用色、點了沒反應 */
  disabled?: boolean;
  /** 停用的原因,滑過時提示 */
  disabledReason?: ReactNode;
  /** 格子底色(語意,見 `MonthCalendarDayTone`);`disabled` 時以停用色為準 */
  tone?: MonthCalendarDayTone;
  /** 日期註記(例:特殊日名稱),畫在日期數字下方 */
  note?: ReactNode;
  /** 右上角角標 */
  corner?: MonthCalendarCorner;
  /** 格子內的自訂內容(標籤、時段…),由使用處決定 */
  content?: ReactNode;
}
