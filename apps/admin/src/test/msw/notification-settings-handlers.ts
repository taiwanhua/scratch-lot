import { HttpResponse } from "msw";

import {
  ModuleSidebarType,
  type NotificationSettingItemFragment,
  type NotificationSettingsQueryVariables,
  type ResetNotificationSettingMutationVariables,
  type RolesQueryVariables,
  type UpdateNotificationSettingMutationVariables,
} from "@repo/graphql";

import { type AuthErrorCode, graphqlError } from "./auth-handlers";
import type { TestRole } from "./data-scope-handlers";
import type { TestMatrixModule, TestMatrixPermission } from "./role-fixtures";
import { api } from "./server";

/** 一種負責人提醒類型(登記表的宣告;`audience` 是租戶調整過的,null = 用預設)。 */
export interface TestNotificationType {
  type: string;
  name: string;
  orgScope: { ref: string; range: string };
  defaultAudience: Record<string, unknown>;
  audience?: Record<string, unknown> | null;
}

export interface NotificationSettingsFailure {
  code: string;
  extensions?: Record<string, unknown>;
}

export interface NotificationSettingsWorldOptions {
  types?: TestNotificationType[];
  /** 人員條件「角色」的候選(`roles`);mock 模式由 roleWorld 提供,這裡不登記 */
  roles?: TestRole[];
  /** 人員條件「權限」的候選樹(`audiencePermissionOptions`) */
  permissionModules?: TestMatrixModule[];
  failures?: {
    UpdateNotificationSetting?: NotificationSettingsFailure;
    ResetNotificationSetting?: NotificationSettingsFailure;
  };
}

export interface NotificationSettingsWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  inputs: {
    update: UpdateNotificationSettingMutationVariables["input"][];
    reset: ResetNotificationSettingMutationVariables["input"][];
  };
}

const TIMESTAMP = "2026-10-17T03:00:00.000Z";
const OPERATOR_ID = "user-admin";

const fail = (code: string, extensions: Record<string, unknown> = {}) =>
  graphqlError(code as AuthErrorCode, code, extensions);

/**
 * 通知設定頁的假 api(`notificationSettings` / `updateNotificationSetting` / `resetNotificationSetting`
 * + 選擇器的 `roles` / `audiencePermissionOptions`)。有狀態(TEST-08):改了或還原後重查拿到新值;
 * `keyword` 比對名稱與類型 key、分頁照 api(`notification-settings.service.ts`)。
 */
export const notificationSettingsWorld = (
  options: NotificationSettingsWorldOptions = {},
): NotificationSettingsWorld => {
  const {
    types = [],
    roles = [],
    permissionModules = [],
    failures = {},
  } = options;
  const inputs: NotificationSettingsWorld["inputs"] = { update: [], reset: [] };
  const stored = new Map(
    types.map((type) => [
      type.type,
      {
        audience: type.audience ?? null,
        updatedAt: type.audience == null ? null : TIMESTAMP,
      },
    ]),
  );

  const toItem = (
    type: TestNotificationType,
  ): NotificationSettingItemFragment => {
    const setting = stored.get(type.type);
    const audience = setting?.audience ?? null;
    return {
      type: type.type,
      name: type.name,
      orgScope: type.orgScope,
      audience: audience ?? type.defaultAudience,
      isDefault: audience === null,
      defaultAudience: type.defaultAudience,
      updatedAt: setting?.updatedAt ?? null,
      updatedBy: setting?.updatedAt == null ? null : OPERATOR_ID,
    };
  };

  const handlers = [
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
      stored.set(type.type, {
        audience: input.audience,
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
      stored.set(type.type, { audience: null, updatedAt: TIMESTAMP });
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

/** 「權限」欄的候選樹:系統管理 → 印表機管理 / 通知設定(預設收件人用到的權限)。 */
export const notificationPermissionModules: TestMatrixModule[] = [
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

/** 底座的負責人提醒(`printing.agent-offline`)+ 一種專案類型(沒有英文文案,退回 api 的 name)。 */
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
    type: "lottery.stocktake-reminder",
    name: "盤點提醒",
    orgScope: { ref: "tenant", range: "self" },
    defaultAudience: holdsPermission("system.notification-settings.edit"),
    ...overrides["lottery.stocktake-reminder"],
  },
];
