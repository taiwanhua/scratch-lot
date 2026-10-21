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
import {
  ATTENDANCE_MODULE_KEY,
  ATTENDANCE_ORG,
  MAKEUP_PUNCH_FORM_KEY,
} from "./schedule-attendance-fixtures";

/**
 * 出勤紀錄 → 補打卡申請(規格 14.8)的夾具:定義與受管表單同形
 * (正本 `apps/db-migrator/seeds/project/revisions/makeup_punch.r2.seed.ts`);兩筆審核中
 * (一筆對應的排班還在、一筆已被刪除),各有派給登入者(小華,店長)的待審任務。
 */

const TIME_PATTERN = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

export const makeupPunchDefinition = (): FormDefinition => ({
  fields: [
    field("date", "日期", "date", {
      widget: { kind: "datePicker" },
      rules: { required: true },
    }),
    field("branch", "分店", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("entry_label", "對應排班", "text", { rules: { required: true } }),
    field("entry", "對應排班(系統代碼)", "text", {
      widget: { kind: "textField", hideWhenReadonly: true },
      rules: { required: true },
    }),
    field("punch_type", "類型", "select", {
      widget: { kind: "radio" },
      options: {
        kind: "static",
        items: [
          { value: "in", label: "上班", order: 1, enabled: true },
          { value: "out", label: "下班", order: 2, enabled: true },
        ],
      },
      rules: { required: true },
    }),
    field("time", "時間", "text", {
      rules: { required: true, pattern: TIME_PATTERN, patternMessage: "HH:mm" },
    }),
    field("reason", "原因", "select", {
      widget: { kind: "dropdown" },
      options: { kind: "fieldCategory", key: "schedule-makeup-punch-reason" },
      rules: { required: true },
    }),
    field("note", "說明", "text"),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "補打卡申請",
        rows: [
          {
            cols: [
              { fieldKey: "date", span: 6 },
              { fieldKey: "branch", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "entry_label", span: 6 },
              { fieldKey: "entry", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "punch_type", span: 6 },
              { fieldKey: "time", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "reason", span: 6 },
              { fieldKey: "note", span: 6 },
            ],
          },
        ],
      },
    ],
  },
  summaryMap: { title: "entry_label", date: "date" },
  prefills: [],
});

export const makeupPunchForm = {
  key: MAKEUP_PUNCH_FORM_KEY,
  name: "補打卡申請",
  moduleKey: ATTENDANCE_MODULE_KEY,
  currentVersion: 1,
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  canCreate: true,
};

/** 補打卡申請審核中、排班還在的那一筆;排班已被刪除的那一筆(審核頁警告、不能核准)。 */
export const MAKEUP_REVIEWING_ID = "sub-makeup-31";
export const MAKEUP_ENTRY_DELETED_ID = "sub-makeup-32";

const makeup = (
  id: string,
  serialNo: string,
  values: { date: string; entry: string; entryLabel: string; time: string },
): MockSubmission =>
  submissionFragment({
    id,
    moduleKey: ATTENDANCE_MODULE_KEY,
    formKey: MAKEUP_PUNCH_FORM_KEY,
    formName: "補打卡申請",
    status: FormSubmissionStatus.Reviewing,
    currentInstanceId: `inst-${id}`,
    serialNo,
    values: {
      date: values.date,
      branch: { id: ATTENDANCE_ORG.id, label: ATTENDANCE_ORG.name },
      entry: values.entry,
      entry_label: values.entryLabel,
      punch_type: "out",
      time: values.time,
      reason: { value: "forgot-punch", label: "忘記打卡" },
      note: null,
    },
    displayValues: [
      {
        fieldKey: "branch",
        items: [
          {
            value: ATTENDANCE_ORG.id,
            label: ATTENDANCE_ORG.name,
            available: true,
          },
        ],
      },
    ],
    summary: { title: values.entryLabel, date: values.date, amount: null },
    createdBy: APPLICANT,
    abilities: {
      canEdit: false,
      canSaveDraft: false,
      canDelete: false,
      canEditField: [],
      canWithdraw: false,
      canVoid: false,
      canCopy: false,
    },
  });

export const makeupPunchSubmissions = (): MockSubmission[] => [
  makeup(MAKEUP_REVIEWING_ID, "M-0031", {
    date: "2026-11-01T16:00:00.000Z",
    entry: "e-wang-2026-11-02",
    entryLabel: "早 08:30–14:30",
    time: "14:35",
  }),
  makeup(MAKEUP_ENTRY_DELETED_ID, "M-0032", {
    date: "2026-11-03T16:00:00.000Z",
    entry: "e-wang-deleted",
    entryLabel: "早 08:30–14:30",
    time: "14:31",
  }),
];

export const MAKEUP_REASON_OPTIONS = [
  { value: "forgot-punch", label: "忘記打卡", enabled: true },
  { value: "device-failure", label: "裝置故障", enabled: true },
  { value: "other", label: "其他", enabled: true },
];

/** 表單執行端的假 api 選項(只有補打卡申請)。 */
export const makeupPunchFormWorld = (
  overrides: Partial<FormRuntimeWorldOptions> = {},
): FormRuntimeWorldOptions => ({
  moduleForms: [makeupPunchForm],
  versions: { [`${MAKEUP_PUNCH_FORM_KEY}@1`]: makeupPunchDefinition() },
  submissions: makeupPunchSubmissions(),
  ...overrides,
});

const makeupInstance = (id: string, title: string, date: string) => ({
  instance: instanceFragment({
    id: `inst-${id}`,
    submissionId: id,
    moduleKey: ATTENDANCE_MODULE_KEY,
    moduleName: "出勤紀錄",
    formKey: MAKEUP_PUNCH_FORM_KEY,
    formName: "補打卡申請",
    workflowKey: "demo_lottery_makeup_punch",
    workflowName: "補打卡申請審核",
    summary: { title, date, amount: null },
    activeStepKeys: ["store_manager"],
    steps: [
      instanceStep("store_manager", "店長審核", {
        status: WorkflowStepStatus.Active,
        plan: [planItem("store_manager-1", MANAGER, { taskId: `task-${id}` })],
      }),
    ],
  }),
  task: taskFragment({
    id: `task-${id}`,
    instanceId: `inst-${id}`,
    submissionId: id,
    moduleKey: ATTENDANCE_MODULE_KEY,
    moduleName: "出勤紀錄",
    formKey: MAKEUP_PUNCH_FORM_KEY,
    formName: "補打卡申請",
    stepKey: "store_manager",
    stepName: "店長審核",
    taskKey: "store_manager-1",
    status: WorkflowTaskStatus.Pending,
    summary: { title, date, amount: null },
  }),
});

/** 兩筆審核中的流程實例與登入者(小華,店長)的待審任務。 */
export const makeupPunchWorkflowWorld = (): Required<
  Pick<WorkflowRuntimeWorldOptions, "instances" | "tasks">
> => {
  const items = [
    makeupInstance(
      MAKEUP_REVIEWING_ID,
      "早 08:30–14:30",
      "2026-11-01T16:00:00.000Z",
    ),
    makeupInstance(
      MAKEUP_ENTRY_DELETED_ID,
      "早 08:30–14:30",
      "2026-11-03T16:00:00.000Z",
    ),
  ];
  return {
    instances: items.map((item) => item.instance),
    tasks: items.map((item) => item.task),
  };
};
