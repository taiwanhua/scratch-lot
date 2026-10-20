import type { ScheduleTabEntry } from "@/components/project/schedule/ScheduleTabsPage/ScheduleTabsPage";

import { CalendarTab } from "./CalendarTab/CalendarTab";

/**
 * 排班作業(`schedule.manage`,表單模組:綁定 支援需求單)的分頁
 * (規格 14.5:排班表 | 畫休總覽 | 行事曆 | 支援需求單,依權限顯示)。各功能只追加自己那一列,
 * 依規格的順序插入。
 */
export const MANAGE_TABS: readonly ScheduleTabEntry[] = [
  { value: "calendar", labelKey: "calendar", Content: CalendarTab },
];
