import { expect } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import {
  type TestModule,
  authWorld,
  overviewModule,
} from "@/test/msw/auth-handlers";
import {
  dataScopeRoles,
  dataScopeTargets,
} from "@/test/msw/data-scope-fixtures";
import {
  type DataScopeWorldOptions,
  dataScopeWorld,
} from "@/test/msw/data-scope-handlers";
import { orgUsers, rootTree } from "@/test/msw/org-fixtures";
import { matrixModules } from "@/test/msw/role-fixtures";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import {
  DATA_SCOPE_PERMISSIONS,
  ROLE_MANAGER_VIEW_PERMISSION,
  USER_MANAGER_VIEW_PERMISSION,
} from "./data-scope-permissions";

/**
 * 資料範圍頁測試的共用場景(一份形狀,測試檔只寫行為;寫法同 `org-manager-test-support.ts`)。
 * 這一頁是**根組織專屬**,所以預設的操作者手上連角色與使用者的檢視權限都有。
 */
export const DATA_SCOPE_OWN_PERMISSIONS = [
  DATA_SCOPE_PERMISSIONS.view,
  DATA_SCOPE_PERMISSIONS.edit,
];

export const PICKER_PERMISSIONS = [
  ROLE_MANAGER_VIEW_PERMISSION,
  USER_MANAGER_VIEW_PERMISSION,
];

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
    id: "m-role",
    key: "system.role-manager",
    name: "角色管理",
    parentId: "m-system",
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Fixed,
    order: 1,
    route: "/system/role-manager",
    permissions: permissions.filter((key) =>
      key.startsWith("system.role-manager"),
    ),
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
    permissions: permissions.filter((key) =>
      key.startsWith("system.user-manager"),
    ),
  },
  {
    id: "m-data-scope",
    key: "system.data-scope",
    name: "資料範圍",
    parentId: "m-system",
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Fixed,
    order: 3,
    route: "/system/data-scope",
    permissions: permissions.filter((key) =>
      key.startsWith("system.data-scope"),
    ),
  },
];

export const renderPage = ({
  permissions = [...DATA_SCOPE_OWN_PERMISSIONS, ...PICKER_PERMISSIONS],
  world = {},
}: {
  permissions?: readonly string[];
  world?: DataScopeWorldOptions;
} = {}) => {
  const fake = dataScopeWorld({
    targets: dataScopeTargets,
    roles: dataScopeRoles,
    users: orgUsers,
    orgTree: rootTree,
    permissionModules: matrixModules,
    ...world,
  });
  server.use(
    ...fake.handlers,
    ...authWorld({
      hasRefreshCookie: true,
      modules: modulesWith(permissions),
    }).handlers,
  );
  return { ...renderApp({ path: "/system/data-scope" }), fake };
};

/** 右邊的規則編輯器(左清單也有目標名稱,查詢一律先收斂到其中一邊)。 */
export const editor = () => screen.getByRole("region", { name: "規則編輯器" });

export const targetList = () => screen.getByRole("list", { name: "資料目標" });

/** 編輯器載完(標題列出現)才開始操作。 */
export const waitForEditor = async (name: string) => {
  await waitFor(() => {
    expect(within(editor()).getByText(name)).toBeInTheDocument();
  });
};

/**
 * 打開一個下拉並點一個選項。MUI 的 Select 要先 `mouseDown`(user-event 的 click 也會發),
 * 選項渲染在 `body` 底下的 Popover,所以選項一律從 `screen` 查而不是從欄位內查。
 */
export const chooseOption = async (
  actor: { click: (element: Element) => Promise<void> },
  combobox: Element,
  option: string,
) => {
  await actor.click(combobox);
  await actor.click(await screen.findByRole("option", { name: option }));
};

/**
 * Autocomplete 的選項是**兩行文字**(主文字 + 次文字),所以 `getByRole("option", { name })`
 * 的完整比對對不上(名稱會是「客服租戶 A」)。一律用主文字開頭比對。
 */
export const autocompleteOptions = () =>
  screen.getAllByRole("option").map((option) => option.textContent);

/**
 * Autocomplete 的分組標題(`groupBy` 產生的那幾行)。它們是 listbox 裡的標題、不是
 * `role="option"`,所以查不到角色,只能取 MUI 的 groupLabel(#372 要驗「每個組織只一行」)。
 */
export const autocompleteGroupLabels = () =>
  [
    ...screen
      .getByRole("listbox")
      .querySelectorAll(".MuiAutocomplete-groupLabel"),
  ].map((label) => label.textContent);

/** 打開一個 Autocomplete 並點主文字是 `primary` 的那一列(多選時選單會留著)。 */
export const pickAutocomplete = async (
  actor: { click: (element: Element) => Promise<void> },
  combobox: Element,
  primary: string,
) => {
  await actor.click(combobox);
  const options = await screen.findAllByRole("option");
  const found = options.find((option) =>
    option.textContent.startsWith(primary),
  );
  expect(found).toBeDefined();
  await actor.click(found as Element);
};

/** 依浮動標籤取編輯器裡的下拉(同一頁會有很多個,依序取用)。 */
export const comboboxes = (label: string) =>
  within(editor()).getAllByRole("combobox", { name: label });

export const comboboxAt = (label: string, index = 0): Element => {
  const found = comboboxes(label);
  expect(found.length).toBeGreaterThan(index);
  return found[index];
};

/** 第 n 條規則的「套用對象」(AudiencePicker)與「條件組合」兩塊。 */
export const audienceRegion = (index = 0): HTMLElement => {
  const found = within(editor()).getAllByRole("region", { name: "套用對象" });
  expect(found.length).toBeGreaterThan(index);
  return found[index];
};

export const conditionsRegion = (index = 0): HTMLElement => {
  const found = within(editor()).getAllByRole("region", { name: "條件組合" });
  expect(found.length).toBeGreaterThan(index);
  return found[index];
};
