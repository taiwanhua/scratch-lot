import type { FormDefinition } from "@repo/domain/form";
import {
  CHECKOUT_CONFIRM_FORM_KEY,
  STORE_KEY,
} from "@repo/domain/project/lottery";
import {
  FormSubmissionStatus,
  WorkflowStepStatus,
  WorkflowTaskStatus,
} from "@repo/graphql";

import {
  type MockSubmission,
  field,
  submissionFragment,
} from "../../form-fixtures";
import type { FormRuntimeWorldOptions } from "../../form-runtime-handlers";
import {
  MANAGER,
  instanceFragment,
  instanceStep,
  planItem,
  taskFragment,
} from "../../workflow-fixtures";
import type { WorkflowRuntimeWorldOptions } from "../../workflow-runtime-handlers";
import {
  CHECKOUT_REVIEWING_ID,
  sampleCheckoutDetail,
} from "./checkout-fixtures";
import {
  DAILY_CLOSE_REVIEWING_ID,
  sampleDailyCloseDetail,
} from "./daily-close-fixtures";

// ---- 表單執行端 / 審核流程(結帳確認申請,受管表單 `checkout_confirm.r1.seed.ts` 同形) ----

const staticOptions = (items: [string, string][]) => ({
  kind: "static" as const,
  items: items.map(([value, label], index) => ({
    value,
    label,
    order: index + 1,
    enabled: true,
  })),
});

export const checkoutConfirmDefinition = (): FormDefinition => ({
  fields: [
    field("branch", "分店", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("type", "類型", "select", {
      widget: { kind: "dropdown" },
      options: staticOptions([
        ["shift", "交班"],
        ["daily", "日結"],
      ]),
      rules: { required: true },
    }),
    field("cash_point", "收銀點", "text"),
    field("successor", "接班人", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "user", labelField: "name" },
    }),
    field("expected", "應有", "number"),
    field("counted", "實點", "number"),
    field("difference", "差額", "number"),
    field("left_for_next", "留給下一班", "number"),
    field("note", "說明", "text"),
    field("draft", "結帳內容(系統)", "multiline", {
      widget: { kind: "textArea", hideWhenReadonly: true },
      rules: { required: true },
    }),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "結帳確認申請",
        rows: [
          {
            cols: [
              { fieldKey: "branch", span: 4 },
              { fieldKey: "type", span: 4 },
              { fieldKey: "cash_point", span: 4 },
            ],
          },
          {
            cols: [
              { fieldKey: "expected", span: 3 },
              { fieldKey: "counted", span: 3 },
              { fieldKey: "difference", span: 3 },
              { fieldKey: "left_for_next", span: 3 },
            ],
          },
          {
            cols: [
              { fieldKey: "successor", span: 6 },
              { fieldKey: "note", span: 6 },
            ],
          },
          { cols: [{ fieldKey: "draft", span: 12 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "cash_point", date: null },
  prefills: [],
});

export const checkoutConfirmForm = {
  key: CHECKOUT_CONFIRM_FORM_KEY,
  name: "結帳確認申請",
  moduleKey: STORE_KEY,
  currentVersion: 1,
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  canCreate: true,
};

/** 李小華(C-0042 的申請人、交班人)。 */
const LI = { id: "user-li", name: "李小華" };

const checkoutSubmission = (): MockSubmission =>
  submissionFragment({
    id: CHECKOUT_REVIEWING_ID,
    moduleKey: STORE_KEY,
    formKey: CHECKOUT_CONFIRM_FORM_KEY,
    formName: "結帳確認申請",
    status: FormSubmissionStatus.Reviewing,
    currentInstanceId: `inst-${CHECKOUT_REVIEWING_ID}`,
    serialNo: "C-0042",
    values: {
      branch: { id: "org-store-a", label: "中山店" },
      type: { value: "shift", label: "交班" },
      cash_point: "店內櫃台",
      successor: null,
      expected: 6500,
      counted: 6400,
      difference: -100,
      left_for_next: 0,
      note: null,
      draft: sampleCheckoutDetail().draft,
    },
    summary: { title: "店內櫃台", date: null, amount: null },
    createdBy: LI,
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

/** C-0043(日結,李小華送出,店長審核中;Figma ST-28b)。 */
const dailyCloseSubmission = (): MockSubmission =>
  submissionFragment({
    id: DAILY_CLOSE_REVIEWING_ID,
    moduleKey: STORE_KEY,
    formKey: CHECKOUT_CONFIRM_FORM_KEY,
    formName: "結帳確認申請",
    status: FormSubmissionStatus.Reviewing,
    currentInstanceId: `inst-${DAILY_CLOSE_REVIEWING_ID}`,
    serialNo: "C-0043",
    values: {
      branch: { id: "org-store-a", label: "中山店" },
      type: { value: "daily", label: "日結" },
      cash_point: null,
      successor: null,
      expected: 25_000,
      counted: 25_000,
      difference: 0,
      left_for_next: 0,
      note: null,
      draft: sampleDailyCloseDetail().draft,
    },
    summary: { title: "中山店", date: null, amount: null },
    createdBy: LI,
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

/** 表單執行端的假 api 選項(只有結帳確認申請)。 */
export const checkoutFormWorld = (): FormRuntimeWorldOptions => ({
  moduleForms: [checkoutConfirmForm],
  versions: {
    [`${CHECKOUT_CONFIRM_FORM_KEY}@1`]: checkoutConfirmDefinition(),
  },
  submissions: [checkoutSubmission(), dailyCloseSubmission()],
});

/** 審核中那一筆的流程實例(接班人那一關跳過、店長審核中)與登入者(店長)的待審任務。 */
const reviewingRuntime = (id: string, title: string) => {
  const common = {
    moduleKey: STORE_KEY,
    moduleName: "店面管理",
    formKey: CHECKOUT_CONFIRM_FORM_KEY,
    formName: "結帳確認申請",
    summary: { title, date: null, amount: null },
  };
  return {
    instance: instanceFragment({
      ...common,
      id: `inst-${id}`,
      submissionId: id,
      workflowKey: "demo_lottery_checkout_confirm",
      workflowName: "結帳確認申請審核",
      activeStepKeys: ["store_manager"],
      steps: [
        instanceStep("successor", "接班人確認", {
          status: WorkflowStepStatus.Skipped,
        }),
        instanceStep("store_manager", "店長審核", {
          status: WorkflowStepStatus.Active,
          plan: [
            planItem("store_manager-1", MANAGER, { taskId: `task-${id}` }),
          ],
        }),
      ],
    }),
    task: taskFragment({
      ...common,
      id: `task-${id}`,
      instanceId: `inst-${id}`,
      submissionId: id,
      stepKey: "store_manager",
      stepName: "店長審核",
      taskKey: "store_manager-1",
      status: WorkflowTaskStatus.Pending,
      applicant: LI,
    }),
  };
};

/** C-0042(交班)與 C-0043(日結)的流程實例與登入者(店長)的待審任務。 */
export const checkoutWorkflowWorld = (): Required<
  Pick<WorkflowRuntimeWorldOptions, "instances" | "tasks">
> => {
  const shift = reviewingRuntime(CHECKOUT_REVIEWING_ID, "店內櫃台");
  const daily = reviewingRuntime(DAILY_CLOSE_REVIEWING_ID, "中山店");
  return {
    instances: [shift.instance, daily.instance],
    tasks: [shift.task, daily.task],
  };
};
