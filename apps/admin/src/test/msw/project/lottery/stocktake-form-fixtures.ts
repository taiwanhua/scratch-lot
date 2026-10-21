import type { FormDefinition } from "@repo/domain/form";
import {
  STOCKTAKE_CONFIRM_FORM_KEY,
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
  APPLICANT,
  MANAGER,
  instanceFragment,
  instanceStep,
  planItem,
  taskFragment,
} from "../../workflow-fixtures";
import type { WorkflowRuntimeWorldOptions } from "../../workflow-runtime-handlers";
import {
  STOCKTAKE_REVIEWING_ID,
  sampleStocktakeDetail,
} from "./stocktake-fixtures";

// ---- 表單執行端 / 審核流程(盤點確認申請,受管表單 `stocktake_confirm.r1.seed.ts` 同形) ----

export const stocktakeConfirmDefinition = (): FormDefinition => ({
  fields: [
    field("branch", "分店", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("scope_label", "盤點範圍", "text"),
    field("totals", "彙總", "multiline", { widget: { kind: "textArea" } }),
    field("note", "說明", "text"),
    field("draft", "盤點內容(系統)", "multiline", {
      widget: { kind: "textArea", hideWhenReadonly: true },
      rules: { required: true },
    }),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "盤點確認申請",
        rows: [
          {
            cols: [
              { fieldKey: "branch", span: 6 },
              { fieldKey: "scope_label", span: 6 },
            ],
          },
          { cols: [{ fieldKey: "totals", span: 12 }] },
          { cols: [{ fieldKey: "note", span: 12 }] },
          { cols: [{ fieldKey: "draft", span: 12 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "scope_label", date: null },
  prefills: [],
});

export const stocktakeConfirmForm = {
  key: STOCKTAKE_CONFIRM_FORM_KEY,
  name: "盤點確認申請",
  moduleKey: STORE_KEY,
  currentVersion: 1,
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  canCreate: true,
};

const stocktakeSubmission = (): MockSubmission =>
  submissionFragment({
    id: STOCKTAKE_REVIEWING_ID,
    moduleKey: STORE_KEY,
    formKey: STOCKTAKE_CONFIRM_FORM_KEY,
    formName: "盤點確認申請",
    status: FormSubmissionStatus.Reviewing,
    currentInstanceId: `inst-${STOCKTAKE_REVIEWING_ID}`,
    serialNo: "S-0032",
    values: {
      branch: { id: "org-store-a", label: "中山店" },
      scope_label: "全店",
      totals:
        "補登售出 2 張 · 300 元;新增待查 101 張;標記異常 1 張;確認遺失 1 張",
      note: null,
      draft: sampleStocktakeDetail().draft,
    },
    summary: { title: "全店", date: null, amount: null },
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

/** 表單執行端的假 api 選項(只有盤點確認申請)。 */
export const stocktakeFormWorld = (): FormRuntimeWorldOptions => ({
  moduleForms: [stocktakeConfirmForm],
  versions: {
    [`${STOCKTAKE_CONFIRM_FORM_KEY}@1`]: stocktakeConfirmDefinition(),
  },
  submissions: [stocktakeSubmission()],
});

/** 審核中那一筆的流程實例與登入者(店長)的待審任務。 */
export const stocktakeWorkflowWorld = (): Required<
  Pick<WorkflowRuntimeWorldOptions, "instances" | "tasks">
> => {
  const id = STOCKTAKE_REVIEWING_ID;
  const common = {
    moduleKey: STORE_KEY,
    moduleName: "店面管理",
    formKey: STOCKTAKE_CONFIRM_FORM_KEY,
    formName: "盤點確認申請",
    summary: { title: "全店", date: null, amount: null },
  };
  return {
    instances: [
      instanceFragment({
        ...common,
        id: `inst-${id}`,
        submissionId: id,
        workflowKey: "demo_lottery_stocktake_confirm",
        workflowName: "盤點確認申請審核",
        activeStepKeys: ["store_manager"],
        steps: [
          instanceStep("store_manager", "店長審核", {
            status: WorkflowStepStatus.Active,
            plan: [
              planItem("store_manager-1", MANAGER, { taskId: `task-${id}` }),
            ],
          }),
        ],
      }),
    ],
    tasks: [
      taskFragment({
        ...common,
        id: `task-${id}`,
        instanceId: `inst-${id}`,
        submissionId: id,
        stepKey: "store_manager",
        stepName: "店長審核",
        taskKey: "store_manager-1",
        status: WorkflowTaskStatus.Pending,
      }),
    ],
  };
};
