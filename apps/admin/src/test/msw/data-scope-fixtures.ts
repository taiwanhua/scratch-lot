import {
  DataScopeCombineOp,
  DataScopeFieldType,
  RoleKind,
} from "@repo/graphql";

import type {
  TestDataScopeRule,
  TestDataScopeTarget,
  TestRole,
} from "./data-scope-handlers";

/**
 * 資料範圍頁的夾具(一份形狀,測試檔只寫行為)。
 *
 * **與 api 對齊的地方**:欄位目錄 = seed 宣告的業務欄位在前、底座自動掛入的六個基礎欄位殿後,
 * 型別與順序照 `apps/api/src/data-scope/data-scope.test.ts`「底座的六個基礎欄位」那條斷言。
 * **一列 = 一個模組**:目標以 `(collection, moduleKey)` 為識別鍵,後兩個目標是兩個表單模組
 * 共用同一張 `form_submissions`(兩個示範表單:驗同一張表兩列、各自的規則);
 * 它們只為了驗左清單的切換與「已設規則」標籤。
 */
const baseFields: TestDataScopeTarget["fields"] = [
  {
    name: "orgId",
    label: "組織",
    type: DataScopeFieldType.Org,
    isBase: true,
    options: [],
  },
  {
    name: "createdBy",
    label: "建立者",
    type: DataScopeFieldType.User,
    isBase: true,
    options: [],
  },
  {
    name: "updatedBy",
    label: "更新者",
    type: DataScopeFieldType.User,
    isBase: true,
    options: [],
  },
  {
    name: "createdAt",
    label: "建立時間",
    type: DataScopeFieldType.Date,
    isBase: true,
    options: [],
  },
  {
    name: "updatedAt",
    label: "更新時間",
    type: DataScopeFieldType.Date,
    isBase: true,
    options: [],
  },
  {
    name: "deletedAt",
    label: "刪除時間",
    type: DataScopeFieldType.Date,
    isBase: true,
    options: [],
  },
];

export const dataScopeTargets: TestDataScopeTarget[] = [
  {
    id: "target-sample-one",
    collection: "demo_items_one",
    moduleKey: "demo.sub.sample-one",
    moduleName: "示範模組1",
    name: "示範項目",
    description: "示範模組1 的資料",
    // `hasRule` 由 handler 依目前存著的規則算(#246 的 1),夾具給預設值即可
    hasRule: false,
    fields: [
      {
        name: "status",
        label: "狀態",
        type: DataScopeFieldType.Enum,
        isBase: false,
        options: [
          { value: "draft", label: "草稿" },
          { value: "published", label: "已發布" },
        ],
      },
      ...baseFields,
    ],
  },
  {
    id: "target-demo-form",
    collection: "form_submissions",
    moduleKey: "demo-form",
    moduleName: "示範表單(頂層)",
    name: "示範表單(頂層)",
    description: "示範表單(頂層)的表單提交",
    hasRule: false,
    fields: baseFields,
  },
  {
    id: "target-demo-group-form",
    collection: "form_submissions",
    moduleKey: "demo.form",
    moduleName: "示範表單(群組內)",
    name: "示範表單(群組內)",
    description: "示範表單(群組內)的表單提交",
    hasRule: false,
    fields: baseFields,
  },
];

/** 自建角色的四個動作(#261;非 root 視角、沒人持有 → 全開)。 */
const CUSTOM_ABILITIES = {
  canEdit: true,
  canEditMatrix: true,
  canToggleEnabled: true,
  canDelete: true,
};

/** 預設角色(租戶副本):改得動、矩陣編得動,但停用只有 root、一律不可刪。 */
const TEMPLATE_COPY_ABILITIES = {
  canEdit: true,
  canEditMatrix: true,
  canToggleEnabled: false,
  canDelete: false,
};

const tenantA = {
  id: "org-tenant-a",
  name: "租戶 A",
  tenantTop: { id: "org-tenant-a", name: "租戶 A" },
};
const tenantB = {
  id: "org-tenant-b",
  name: "租戶 B",
  tenantTop: { id: "org-tenant-b", name: "租戶 B" },
};
/** 租戶 A 底下的一個部門 —— 租戶頂層與擁有組織不同的那一種(#372)。 */
const salesOfA = {
  id: "org-sales-a",
  name: "租戶 A 業務部",
  tenantTop: { id: "org-tenant-a", name: "租戶 A" },
};

/**
 * 套用對象「指定角色」的清單(`roles` query;擁有組織在管理範圍內)。
 *
 * 刻意放兩個同名的「租戶管理員」分屬兩個租戶 —— 這正是 #261 的 8 要解決的情形:
 * 根組織視角下只看角色名稱完全分不出來,要靠「名稱 — 擁有組織」與分組。
 *
 * **順序刻意是亂的、而且擁有組織不等於租戶頂層**(#372):`api` 回的順序裡同一個擁有組織
 * 的角色被別的組織隔開,選單若不先排序,MUI 的 `groupBy` 會讓同一個標題出現兩次。
 */
export const dataScopeRoles: TestRole[] = [
  {
    id: "role-support",
    name: "客服",
    description: null,
    enabled: true,
    kind: RoleKind.Custom,
    abilities: CUSTOM_ABILITIES,
    isSystem: false,
    isTemplateCopy: false,
    userCount: 2,
    ownerOrg: tenantA,
  },
  {
    id: "role-admin-b",
    name: "租戶管理員",
    description: null,
    enabled: true,
    kind: RoleKind.TemplateCopy,
    abilities: TEMPLATE_COPY_ABILITIES,
    isSystem: false,
    isTemplateCopy: true,
    userCount: 1,
    ownerOrg: tenantB,
  },
  {
    id: "role-auditor",
    name: "稽核",
    description: null,
    enabled: true,
    kind: RoleKind.Custom,
    abilities: CUSTOM_ABILITIES,
    isSystem: false,
    isTemplateCopy: false,
    userCount: 0,
    ownerOrg: salesOfA,
  },
  {
    id: "role-editor",
    name: "編輯",
    description: null,
    enabled: true,
    kind: RoleKind.Custom,
    abilities: CUSTOM_ABILITIES,
    isSystem: false,
    isTemplateCopy: false,
    userCount: 1,
    ownerOrg: tenantA,
  },
  {
    id: "role-admin-a",
    name: "租戶管理員",
    description: null,
    enabled: true,
    kind: RoleKind.TemplateCopy,
    abilities: TEMPLATE_COPY_ABILITIES,
    isSystem: false,
    isTemplateCopy: true,
    userCount: 1,
    ownerOrg: tenantA,
  },
];

/**
 * 已存在的一份規則(正本 `docs/modules/data-scope.md` 的 JSON 示例的同一個形狀):
 * 客服只看自己建立的,且(組織不是台北分店 或 建立時間在 2026 年間)。
 */
export const savedRule: TestDataScopeRule = {
  targetId: "target-sample-one",
  collection: "demo_items_one",
  moduleKey: "demo.sub.sample-one",
  combineOp: DataScopeCombineOp.Or,
  updatedAt: "2026-09-20T02:00:00.000Z",
  rules: [
    {
      audience: {
        mode: "match",
        filter: {
          field: "role",
          cond: "in",
          value: { kind: "static", values: ["role-support"] },
        },
      },
      filter: {
        op: "AND",
        children: [
          {
            field: "createdBy",
            cond: "in",
            value: { kind: "dynamic", ref: "current-user" },
          },
          {
            op: "OR",
            children: [
              {
                field: "orgId",
                cond: "not-in",
                value: { kind: "static", values: ["org-store"] },
              },
              {
                field: "createdAt",
                cond: "between",
                // 台北 2026-01-01 與 2026-12-31 的 00:00(api 只收時點)
                value: {
                  kind: "static",
                  values: [
                    "2025-12-31T16:00:00.000Z",
                    "2026-12-30T16:00:00.000Z",
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  ],
};
