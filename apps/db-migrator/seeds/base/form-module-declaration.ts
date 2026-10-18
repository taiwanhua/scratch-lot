import type { ModuleIconKey } from "@repo/domain/module-icon";

import {
  type ModuleSeedDeclaration,
  type PermissionDeclaration,
  WILDCARD_ACTION,
  permissionKey,
} from "./module-declaration";

/**
 * 表單提交狀態的資料範圍選項(值對照 `form_submissions.status`)。
 * 每個表單模組都給完整七種:任何一個表單模組都可能被綁上審核流程。
 */
export const FORM_SUBMISSION_STATUS_OPTIONS = [
  { value: "draft", label: "草稿" },
  { value: "reviewing", label: "審核中" },
  { value: "returned", label: "已退回" },
  { value: "withdrawn", label: "已撤回" },
  { value: "completed", label: "已完成" },
  { value: "rejected", label: "已駁回" },
  { value: "voided", label: "已作廢" },
];

/** 表單模組頁內的額外權限:和固定四條一起掛在模組主節點,key = `<模組>.<action>`。 */
export interface FormModulePermissionSpec {
  /** kebab-case 動作段(例 `sell` → `<模組>.sell`)。 */
  action: string;
  name: string;
  description?: string;
}

/** 表單模組固定的四條個別權限:動作 → 顯示名與說明。 */
const FIXED_PERMISSIONS = [
  { action: "view", name: "檢視", description: "看列表與單筆資料、進入詳情頁" },
  {
    action: "create",
    name: "新增",
    description: "進入新增頁的按鈕 + 新增 API",
  },
  {
    action: "edit",
    name: "編輯",
    description: "進入編輯頁的按鈕 + 編輯 API(綁流程的單核准後只能作廢)",
  },
  { action: "delete", name: "刪除", description: "列表的刪除按鈕 + 刪除 API" },
] as const;

const FIXED_ACTIONS: ReadonlySet<string> = new Set(
  FIXED_PERMISSIONS.map((permission) => permission.action),
);

/**
 * 表單動態權限的動作前綴(執行期由表單發布建立:`show-` / `edit-<formKey>-<fieldKey>`、
 * `create-<formKey>`;解析正本 `apps/api/src/forms/form-permission-keys.ts`):宣告的頁內權限不得占用。
 */
const DYNAMIC_ACTION_PREFIXES = ["show-", "edit-", "create-"] as const;

function assertDeclarableAction(moduleKey: string, action: string): void {
  if (
    action === WILDCARD_ACTION ||
    FIXED_ACTIONS.has(action) ||
    DYNAMIC_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix))
  ) {
    throw new Error(
      `表單模組 ${moduleKey} 的頁內權限動作 "${action}" 與固定權限、wildcard 或表單動態權限的形狀衝突`,
    );
  }
}

export interface FormModuleSpec {
  key: string;
  name: string;
  /** 掛在哪個節點底下;null = 頂層。父節點由別的宣告檔宣告(可以在底座;組裝時依整棵樹排序)。 */
  parentKey: string | null;
  /** 本層的路由段(完整路徑由祖先的 route 串起來)。 */
  route: string;
  order: number;
  icon: ModuleIconKey;
  description: string;
  /** `modules.settings` 的初始值(如列表欄位配置 `list`);不給 = `{}`。建立後由 root 在畫面上改。 */
  settings?: Record<string, unknown>;
  /** 頁內額外權限(選填);和固定四條 `view` / `create` / `edit` / `delete` 一起產生。 */
  permissions?: readonly FormModulePermissionSpec[];
  /**
   * 依表單分開新增權限(選填,預設關):true 時每張表單發布時自動建 `<模組>.create-<formKey>`
   * (名稱「<表單名> 新增」),新增資格看它而不看模組 `create`。只能在這裡宣告;底座示範表單模組不開。
   */
  perFormCreate?: boolean;
}

/**
 * 表單模組(`engine: "form"`)的 seed 骨架:主節點 + 三個 `-page` 隱藏頁 + 四筆個別權限
 * (+ 宣告的頁內權限 `spec.permissions`)+ `form_submissions` 的資料範圍目標。
 *
 * 骨架照固定欄位模組的宣告方式;差別只在 `engine: "form"`:頁面由表單引擎組裝、資料存所有表單模組
 * 共用的 `form_submissions`,資料範圍目標的 `moduleKey` 由 seed runner 填本模組 key
 * (同一張表可以有多個表單模組各一個目標)。表單、流程與綁定都是執行期資料,不在 seed:
 * 由根組織與租戶在畫面上建。
 */
export function formModuleDeclaration(
  spec: FormModuleSpec,
): ModuleSeedDeclaration {
  const { key, name } = spec;
  const extraPermissions = (spec.permissions ?? []).map(
    (permission): PermissionDeclaration => {
      assertDeclarableAction(key, permission.action);
      return {
        key: permissionKey(key, permission.action),
        moduleKey: key,
        name: permission.name,
        ...(permission.description === undefined
          ? {}
          : { description: permission.description }),
      };
    },
  );
  return {
    nodes: [
      {
        key,
        name,
        sidebarType: "link",
        parentKey: spec.parentKey,
        order: spec.order,
        route: spec.route,
        icon: spec.icon,
        engine: "form",
        ...(spec.perFormCreate === true ? { perFormCreate: true } : {}),
        description: spec.description,
        ...(spec.settings === undefined ? {} : { settings: spec.settings }),
      },
      {
        key: `${key}.view-page`,
        name: "詳情",
        sidebarType: "hidden",
        parentKey: key,
        order: 1,
        route: "view-page",
      },
      {
        key: `${key}.create-page`,
        name: "新增",
        sidebarType: "hidden",
        parentKey: key,
        order: 2,
        route: "create-page",
      },
      {
        key: `${key}.edit-page`,
        name: "編輯",
        sidebarType: "hidden",
        parentKey: key,
        order: 3,
        route: "edit-page",
      },
    ],
    permissions: [
      ...FIXED_PERMISSIONS.map((permission): PermissionDeclaration => ({
        key: permissionKey(key, permission.action),
        moduleKey: key,
        name: permission.name,
        description: permission.description,
      })),
      ...extraPermissions,
    ],
    // collection 固定 form_submissions;moduleKey 由 runner 填本模組 key。
    // 欄位目錄 = 基礎欄位(程式自動附加)+ 提交狀態;表單自訂欄位進條件不在此範圍
    dataScopeTarget: {
      collection: "form_submissions",
      name,
      description: `${name}的表單提交(form_submissions 裡 moduleKey = ${key} 的資料)`,
      fields: [
        {
          name: "status",
          label: "狀態",
          type: "enum",
          options: FORM_SUBMISSION_STATUS_OPTIONS,
        },
      ],
    },
  };
}
