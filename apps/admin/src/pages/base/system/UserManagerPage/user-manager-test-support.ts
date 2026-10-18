import { screen } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType, RoleKind } from "@repo/graphql";

import {
  type TestOrg as TestMeOrg,
  type TestModule,
  authWorld,
  overviewModule,
} from "@/test/msw/auth-handlers";
import type { TestRole } from "@/test/msw/role-fixtures";
import { server } from "@/test/msw/server";
import {
  type TestOrg,
  type TestOrgNode,
  type TestUser,
  type UserWorldOptions,
  userWorld,
} from "@/test/msw/user-manager-handlers";
import { renderApp } from "@/test/render";

import {
  ORG_MANAGER_VIEW_PERMISSION,
  USER_MANAGER_PERMISSIONS,
} from "./user-manager-permissions";

/**
 * 使用者管理頁測試的共用場景(`UserManagerPage.test.tsx` 與
 * `AssignRolesDialog/AssignRolesDialog.test.tsx` 共用):一份形狀,測試檔只寫行為(TEST-08)。
 */

/** 左樹要 `system.org-manager.view`;拿掉它就是「樹不可用」那條路。 */
export const ALL_PERMISSIONS = [
  ...Object.values(USER_MANAGER_PERMISSIONS),
  ORG_MANAGER_VIEW_PERMISSION,
];

export const modulesWith = (permissions: readonly string[]): TestModule[] => [
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
    permissions: [...permissions],
  },
];

export const orgTree: TestOrgNode[] = [
  {
    id: "org-tenant",
    name: "租戶 A",
    parentId: "org-root",
    enabled: true,
    outOfScope: false,
    children: [
      {
        id: "org-content",
        name: "內容組",
        parentId: "org-tenant",
        enabled: true,
        outOfScope: false,
        children: [],
      },
      {
        id: "org-other",
        name: "租戶 B",
        parentId: "org-tenant",
        enabled: true,
        outOfScope: true,
        children: [],
      },
    ],
  },
];

/** 樹根 = 租戶頂層(`parentId` 不是 null)→ 它的 `ownerUserId` 是受保護的擁有者。 */
export const tenantRootOrg: TestOrg = {
  id: "org-tenant",
  name: "租戶 A",
  description: null,
  parentId: "org-root",
  enabled: true,
  isSystem: false,
  ownerUserId: "user-owner",
  visibility: null,
  logoUrl: null,
};

const role = (
  id: string,
  name: string,
  outOfScope = false,
): TestUser["roles"][number] => ({
  id,
  name,
  ownerOrgId: "org-tenant",
  ownerOrgName: "租戶 A",
  outOfScope,
});

const user = (
  id: string,
  name: string,
  overrides: Partial<TestUser> = {},
): TestUser => ({
  id,
  account: id,
  name,
  email: `${id}@cookhome.online`,
  nickname: null,
  gender: null,
  phone: null,
  address: null,
  nationalId: null,
  enabled: true,
  mustChangePassword: false,
  orgs: [{ id: "org-tenant", name: "租戶 A" }],
  roles: [],
  ...overrides,
});

/**
 * 指派角色彈窗的候選來源(正式的 `roles` query:擁有組織在操作者管理範圍內)。
 * 「審核員」刻意不在裡面 —— 它是王小明已持有、但操作者搆不到的既有授予。
 */
const assignableRole = (
  id: string,
  name: string,
  overrides: Partial<TestRole> = {},
): TestRole => ({
  id,
  name,
  description: null,
  enabled: true,
  kind: RoleKind.Custom,
  abilities: {
    canEdit: true,
    canEditMatrix: true,
    canToggleEnabled: true,
    canDelete: true,
  },
  isSystem: false,
  isTemplateCopy: false,
  userCount: 0,
  ownerOrg: {
    id: "org-tenant",
    name: "租戶 A",
    tenantTop: { id: "org-tenant", name: "租戶 A" },
  },
  ...overrides,
});

export const assignableRoles: TestRole[] = [
  assignableRole("role-editor", "編輯", { description: "內容管理相關權限" }),
  assignableRole("role-viewer", "檢視者", { enabled: false }),
  assignableRole("role-admin", "租戶管理員", {
    kind: RoleKind.TemplateCopy,
    isTemplateCopy: true,
  }),
  /**
   * 擁有組織是「租戶 B」(租戶 A 底下的另一支),而王小明屬「租戶 A / 內容組」——
   * 所以他**沒有被授予這一筆的資格**(ADR-0003)。這種列照樣顯示、
   * 但勾不動並就地說明,不是勾得下去、送出才吃到錯。
   */
  assignableRole("role-branch-only", "分店專員", {
    ownerOrg: {
      id: "org-other",
      name: "租戶 B",
      tenantTop: { id: "org-tenant", name: "租戶 A" },
    },
  }),
];

const operator = user("user-1", "小華", {
  roles: [role("role-editor", "編輯")],
});
const owner = user("user-owner", "何家華", {
  roles: [role("role-admin", "租戶管理員")],
});
const ming = user("user-ming", "王小明", {
  orgs: [
    { id: "org-tenant", name: "租戶 A" },
    { id: "org-content", name: "內容組" },
  ],
  roles: [role("role-editor", "編輯"), role("role-audit", "審核員", true)],
  nationalId: "A123456789",
});
const fillers = Array.from({ length: 9 }, (_, index) =>
  user(`user-f${String(index)}`, `路人${String(index)}`),
);

export const defaultUsers = [operator, owner, ming, ...fillers];

export const renderPage = ({
  permissions = ALL_PERMISSIONS,
  world = {},
  search = "",
  meOrgs,
}: {
  permissions?: readonly string[];
  world?: UserWorldOptions;
  /** 起始網址的查詢字串(含 `?`;重新整理、帶參數打開用) */
  search?: string;
  /**
   * 登入者自己的所屬組織(`me.orgs`,AppBar 的「當前組織」可切換清單)。
   * **傳進來的陣列就是 handler 回的那一份**,測試在流程中間 `push` 一筆,
   * 下一次重取 `me` 就看得到 —— 兩個 world 各自獨立,`setUserOrgs` 不會動到 `me`。
   */
  meOrgs?: TestMeOrg[];
} = {}) => {
  const fake = userWorld({
    users: defaultUsers,
    orgTree,
    roles: assignableRoles,
    rootOrg: tenantRootOrg,
    ...world,
  });
  const auth = authWorld({
    hasRefreshCookie: true,
    modules: modulesWith(permissions),
    ...(meOrgs === undefined ? {} : { orgs: meOrgs }),
  });
  server.use(...fake.handlers, ...auth.handlers);
  return {
    ...renderApp({ path: `/system/user-manager${search}` }),
    fake,
    auth,
  };
};

export const rowOf = (name: string) =>
  screen.getByRole("row", { name: new RegExp(name) });

/**
 * 「選擇所屬組織」彈窗裡某個組織的核取方塊。
 * 以標籤**開頭**比對那一列(上層節點的 `textContent` 含子孫的文字),
 * 取它自己的核取方塊 = 該列 DOM 上的第一個(與 `@repo/ui` 的 Tree 測試同一招)。
 */
export const orgCheckboxOf = async (
  name: string,
): Promise<HTMLInputElement> => {
  const items = await screen.findAllByRole("treeitem");
  const row = items.find((item) => item.textContent.startsWith(name));
  if (row === undefined) {
    throw new Error(`找不到「${name}」這一列`);
  }
  const checkbox = row.querySelector<HTMLInputElement>(
    "input[type='checkbox']",
  );
  if (checkbox === null) {
    throw new Error(`「${name}」這一列沒有核取方塊`);
  }
  return checkbox;
};
