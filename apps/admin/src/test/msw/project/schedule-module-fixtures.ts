import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import type { TestModule } from "../auth-handlers";

/**
 * 班表管理的 `me.modules` 夾具(與 `apps/db-migrator/seeds/project/schedule.ts` 同形:群組 + 四個子模組,
 * 排班作業、出勤紀錄是表單模組、各有三個隱藏頁)。`permissions` 給全部 key;測試要拿掉某個權限就過濾。
 */
export const SCHEDULE_ALL_PERMISSIONS = {
  "schedule.my": [
    "schedule.my.view",
    "schedule.my.punch",
    "schedule.my.edit-day-offs",
  ],
  "schedule.manage": [
    "schedule.manage.view",
    "schedule.manage.create",
    "schedule.manage.edit",
    "schedule.manage.delete",
    "schedule.manage.auto-run",
    "schedule.manage.publish",
    "schedule.manage.view-day-offs",
    "schedule.manage.use-punch-time",
    "schedule.manage.edit-day-offs",
    "schedule.manage.edit-calendar",
  ],
  "schedule.settings": [
    "schedule.settings.view",
    "schedule.settings.edit-templates",
    "schedule.settings.edit-staff",
    "schedule.settings.edit-default-rules",
    "schedule.settings.edit-org-rules",
  ],
  "schedule.attendance": [
    "schedule.attendance.view",
    "schedule.attendance.create",
    "schedule.attendance.edit",
    "schedule.attendance.delete",
    "schedule.attendance.view-all",
    "schedule.attendance.export",
    "schedule.attendance.reassign-punches",
  ],
} as const;

const node = (
  key: string,
  name: string,
  parentKey: string | null,
  order: number,
  route: string,
  overrides: Partial<TestModule> = {},
): TestModule => ({
  id: `m-${key}`,
  key,
  name,
  parentId: parentKey === null ? null : `m-${parentKey}`,
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order,
  route,
  icon: null,
  permissions: [],
  ...overrides,
});

const formPages = (key: string, route: string): TestModule[] =>
  (
    [
      ["view-page", "詳情"],
      ["create-page", "新增"],
      ["edit-page", "編輯"],
    ] as const
  ).map(([page, name], index) =>
    node(`${key}.${page}`, name, key, index + 1, `${route}/${page}`, {
      sidebarType: ModuleSidebarType.Hidden,
    }),
  );

/** 班表管理的模組;`omit` 列的權限 key 拿掉(測試「沒有某權限時看不到按鈕」)。 */
export const scheduleModules = (omit: readonly string[] = []): TestModule[] => {
  const keep = (keys: readonly string[]) =>
    keys.filter((key) => !omit.includes(key));
  return [
    node("schedule", "班表管理", null, 17, "/schedule", {
      sidebarType: ModuleSidebarType.Group,
    }),
    node("schedule.my", "我的班表", "schedule", 1, "/schedule/my", {
      permissions: keep(SCHEDULE_ALL_PERMISSIONS["schedule.my"]),
    }),
    node("schedule.manage", "排班作業", "schedule", 2, "/schedule/manage", {
      engine: ModuleEngine.Form,
      permissions: keep(SCHEDULE_ALL_PERMISSIONS["schedule.manage"]),
    }),
    ...formPages("schedule.manage", "/schedule/manage"),
    node("schedule.settings", "排班設定", "schedule", 3, "/schedule/settings", {
      permissions: keep(SCHEDULE_ALL_PERMISSIONS["schedule.settings"]),
    }),
    node(
      "schedule.attendance",
      "出勤紀錄",
      "schedule",
      4,
      "/schedule/attendance",
      {
        engine: ModuleEngine.Form,
        permissions: keep(SCHEDULE_ALL_PERMISSIONS["schedule.attendance"]),
      },
    ),
    ...formPages("schedule.attendance", "/schedule/attendance"),
  ];
};
