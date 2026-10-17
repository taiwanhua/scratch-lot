import { expect } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import { AUDIENCE_ROLE_VIEW_PERMISSION } from "@/components/base/AudiencePicker/useAudienceOptions";
import {
  type TestModule,
  authWorld,
  overviewModule,
} from "@/test/msw/auth-handlers";
import { dataScopeRoles } from "@/test/msw/data-scope-fixtures";
import {
  type NotificationSettingsWorldOptions,
  notificationPermissionModules,
  notificationSettingsWorld,
  notificationTypes,
} from "@/test/msw/notification-settings-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { NOTIFICATION_SETTINGS_PERMISSIONS } from "./notification-settings-permissions";

/** 通知設定頁測試的共用場景(一份形狀,測試檔只寫行為;寫法同 `data-scope-test-support.ts`)。 */
export const FULL_PERMISSIONS = [
  NOTIFICATION_SETTINGS_PERMISSIONS.view,
  NOTIFICATION_SETTINGS_PERMISSIONS.edit,
  AUDIENCE_ROLE_VIEW_PERMISSION,
];

const systemGroup: TestModule = {
  id: "m-system",
  key: "system",
  name: "系統管理",
  parentId: null,
  sidebarType: ModuleSidebarType.Group,
  engine: ModuleEngine.Fixed,
  order: 1,
  route: "/system",
  permissions: [],
};

const link = (
  id: string,
  key: string,
  name: string,
  order: number,
  permissions: readonly string[],
): TestModule => ({
  id,
  key,
  name,
  parentId: "m-system",
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order,
  route: `/${key.replace(".", "/")}`,
  permissions: permissions.filter((permission) =>
    permission.startsWith(`${key}.`),
  ),
});

const modulesWith = (
  permissions: readonly string[],
  hasRootOnlyModules: boolean,
): TestModule[] => [
  overviewModule,
  systemGroup,
  link("m-role", "system.role-manager", "角色管理", 3, permissions),
  // 超級管理員手上有根組織專屬模組;它不代表「站在根組織」(那由 `currentOrg.tenantId` 決定)
  ...(hasRootOnlyModules
    ? [link("m-module", "system.module-manager", "模組與權限", 4, [])]
    : []),
  link(
    "m-notification-settings",
    "system.notification-settings",
    "通知設定",
    9,
    permissions,
  ),
];

export const renderPage = ({
  permissions = FULL_PERMISSIONS,
  world = {},
  search = "",
  isAtRoot = false,
  hasRootOnlyModules = false,
  locale = null,
}: {
  permissions?: readonly string[];
  world?: NotificationSettingsWorldOptions;
  /** 起始網址的查詢字串(含 `?`) */
  search?: string;
  /** 站在根組織(`me.currentOrg.tenantId = null`);否則站在租戶 A */
  isAtRoot?: boolean;
  /** 操作者手上有根組織專屬模組(超級管理員) */
  hasRootOnlyModules?: boolean;
  /** 個人偏好的語系(`null` = 預設繁中) */
  locale?: string | null;
} = {}) => {
  const fake = notificationSettingsWorld({
    types: notificationTypes(),
    roles: dataScopeRoles,
    permissionModules: notificationPermissionModules,
    ...world,
  });
  server.use(
    ...fake.handlers,
    ...authWorld({
      hasRefreshCookie: true,
      modules: modulesWith(permissions, hasRootOnlyModules),
      currentOrgTenantId: isAtRoot ? null : "org-tenant-a",
      preferences: { locale },
    }).handlers,
  );
  return {
    ...renderApp({ path: `/system/notification-settings${search}` }),
    fake,
  };
};

export const table = () => screen.getByRole("table", { name: "通知類型清單" });

/** 某一種類型的那一列(依顯示名稱找)。 */
export const rowOf = (name: string): HTMLElement => {
  const row = within(table())
    .getAllByRole("row")
    .find((item) => within(item).queryByText(name) !== null);
  if (row === undefined) {
    throw new Error(`找不到「${name}」那一列`);
  }
  return row;
};

/** 清單載完、收件人摘要也解析完(權限名稱到手)才開始斷言。 */
export const waitForRows = async (name = "列印代理程式離線") => {
  await waitFor(() => {
    expect(within(table()).getByText(name)).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(within(table()).queryByText(/載入中/)).toBeNull();
  });
};
