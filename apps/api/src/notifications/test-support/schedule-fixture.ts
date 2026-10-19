import type { ProjectNotificationRegistrations } from "../notification-registry.module";

/**
 * 「可調時間」的測試類型(`notification-schedule-settings.test.ts` 以 `jest.mock` 換掉專案的
 * `src/project/notifications.ts`):模擬一個專案宣告了三種寫法、當事人通知與沒宣告的類型。
 * 只在測試用;真正的專案類型由專案自己登記。
 */

const permissionAudience = (permission: string) =>
  ({
    mode: "match",
    filter: {
      field: "permission",
      cond: "in",
      value: { kind: "static", values: [permission] },
    },
  }) as const;

const template = {
  "zh-TW": () => ({ title: "測試提醒", body: "" }),
};

const common = {
  defaultChannels: ["in-app"],
  canDisable: { "in-app": true },
  template,
} as const;

/** 負責人提醒 + 某日期前 N 天(證照到期的寫法)。 */
export const TEST_LICENSE_EXPIRY = "test.license-expiry";
/** 負責人提醒 + 每月第 N 天(關帳逾期的寫法)。 */
export const TEST_CLOSE_OVERDUE = "test.close-overdue";
/** 負責人提醒 + 逾期後每天(日結逾期的寫法)。 */
export const TEST_SETTLE_OVERDUE = "test.settle-overdue";
/** 負責人提醒、沒宣告可調時間(調貨出貨通知)。 */
export const TEST_TRANSFER_SHIPPED = "test.transfer-shipped";
/** 當事人通知 + 某日期前 N 天(畫休開放)。 */
export const TEST_DAY_OFF_OPEN = "test.day-off-open";
/** 當事人通知、沒宣告可調時間(排班發布):不在通知設定頁。 */
export const TEST_ROSTER_PUBLISHED = "test.roster-published";

export const SCHEDULE_FIXTURE_NOTIFICATIONS: ProjectNotificationRegistrations =
  {
    types: [
      {
        ...common,
        key: TEST_LICENSE_EXPIRY,
        name: "證照到期",
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
        key: TEST_CLOSE_OVERDUE,
        name: "關帳逾期",
        category: "responsible",
        orgScope: { ref: "tenant", range: "self" },
        defaultAudience: permissionAudience("system.printers.edit"),
        schedule: {
          default: { kind: "monthly", dayOfMonth: 3, time: "09:00" },
        },
      },
      {
        ...common,
        key: TEST_SETTLE_OVERDUE,
        name: "日結逾期",
        category: "responsible",
        orgScope: { ref: "event-org", range: "self" },
        defaultAudience: permissionAudience("system.printers.edit"),
        schedule: { default: { kind: "daily-overdue", time: "09:00" } },
      },
      {
        ...common,
        key: TEST_TRANSFER_SHIPPED,
        name: "調貨出貨通知",
        category: "responsible",
        orgScope: { ref: "event-org", range: "self" },
        defaultAudience: permissionAudience("system.printers.edit"),
      },
      {
        ...common,
        key: TEST_DAY_OFF_OPEN,
        name: "畫休開放",
        category: "party",
        recipientNote: "可排這家店的排班人員",
        schedule: {
          default: { kind: "days-before", daysBefore: [0], time: "09:00" },
          dateLabel: "開放日",
        },
      },
      {
        ...common,
        key: TEST_ROSTER_PUBLISHED,
        name: "排班發布",
        category: "party",
      },
    ],
    links: [],
  };
