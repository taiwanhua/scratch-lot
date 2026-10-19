import type { ReactNode } from "react";

/** 時點:`Date` 或 epoch 毫秒(呼叫端給時點,元件依瀏覽器時區換成「哪一天的幾點」)。 */
export type ScheduleTimelineTime = Date | number;

/** 日模式一天,時間由左往右;週模式每天一欄,時間由上往下。 */
export type ScheduleTimelineMode = "day" | "week";

/** 顯示的一天(日模式 1 天、週模式 7 天,順序就是欄的順序)。 */
export interface ScheduleTimelineDate {
  /** `YYYY-MM-DD` */
  date: string;
  /** 表頭日期後面的文字(例:「三」「三 活動日」),由使用的模組決定 */
  label?: ReactNode;
  /** 日期背景色(例:特殊日;主題色票如 `info.lighter`,或行事曆設定的顏色) */
  background?: string;
}

/** 不能操作的時間範圍(灰色;例:公休整天、已排於其他場地)。跨午夜的範圍兩天各畫一段。 */
export interface ScheduleTimelineDisabledRange {
  start: ScheduleTimelineTime;
  end: ScheduleTimelineTime;
  /** 範圍中間的說明(例:「公休」) */
  label?: ReactNode;
}

/** 長條狀態:正常 / 較短(只上部分時段)/ 停用(不能操作,灰色、不可點)。 */
export type ScheduleTimelineBarState = "normal" | "short" | "disabled";

/** 長條色系(Figma Draft/ScheduleTimelineBlock 的 Normal / Warning / Empty)。 */
export type ScheduleTimelineBarTone = "primary" | "warning" | "error";

/** 容器裡的一條長條(例:一筆排程)。 */
export interface ScheduleTimelineBar {
  kind: "bar";
  id: string;
  start: ScheduleTimelineTime;
  end: ScheduleTimelineTime;
  /** 標題(例:負責人綠標籤 + 姓名);週模式直排 */
  title: ReactNode;
  /** 副標(日模式第二行;例:「超出容器的時間」) */
  subtitle?: ReactNode;
  /** 預設 `normal` */
  state?: ScheduleTimelineBarState;
  /** 預設 `primary` */
  tone?: ScheduleTimelineBarTone;
  /**
   * 右上角的小圖示與徽章(例:自動排入標記、「×2」),內容由模組決定;
   * 多個時日模式左右並排、週模式(窄長條)依序往下排
   */
  marks?: readonly ReactNode[];
  /** 滑過時的提示內容 */
  tooltip?: ReactNode;
  /** 無障礙名稱;預設是時段「HH:mm–HH:mm」 */
  ariaLabel?: string;
}

/** 缺額虛線空位的強度:錯誤色(例:缺負責)/ 警告色(例:缺協同)。 */
export type ScheduleTimelineVacancySeverity = "error" | "warning";

/** 容器裡的一個缺額虛線空位(佔一條,時段 = 所屬容器的時段)。 */
export interface ScheduleTimelineVacancy {
  kind: "vacancy";
  id: string;
  /** 例:「缺協同 1」;週模式直排 */
  label: ReactNode;
  severity: ScheduleTimelineVacancySeverity;
  tooltip?: ReactNode;
  /** 無障礙名稱;預設是 `label`(字串時)或 id */
  ariaLabel?: string;
}

/** 容器裡的一條:長條或缺額空位。 */
export type ScheduleTimelineSlot =
  ScheduleTimelineBar | ScheduleTimelineVacancy;

/** 容器框色(Figma Draft/ScheduleTimelineDemand 的 Tone)。 */
export type ScheduleTimelineGroupTone = "neutral" | "warning" | "error";

/** 一個群組(例:一筆時段需求),畫成容器;裡面放屬於它的長條與缺額空位。 */
export interface ScheduleTimelineGroup {
  /** 唯一識別(排序的最後一關) */
  id: string;
  start: ScheduleTimelineTime;
  end: ScheduleTimelineTime;
  /** 容器標題(日模式;例:「上午場 · 場地 A 08:30–14:30 · 負責 1/1」) */
  title: ReactNode;
  /** 週模式左側 20px 的直排標題(例:「早 2/2」);預設同 `title` */
  shortTitle?: ReactNode;
  /** 預設 `neutral` */
  tone?: ScheduleTimelineGroupTone;
  /**
   * 容器裡的條,排列順序由模組提供(例:負責 → 缺負責 → 協同 → 缺協同);
   * 條數 = 長度(週模式容器寬 = 20 + 28 × 條數)
   */
  slots: readonly ScheduleTimelineSlot[];
  /** 排序鍵,逐項升冪(例:[崗位排序, 範本排序]),見 `layoutTimeline` */
  sortKeys?: readonly number[];
  /** 建立時間(epoch 毫秒;排序鍵之後的平手規則) */
  createdAt: number;
  tooltip?: ReactNode;
  /** 無障礙名稱;預設是 `title`(字串時)或時段 */
  ariaLabel?: string;
}

/** 回呼帶出的點:點到的日期與時間(那一小時格的開始;鍵盤操作時是該段的開始所在的格)。 */
export interface ScheduleTimelinePoint {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm` */
  time: string;
  /** 同一時點(瀏覽器時區) */
  at: Date;
}

/** 已選取的東西(受控):容器 / 長條 / 缺額空位以 id,「+N」長條以日期。 */
export type ScheduleTimelineSelection =
  | { kind: "group" | "bar" | "vacancy"; id: string }
  | { kind: "more"; date: string };

/** 「+N」長條的框色(Figma Draft/ScheduleTimelineMore 的 Tone),由模組依被收起內容決定。 */
export type ScheduleTimelineMoreTone = "neutral" | "warning" | "error";
