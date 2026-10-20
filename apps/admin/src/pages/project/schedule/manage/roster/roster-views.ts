import type { ComponentType } from "react";

import { RosterColumnPicker } from "./RosterColumnPicker";
import { RosterGridView } from "./views/RosterGridView";

/**
 * 排班表的檢視切換(規格 14.5:`[ 月 | 週 | 日 | 班表 ]`,讀同一份資料、修改都開同一套對話框)。
 * 每個檢視一列,依規格順序插入;檢視元件用 `useRoster()` 拿資料與動作。
 */
export interface RosterViewEntry {
  /** 網址 `?view=` 的值 */
  value: string;
  /** 切換鈕文字 `admin.schedule.roster.views.<labelKey>` */
  labelKey: string;
  Content: ComponentType;
  /** 手機預設的檢視(規格:電腦預設班表、手機預設日) */
  isMobileDefault?: boolean;
  /** 電腦 / 平板預設的檢視 */
  isDesktopDefault?: boolean;
  /** 這個檢視的工具列右側多出的東西(班表檢視的 [⚙ 顯示欄位]) */
  Tools?: ComponentType;
}

export const ROSTER_VIEWS: readonly RosterViewEntry[] = [
  {
    value: "roster",
    labelKey: "roster",
    Content: RosterGridView,
    isDesktopDefault: true,
    Tools: RosterColumnPicker,
  },
];
