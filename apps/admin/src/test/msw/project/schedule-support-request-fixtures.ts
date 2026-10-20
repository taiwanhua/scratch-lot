import type { FormDefinition } from "@repo/domain/form";
import {
  FormSubmissionStatus,
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
 * (正本 `apps/db-migrator/seeds/project/revisions/support_request.r1.seed.ts`);
 * 三筆提交:審核中(派給登入者小華)、已完成、已退回(Figma SC-31 274:32718)。
 */
export const SUPPORT_REQUEST_FORM_KEY = "support_request";
export const SCHEDULE_MANAGE_MODULE_KEY = "schedule.manage";

const TIME_PATTERN = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

export const supportRequestDefinition = (): FormDefinition => ({
  fields: [
    field("date", "日期", "date", {
      widget: { kind: "datePicker" },
      rules: { required: true },
    }),
    field("position", "崗位", "select", {
      widget: { kind: "dropdown" },
      options: { kind: "fieldCategory", key: "schedule-position" },
      rules: { required: true },
    }),
    field("start_time", "開始", "text", {
      widget: { kind: "textField", placeholder: "HH:mm" },
      rules: {
        required: true,
        pattern: TIME_PATTERN,
        patternMessage: "請輸入 24 小時制的時間,例 17:00",
      },
    }),
    field("end_time", "結束", "text", {
      widget: { kind: "textField", placeholder: "HH:mm" },
      rules: {
        required: true,
        pattern: TIME_PATTERN,
        patternMessage: "請輸入 24 小時制的時間,例 21:00",
        custom: { ">": [{ var: "end_time" }, { var: "start_time" }] },
        customMessage: "結束時間要晚於開始時間",
      },
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
              { fieldKey: "date", span: 6 },
              { fieldKey: "position", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "start_time", span: 6 },
              { fieldKey: "end_time", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "headcount", span: 6 },
              { fieldKey: "branch", span: 6 },
            ],
          },
          { cols: [{ fieldKey: "note", span: 12 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "note", date: "date" },
  prefills: [],
});

/** `moduleForms("schedule.manage")` 的那一張(受管表單關了「允許存草稿」)。 */
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
    date: string;
    position: string;
    start: string;
    end: string;
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
      date: values.date,
      position: values.position,
      start_time: values.start,
      end_time: values.end,
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
    summary: { title: values.note, date: values.date, amount: null },
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
      date: "2026-11-11T16:00:00.000Z",
      position: "in-store-counter",
      start: "17:00",
      end: "21:00",
      headcount: "1",
      note: "颱風後補人,晚間人手不足",
    },
    {
      status: FormSubmissionStatus.Reviewing,
      currentInstanceId: "inst-support-12",
    },
  ),
  supportRequest("sub-support-11", {
    date: "2026-11-07T16:00:00.000Z",
    position: "restock",
    start: "13:00",
    end: "17:00",
    headcount: "1",
    note: "週末到貨補貨",
  }),
  supportRequest(
    "sub-support-09",
    {
      date: "2026-10-29T16:00:00.000Z",
      position: "in-store-counter",
      start: "14:30",
      end: "22:00",
      headcount: "2",
      note: "店員請假",
    },
    { status: FormSubmissionStatus.Returned },
  ),
];

/** 表單執行端的假 api 選項(只有支援需求單)。 */
export const supportRequestFormWorld = (
  overrides: Partial<FormRuntimeWorldOptions> = {},
): FormRuntimeWorldOptions => ({
  moduleForms: [supportRequestForm],
  versions: {
    [`${SUPPORT_REQUEST_FORM_KEY}@1`]: supportRequestDefinition(),
  },
  submissions: supportRequestSubmissions(),
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
