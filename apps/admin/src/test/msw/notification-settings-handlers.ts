import { HttpResponse } from "msw";

import {
  ModuleSidebarType,
  NotificationScheduleKind,
  type NotificationSettingItemFragment,
  NotificationSettingPart,
  type NotificationSettingsQueryVariables,
  type ResetNotificationSettingMutationVariables,
  type RolesQueryVariables,
  type UpdateNotificationSettingMutationVariables,
  type UpdateSidebarBadgeSettingMutationVariables,
} from "@repo/graphql";

import { type GraphqlErrorCode, graphqlError } from "./auth-handlers";
import type { TestRole } from "./data-scope-handlers";
import type { TestMatrixModule, TestMatrixPermission } from "./role-fixtures";
import { api } from "./server";
import {
  type TestSidebarBadge,
  sidebarBadgeSettingsHandlers,
} from "./sidebar-badge-settings-handlers";

export {
  type TestSidebarBadge,
  sidebarBadges,
} from "./sidebar-badge-settings-handlers";

/** api 回的一份提醒時間。 */
export interface TestNotificationSchedule {
  kind: NotificationScheduleKind;
  daysBefore?: number[] | null;
  dayOfMonth?: number | null;
  time: string;
}

/**
 * 通知設定頁上的一種類型(登記表的宣告):負責人提醒(預設)或宣告了可調時間的當事人通知。
 * `audience` / `schedule` 是租戶調整過的,null = 用預設。
 */
export interface TestNotificationType {
  type: string;
  name: string;
  /** 不給 = `responsible` */
  category?: "responsible" | "party";
  /** 當事人通知不給 */
  orgScope?: { ref: string; range: string } | null;
  defaultAudience?: Record<string, unknown> | null;
  audience?: Record<string, unknown> | null;
  /** 當事人通知的收件人說明 */
  recipientNote?: string | null;
  /** 可調時間的預設;不給 = 沒宣告(發生時就寄) */
  defaultSchedule?: TestNotificationSchedule | null;
  schedule?: TestNotificationSchedule | null;
  dateLabel?: string | null;
}

export interface NotificationSettingsFailure {
  code: GraphqlErrorCode;
  extensions?: Record<string, unknown>;
}

export interface NotificationSettingsWorldOptions {
  types?: TestNotificationType[];
  /** 「側欄數字」區塊的列;不給 = 沒有登記 */
  badges?: TestSidebarBadge[];
  /** 人員條件「角色」的候選(`roles`);mock 模式由 roleWorld 提供,這裡不登記 */
  roles?: TestRole[];
  /** 人員條件「權限」的候選樹(`audiencePermissionOptions`) */
  permissionModules?: TestMatrixModule[];
  failures?: {
    UpdateNotificationSetting?: NotificationSettingsFailure;
    ResetNotificationSetting?: NotificationSettingsFailure;
    UpdateSidebarBadgeSetting?: NotificationSettingsFailure;
    ResetSidebarBadgeSetting?: NotificationSettingsFailure;
  };
}

export interface NotificationSettingsWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  inputs: {
    update: UpdateNotificationSettingMutationVariables["input"][];
    reset: ResetNotificationSettingMutationVariables["input"][];
    badgeUpdate: UpdateSidebarBadgeSettingMutationVariables["input"][];
    badgeReset: { moduleKey: string }[];
  };
}

const TIMESTAMP = "2026-10-17T03:00:00.000Z";
const OPERATOR_ID = "user-admin";

const fail = (
  code: GraphqlErrorCode,
  extensions: Record<string, unknown> = {},
) => graphqlError(code, code, extensions);

/**
 * 通知設定頁的假 api(`notificationSettings` / `updateNotificationSetting` / `resetNotificationSetting`
 * + 選擇器的 `roles` / `audiencePermissionOptions`)。有狀態(TEST-08):改了或還原後重查拿到新值;
 * `keyword` 比對名稱與類型 key、分頁照 api(`notification-settings.service.ts`)。
 * 「側欄數字」區塊的 `sidebarBadgeSettings` / `updateSidebarBadgeSetting` / `resetSidebarBadgeSetting` 同樣有狀態。
 */
export const notificationSettingsWorld = (
  options: NotificationSettingsWorldOptions = {},
): NotificationSettingsWorld => {
  const {
    types = [],
    badges = [],
    roles = [],
    permissionModules = [],
    failures = {},
  } = options;
  const inputs: NotificationSettingsWorld["inputs"] = {
    update: [],
    reset: [],
    badgeUpdate: [],
    badgeReset: [],
  };

  interface StoredSetting {
    audience: Record<string, unknown> | null;
    schedule: TestNotificationSchedule | null;
    updatedAt: string | null;
  }
  const stored = new Map<string, StoredSetting>(
    types.map((type) => [
      type.type,
      {
        audience: type.audience ?? null,
        schedule: type.schedule ?? null,
        updatedAt:
          type.audience == null && type.schedule == null ? null : TIMESTAMP,
      },
    ]),
  );

  const scheduleOf = (schedule: TestNotificationSchedule | null) =>
    schedule === null
      ? null
      : {
          kind: schedule.kind,
          daysBefore: schedule.daysBefore ?? null,
          dayOfMonth: schedule.dayOfMonth ?? null,
          time: schedule.time,
        };

  const toItem = (
    type: TestNotificationType,
  ): NotificationSettingItemFragment => {
    const setting = stored.get(type.type);
    const category = type.category ?? "responsible";
    const audience = setting?.audience ?? null;
    const defaultSchedule = type.defaultSchedule ?? null;
    const schedule =
      defaultSchedule === null ? null : (setting?.schedule ?? null);
    return {
      type: type.type,
      name: type.name,
      category,
      orgScope: type.orgScope ?? null,
      audience:
        category === "responsible"
          ? (audience ?? type.defaultAudience ?? null)
          : null,
      isDefault: audience === null,
      defaultAudience: type.defaultAudience ?? null,
      recipientNote: type.recipientNote ?? null,
      schedule: scheduleOf(schedule ?? defaultSchedule),
      defaultSchedule: scheduleOf(defaultSchedule),
      isScheduleDefault: schedule === null,
      scheduleDateLabel: type.dateLabel ?? null,
      updatedAt: setting?.updatedAt ?? null,
      updatedBy: setting?.updatedAt == null ? null : OPERATOR_ID,
    };
  };

  const settingOf = (type: string): StoredSetting =>
    stored.get(type) ?? { audience: null, schedule: null, updatedAt: null };

  const handlers = [
    ...sidebarBadgeSettingsHandlers({
      badges,
      inputs,
      failures: {
        update: failures.UpdateSidebarBadgeSetting,
        reset: failures.ResetSidebarBadgeSetting,
      },
    }),
    api.query("NotificationSettings", ({ variables }) => {
      const { input } = variables as NotificationSettingsQueryVariables;
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 20;
      const keyword = input.keyword?.trim().toLowerCase() ?? "";
      const matched = types.filter(
        (type) =>
          keyword === "" ||
          type.name.toLowerCase().includes(keyword) ||
          type.type.includes(keyword),
      );
      return HttpResponse.json({
        data: {
          notificationSettings: {
            items: matched
              .slice((page - 1) * pageSize, page * pageSize)
              .map((type) => toItem(type)),
            page,
            pageSize,
            totalCount: matched.length,
          },
        },
      });
    }),
    api.mutation("UpdateNotificationSetting", ({ variables }) => {
      const { input } = variables as UpdateNotificationSettingMutationVariables;
      inputs.update.push(input);
      const failure = failures.UpdateNotificationSetting;
      if (failure !== undefined) {
        return fail(failure.code, failure.extensions ?? {});
      }
      const type = types.find((item) => item.type === input.type);
      if (type === undefined) {
        return fail("VALIDATION_FAILED", { reason: "UNKNOWN_TYPE" });
      }
      const current = settingOf(type.type);
      stored.set(type.type, {
        audience: input.audience ?? current.audience,
        schedule:
          input.schedule == null
            ? current.schedule
            : {
                kind: input.schedule.kind,
                daysBefore: input.schedule.daysBefore ?? null,
                dayOfMonth: input.schedule.dayOfMonth ?? null,
                time: input.schedule.time,
              },
        updatedAt: TIMESTAMP,
      });
      return HttpResponse.json({
        data: { updateNotificationSetting: { setting: toItem(type) } },
      });
    }),
    api.mutation("ResetNotificationSetting", ({ variables }) => {
      const { input } = variables as ResetNotificationSettingMutationVariables;
      inputs.reset.push(input);
      const failure = failures.ResetNotificationSetting;
      if (failure !== undefined) {
        return fail(failure.code, failure.extensions ?? {});
      }
      const type = types.find((item) => item.type === input.type);
      if (type === undefined) {
        return fail("VALIDATION_FAILED", { reason: "UNKNOWN_TYPE" });
      }
      const current = settingOf(type.type);
      const part = input.part ?? null;
      stored.set(type.type, {
        audience:
          part === null || part === NotificationSettingPart.Audience
            ? null
            : current.audience,
        schedule:
          part === null || part === NotificationSettingPart.Schedule
            ? null
            : current.schedule,
        updatedAt: TIMESTAMP,
      });
      return HttpResponse.json({
        data: { resetNotificationSetting: { setting: toItem(type) } },
      });
    }),
    api.query("Roles", ({ variables }) => {
      const { input } = variables as RolesQueryVariables;
      return HttpResponse.json({
        data: {
          roles: {
            totalCount: roles.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 100,
            items: roles,
          },
        },
      });
    }),
    api.query("AudiencePermissionOptions", () =>
      HttpResponse.json({
        data: { audiencePermissionOptions: { modules: permissionModules } },
      }),
    ),
  ];

  return { handlers, inputs };
};

// ---- 夾具 ----

const permission = (
  moduleKey: string,
  action: string,
  name: string,
): TestMatrixPermission => ({
  id: `p-${moduleKey}-${action}`,
  key: `${moduleKey}.${action}`,
  name,
  description: null,
  action,
});

export const systemModule = (
  key: string,
  name: string,
  actions: [string, string][],
): TestMatrixModule => ({
  id: `m-${key}`,
  key,
  name,
  parentId: "m-system",
  sidebarType: ModuleSidebarType.Link,
  order: 1,
  description: null,
  permissions: [
    permission(key, "*", "全部"),
    ...actions.map(([action, label]) => permission(key, action, label)),
  ],
  children: [],
});

/** 「權限」欄的候選樹:系統管理 → 印表機管理 / 通知設定(預設收件人用到的權限)+ 申請中心(側欄數字的預設權限)。 */
export const notificationPermissionModules: TestMatrixModule[] = [
  {
    ...systemModule("apply-center", "申請中心", [["view", "檢視"]]),
    parentId: null,
    order: 0,
  },
  {
    id: "m-system",
    key: "system",
    name: "系統管理",
    parentId: null,
    sidebarType: ModuleSidebarType.Group,
    order: 1,
    description: null,
    permissions: [permission("system", "*", "全部")],
    children: [
      systemModule("system.printers", "印表機管理", [
        ["view", "檢視"],
        ["edit", "編輯"],
      ]),
      systemModule("system.notification-settings", "通知設定", [
        ["view", "檢視"],
        ["edit", "編輯"],
      ]),
    ],
  },
];

/** 人員條件:持有某一筆權限。 */
export const holdsPermission = (key: string): Record<string, unknown> => ({
  mode: "match",
  filter: {
    op: "AND",
    children: [
      {
        field: "permission",
        cond: "in",
        value: { kind: "static", values: [key] },
      },
    ],
  },
});

/** 人員條件:角色屬於某幾個角色。 */
export const inRoles = (roleIds: string[]): Record<string, unknown> => ({
  mode: "match",
  filter: {
    op: "AND",
    children: [
      {
        field: "role",
        cond: "in",
        value: { kind: "static", values: roleIds },
      },
    ],
  },
});

/** 到期提醒的預設提醒時間:到期前 30、7 天及當天 09:00。 */
export const EXPIRY_DEFAULT_SCHEDULE: TestNotificationSchedule = {
  kind: NotificationScheduleKind.DaysBefore,
  daysBefore: [30, 7, 0],
  time: "09:00",
};

/**
 * 底座的負責人提醒(`printing.agent-offline`,沒宣告提醒時間)+ 一種專案類型
 * (沒有英文文案,退回 api 的 name;宣告了「某日期前 N 天」)。
 */
export const notificationTypes = (
  overrides: Partial<Record<string, Partial<TestNotificationType>>> = {},
): TestNotificationType[] => [
  {
    type: "printing.agent-offline",
    name: "列印代理程式離線",
    orgScope: { ref: "event-org", range: "ancestors" },
    defaultAudience: holdsPermission("system.printers.edit"),
    ...overrides["printing.agent-offline"],
  },
  {
    type: "demo.expiry-reminder",
    name: "到期提醒",
    orgScope: { ref: "tenant", range: "self" },
    defaultAudience: holdsPermission("system.notification-settings.edit"),
    defaultSchedule: EXPIRY_DEFAULT_SCHEDULE,
    dateLabel: "到期",
    ...overrides["demo.expiry-reminder"],
  },
];

/** 宣告了提醒時間的當事人通知(只有提醒時間一塊;收件人由事件決定)。 */
export const partyScheduledType = (
  override: Partial<TestNotificationType> = {},
): TestNotificationType => ({
  type: "demo.deadline-notice",
  name: "截止提醒",
  category: "party",
  recipientNote: "表單的填寫人",
  defaultSchedule: {
    kind: NotificationScheduleKind.DaysBefore,
    daysBefore: [1],
    time: "09:00",
  },
  dateLabel: "截止日",
  ...override,
});

/** 每月第 N 天的負責人提醒。 */
export const monthlyType = (
  override: Partial<TestNotificationType> = {},
): TestNotificationType => ({
  type: "demo.monthly-report",
  name: "月報提醒",
  orgScope: { ref: "tenant", range: "self" },
  defaultAudience: holdsPermission("system.notification-settings.edit"),
  defaultSchedule: {
    kind: NotificationScheduleKind.Monthly,
    dayOfMonth: 3,
    time: "09:00",
  },
  ...override,
});
