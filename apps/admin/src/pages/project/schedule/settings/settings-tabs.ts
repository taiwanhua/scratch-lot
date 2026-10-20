import type { ScheduleTabEntry } from "@/components/project/schedule/ScheduleTabsPage/ScheduleTabsPage";

import { RulesTab } from "./RulesTab/RulesTab";
import { StaffTab } from "./StaffTab/StaffTab";
import { TemplatesTab } from "./TemplatesTab/TemplatesTab";
import { WeekTemplatesTab } from "./WeekTemplatesTab/WeekTemplatesTab";

/**
 * 排班設定(`schedule.settings`)的分頁(規格 3.1:排班人員、人力需求範本、人力需求週範本、規則)。
 * 之後的功能只追加自己那一列。
 */
export const SETTINGS_TABS: readonly ScheduleTabEntry[] = [
  { value: "staff", labelKey: "staff", Content: StaffTab },
  { value: "templates", labelKey: "templates", Content: TemplatesTab },
  {
    value: "week-templates",
    labelKey: "weekTemplates",
    Content: WeekTemplatesTab,
  },
  { value: "rules", labelKey: "rules", Content: RulesTab },
];
