import type { Audience } from "@repo/domain/audience";

import type { ProjectNotificationRegistrations } from "../notification-registry.module";

/**
 * 「可調時間」的測試類型(`notification-schedule-settings.test.ts` 以 `jest.mock` 換掉專案的
 * `src/project/notifications.ts`):模擬專案入口宣告了三種寫法、當事人通知與沒宣告的類型。
 * 只在測試用;真正的專案類型由專案自己登記。
 */

const permissionAudience = (permission: string): Audience => ({
  mode: "match",
  filter: {
    field: "permission",
    cond: "in",
    value: { kind: "static", values: [permission] },
  },
});

const template = {
  "zh-TW": () => ({ title: "測試提醒", body: "" }),
};

const common = {
  defaultChannels: ["in-app"],
  canDisable: { "in-app": true },
  template,
} as const;

/** 負責人提醒 + 某日期前 N 天。 */
export const TEST_EXPIRY_REMINDER = "test.expiry-reminder";
/** 負責人提醒 + 每月第 N 天。 */
export const TEST_MONTHLY_REPORT = "test.monthly-report";
/** 負責人提醒 + 逾期後每天。 */
export const TEST_OVERDUE_REMINDER = "test.overdue-reminder";
/** 負責人提醒、沒宣告可調時間。 */
export const TEST_EVENT_ALERT = "test.event-alert";
/** 當事人通知 + 某日期前 N 天。 */
export const TEST_DEADLINE_NOTICE = "test.deadline-notice";
/** 當事人通知、沒宣告可調時間:不在通知設定頁。 */
export const TEST_RESULT_NOTICE = "test.result-notice";

export const SCHEDULE_FIXTURE_NOTIFICATIONS: ProjectNotificationRegistrations =
  {
    types: [
      {
        ...common,
        key: TEST_EXPIRY_REMINDER,
        name: "到期提醒",
        category: "responsible",
        orgScope: { ref: "event-org", range: "ancestors" },
        defaultAudience: permissionAudience("system.printers.edit"),
        schedule: {
          default: {
            kind: "days-before",
            daysBefore: [30, 7, 0],
            time: "09:00",
          },
          dateLabel: "到期",
        },
      },
      {
        ...common,
        key: TEST_MONTHLY_REPORT,
        name: "月報提醒",
        category: "responsible",
        orgScope: { ref: "tenant", range: "self" },
        defaultAudience: permissionAudience("system.printers.edit"),
        schedule: {
          default: { kind: "monthly", dayOfMonth: 3, time: "09:00" },
        },
      },
      {
        ...common,
        key: TEST_OVERDUE_REMINDER,
        name: "逾期提醒",
        category: "responsible",
        orgScope: { ref: "event-org", range: "self" },
        defaultAudience: permissionAudience("system.printers.edit"),
        schedule: { default: { kind: "daily-overdue", time: "09:00" } },
      },
      {
        ...common,
        key: TEST_EVENT_ALERT,
        name: "異常提醒",
        category: "responsible",
        orgScope: { ref: "event-org", range: "self" },
        defaultAudience: permissionAudience("system.printers.edit"),
      },
      {
        ...common,
        key: TEST_DEADLINE_NOTICE,
        name: "截止提醒",
        category: "party",
        recipientNote: "表單的填寫人",
        schedule: {
          default: { kind: "days-before", daysBefore: [0], time: "09:00" },
          dateLabel: "截止日",
        },
      },
      {
        ...common,
        key: TEST_RESULT_NOTICE,
        name: "結果通知",
        category: "party",
      },
    ],
    links: [],
  };
