import { screen, within } from "@testing-library/react";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import { FIELD_MANAGER_PERMISSIONS } from "@/components/base/FieldManager/field-manager-permissions";
import {
  type TestModule,
  type TestOrg,
  authWorld,
  overviewModule,
} from "@/test/msw/auth-handlers";
import {
  currentOrg as currentOrgFixture,
  fieldCategories,
  fieldsByCategory,
  upperOrg,
} from "@/test/msw/field-fixtures";
import {
  type FieldWorldOptions,
  fieldWorld,
} from "@/test/msw/field-manager-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * 欄位管理頁測試的共用場景(`FieldManagerPage.test.tsx`、`FieldManagerSeed.test.tsx`
 * 與 `FieldManagerVisibility.test.tsx` 共用):一份形狀,測試檔只寫行為(TEST-08)。
 *
 * 組織樹與 api 的 `field-visibility.test.ts` 同一組:
 * 好食公司(上層)─ **南港店(當前組織)** ─ 子南港店。
 */

export const VIEW_ONLY = [FIELD_MANAGER_PERMISSIONS.view];
/** 欄位管理這一層的四筆(租戶管理員拿得到的全部);不含根組織專屬的管理類別。 */
export const FULL_PERMISSIONS = [
  FIELD_MANAGER_PERMISSIONS.view,
  FIELD_MANAGER_PERMISSIONS.create,
  FIELD_MANAGER_PERMISSIONS.edit,
  FIELD_MANAGER_PERMISSIONS.toggleEnabled,
];
/** 站在根組織、另持 `category-ops.manage-categories`(新增 / 改名 / 停用類別)。 */
export const CATEGORY_MANAGER = [
  ...FULL_PERMISSIONS,
  FIELD_MANAGER_PERMISSIONS.manageCategories,
];

/** 當前組織(`me.currentOrg`);來源欄的組織名稱改由 api 逐列帶回,不取自這裡。 */
export const currentOrg: TestOrg = currentOrgFixture;

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

export const modulesWith = (permissions: readonly string[]): TestModule[] => [
  overviewModule,
  systemGroup,
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

export const renderPage = ({
  permissions = FULL_PERMISSIONS,
  world = {},
  search = "",
}: {
  permissions?: readonly string[];
  world?: FieldWorldOptions;
  /** 起始網址的查詢字串(含 `?`;重新整理、帶參數打開用) */
  search?: string;
} = {}) => {
  const fake = fieldWorld({
    categories: fieldCategories,
    fieldsByCategory,
    currentOrg: currentOrgFixture,
    upperOrgIds: [upperOrg.id],
    ...world,
  });
  server.use(
    ...fake.handlers,
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [currentOrg],
      modules: modulesWith(permissions),
    }).handlers,
  );
  return { ...renderApp({ path: `/system/field-manager${search}` }), fake };
};

/** 類別清單與選項表格各自收斂:兩邊都可能出現同一個名稱。 */
export const categoryList = () =>
  screen.getByRole("region", { name: "欄位類別" });
export const optionsPanel = () =>
  screen.getByRole("region", { name: "欄位選項" });

/**
 * 選一個類別並等右邊換好。頁面是「恢復登入 → me → 類別 → 選項」四段接力,
 * 所以每一步都要等(同步的 `getBy*` 會在還在轉圈時就炸,TEST-08)。
 */
export const selectCategory = async (
  actor: { click: (element: Element) => Promise<void> },
  name: string,
) => {
  const list = await screen.findByRole("region", { name: "欄位類別" });
  await actor.click(await within(list).findByText(name));
  await screen.findByText(`${name} — 選項`);
};

/** 表格的一列(以顯示名稱找);清單是後到的,所以等它出現。 */
export const findRowOf = (label: string) =>
  screen.findByRole("row", { name: new RegExp(label) });
