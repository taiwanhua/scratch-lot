import type { FormDefinition } from "@repo/domain/form";
import {
  FormSubmissionStatus,
  ModuleEngine,
  type ModuleListColumn,
  ModuleListColumnKind,
  ModuleSidebarType,
} from "@repo/graphql";

import type { TestModule } from "../../auth-handlers";
import {
  type MockSubmission,
  field,
  submissionFragment,
} from "../../form-fixtures";
import type { FormRuntimeWorldOptions } from "../../form-runtime-handlers";
import { masterDataOrgs } from "./master-data-fixtures";

/**
 * 叫貨與進貨 → 叫貨、採購單(規格 8.1;Figma PU-01–PU-03)的夾具。模組與 seed
 * `apps/db-migrator/seeds/project/purchasing.ts` 同形;表單定義與受管表單同形
 * (`seeds/project/revisions/requisition.r3.seed.ts`)。分店沿用檔案管理夾具的中山店 / 新竹店。
 */
export const REQUISITION_MODULE_KEY = "purchasing.requisition";
export const REQUISITION_FORM_KEY = "requisition";

export const REQUISITION_ALL_PERMISSIONS = [
  "purchasing.requisition.view",
  "purchasing.requisition.create",
  "purchasing.requisition.edit",
  "purchasing.requisition.delete",
  "purchasing.requisition.purchase-list",
] as const;

const node = (
  key: string,
  name: string,
  parentKey: string | null,
  order: number,
  route: string,
  overrides: Partial<TestModule> = {},
): TestModule => ({
  id: `m-${key}`,
  key,
  name,
  parentId: parentKey === null ? null : `m-${parentKey}`,
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order,
  route,
  icon: null,
  permissions: [],
  ...overrides,
});

/** 叫貨與進貨的模組;`omit` 列的權限 key 拿掉(測試「沒有某權限時看不到」)。 */
export const purchasingModules = (
  omit: readonly string[] = [],
): TestModule[] => [
  node("purchasing", "叫貨與進貨", null, 30, "/purchasing", {
    sidebarType: ModuleSidebarType.Group,
    icon: "receipt",
  }),
  node(
    REQUISITION_MODULE_KEY,
    "叫貨、採購單",
    "purchasing",
    1,
    "/purchasing/requisition",
    {
      engine: ModuleEngine.Form,
      icon: "receipt",
      permissions: REQUISITION_ALL_PERMISSIONS.filter(
        (key) => !omit.includes(key),
      ),
    },
  ),
  ...(
    [
      ["view-page", "詳情"],
      ["create-page", "新增"],
      ["edit-page", "編輯"],
    ] as const
  ).map(([page, name], index) =>
    node(
      `${REQUISITION_MODULE_KEY}.${page}`,
      name,
      REQUISITION_MODULE_KEY,
      index + 1,
      `/purchasing/requisition/${page}`,
      { sidebarType: ModuleSidebarType.Hidden },
    ),
  ),
];

export const requisitionDefinition = (): FormDefinition => ({
  fields: [
    field("branch", "叫貨分店", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "org", labelField: "name" },
      default: { kind: "expression", expr: { var: "ctx.user.orgId" } },
      rules: { required: true },
    }),
    field("expected_date", "期望到貨日", "date", {
      widget: { kind: "datePicker" },
    }),
    field("lines", "明細", "array", {
      widget: { kind: "table" },
      columns: [
        {
          key: "game",
          label: "遊戲",
          type: "reference",
          widget: { kind: "referencePicker" },
          valueSource: { kind: "input" },
          source: {
            provider: "lottery_game",
            labelField: "name",
            filter: { status: "on_sale" },
          },
          rules: { required: true },
          width: 220,
        },
        {
          key: "books",
          label: "本數",
          type: "number",
          precision: 0,
          widget: { kind: "number" },
          valueSource: { kind: "input" },
          rules: { required: true, min: 1, max: 999 },
          width: 100,
        },
      ],
      rules: { required: true, maxRows: 200 },
    }),
    field("total_books", "本數", "number", {
      precision: 0,
      widget: { kind: "number" },
      valueSource: { kind: "computed", expr: { sumOf: ["lines", "books"] } },
    }),
    field("note", "備註", "text", { rules: { maxLength: 200 } }),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "叫貨單",
        rows: [
          {
            cols: [
              { fieldKey: "branch", span: 6 },
              { fieldKey: "expected_date", span: 6 },
            ],
          },
          { cols: [{ fieldKey: "lines", span: 12 }] },
          { cols: [{ fieldKey: "total_books", span: 6 }] },
          { cols: [{ fieldKey: "note", span: 12 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "note", date: "expected_date" },
  prefills: [],
});

/** `moduleForms("purchasing.requisition")` 的那一張(允許存草稿;單號格式 R-0001)。 */
export const requisitionForm = {
  key: REQUISITION_FORM_KEY,
  name: "叫貨單",
  moduleKey: REQUISITION_MODULE_KEY,
  currentVersion: 1,
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: true,
  canCreate: true,
};

const LOCKED = {
  canEdit: false,
  canSaveDraft: false,
  canDelete: false,
  canEditField: [],
  canWithdraw: false,
  canVoid: false,
  canCopy: false,
};

const CREATORS = {
  wang: { id: "user-wang", name: "王小明" },
  chen: { id: "user-chen", name: "陳美玲" },
  lin: { id: "user-lin", name: "林美麗" },
};

const requisition = (
  id: string,
  serialNo: string,
  branch: { id: string; name: string },
  expectedDate: string | null,
  books: number,
  overrides: Partial<MockSubmission> = {},
): MockSubmission =>
  submissionFragment({
    id,
    serialNo,
    moduleKey: REQUISITION_MODULE_KEY,
    formKey: REQUISITION_FORM_KEY,
    formName: "叫貨單",
    status: FormSubmissionStatus.Completed,
    values: {
      branch: branch.id,
      expected_date: expectedDate,
      lines: [
        {
          rowId: `00000000-0000-4000-8000-${id.slice(-12).padStart(12, "0")}`,
          game: { id: "game-5164", label: "發大財" },
          books: String(books),
        },
      ],
      total_books: String(books),
      note: null,
    },
    displayValues: [
      {
        fieldKey: "branch",
        items: [{ value: branch.id, label: branch.name, available: true }],
      },
    ],
    summary: { title: null, date: expectedDate, amount: null },
    createdBy: CREATORS.wang,
    abilities: LOCKED,
    ...overrides,
  });

/** Figma PU-01 的五筆:草稿、審核中、待購買、已進貨、已調貨。 */
export const requisitionSubmissions = (): MockSubmission[] => [
  requisition(
    "sub-req-0024",
    "R-0024",
    masterDataOrgs.storeA,
    "2026-10-19T16:00:00.000Z",
    5,
    {
      status: FormSubmissionStatus.Draft,
      abilities: { ...LOCKED, canEdit: true, canDelete: true },
    },
  ),
  requisition(
    "sub-req-0023",
    "R-0023",
    masterDataOrgs.storeA,
    "2026-10-17T16:00:00.000Z",
    6,
    { status: FormSubmissionStatus.Reviewing },
  ),
  requisition("sub-req-0022", "R-0022", masterDataOrgs.storeB, null, 3, {
    createdBy: CREATORS.chen,
  }),
  requisition(
    "sub-req-0021",
    "R-0021",
    masterDataOrgs.storeA,
    "2026-10-15T16:00:00.000Z",
    5,
  ),
  requisition("sub-req-0020", "R-0020", masterDataOrgs.storeB, null, 2, {
    createdBy: CREATORS.lin,
  }),
];

/** 已完成那幾筆的衍生狀態(`lotteryRequisitionStates`)。 */
export const REQUISITION_STATES: Readonly<Record<string, string>> = {
  "sub-req-0022": "pending",
  "sub-req-0021": "purchased",
  "sub-req-0020": "transferred",
};

/** 列表欄位配置(與 seed 初值同):單號、叫貨分店、期望到貨日、本數 + 狀態、建立者。 */
export const requisitionListColumns = (): ModuleListColumn[] => [
  {
    kind: ModuleListColumnKind.Slot,
    key: "serialNo",
    formKey: null,
    width: 110,
    order: 0,
  },
  ...(
    [
      ["branch", 140],
      ["expected_date", 130],
      ["total_books", 90],
    ] as const
  ).map(([key, width], order) => ({
    kind: ModuleListColumnKind.Field,
    key,
    formKey: REQUISITION_FORM_KEY,
    width,
    order: order + 1,
  })),
];

export const REQUISITION_LIST_BUILTIN = {
  form: false,
  status: true,
  createdBy: true,
};

/** 表單執行端的假 api 選項(只有叫貨單)。 */
export const requisitionFormWorld = (
  overrides: Partial<FormRuntimeWorldOptions> = {},
): FormRuntimeWorldOptions => ({
  moduleForms: [requisitionForm],
  versions: { [`${REQUISITION_FORM_KEY}@1`]: requisitionDefinition() },
  submissions: requisitionSubmissions(),
  listColumns: { [REQUISITION_MODULE_KEY]: requisitionListColumns() },
  listBuiltin: { [REQUISITION_MODULE_KEY]: REQUISITION_LIST_BUILTIN },
  ...overrides,
});
