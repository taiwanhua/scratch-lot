import { screen, within } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import { FIELD_MANAGER_PERMISSIONS } from "@/components/base/FieldManager/field-manager-permissions";
import {
  type TestModule,
  authWorld,
  overviewModule,
} from "@/test/msw/auth-handlers";
import {
  currentOrg,
  fieldCategories,
  fieldsByCategory,
  upperOrg,
} from "@/test/msw/field-fixtures";
import {
  type FieldWorldOptions,
  fieldWorld,
} from "@/test/msw/field-manager-handlers";
import {
  type FieldOptionColorWorldOptions,
  fieldOptionColorWorld,
} from "@/test/msw/project/field-option-colors-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * 欄位管理(帶顏色欄的客製頁)測試的共用場景:路由、殼、守門都是真的,只有 api 是假的
 * (欄位管理沿用底座的 `fieldWorld`,顏色是 `fieldOptionColorWorld`)。
 * 夾具組織樹同底座的欄位管理測試:好食公司(上層)─ 南港店(當前組織)─ 子南港店。
 */
export const FULL_PERMISSIONS = [
  FIELD_MANAGER_PERMISSIONS.view,
  FIELD_MANAGER_PERMISSIONS.create,
  FIELD_MANAGER_PERMISSIONS.edit,
  FIELD_MANAGER_PERMISSIONS.toggleEnabled,
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
    id: "m-field",
    key: "system.field-manager",
    name: "欄位管理",
    parentId: "m-system",
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Fixed,
    order: 5,
    route: "/system/field-manager",
    permissions: [...permissions],
  },
];

/** 示範分類各選項 → 類別 key 與值(假伺服器寫入時用)。 */
const demoOptions = Object.fromEntries(
  (fieldsByCategory["cat-demo"] ?? []).map((field) => [
    field.id,
    { categoryKey: "demo-category", value: field.value },
  ]),
);

export const renderColorPage = ({
  permissions = FULL_PERMISSIONS,
  world = {},
  colors = {},
}: {
  permissions?: readonly string[];
  world?: FieldWorldOptions;
  colors?: FieldOptionColorWorldOptions;
} = {}) => {
  const fake = fieldWorld({
    categories: fieldCategories,
    fieldsByCategory,
    currentOrg,
    upperOrgIds: [upperOrg.id],
    ...world,
  });
  const colorFake = fieldOptionColorWorld({ options: demoOptions, ...colors });
  server.use(
    ...fake.handlers,
    ...colorFake.handlers,
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [currentOrg],
      modules: modulesWith(permissions),
    }).handlers,
  );
  return { ...renderApp({ path: "/system/field-manager" }), colorFake };
};

/** 選一個類別並等右邊換好(四段接力:恢復登入 → me → 類別 → 選項)。 */
export const selectCategory = async (
  actor: { click: (element: Element) => Promise<void> },
  name: string,
) => {
  const list = await screen.findByRole("region", { name: "欄位類別" });
  await actor.click(await within(list).findByText(name));
  await screen.findByText(`${name} — 選項`);
};

/** 表格的一列(以顯示名稱找)。 */
export const findRowOf = (label: string) =>
  screen.findByRole("row", { name: new RegExp(label) });
