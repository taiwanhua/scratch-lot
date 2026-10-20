import type { ScheduleTabEntry } from "@/components/project/schedule/ScheduleTabsPage/ScheduleTabsPage";

/**
 * 出勤紀錄(`schedule.attendance`,表單模組:綁定 補打卡申請)的分頁
 * (規格 14.7:依人員(月)/ 依分店(日))。頁殼先建好,各分頁由負責的功能追加一列。
 */
export const ATTENDANCE_TABS: readonly ScheduleTabEntry[] = [];
