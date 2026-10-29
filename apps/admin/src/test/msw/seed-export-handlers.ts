/* eslint-disable unicorn/prefer-structured-clone -- 這裡要的是「換成本 realm 的純 JSON 值」不是深拷貝(理由見 `fileOf`),structuredClone 正是問題的來源;到期條件:world 的狀態不再用 structuredClone 複製時移除 */
import { HttpResponse } from "msw";

import type { FormDefinition } from "@repo/domain/form";
import {
  type DefinitionSeedSet,
  definitionSeedFileName,
  serializeSeedSet,
} from "@repo/domain/seed";
import type { WorkflowDefinition } from "@repo/domain/workflow";
import {
  type ExportFormSeedQueryVariables,
  type ExportWorkflowSeedQueryVariables,
  type FormFieldsFragment,
  type FormVersionFieldsFragment,
  FormVersionStatus,
  type WorkflowFieldsFragment,
  type WorkflowVersionFieldsFragment,
  WorkflowVersionStatus,
} from "@repo/graphql";

import { graphqlError } from "./auth-handlers";
import { api } from "./server";

/**
 * 「匯出專案設定」的假 api(docs/modules/forms.md、docs/modules/workflows.md「匯出專案設定」):
 * 表單與流程設計端的 world 各掛一支,狀態(表單 / 流程與版本)由 world 傳進來。
 * 指名的版本不存在 → `NOT_FOUND`、不是已發布 → `VALIDATION_FAILED`(`fields: ["version"]`);
 * 檔名與內容用與 api 同一份共用契約(`@repo/domain/seed`)產生,不另寫一份格式。
 * 權限、根組織與可攜性的真正判斷在 api 測試;要驗那些分支時由 world 的 `failures` 指定回應。
 */

type Failure = ReturnType<typeof graphqlError> | null;

const notPublished = () =>
  graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", {
    fields: ["version"],
  });

/**
 * world 的狀態是 `structuredClone` 出來的:在 jest 的 jsdom 環境裡它的物件原型屬於另一個 realm,
 * 共用契約的純資料檢查不認。先經 JSON 來回換成本 realm 的純 JSON 值(api 回的本來就是 JSON)。
 */
const fileOf = (seed: DefinitionSeedSet) => {
  const plain = JSON.parse(JSON.stringify(seed)) as DefinitionSeedSet;
  return {
    fileName: definitionSeedFileName(plain),
    source: serializeSeedSet(plain),
  };
};

export interface FormSeedExportState {
  findForm: (formKey: string) => FormFieldsFragment | undefined;
  versionsOf: (formKey: string) => FormVersionFieldsFragment[];
  /** world 指定的失敗回應(沒有就回 null) */
  fail: (operation: "ExportFormSeed") => Failure;
  /** world 的 `inputs`:記下送來的 input(測試斷言用) */
  inputs: { exportFormSeed: ExportFormSeedQueryVariables["input"][] };
}

export const formSeedExportHandler = (state: FormSeedExportState) =>
  api.query("ExportFormSeed", ({ variables }) => {
    const { input } = variables as ExportFormSeedQueryVariables;
    state.inputs.exportFormSeed.push(input);
    const failure = state.fail("ExportFormSeed");
    if (failure !== null) {
      return failure;
    }
    const form = state.findForm(input.formKey);
    const version = state
      .versionsOf(input.formKey)
      .find((item) => item.version === input.version);
    if (form === undefined || version === undefined) {
      return graphqlError("NOT_FOUND");
    }
    if (version.status !== FormVersionStatus.Published) {
      return notPublished();
    }
    return HttpResponse.json({
      data: {
        exportFormSeed: fileOf({
          kind: "form-definition",
          key: form.key,
          revision: input.revision,
          name: form.name,
          changelog: input.changelog,
          desiredStatus: "published",
          moduleKey: form.moduleKey,
          tabLabelTemplate: form.tabLabelTemplate ?? null,
          // 存的四塊原樣輸出(JSON 純量 → domain 型別,不補預設、不重排)
          definition: {
            fields: version.fields,
            layout: version.layout,
            summaryMap: version.summaryMap,
            prefills: version.prefills,
          } as unknown as FormDefinition,
        }),
      },
    });
  });

export interface WorkflowSeedExportState {
  findWorkflow: (workflowKey: string) => WorkflowFieldsFragment | undefined;
  versionsOf: (workflowKey: string) => WorkflowVersionFieldsFragment[];
  fail: (operation: "ExportWorkflowSeed") => Failure;
  inputs: { exportSeed: ExportWorkflowSeedQueryVariables["input"][] };
}

export const workflowSeedExportHandler = (state: WorkflowSeedExportState) =>
  api.query("ExportWorkflowSeed", ({ variables }) => {
    const { input } = variables as ExportWorkflowSeedQueryVariables;
    state.inputs.exportSeed.push(input);
    const failure = state.fail("ExportWorkflowSeed");
    if (failure !== null) {
      return failure;
    }
    const workflow = state.findWorkflow(input.workflowKey);
    const version = state
      .versionsOf(input.workflowKey)
      .find((item) => item.version === input.version);
    if (workflow === undefined || version === undefined) {
      return graphqlError("NOT_FOUND");
    }
    if (version.status !== WorkflowVersionStatus.Published) {
      return notPublished();
    }
    return HttpResponse.json({
      data: {
        exportWorkflowSeed: fileOf({
          kind: "workflow-definition",
          key: workflow.key,
          revision: input.revision,
          name: workflow.name,
          changelog: input.changelog,
          desiredStatus: "published",
          checkFormKey: version.checkFormKey ?? null,
          definition: {
            steps: version.steps as unknown as WorkflowDefinition["steps"],
            edges: version.edges ?? null,
          },
        }),
      },
    });
  });
