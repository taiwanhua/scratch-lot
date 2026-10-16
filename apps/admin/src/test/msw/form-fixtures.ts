import type { FieldDef, FormDefinition } from "@repo/domain/form";
import {
  type FormFieldsFragment,
  type FormSubmissionFieldsFragment,
  type FormSubmissionRevisionsQuery,
  FormSubmissionStatus,
  type FormVersionFieldsFragment,
  FormVersionStatus,
  ModuleEngine,
  ModuleSidebarType,
} from "@repo/graphql";

import { rawOf } from "@/lib/base/form-engine/definition";

import type { TestModule } from "./auth-handlers";

/**
 * 表單引擎的測試夾具(形狀以 api 的回傳為準:`apps/api/src/forms/**\/*.test.ts` 的斷言、
 * `packages/graphql/src/documents/forms.graphql` / `form-submissions.graphql` 的 fragment;TEST-08 / TEST-12)。
 *
 * 範例表單「購物單」(`shopping_list`,掛在 `demo-form` 模組):品項(必填)、數量、單價、
 * 總價(計算:數量 × 單價)、備註(數量 > 0 才顯示)、採購人(帶入目標)、內部備註(限定可改,帶入目標)。
 */
export const DEMO_FORM_KEY = "demo-form";
export const SHOPPING_FORM_KEY = "shopping_list";

export const DEMO_FORM_ROUTES = {
  list: "/demo-form",
  viewPage: "/demo-form/view-page",
  createPage: "/demo-form/create-page",
  editPage: "/demo-form/edit-page",
} as const;

export const FORMS_ROUTE = "/system/forms";

/** `icon` 照 seed 的宣告(隱藏頁沒有圖示 = null)。 */
const moduleOf = (
  id: string,
  key: string,
  name: string,
  parentId: string | null,
  sidebarType: ModuleSidebarType,
  route: string,
  permissions: readonly string[],
  icon: string | null = null,
): TestModule => ({
  id,
  key,
  name,
  parentId,
  sidebarType,
  engine: key === DEMO_FORM_KEY ? ModuleEngine.Form : ModuleEngine.Fixed,
  order: 3,
  route,
  icon,
  permissions: [...permissions],
});

/** `me.modules`:示範表單(頂層)+ 三個隱藏頁(seed `demo-form.ts` 的形狀);權限全掛在列表那一層。 */
export const demoFormModules = (
  permissions: readonly string[],
): TestModule[] => [
  moduleOf(
    "m-demo-form",
    DEMO_FORM_KEY,
    "示範表單(頂層)",
    null,
    ModuleSidebarType.Link,
    DEMO_FORM_ROUTES.list,
    permissions,
    "description",
  ),
  moduleOf(
    "m-demo-form-view",
    `${DEMO_FORM_KEY}.view-page`,
    "詳情",
    "m-demo-form",
    ModuleSidebarType.Hidden,
    DEMO_FORM_ROUTES.viewPage,
    [],
  ),
  moduleOf(
    "m-demo-form-create",
    `${DEMO_FORM_KEY}.create-page`,
    "新增",
    "m-demo-form",
    ModuleSidebarType.Hidden,
    DEMO_FORM_ROUTES.createPage,
    [],
  ),
  moduleOf(
    "m-demo-form-edit",
    `${DEMO_FORM_KEY}.edit-page`,
    "編輯",
    "m-demo-form",
    ModuleSidebarType.Hidden,
    DEMO_FORM_ROUTES.editPage,
    [],
  ),
];

/** `me.modules`:系統管理 → 表單管理。 */
export const formsModules = (permissions: readonly string[]): TestModule[] => [
  moduleOf(
    "m-system",
    "system",
    "系統管理",
    null,
    ModuleSidebarType.Group,
    "/system",
    [],
    "settings",
  ),
  moduleOf(
    "m-forms",
    "system.forms",
    "表單管理",
    "m-system",
    ModuleSidebarType.Link,
    FORMS_ROUTE,
    permissions,
    "list",
  ),
];

/** 一個欄位定義(測試用預設:文字框、使用者填、非必填、不受保護)。 */
export const field = (
  key: string,
  label: string,
  type: FieldDef["type"],
  overrides: Partial<FieldDef> = {},
): FieldDef => ({
  key,
  label,
  type,
  widget: { kind: "textField" },
  valueSource: { kind: "input" },
  options: null,
  rules: { required: false },
  permission: { show: false, edit: false },
  help: null,
  ...overrides,
});

export const shoppingDefinition = (): FormDefinition => ({
  fields: [
    field("item", "品項", "text", { rules: { required: true } }),
    field("qty", "數量", "number", {
      precision: 0,
      widget: { kind: "number" },
    }),
    field("unit_price", "單價", "number", {
      precision: 0,
      widget: { kind: "number", unit: "元" },
    }),
    field("total", "總價", "number", {
      precision: 0,
      widget: { kind: "number", unit: "元" },
      valueSource: {
        kind: "computed",
        expr: { "*": [{ var: "qty" }, { var: "unit_price" }] },
      },
    }),
    field("note", "備註", "multiline", {
      widget: { kind: "textArea" },
      visibleWhen: { ">": [{ var: "qty" }, 0] },
    }),
    field("buyer", "採購人", "text"),
    field("internal_note", "內部備註", "text", {
      permission: { show: false, edit: true },
    }),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "採購內容",
        rows: [
          {
            cols: [
              { fieldKey: "item", span: 6 },
              { fieldKey: "qty", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "unit_price", span: 6 },
              { fieldKey: "total", span: 6 },
            ],
          },
          { cols: [{ fieldKey: "note", span: 12 }] },
          {
            cols: [
              { fieldKey: "buyer", span: 6 },
              { fieldKey: "internal_note", span: 6 },
            ],
          },
        ],
      },
    ],
  },
  summaryMap: { title: "item", date: null, amount: "total" },
  prefills: [
    {
      label: "從使用者帶入",
      source: { provider: "user", labelField: "name" },
      mapping: [
        { sourceField: "name", fieldKey: "buyer" },
        { sourceField: "email", fieldKey: "internal_note" },
      ],
    },
  ],
});

const STAMP = "2026-09-20T08:00:00.000Z";

export const versionFragment = (
  definition: FormDefinition,
  overrides: Partial<FormVersionFieldsFragment> = {},
): FormVersionFieldsFragment => ({
  id: `ver-${SHOPPING_FORM_KEY}-${String(overrides.version ?? "draft")}`,
  formKey: SHOPPING_FORM_KEY,
  version: null,
  status: FormVersionStatus.Draft,
  draftRevision: 1,
  baseVersion: null,
  ...rawOf(definition),
  changelog: null,
  publishedAt: null,
  publishedBy: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});

export const formFragment = (
  overrides: Partial<FormFieldsFragment> = {},
): FormFieldsFragment => ({
  id: `form-${overrides.key ?? SHOPPING_FORM_KEY}`,
  key: SHOPPING_FORM_KEY,
  moduleKey: DEMO_FORM_KEY,
  moduleName: "示範表單(頂層)",
  name: "購物單",
  isShared: true,
  ownerOrgId: null,
  ownerOrgName: null,
  forkedFrom: null,
  currentVersion: 1,
  tabLabelTemplate: null,
  allowDraft: true,
  hasDraft: true,
  tenantEnabled: null,
  assignments: [],
  abilities: {
    canEdit: true,
    canAssign: true,
    canSetEnabled: false,
    canFork: true,
  },
  // api 在 root 視角與沒綁時回 null(docs/modules/workflows.md「流程綁定」)
  workflowBinding: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});

type RevisionMeta = NonNullable<
  FormSubmissionRevisionsQuery["formSubmission"]["submission"]["revisions"]
>[number];

/**
 * 修訂紀錄的一筆(`FormSubmissionRevisions` 回的形狀);`version` 沒給 = 提交的版本、`kind` 沒給 = null。
 */
export type MockRevisionMeta = Omit<
  RevisionMeta,
  "version" | "kind" | "upgradedBy" | "upgradedAt"
> &
  Partial<Pick<RevisionMeta, "version" | "kind" | "upgradedBy" | "upgradedAt">>;

/**
 * 假 api 存的一筆提交:fragment 之外另帶修訂紀錄(api 的 `revisions` 是 field resolver,只有修訂紀錄跳窗才查;
 * 沒給 = 修訂 1..`revision` 都綁提交的版本)。
 */
export interface MockSubmission extends FormSubmissionFieldsFragment {
  revisions?: MockRevisionMeta[];
}

export const submissionFragment = (
  overrides: Partial<MockSubmission> = {},
): MockSubmission => ({
  id: "sub-1",
  moduleKey: DEMO_FORM_KEY,
  formKey: SHOPPING_FORM_KEY,
  formName: "購物單",
  version: 1,
  status: FormSubmissionStatus.Completed,
  revision: 1,
  viewedRevision: 1,
  viewedVersion: 1,
  values: {
    item: "雞蛋",
    qty: "2",
    unit_price: "30",
    total: "60",
    note: "要放山",
    buyer: null,
    internal_note: null,
  },
  fieldStates: [],
  displayValues: [],
  summary: { title: "雞蛋", date: STAMP, amount: "60" },
  ctx: {
    at: STAMP,
    timezone: "Asia/Taipei",
    userId: "user-1",
    orgId: "org-1",
    orgIds: ["org-1"],
  },
  editVersion: 2,
  orgId: "org-1",
  createdBy: { id: "user-1", name: "小華" },
  submittedAt: STAMP,
  createdAt: STAMP,
  updatedAt: STAMP,
  currentInstanceId: null,
  blocked: false,
  voidedAt: null,
  voidReason: null,
  replacedById: null,
  copiedFrom: null,
  touched: [],
  abilities: {
    canEdit: true,
    canSaveDraft: true,
    canDelete: true,
    canEditField: ["item", "qty", "unit_price", "note", "buyer"],
    canWithdraw: false,
    canVoid: false,
    canCopy: false,
  },
  ...overrides,
});
