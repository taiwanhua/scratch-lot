import { ModuleSidebarType, RoleKind } from "@repo/graphql";

import type { TestOrgNode } from "./org-manager-handlers";

/**
 * 角色管理頁的夾具。形狀對齊 api 的 payload(`docs/modules/role-manager.md`
 * 「api 介面」的 GQL-07 欄位語意):`RoleMatrixPayload.granted` 已是展開後的授予,
 * 可以直接餵 `@repo/domain/permission` 的連動純函式。
 */

/** 角色種類規則算出來的四個動作(api 依操作者算好,前端只讀)。 */
export interface TestRoleAbilities {
  canEdit: boolean;
  canEditMatrix: boolean;
  canToggleEnabled: boolean;
  canDelete: boolean;
}

export interface TestRole {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  kind: RoleKind;
  abilities: TestRoleAbilities;
  isSystem: boolean;
  isTemplateCopy: boolean;
  userCount: number;
  ownerOrg: {
    id: string;
    name: string;
    tenantTop: { id: string; name: string } | null;
  } | null;
}

export interface TestMatrixPermission {
  id: string;
  key: string;
  name: string;
  description: string | null;
  action: string;
}

export interface TestMatrixModule {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  sidebarType: ModuleSidebarType;
  order: number;
  description: string | null;
  permissions: TestMatrixPermission[];
  children: TestMatrixModule[];
}

export interface TestRoleUser {
  id: string;
  account: string;
  name: string;
  email: string;
  enabled: boolean;
  outOfScope: boolean;
  ownerProtected: boolean;
  orgs: { id: string; name: string }[];
}

/**
 * `roleUserCandidates` 的一筆(加入使用者彈窗的候選)。
 * `eligible` 由 api 算好 —— 所屬組織落在角色擁有組織子樹內才是 true;
 * false 的人**照樣回**,由前端 disabled 並說明原因。
 */
export interface TestCandidate {
  id: string;
  account: string;
  name: string;
  email: string;
  enabled: boolean;
  eligible: boolean;
  orgs: { id: string; name: string }[];
}

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

/** 每個模組固定有一筆 `<key>.*`(ADR-0004;seed 自動產生)。 */
const wildcard = (moduleKey: string): TestMatrixPermission =>
  permission(moduleKey, "*", "全部");

const module_ = (
  key: string,
  name: string,
  parentKey: string | null,
  sidebarType: ModuleSidebarType,
  permissions: TestMatrixPermission[],
  children: TestMatrixModule[] = [],
): TestMatrixModule => ({
  id: `m-${key}`,
  key,
  name,
  parentId: parentKey === null ? null : `m-${parentKey}`,
  sidebarType,
  order: 1,
  description: null,
  permissions: [wildcard(key), ...permissions],
  children,
});

const sampleOne = module_(
  "demo.sub.sample-one",
  "示範模組1",
  "demo.sub",
  ModuleSidebarType.Link,
  [
    permission("demo.sub.sample-one", "view", "檢視"),
    permission("demo.sub.sample-one", "create", "新增"),
    permission("demo.sub.sample-one", "edit", "編輯"),
  ],
);

const sampleTwo = module_(
  "demo.sample-two",
  "示範模組2",
  "demo",
  ModuleSidebarType.Link,
  [permission("demo.sample-two", "view", "檢視")],
);

/**
 * 顯示樹(`roleMatrix.modules`)= 全樹 ∩ 操作者自身的有效權限集(role-manager.md
 * 「矩陣的兩棵樹」)— 測試直接給這棵,前端不必再算防越權。
 */
export const matrixModules: TestMatrixModule[] = [
  module_(
    "demo",
    "示範群組",
    null,
    ModuleSidebarType.Group,
    [],
    [
      module_(
        "demo.sub",
        "示範次群組",
        "demo",
        ModuleSidebarType.Group,
        [],
        [sampleOne],
      ),
      sampleTwo,
    ],
  ),
];

/** 預設授予:進得去示範模組1、只給了「檢視」— 上層兩個群組因此是「勾選且不可取消」。 */
export const grantedFixture = {
  moduleKeys: ["demo", "demo.sub", "demo.sub.sample-one"],
  permissionKeys: ["demo.sub.sample-one.view"],
};

/**
 * 夾具的 `kind` / `abilities` 預設值**照 api 的規則表算**(`role-rules.ts`;
 * 視角是「非 root、沒持有這個角色」),個別案例再以 overrides 改 ——
 * 這樣夾具不會跟規則漂走,而要測 root 視角時只要覆寫 `abilities`。
 */
const kindOf = (isSystem: boolean, isTemplateCopy: boolean): RoleKind => {
  if (isSystem) {
    return RoleKind.System;
  }
  return isTemplateCopy ? RoleKind.TemplateCopy : RoleKind.Custom;
};

const abilitiesOf = (kind: RoleKind, userCount: number): TestRoleAbilities => ({
  canEdit: kind !== RoleKind.System,
  canEditMatrix: kind !== RoleKind.System,
  canToggleEnabled: kind === RoleKind.Custom,
  canDelete: kind === RoleKind.Custom && userCount === 0,
});

const role = (
  id: string,
  name: string,
  overrides: Partial<TestRole> = {},
): TestRole => {
  const isSystem = overrides.isSystem ?? false;
  const isTemplateCopy = overrides.isTemplateCopy ?? false;
  const userCount = overrides.userCount ?? 0;
  const kind = kindOf(isSystem, isTemplateCopy);
  return {
    id,
    name,
    description: null,
    enabled: true,
    kind,
    abilities: abilitiesOf(kind, userCount),
    isSystem: false,
    isTemplateCopy: false,
    userCount: 0,
    ownerOrg: {
      id: "org-tenant",
      name: "租戶 A",
      tenantTop: { id: "org-tenant", name: "租戶 A" },
    },
    ...overrides,
  };
};

export const roles: TestRole[] = [
  // 名稱刻意不叫「編輯」:列上的動作按鈕也叫「編輯」,測試才不必在兩者之間繞
  role("role-editor", "內容編輯", {
    description: "內容管理相關權限",
    userCount: 2,
  }),
  role("role-admin", "租戶管理員", {
    description: "租戶內全部模組",
    isTemplateCopy: true,
    userCount: 1,
  }),
  role("role-audit", "審核員", { description: "食譜審核", enabled: false }),
  role("role-system", "超級管理員", { isSystem: true, userCount: 1 }),
];

export const roleUsers: TestRoleUser[] = [
  {
    id: "user-ming",
    account: "ming",
    name: "王小明",
    email: "ming@example.invalid",
    enabled: true,
    outOfScope: false,
    ownerProtected: false,
    orgs: [{ id: "org-content", name: "內容組" }],
  },
  {
    id: "user-owner",
    account: "owner",
    name: "何家華",
    email: "owner@example.invalid",
    enabled: true,
    outOfScope: false,
    ownerProtected: true,
    orgs: [{ id: "org-tenant", name: "租戶 A" }],
  },
  {
    id: "user-far",
    account: "far",
    name: "外組同事",
    email: "far@example.invalid",
    enabled: true,
    outOfScope: true,
    ownerProtected: false,
    orgs: [{ id: "org-other", name: "租戶 B" }],
  },
];

export const candidates: TestCandidate[] = [
  {
    id: "user-new",
    account: "newbie",
    name: "新同事",
    email: "newbie@example.invalid",
    enabled: true,
    orgs: [{ id: "org-content", name: "內容組" }],
    eligible: true,
  },
  {
    id: "user-ming",
    account: "ming",
    name: "王小明",
    email: "ming@example.invalid",
    enabled: true,
    orgs: [{ id: "org-content", name: "內容組" }],
    eligible: true,
  },
  /**
   * 所屬組織不在角色擁有組織的子樹內 —— 這種人**照樣列出來、但勾不動**,
   * 並就地說明原因(在此之前直接不列,找不到人的人只會覺得「這個人不見了」)。
   */
  {
    id: "user-outsider",
    account: "outsider",
    name: "別家同事",
    email: "outsider@example.invalid",
    enabled: true,
    orgs: [{ id: "org-other", name: "租戶 B" }],
    eligible: false,
  },
];

/** 擁有組織下拉的來源(`orgTree`;租戶視角,樹根的 parentId 一律是 null)。 */
export const roleOrgTree: TestOrgNode[] = [
  {
    id: "org-tenant",
    name: "租戶 A",
    parentId: null,
    enabled: true,
    outOfScope: false,
    ownerUserId: "user-owner",
    children: [
      {
        id: "org-content",
        name: "內容組",
        parentId: "org-tenant",
        enabled: true,
        outOfScope: false,
        ownerUserId: null,
        children: [],
      },
    ],
  },
];
