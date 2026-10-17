import type { ReactNode } from "react";

/** 角標小圓點可用的色系(只用主題的語意色,STYLE-01)。 */
export type MonthCalendarCornerColor =
  "primary" | "info" | "success" | "warning" | "error";

/**
 * 日期格右上角的角標(《底座規格》10.5):
 * - `dot`:小圓點(例:有異動、缺卡),顏色由使用處決定;`label` 是給報讀器的說明。
 * - `badge`:error badge,內容由使用處決定(例:「缺下班卡」)。
 */
export type MonthCalendarCorner =
  | { variant: "dot"; color: MonthCalendarCornerColor; label: string }
  | { variant: "badge"; content: ReactNode };

/** 使用處對單一日期的設定;只對本月的日期生效(前後補的日子只顯示數字)。 */
export interface MonthCalendarDayInfo {
  /** 不能選的日子(例:店休):停用色、點了沒反應 */
  disabled?: boolean;
  /** 停用的原因,滑過時提示 */
  disabledReason?: ReactNode;
  /** 日期註記(例:特殊日名稱),畫在日期數字下方 */
  note?: ReactNode;
  /** 右上角角標 */
  corner?: MonthCalendarCorner;
  /** 格子內的自訂內容(標籤、班別…),由使用處決定 */
  content?: ReactNode;
}
