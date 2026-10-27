import type { ComponentType } from "react";

import {
  rosterDateOf,
  weekReadRangeOf,
} from "@/lib/project/schedule-roster-views";

import { RosterColumnPicker } from "./RosterColumnPicker";
import type { RosterData } from "./roster-context";
import { DayNavigator } from "./views/DayNavigator";
import { DayView } from "./views/DayView";
import { MonthView } from "./views/MonthView";
import { RosterGridView } from "./views/RosterGridView";
import { WeekNavigator } from "./views/WeekNavigator";
import { WeekView } from "./views/WeekView";

/** 工具列第二列取代 `◀ 2026 年 11 月 ▶` 的期間切換(週 / 日檢視顯示那一週 / 那一天)。 */
export interface RosterNavigatorProps {
  /** 排班表資料(還沒載到為 undefined) */
  data: RosterData | undefined;
  /** 目前的月份 `YYYY-MM` */
  month: string;
}

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
  /** 取代月份切換的期間切換(週 / 日);沒給 = `◀ 2026 年 11 月 ▶` */
  Navigator?: ComponentType<RosterNavigatorProps>;
  /**
   * 這個檢視要多讀的日期範圍(`scheduleRoster` 的 `from` / `to`;週檢視跨月)。`dateParam` 是網址的
   * `?date=`、`today` 是租戶時區的今天;不用多讀回 null。
   */
  readRangeOf?: (
    dateParam: string,
    month: string,
    today: string,
  ) => { from: string; to: string } | null;
}

export const ROSTER_VIEWS: readonly RosterViewEntry[] = [
  { value: "month", labelKey: "month", Content: MonthView },
  {
    value: "week",
    labelKey: "week",
    Content: WeekView,
    Navigator: WeekNavigator,
    readRangeOf: (dateParam, month, today) =>
      weekReadRangeOf(rosterDateOf(dateParam, month, today), month),
  },
  {
    value: "day",
    labelKey: "day",
    Content: DayView,
    Navigator: DayNavigator,
    isMobileDefault: true,
  },
  {
    value: "roster",
    labelKey: "roster",
    Content: RosterGridView,
    isDesktopDefault: true,
    Tools: RosterColumnPicker,
  },
];
