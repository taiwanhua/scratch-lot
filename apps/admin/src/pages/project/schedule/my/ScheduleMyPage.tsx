import { useTranslations } from "use-intl";

import { ScheduleTabsPage } from "@/components/project/schedule/ScheduleTabsPage/ScheduleTabsPage";

import { MY_TABS } from "./my-tabs";

/** 我的班表(`schedule.my`,規格 14.6):分頁登記在 `my-tabs.ts`。 */
export const ScheduleMyPage = () => {
  const t = useTranslations("admin.schedule.pages");
  return <ScheduleTabsPage title={t("my")} tabs={MY_TABS} />;
};
