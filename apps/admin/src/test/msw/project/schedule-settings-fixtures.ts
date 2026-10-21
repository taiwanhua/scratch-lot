import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import type {
  ScheduleCalendarDayFieldsFragment,
  ScheduleDemandTemplateFieldsFragment,
  ScheduleDemandWeekTemplateFieldsFragment,
  ScheduleStaffRowFieldsFragment,
} from "@repo/graphql";

/**
 * 班表管理(排班設定、行事曆)的夾具:元件測試與 mock 模式共用。
 * 組織 id 沿用 `org-fixtures.ts`(租戶 A、A-2 台北分店),mock 模式的分店選擇器才找得到名稱。
 */

export type TestCalendarDay = ScheduleCalendarDayFieldsFragment & {
  /** 設定這一天的組織 */
  orgId: string;
};

export const SCHEDULE_TENANT = { id: "org-tenant-a", name: "租戶 A" };
export const SCHEDULE_BRANCH = { id: "org-store", name: "A-2 台北分店" };

export const SCHEDULE_TEST_OPTIONS: Record<
  string,
  { value: string; label: string }[]
> = {
  [SCHEDULE_FIELD_CATEGORY_KEYS.position]: [
    { value: "in-store-counter", label: "店內櫃台" },
    { value: "outdoor-stall", label: "店外攤位" },
    { value: "restock", label: "補貨" },
  ],
  [SCHEDULE_FIELD_CATEGORY_KEYS.task]: [
    { value: "store-and-accounts-lead", label: "店內事務與帳目負責" },
    { value: "store-duties", label: "店內事務" },
  ],
  [SCHEDULE_FIELD_CATEGORY_KEYS.dayOffOverrideReason]: [
    { value: "staff-late-notice", label: "員工臨時告知" },
    { value: "entry-error", label: "登記錯誤" },
    { value: "store-adjustment", label: "店務調整" },
    { value: "other", label: "其他" },
  ],
  [SCHEDULE_FIELD_CATEGORY_KEYS.specialDayCategory]: [
    { value: "national-holiday", label: "國定假日" },
    { value: "typhoon-day", label: "颱風假" },
    { value: "event-day", label: "活動日" },
    { value: "other", label: "其他" },
  ],
  [SCHEDULE_FIELD_CATEGORY_KEYS.changeReason]: [
    { value: "shift-swap", label: "換班" },
    { value: "sick-leave", label: "請病假" },
    { value: "other", label: "其他" },
  ],
  [SCHEDULE_FIELD_CATEGORY_KEYS.makeupPunchReason]: [
    { value: "forgot-punch", label: "忘記打卡" },
    { value: "device-failure", label: "裝置故障" },
    { value: "other", label: "其他" },
  ],
  [SCHEDULE_FIELD_CATEGORY_KEYS.entryReassignReason]: [
    { value: "wrong-entry-at-open", label: "開班時選錯排班" },
    { value: "cover-shift-reassign", label: "臨時代班補排班後改對應" },
    { value: "shift-swap", label: "換班" },
    { value: "other", label: "其他" },
  ],
};

const tenantOwner = { id: SCHEDULE_TENANT.id, name: SCHEDULE_TENANT.name };
const branchOwner = { id: SCHEDULE_BRANCH.id, name: SCHEDULE_BRANCH.name };

export const sampleScheduleTemplates: ScheduleDemandTemplateFieldsFragment[] = [
  {
    id: "tpl-early",
    name: "早班",
    shortName: "早",
    startTime: "08:30",
    endTime: "14:30",
    positionKey: "in-store-counter",
    tasks: [
      { taskId: "t1", role: "leader", taskKey: "store-and-accounts-lead" },
      { taskId: "t2", role: "helper", taskKey: "store-duties" },
    ],
    paletteKey: "yellow",
    ownerOrg: tenantOwner,
    canEdit: false,
  },
  {
    id: "tpl-late",
    name: "晚班",
    shortName: "晚",
    startTime: "14:30",
    endTime: "22:00",
    positionKey: "in-store-counter",
    tasks: [
      { taskId: "t3", role: "leader", taskKey: "store-and-accounts-lead" },
      { taskId: "t4", role: "helper", taskKey: "store-duties" },
    ],
    paletteKey: "blue",
    ownerOrg: tenantOwner,
    canEdit: false,
  },
  {
    id: "tpl-restock",
    name: "補貨",
    shortName: "補",
    startTime: "13:00",
    endTime: "17:00",
    positionKey: "restock",
    tasks: [{ taskId: "t5", role: "helper", taskKey: "store-duties" }],
    paletteKey: "green",
    ownerOrg: branchOwner,
    canEdit: true,
  },
];

export const sampleScheduleWeekTemplates: ScheduleDemandWeekTemplateFieldsFragment[] =
  [
    {
      id: "week-weekday",
      name: "平日標準週",
      days: [
        [],
        ["tpl-early", "tpl-late"],
        ["tpl-early", "tpl-late"],
        ["tpl-early", "tpl-late", "tpl-restock"],
        ["tpl-early", "tpl-late"],
        ["tpl-early", "tpl-late", "tpl-restock"],
        [],
      ],
      enabled: true,
      ownerOrg: branchOwner,
      canEdit: true,
    },
  ];

const staffOrg = (
  org: { id: string; name: string },
  canLead: boolean,
  isPrimary: boolean,
  sortOrder: number,
) => ({ orgId: org.id, orgName: org.name, canLead, isPrimary, sortOrder });

export const sampleScheduleStaff: ScheduleStaffRowFieldsFragment[] = [
  {
    userId: "u-wang",
    name: "王小明",
    account: "wang",
    joinedElsewhere: false,
    staff: {
      id: "s-wang",
      employmentType: "full-time",
      enabled: true,
      note: null,
      primaryElsewhere: false,
      isShared: false,
      orgs: [
        staffOrg(SCHEDULE_BRANCH, true, true, 1),
        staffOrg({ id: "org-content", name: "A-1 內容組" }, false, false, 2),
      ],
    },
  },
  {
    userId: "u-li",
    name: "李小華",
    account: "li",
    joinedElsewhere: false,
    staff: {
      id: "s-li",
      employmentType: "full-time",
      enabled: true,
      note: null,
      primaryElsewhere: false,
      isShared: false,
      orgs: [staffOrg(SCHEDULE_BRANCH, false, true, 1)],
    },
  },
  {
    userId: "u-lin",
    name: "林新人",
    account: "lin",
    joinedElsewhere: false,
    staff: null,
  },
  // 已被看不到的組織加入(一人一份):不能再加入
  {
    userId: "u-chen",
    name: "陳支援",
    account: "chen",
    joinedElsewhere: true,
    staff: null,
  },
  {
    userId: "u-chang",
    name: "張工讀",
    account: "chang",
    joinedElsewhere: false,
    staff: null,
  },
];

export const sampleScheduleCalendarDays: TestCalendarDay[] = [
  {
    id: "cal-1",
    orgId: SCHEDULE_TENANT.id,
    date: "2026-11-03",
    type: "closed",
    category: null,
    name: "盤點日",
    note: null,
    paletteKey: null,
    ownerOrg: tenantOwner,
    canEdit: false,
  },
  {
    id: "cal-2",
    orgId: SCHEDULE_BRANCH.id,
    date: "2026-11-11",
    type: "special",
    category: "event-day",
    name: "店慶",
    note: null,
    paletteKey: "cyan",
    ownerOrg: branchOwner,
    canEdit: true,
  },
];
