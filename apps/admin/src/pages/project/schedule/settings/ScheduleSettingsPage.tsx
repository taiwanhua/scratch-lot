import { useTranslations } from "use-intl";

import { ScheduleTabsPage } from "@/components/project/schedule/ScheduleTabsPage/ScheduleTabsPage";

import { SETTINGS_TABS } from "./settings-tabs";

/** 排班設定(`schedule.settings`,規格 3.1、14.2–14.4):分頁登記在 `settings-tabs.ts`。 */
export const ScheduleSettingsPage = () => {
  const t = useTranslations("admin.schedule.pages");
  return <ScheduleTabsPage title={t("settings")} tabs={SETTINGS_TABS} />;
};
