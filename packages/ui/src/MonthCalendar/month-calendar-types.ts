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
 * 月曆尺寸:
 * - `medium`(預設):格子高度電腦大格(96px)、手機約 48px,隨螢幕寬度切換。
 * - `small`:任何寬度都用小格(約 40px)與小留白,給選日期的浮層、側欄這類窄容器。
 */
export type MonthCalendarSize = "small" | "medium";

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
  /**
   * 格子底色的**來源顏色**(CSS 顏色值,由資料帶來,例:行事曆特殊日選的顏色;使用處不寫死色碼)。
   * 元件以主題的 `action.selectedOpacity` 淡化後當底色,文字照常用 `text.primary`;給了就優先於 `tone`,
   * `disabled` 時以停用色為準
   */
  background?: string;
  /** 日期註記(例:特殊日名稱),畫在日期數字下方 */
  note?: ReactNode;
  /** 右上角角標(只有一個時;多個用 `corners`) */
  corner?: MonthCalendarCorner;
  /**
   * 右上角多個角標,依陣列順序由左到右並排;給了就取代 `corner`。
   * 超過月曆的 `maxCorners` 時,前面的照畫、其餘收成一個「+N」(同 MUI `AvatarGroup` 的 `max`)
   */
  corners?: readonly MonthCalendarCorner[];
  /**
   * 格子內的自訂內容(標籤、時段…),由使用處決定。內容裡 `position: absolute` 鋪滿整格的裝飾(底紋等)
   * 畫在日期數字、註記與角標底下;內容自己的文字要疊在裝飾上,文字那層給 `position: relative`。
   * 內容裡貼右上角的絕對定位元素(按鈕、圖示)會被角標蓋住,同一格有 `corners` 時不要放在右上角
   */
  content?: ReactNode;
}
