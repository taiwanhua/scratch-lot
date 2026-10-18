import { expect } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import {
  type TestModule,
  authWorld,
  overviewModule,
} from "@/test/msw/auth-handlers";
import { moduleAdminTree } from "@/test/msw/module-admin-fixtures";
import {
  type ModuleAdminWorldOptions,
  moduleAdminWorld,
} from "@/test/msw/module-manager-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { MODULE_MANAGER_PERMISSIONS } from "./module-manager-permissions";

/**
 * 模組與權限頁測試的共用場景(`ModuleManagerPage.test.tsx` 與
 * `ModuleManagerToggles.test.tsx` 共用):一份形狀,測試檔只寫行為(TEST-08)。
 */

export const VIEW_ONLY = [MODULE_MANAGER_PERMISSIONS.view];
export const FULL_PERMISSIONS = [
  MODULE_MANAGER_PERMISSIONS.view,
  MODULE_MANAGER_PERMISSIONS.toggleEnabled,
  MODULE_MANAGER_PERMISSIONS.setIcon,
];
/** 換圖示與停用是兩把鑰匙:只有 `.toggle-enabled` 時圖示欄位仍是唯讀的 */
export const WITHOUT_SET_ICON = [
  MODULE_MANAGER_PERMISSIONS.view,
  MODULE_MANAGER_PERMISSIONS.toggleEnabled,
];

/**
 * 操作者的 `me.modules`:本模組 `isRootOnly`,租戶那邊根本沒有這一項,
 * 所以能走到這一頁就代表是根組織的人(ADR-0009 / ADR-0011)。
 */
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
    id: "m-module",
    key: "system.module-manager",
    name: "模組與權限",
    parentId: "m-system",
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Fixed,
    order: 4,
    route: "/system/module-manager",
    permissions: [...permissions],
  },
];

export const renderPage = ({
  permissions = FULL_PERMISSIONS,
  world = {},
  search = "",
}: {
  permissions?: readonly string[];
  world?: ModuleAdminWorldOptions;
  /** 起始網址的查詢字串(含 `?`;重新整理、帶參數打開用) */
  search?: string;
} = {}) => {
  const fake = moduleAdminWorld({ tree: moduleAdminTree, ...world });
  server.use(
    ...fake.handlers,
    ...authWorld({
      hasRefreshCookie: true,
      modules: modulesWith(permissions),
    }).handlers,
  );
  return { ...renderApp({ path: `/system/module-manager${search}` }), fake };
};

/** 樹與資料區都有模組名稱(側欄也是),查詢一律先收斂到其中一邊。 */
export const moduleTree = () => screen.getByRole("tree", { name: "模組樹" });
export const detail = () => screen.getByRole("region", { name: "模組資料" });

/** 節點自己的標籤(不含子孫:treeitem 的 textContent 會把整棵子樹串進來)。 */
const labelOf = (item: Element) =>
  item.querySelector(".MuiTreeItem-label")?.textContent ?? "";

export const treeLabel = (name: string) => {
  const item = within(moduleTree())
    .getAllByRole("treeitem")
    .find((candidate) => labelOf(candidate).startsWith(name));
  return item === undefined ? undefined : labelOf(item);
};

/**
 * 樹是先渲染骨架、資料後到的;載入完成時 MUI 會換掉整個樹根元素,
 * 所以每次輪詢都要重新查(抓住舊的那顆會永遠等不到)。
 */
export const waitForTree = async () => {
  await waitFor(() => {
    expect(within(moduleTree()).getByText("系統管理")).toBeInTheDocument();
  });
};

/**
 * 點一個節點 = **只有選取**(`Tree` 設了 `expansionTrigger="iconContainer"`,
 * 展開 / 收合只認名稱前面的箭頭),所以點過的節點不會收起來,子節點照樣找得到。
 */
export const clickNode = async (
  actor: { click: (element: Element) => Promise<void> },
  name: string,
) => {
  await actor.click(await within(moduleTree()).findByText(name));
};
