import { screen } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import {
  type TestModule,
  authWorld,
  overviewModule,
} from "@/test/msw/auth-handlers";
import {
  type RoleWorldOptions,
  roleWorld,
} from "@/test/msw/role-manager-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import {
  ORG_MANAGER_VIEW_PERMISSION,
  ROLE_MANAGER_PERMISSIONS,
} from "./role-manager-permissions";

/**
 * 角色管理頁測試的共用 world 與 helper(TEST-08「共用的 world / 夾具 / helper 抽成
 * `<page>-test-support.ts`」)。
 */

/**
 * 擁有組織下拉(新增角色、清單上方的篩選)要 `system.org-manager.view`;
 * 加入使用者的候選自 #246 起掛在 `system.role-manager.assign-users` 底下,
 * 不再需要 `system.user-manager.view`。
 */
export const ALL_PERMISSIONS = [
  ...Object.values(ROLE_MANAGER_PERMISSIONS),
  ORG_MANAGER_VIEW_PERMISSION,
];

const ROLE_PREFIX = "system.role-manager.";

const modulesWith = (permissions: readonly string[]): TestModule[] => [
  overviewModule,
  {
    id: "m-system",
    key: "system",
    name: "系統管理",
    parentId: null,
    sidebarType: ModuleSidebarType.Group,
    engine: ModuleEngine.Fixed,
    order: 1,
    route: "/system",
    permissions: [],
  },
  {
    id: "m-org",
    key: "system.org-manager",
    name: "組織管理",
    parentId: "m-system",
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Fixed,
    order: 1,
    route: "/system/org-manager",
    permissions: permissions.includes(ORG_MANAGER_VIEW_PERMISSION)
      ? [ORG_MANAGER_VIEW_PERMISSION]
      : [],
  },
  {
    id: "m-user",
    key: "system.user-manager",
    name: "使用者管理",
    parentId: "m-system",
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Fixed,
    order: 2,
    route: "/system/user-manager",
    permissions: [],
  },
  {
    id: "m-role",
    key: "system.role-manager",
    name: "角色管理",
    parentId: "m-system",
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Fixed,
    order: 3,
    route: "/system/role-manager",
    permissions: permissions.filter((key) => key.startsWith(ROLE_PREFIX)),
  },
];

export interface RenderRolePageOptions {
  permissions?: readonly string[];
  world?: RoleWorldOptions;
  /** 起始網址的查詢字串(含 `?`;重新整理、帶參數打開用) */
  search?: string;
}

/** 當前組織 = 租戶頂層(擁有組織下拉的預設值就是它)。 */
const CURRENT_ORG = { id: "org-tenant", name: "租戶 A" };

export const renderRolePage = ({
  permissions = ALL_PERMISSIONS,
  world = {},
  search = "",
}: RenderRolePageOptions = {}) => {
  const fake = roleWorld(world);
  server.use(
    ...fake.handlers,
    ...authWorld({
      hasRefreshCookie: true,
      modules: modulesWith(permissions),
      orgs: [CURRENT_ORG],
    }).handlers,
  );
  return { ...renderApp({ path: `/system/role-manager${search}` }), fake };
};

/** 矩陣的一列:以「標籤 + key」開頭找(同一棵樹裡有好幾個「全部(*)」)。 */
export const matrixRow = (labelWithKey: string): HTMLElement => {
  const row = screen
    .getAllByRole("treeitem")
    .find((item) => item.textContent.startsWith(labelWithKey));
  if (row === undefined) {
    throw new Error(`找不到矩陣上的「${labelWithKey}」這一列`);
  }
  return row;
};

/** 某一列自己的核取方塊(DOM 上是該列的第一個 input)。 */
export const matrixCheckbox = (labelWithKey: string): HTMLInputElement => {
  const checkbox = matrixRow(labelWithKey).querySelector<HTMLInputElement>(
    "input[type='checkbox']",
  );
  if (checkbox === null) {
    throw new Error(`「${labelWithKey}」這一列沒有核取方塊`);
  }
  return checkbox;
};
