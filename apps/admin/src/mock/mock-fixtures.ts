import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";
import { projectPublic } from "@repo/project-config/public";

import {
  FIELD_MANAGER_MODULE_KEY,
  FIELD_MANAGER_PERMISSIONS,
} from "@/components/base/FieldManager/field-manager-permissions";
import {
  SAMPLE_ONE_MODULE_KEYS,
  SAMPLE_ONE_PERMISSIONS,
} from "@/pages/base/demo/demo-sample-one-config";
import {
  SAMPLE_TWO_MODULE_KEYS,
  SAMPLE_TWO_PERMISSIONS,
} from "@/pages/base/demo/demo-sample-two-config";
import {
  DATA_SCOPE_MODULE_KEY,
  DATA_SCOPE_PERMISSIONS,
} from "@/pages/base/system/DataScopePage/data-scope-permissions";
import {
  MODULE_MANAGER_MODULE_KEY,
  MODULE_MANAGER_PERMISSIONS,
} from "@/pages/base/system/ModuleManagerPage/module-manager-permissions";
import {
  NOTIFICATION_SETTINGS_MODULE_KEY,
  NOTIFICATION_SETTINGS_PERMISSIONS,
} from "@/pages/base/system/NotificationSettingsPage/notification-settings-permissions";
import {
  ORG_MANAGER_MODULE_KEY,
  ORG_MANAGER_PERMISSIONS,
} from "@/pages/base/system/OrgManagerPage/org-manager-permissions";
import {
  ROLE_MANAGER_MODULE_KEY,
  ROLE_MANAGER_PERMISSIONS,
} from "@/pages/base/system/RoleManagerPage/role-manager-permissions";
import {
  USER_MANAGER_MODULE_KEY,
  USER_MANAGER_PERMISSIONS,
} from "@/pages/base/system/UserManagerPage/user-manager-permissions";
import type { TestModule, TestOrg } from "@/test/msw/auth-handlers";
import { overviewModule } from "@/test/msw/auth-handlers";
import { dataScopeRoles } from "@/test/msw/data-scope-fixtures";
import { demoFormModules, formsModules } from "@/test/msw/form-fixtures";
import {
  sampleOneModules,
  sampleTwoModules,
  systemModules,
} from "@/test/msw/module-fixtures";
import { printersModule } from "@/test/msw/printing-fixtures";
import { reportsModule } from "@/test/msw/reports-fixtures";
import type { TestRole } from "@/test/msw/role-fixtures";
import type { TestUser } from "@/test/msw/user-manager-handlers";
import { HR_ROLE_ID } from "@/test/msw/workflow-audience-fixtures";
import {
  applyCenterModules,
  demoGroupFormModules,
  workflowsModules,
} from "@/test/msw/workflow-fixtures";

/**
 * mock 開發模式**自己的**夾具:`src/test/msw/` 沒有正本的那幾份。
 *
 * 規矩:凡是 `src/test/msw/` 已經有的(組織樹、角色、模組樹、資料範圍、欄位)一律直接用,
 * 不在這裡複製一份 —— 兩份會漂走,而測試那一份才是對著 api 斷言校準過的(TEST-08)。
 * 這裡只補三樣:①使用者清單(測試的正本在 `UserManagerPage/user-manager-test-support.ts`,
 * 那是頁面自己的檔案,mock 模式不該反向依賴)②角色清單的型別補齊 ③「視角」= 模組與權限的組合。
 */

/**
 * 全 mock 世界共用的角色清單。取 `data-scope-fixtures.ts` 的 `dataScopeRoles` 而不是
 * `role-fixtures.ts` 的 `roles`:資料範圍頁的 `savedRule` 指名 `role-support`,
 * 兩邊不同份的話那一頁的「指定角色」會顯示成生的 id。它同時含兩個租戶的同名「租戶管理員」,
 * 正是角色管理頁要看的分組畫面。
 *
 * `map` 只做一件事:codegen 的型別把欄位標成 optional,補成角色管理頁夾具的 `TestRole` 形狀。
 */
export const mockRoles: TestRole[] = [
  ...dataScopeRoles,
  // 流程管理的「病假審核 · 人資」關卡用的角色(人員條件只收 ObjectId 字串,id 對齊 `workflow-fixtures.ts`)
  { ...dataScopeRoles[0], id: HR_ROLE_ID, name: "人資", userCount: 2 },
].map((role) => ({
  ...role,
  description: role.description ?? null,
  ownerOrg:
    role.ownerOrg == null
      ? null
      : { ...role.ownerOrg, tenantTop: role.ownerOrg.tenantTop ?? null },
}));

/** 可切換的視角(query string `?view=`)。 */
export type MockView = "root" | "tenant";

/** 使用者管理的清單與細節(`users` / `user`);組織 id 對齊 `org-fixtures.ts` 的 `rootTree`。 */
const user = (
  id: string,
  account: string,
  name: string,
  overrides: Partial<TestUser> = {},
): TestUser => ({
  id,
  account,
  name,
  email: `${account}@example.invalid`,
  nickname: null,
  gender: null,
  phone: null,
  address: null,
  nationalId: null,
  enabled: true,
  mustChangePassword: false,
  orgs: [{ id: "org-tenant-a", name: "租戶 A" }],
  roles: [],
  ...overrides,
});

const grant = (
  id: string,
  name: string,
  outOfScope = false,
): TestUser["roles"][number] => ({
  id,
  name,
  ownerOrgId: "org-tenant-a",
  ownerOrgName: "租戶 A",
  outOfScope,
});

/**
 * 十二筆 —— `userWorld` 的預設 `pageSize` 是 10,故意超過一頁,分頁列才有東西可截圖。
 * `user-owner` 是 `org-fixtures.ts` 的 `orgDetails` 指定的租戶擁有者(轉移擁有者彈窗的候選人),
 * id 對不上的話組織管理頁的擁有者欄會是空的。
 */
export const mockUsers: TestUser[] = [
  user("user-1", "root", "小華", {
    orgs: [{ id: "org-root", name: projectPublic.brand.name }],
  }),
  user("user-owner", "owner", "何家華", {
    roles: [grant("role-admin", "租戶管理員")],
  }),
  user("user-ming", "ming", "王小明", {
    orgs: [
      { id: "org-tenant-a", name: "租戶 A" },
      { id: "org-content", name: "A-1 內容組" },
    ],
    roles: [
      grant("role-editor", "內容編輯"),
      grant("role-audit", "審核員", true),
    ],
    nationalId: "A123456789",
    phone: "0912-345-678",
  }),
  user("user-new", "newbie", "新同事", {
    orgs: [{ id: "org-content", name: "A-1 內容組" }],
    mustChangePassword: true,
  }),
  user("user-off", "off", "離職者", {
    enabled: false,
    orgs: [{ id: "org-store", name: "A-2 台北分店" }],
  }),
  user("user-b", "tenant-b", "租戶 B 管理員", {
    orgs: [{ id: "org-tenant-b", name: "租戶 B" }],
  }),
  ...Array.from({ length: 6 }, (_, index) =>
    user(
      `user-f${String(index)}`,
      `staff${String(index)}`,
      `路人${String(index)}`,
      {
        orgs: [{ id: "org-editors", name: "A-1-1 編輯組" }],
      },
    ),
  ),
];

/** 每個模組**展開後**的完整權限(`me.modules[].permissions`;`<模組>.*` 只涵蓋同層,ADR-0004)。 */
const permissionsByModuleKey: Record<string, readonly string[]> = {
  [ORG_MANAGER_MODULE_KEY]: Object.values(ORG_MANAGER_PERMISSIONS),
  [USER_MANAGER_MODULE_KEY]: Object.values(USER_MANAGER_PERMISSIONS),
  [ROLE_MANAGER_MODULE_KEY]: Object.values(ROLE_MANAGER_PERMISSIONS),
  [MODULE_MANAGER_MODULE_KEY]: Object.values(MODULE_MANAGER_PERMISSIONS),
  [FIELD_MANAGER_MODULE_KEY]: Object.values(FIELD_MANAGER_PERMISSIONS),
  [DATA_SCOPE_MODULE_KEY]: Object.values(DATA_SCOPE_PERMISSIONS),
  // 示範模組1:同層的權限在列表頁那一層,兩個頁面自有權限掛在各自的隱藏頁
  [SAMPLE_ONE_MODULE_KEYS.list]: [
    SAMPLE_ONE_PERMISSIONS.view,
    SAMPLE_ONE_PERMISSIONS.create,
    SAMPLE_ONE_PERMISSIONS.showInternalNote,
    SAMPLE_ONE_PERMISSIONS.editInternalNote,
  ],
  [SAMPLE_ONE_MODULE_KEYS.createPage]: [SAMPLE_ONE_PERMISSIONS.showTips],
  [SAMPLE_ONE_MODULE_KEYS.editPage]: [SAMPLE_ONE_PERMISSIONS.showHistory],
  // 示範模組2:對照組的四筆全掛在列表頁那一層(沒有頁面自有權限)
  [SAMPLE_TWO_MODULE_KEYS.list]: [
    SAMPLE_TWO_PERMISSIONS.view,
    SAMPLE_TWO_PERMISSIONS.create,
    `${SAMPLE_TWO_MODULE_KEYS.list}.edit`,
    `${SAMPLE_TWO_MODULE_KEYS.list}.delete`,
  ],
};

/** 模組與權限、資料範圍是 `isRootOnly`:租戶管理員的 `me.modules` 裡根本沒有它們。 */
const ROOT_ONLY_MODULE_KEYS = new Set<string>([
  MODULE_MANAGER_MODULE_KEY,
  DATA_SCOPE_MODULE_KEY,
]);

const withFullPermissions = (module: TestModule): TestModule => ({
  ...module,
  permissions: [...(permissionsByModuleKey[module.key] ?? module.permissions)],
});

/** 通知設定(seed 正本 apps/db-migrator/seeds/base/modules/system.ts 的 order 9)。 */
const notificationSettingsModule: TestModule = {
  id: "m-notification-settings",
  key: NOTIFICATION_SETTINGS_MODULE_KEY,
  name: "通知設定",
  parentId: "m-system",
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order: 9,
  route: "/system/notification-settings",
  icon: "notifications",
  permissions: Object.values(NOTIFICATION_SETTINGS_PERMISSIONS),
};

/**
 * 側欄與路由的來源:總覽 + 系統管理群組 + 該視角看得到的治理模組 + 示範家族,權限給滿。
 *
 * 示範家族兩支都放(seed 就是兩支都灌):示範模組1與示範模組2的四頁都已實作,
 * 兩者的隱藏頁都在,路由防守才有東西可看。
 */
export const modulesForView = (view: MockView): TestModule[] => [
  overviewModule,
  ...systemModules
    .filter(
      (module) => view === "root" || !ROOT_ONLY_MODULE_KEYS.has(module.key),
    )
    .map((module) => withFullPermissions(module)),
  ...sampleTwoModules.map((module) => withFullPermissions(module)),
  ...sampleOneModules.map((module) => withFullPermissions(module)),
  // 表單引擎:表單管理(掛在系統管理群組下)與表單模組範例「示範表單(頂層)」
  ...formsModules(["system.forms.*"]).filter(
    (module) => module.key === "system.forms",
  ),
  ...demoFormModules(["demo-form.*"]),
  // 審核流程:流程管理 + 阻擋清單(掛在系統管理群組下)、申請中心 + 詳情、表單模組範例「示範表單(群組內)」
  ...workflowsModules(
    ["system.workflows.*"],
    ["system.workflows.blocked-page.reassign"],
  ).filter((module) => module.key !== "system"),
  ...applyCenterModules(),
  ...demoGroupFormModules(["demo.form.*"]),
  // 通知設定(掛在系統管理群組下,排在既有 8 項之後)
  notificationSettingsModule,
  // 印表機管理(系統管理群組最後一項)
  printersModule(),
  // 輸出報表(頂層;報表本身由登記決定,權限給滿)
  reportsModule(),
];

/** `me.orgs`(組織切換器);第一個即 `me.currentOrg`。 */
export const orgsForView = (view: MockView): TestOrg[] =>
  view === "root"
    ? [
        { id: "org-root", name: projectPublic.brand.name },
        { id: "org-tenant-a", name: "租戶 A" },
      ]
    : [
        { id: "org-tenant-a", name: "租戶 A" },
        { id: "org-content", name: "A-1 內容組" },
      ];
