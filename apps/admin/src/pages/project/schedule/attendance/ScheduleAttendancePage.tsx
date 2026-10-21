import { useTranslations } from "use-intl";

import { ScheduleTabsPage } from "@/components/project/schedule/ScheduleTabsPage/ScheduleTabsPage";

import { ATTENDANCE_TABS } from "./attendance-tabs";

/**
 * 出勤紀錄(`schedule.attendance`)的列表頁(表單模組的列表頁換成分頁頁殼;詳情 / 新增 / 編輯沿用表單引擎)。
 * 分頁登記在 `attendance-tabs.ts`。
 */
export const ScheduleAttendancePage = () => {
  const t = useTranslations("admin.schedule.pages");
  return <ScheduleTabsPage title={t("attendance")} tabs={ATTENDANCE_TABS} />;
};
