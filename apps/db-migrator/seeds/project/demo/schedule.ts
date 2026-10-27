import type {
  OnboardingScheduleStaffBranch,
  OnboardingScheduleTemplate,
  OnboardingScheduleWeekTemplate,
} from "../onboarding/plan";

/** 示範的排班人員(以示範帳號的別名指定;帳號由基底信箱加別名產生)。 */
export interface DemoScheduleStaff {
  alias: string;
  employmentType: "full-time" | "part-time";
  branches: OnboardingScheduleStaffBranch[];
}

/**
 * 示範機構的排班人員(規格 14.3):兩家店的店長可擔任負責人;中山店店員也可以支援信義店。
 * 總部人員不排班。
 */
export const DEMO_SCHEDULE_STAFF: readonly DemoScheduleStaff[] = [
  {
    alias: "demo-manager-a",
    employmentType: "full-time",
    branches: [{ name: "中山店", canLead: true, isPrimary: true }],
  },
  {
    alias: "demo-clerk-a",
    employmentType: "part-time",
    branches: [
      { name: "中山店", canLead: false, isPrimary: true },
      { name: "信義店", canLead: false, isPrimary: false },
    ],
  },
  {
    alias: "demo-manager-b",
    employmentType: "full-time",
    branches: [{ name: "信義店", canLead: true, isPrimary: true }],
  },
  {
    alias: "demo-clerk-b",
    employmentType: "part-time",
    branches: [{ name: "信義店", canLead: false, isPrimary: true }],
  },
];

const LEAD = { role: "leader", taskKey: "store-and-accounts-lead" } as const;
const HELP = { role: "helper", taskKey: "store-duties" } as const;

/** 範本的崗位:示範崗位「店內櫃台A」(兩家店都有同崗位的收銀點,開班不會跳崗位不一致)。 */
const IN_STORE_COUNTER_A = "in-store-counter-a";

/** 最上層組織的人力需求範本(規格 14.4;各分店都能用)。 */
export const DEMO_SCHEDULE_TEMPLATES: readonly OnboardingScheduleTemplate[] = [
  {
    name: "早班",
    shortName: "早",
    startTime: "08:30",
    endTime: "14:30",
    positionKey: IN_STORE_COUNTER_A,
    tasks: [LEAD, HELP],
    color: "yellow",
  },
  {
    name: "晚班",
    shortName: "晚",
    startTime: "14:30",
    endTime: "22:00",
    positionKey: IN_STORE_COUNTER_A,
    tasks: [LEAD, HELP],
    color: "blue",
  },
];

const BOTH = ["早班", "晚班"];

/** 「一般週」:每天早晚班(0 = 星期日)。 */
export const DEMO_SCHEDULE_WEEK_TEMPLATES: readonly OnboardingScheduleWeekTemplate[] =
  [
    {
      name: "一般週",
      days: [BOTH, BOTH, BOTH, BOTH, BOTH, BOTH, BOTH],
    },
  ];
