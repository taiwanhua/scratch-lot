import { useTranslations } from "use-intl";

import { ScheduleTabsPage } from "@/components/project/schedule/ScheduleTabsPage/ScheduleTabsPage";

import { MANAGE_TABS } from "./manage-tabs";

/**
 * 排班作業(`schedule.manage`)的列表頁(表單模組的列表頁換成分頁頁殼;支援需求單的詳情 / 新增 / 編輯
 * 沿用表單引擎)。分頁登記在 `manage-tabs.ts`。
 */
export const ScheduleManagePage = () => {
  const t = useTranslations("admin.schedule.pages");
  return <ScheduleTabsPage title={t("manage")} tabs={MANAGE_TABS} />;
};
