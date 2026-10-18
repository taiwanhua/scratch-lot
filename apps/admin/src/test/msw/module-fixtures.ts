import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import { type TestModule, overviewModule } from "./auth-handlers";

/**
 * 與 `apps/db-migrator/seeds/base/modules/*` 同形的模組陣列(ADR-0011 步驟 7 的輸出形狀:
 * route 為完整路徑、api 樹 route 為 null),供殼的測試當 `me.modules` 夾具。
 * 順序刻意不照 order 排,驗證前端自行排序。
 * `icon` 照 `docs/modules/module-manager.md`「側欄圖示」的初值對照表(隱藏頁一律 null)。
 */
const link = (
  id: string,
  key: string,
  name: string,
  parentId: string | null,
  order: number,
  route: string,
  icon: string | null = null,
): TestModule => ({
  id,
  key,
  name,
  parentId,
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order,
  route,
  icon,
  permissions: [`${key}.*`],
});

const group = (
  id: string,
  key: string,
  name: string,
  parentId: string | null,
  order: number,
  route: string,
  icon: string | null = null,
): TestModule => ({
  ...link(id, key, name, parentId, order, route, icon),
  sidebarType: ModuleSidebarType.Group,
});

const hidden = (
  id: string,
  key: string,
  name: string,
  parentId: string | null,
  order: number,
  route: string | null,
  icon: string | null = null,
): TestModule => ({
  ...link(id, key, name, parentId, order, route ?? "", icon),
  sidebarType: ModuleSidebarType.Hidden,
  route,
});

/** 系統管理群組 + 六個治理模組(seeds/base/modules/system.ts)。 */
export const systemModules: TestModule[] = [
  link(
    "m-user",
    "system.user-manager",
    "使用者管理",
    "m-system",
    2,
    "/system/user-manager",
    "people",
  ),
  group("m-system", "system", "系統管理", null, 1, "/system", "settings"),
  link(
    "m-data-scope",
    "system.data-scope",
    "資料範圍",
    "m-system",
    6,
    "/system/data-scope",
    "filter",
  ),
  link(
    "m-org",
    "system.org-manager",
    "組織管理",
    "m-system",
    1,
    "/system/org-manager",
    "business",
  ),
  link(
    "m-field",
    "system.field-manager",
    "欄位管理",
    "m-system",
    5,
    "/system/field-manager",
    "label",
  ),
  link(
    "m-role",
    "system.role-manager",
    "角色管理",
    "m-system",
    3,
    "/system/role-manager",
    "shield",
  ),
  link(
    "m-module",
    "system.module-manager",
    "模組與權限",
    "m-system",
    4,
    "/system/module-manager",
    "apps",
  ),
];

/** 示範群組 `demo`(seeds/base/modules/demo.sub.sample-one.ts);只掛示範表單(群組內)的測試單獨拿它補父節點。 */
export const demoGroupNode: TestModule = group(
  "m-demo",
  "demo",
  "示範群組",
  null,
  2,
  "/demo",
  "extension",
);

/** 示範模組2 家族:示範群組 → 示範模組2 + 三個隱藏頁(seeds/base/modules/demo.sample-two.ts)。 */
export const sampleTwoModules: TestModule[] = [
  hidden(
    "m-two-edit",
    "demo.sample-two.edit-page",
    "編輯",
    "m-two",
    3,
    "/demo/sample-two/edit-page",
  ),
  demoGroupNode,
  link(
    "m-two",
    "demo.sample-two",
    "示範模組2",
    "m-demo",
    2,
    "/demo/sample-two",
    "list",
  ),
  hidden(
    "m-two-view",
    "demo.sample-two.view-page",
    "詳情",
    "m-two",
    1,
    "/demo/sample-two/view-page",
  ),
  hidden(
    "m-two-create",
    "demo.sample-two.create-page",
    "新增",
    "m-two",
    2,
    "/demo/sample-two/create-page",
  ),
];

/** 示範模組1 家族:示範次群組 → 示範模組1 + 三個隱藏頁(seeds/base/modules/demo.sub.sample-one.ts)。 */
export const sampleOneModules: TestModule[] = [
  group(
    "m-demo-sub",
    "demo.sub",
    "示範次群組",
    "m-demo",
    1,
    "/demo/sub",
    "folder",
  ),
  hidden(
    "m-one-edit",
    "demo.sub.sample-one.edit-page",
    "編輯示範項目",
    "m-one",
    3,
    "/demo/sub/sample-one/edit-page",
  ),
  link(
    "m-one",
    "demo.sub.sample-one",
    "示範模組1",
    "m-demo-sub",
    1,
    "/demo/sub/sample-one",
    "grid",
  ),
  hidden(
    "m-one-view",
    "demo.sub.sample-one.view-page",
    "示範項目詳情",
    "m-one",
    1,
    "/demo/sub/sample-one/view-page",
  ),
  hidden(
    "m-one-create",
    "demo.sub.sample-one.create-page",
    "新增示範項目",
    "m-one",
    2,
    "/demo/sub/sample-one/create-page",
  ),
];

/**
 * **沒有登記頁面元件的模組**(`app/module-pages.tsx` 裡查不到這個 key)。
 *
 * 殼對這種模組會顯示佔位頁(內容區就是模組名的標題),那是殼自己的行為、要一直測得到 ——
 * 以前是拿「還沒實作的示範模組2」來驗,示範家族全部實作完之後就沒有這種模組了,
 * 所以改成一支**永遠不會被實作**的夾具模組。新增真頁面時不要順手把它登記掉。
 */
export const placeholderModules: TestModule[] = [
  group("m-demo", "demo", "示範群組", null, 2, "/demo", "extension"),
  link(
    "m-placeholder",
    "demo.not-implemented",
    "未實作模組",
    "m-demo",
    9,
    "/demo/not-implemented",
    "list",
  ),
  hidden(
    "m-placeholder-edit",
    "demo.not-implemented.edit-page",
    "編輯",
    "m-placeholder",
    1,
    "/demo/not-implemented/edit-page",
  ),
];

/** 隱藏的純 API 樹:在陣列裡但 route 為 null(seeds/base/modules/api.ts)。 */
export const apiModules: TestModule[] = [
  hidden("m-api", "api", "API 能力", null, 99, null, "tune"),
];

/** 超級管理員看到的全部:總覽 + 系統管理六項 + 示範家族 + api 樹。 */
export const superAdminModules: TestModule[] = [
  ...apiModules,
  overviewModule,
  ...sampleOneModules,
  ...systemModules,
  ...sampleTwoModules,
];
