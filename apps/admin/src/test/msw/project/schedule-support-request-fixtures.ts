import type { FormDefinition } from "@repo/domain/form";
import {
  FormSubmissionStatus,
  type ModuleListColumn,
  ModuleListColumnKind,
  WorkflowStepStatus,
  WorkflowTaskStatus,
} from "@repo/graphql";

import {
  type MockSubmission,
  field,
  submissionFragment,
} from "../form-fixtures";
import type { FormRuntimeWorldOptions } from "../form-runtime-handlers";
import {
  APPLICANT,
  MANAGER,
  instanceFragment,
  instanceStep,
  planItem,
  taskFragment,
} from "../workflow-fixtures";
import type { WorkflowRuntimeWorldOptions } from "../workflow-runtime-handlers";

/**
 * 排班作業 → 支援需求單(規格 14.10)的夾具。定義與受管表單同形
 * (正本 `apps/db-migrator/seeds/project/revisions/support_request.r4.seed.ts`);
 * 三筆提交:審核中(派給登入者小華)、已完成、已退回(Figma SC-31 274:32718)。
 */
export const SUPPORT_REQUEST_FORM_KEY = "support_request";
export const SCHEDULE_MANAGE_MODULE_KEY = "schedule.manage";

export const supportRequestDefinition = (): FormDefinition => ({
  fields: [
    field("start_at", "開始", "datetime", {
      widget: { kind: "dateTimePicker" },
      rules: { required: true },
    }),
    field("end_at", "結束", "datetime", {
      widget: { kind: "dateTimePicker" },
      rules: {
        required: true,
        custom: {
          and: [
            { ">": [{ var: "end_at" }, { var: "start_at" }] },
            {
              "==": [{ dateDiff: [{ var: "start_at" }, { var: "end_at" }] }, 0],
            },
          ],
        },
        customMessage:
          "結束要晚於開始,而且在同一天(不能跨午夜,跨過午夜請拆成兩張)",
      },
    }),
    field("position", "崗位", "select", {
      widget: { kind: "dropdown" },
      options: { kind: "fieldCategory", key: "schedule-position" },
      rules: { required: true },
    }),
    field("headcount", "需要人數", "number", {
      precision: 0,
      widget: { kind: "number" },
      rules: { required: true, min: 1, max: 99 },
    }),
    field("branch", "分店", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "org", labelField: "name" },
      default: { kind: "expression", expr: { var: "ctx.user.orgId" } },
      rules: { required: true },
    }),
    field("note", "說明", "text", { rules: { maxLength: 200 } }),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "支援需求",
        rows: [
          {
            cols: [
              { fieldKey: "start_at", span: 6 },
              { fieldKey: "end_at", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "position", span: 6 },
              { fieldKey: "headcount", span: 6 },
            ],
          },
          { cols: [{ fieldKey: "branch", span: 6 }] },
          { cols: [{ fieldKey: "note", span: 12 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "note", date: "start_at" },
  prefills: [],
});

/** `moduleForms("schedule.manage")` 的那一張(受管表單關了「允許存草稿」;單號格式 SP-0001)。 */
export const supportRequestForm = {
  key: SUPPORT_REQUEST_FORM_KEY,
  name: "支援需求單",
  moduleKey: SCHEDULE_MANAGE_MODULE_KEY,
  currentVersion: 1,
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  canCreate: true,
};

const POSITION_OPTIONS = [
  { value: "in-store-counter", label: "店內櫃台", enabled: true },
  { value: "outdoor-stall", label: "店外攤位", enabled: true },
  { value: "restock", label: "補貨", enabled: true },
];

const LOCKED = {
  canEdit: false,
  canSaveDraft: false,
  canDelete: false,
  canEditField: [],
  canWithdraw: false,
  canVoid: false,
  canCopy: false,
};

const supportRequest = (
  id: string,
  values: {
    /** 開始 / 結束(ISO 時點) */
    start: string;
    end: string;
    position: string;
    headcount: string;
    note: string;
  },
  overrides: Partial<MockSubmission> = {},
): MockSubmission => {
  const position = POSITION_OPTIONS.find(
    (option) => option.value === values.position,
  );
  return submissionFragment({
    id,
    moduleKey: SCHEDULE_MANAGE_MODULE_KEY,
    formKey: SUPPORT_REQUEST_FORM_KEY,
    formName: "支援需求單",
    status: FormSubmissionStatus.Completed,
    values: {
      start_at: values.start,
      end_at: values.end,
      position: values.position,
      headcount: values.headcount,
      branch: "org-store",
      note: values.note,
    },
    displayValues: [
      {
        fieldKey: "position",
        items: [
          {
            value: values.position,
            label: position?.label ?? values.position,
            available: true,
          },
        ],
      },
      {
        fieldKey: "branch",
        items: [{ value: "org-store", label: "台北分店", available: true }],
      },
    ],
    summary: { title: values.note, date: values.start, amount: null },
    createdBy: APPLICANT,
    abilities: LOCKED,
    ...overrides,
  });
};

/** 三筆支援需求單:審核中(派給登入者小華)、已完成、已退回。 */
export const supportRequestSubmissions = (): MockSubmission[] => [
  supportRequest(
    "sub-support-12",
    {
      // 台北 11/12 17:00–21:00
      start: "2026-11-12T09:00:00.000Z",
      end: "2026-11-12T13:00:00.000Z",
      position: "in-store-counter",
      headcount: "1",
      note: "颱風後補人,晚間人手不足",
    },
    {
      status: FormSubmissionStatus.Reviewing,
      currentInstanceId: "inst-support-12",
      serialNo: "SP-0012",
    },
  ),
  supportRequest(
    "sub-support-11",
    {
      // 台北 11/8 13:00–17:00
      start: "2026-11-08T05:00:00.000Z",
      end: "2026-11-08T09:00:00.000Z",
      position: "restock",
      headcount: "1",
      note: "週末到貨補貨",
    },
    { serialNo: "SP-0011" },
  ),
  supportRequest(
    "sub-support-09",
    {
      // 台北 10/30 14:30–22:00
      start: "2026-10-30T06:30:00.000Z",
      end: "2026-10-30T14:00:00.000Z",
      position: "in-store-counter",
      headcount: "2",
      note: "店員請假",
    },
    { status: FormSubmissionStatus.Returned, serialNo: "SP-0009" },
  ),
];

/**
 * `schedule.manage` 的列表欄位配置(與 seed 初值 `apps/db-migrator/seeds/project/settings.ts` 同):
 * 單號、開始、結束、崗位、需要人數、分店 + 內建欄「狀態」。
 */
export const supportRequestListColumns = (): ModuleListColumn[] => [
  {
    kind: ModuleListColumnKind.Slot,
    key: "serialNo",
    formKey: null,
    width: 100,
    order: 0,
  },
  ...(
    [
      ["start_at", 150],
      ["end_at", 150],
      ["position", 140],
      ["headcount", 100],
      ["branch", 140],
    ] as const
  ).map(([key, width], order) => ({
    kind: ModuleListColumnKind.Field,
    key,
    formKey: SUPPORT_REQUEST_FORM_KEY,
    width,
    order: order + 1,
  })),
];

export const SUPPORT_REQUEST_LIST_BUILTIN = {
  form: false,
  status: true,
  createdBy: false,
};

/** 表單執行端的假 api 選項(只有支援需求單)。 */
export const supportRequestFormWorld = (
  overrides: Partial<FormRuntimeWorldOptions> = {},
): FormRuntimeWorldOptions => ({
  moduleForms: [supportRequestForm],
  versions: {
    [`${SUPPORT_REQUEST_FORM_KEY}@1`]: supportRequestDefinition(),
  },
  submissions: supportRequestSubmissions(),
  listColumns: { [SCHEDULE_MANAGE_MODULE_KEY]: supportRequestListColumns() },
  listBuiltin: { [SCHEDULE_MANAGE_MODULE_KEY]: SUPPORT_REQUEST_LIST_BUILTIN },
  fieldOptions: {
    position: POSITION_OPTIONS.map((option, index) => ({
      ...option,
      order: index + 1,
    })),
  },
  ...overrides,
});

/** 審核中那一筆的流程實例與登入者(小華)的待審任務。 */
export const supportRequestWorkflowWorld = (): Required<
  Pick<WorkflowRuntimeWorldOptions, "instances" | "tasks">
> => ({
  instances: [
    instanceFragment({
      id: "inst-support-12",
      submissionId: "sub-support-12",
      moduleKey: SCHEDULE_MANAGE_MODULE_KEY,
      moduleName: "排班作業",
      formKey: SUPPORT_REQUEST_FORM_KEY,
      formName: "支援需求單",
      workflowKey: "demo_lottery_support_request",
      workflowName: "支援需求單審核",
      summary: {
        title: "颱風後補人,晚間人手不足",
        date: "2026-11-11T16:00:00.000Z",
        amount: null,
      },
      activeStepKeys: ["hq"],
      steps: [
        instanceStep("hq", "總部審核", {
          status: WorkflowStepStatus.Active,
          plan: [planItem("hq-1", MANAGER, { taskId: "task-support-12" })],
        }),
      ],
    }),
  ],
  tasks: [
    taskFragment({
      id: "task-support-12",
      instanceId: "inst-support-12",
      submissionId: "sub-support-12",
      moduleKey: SCHEDULE_MANAGE_MODULE_KEY,
      moduleName: "排班作業",
      formKey: SUPPORT_REQUEST_FORM_KEY,
      formName: "支援需求單",
      stepKey: "hq",
      stepName: "總部審核",
      taskKey: "hq-1",
      status: WorkflowTaskStatus.Pending,
      summary: {
        title: "颱風後補人,晚間人手不足",
        date: "2026-11-11T16:00:00.000Z",
        amount: null,
      },
    }),
  ],
});
