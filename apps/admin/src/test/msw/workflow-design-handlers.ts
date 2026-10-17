import { type GraphQLResponseBody, HttpResponse } from "msw";

import {
  type BindFormWorkflowMutationVariables,
  type CreateWorkflowMutationVariables,
  type CreateWorkflowVersionDraftMutationVariables,
  type DeleteWorkflowVersionDraftMutationVariables,
  type ExportWorkflowSeedQueryVariables,
  type ForkWorkflowMutationVariables,
  type FormFieldsFragment,
  type FormWorkflowOptionsQuery,
  type PublishWorkflowVersionMutationVariables,
  type SaveWorkflowVersionDraftMutationVariables,
  type UnbindFormWorkflowMutationVariables,
  type ValidateWorkflowVersionQueryVariables,
  type WorkflowFieldsFragment,
  type WorkflowValidationFieldsFragment,
  type WorkflowVersionFieldsFragment,
  type WorkflowVersionQueryVariables,
  WorkflowVersionStatus,
  type WorkflowsQueryVariables,
} from "@repo/graphql";

import { type AuthErrorCode, graphqlError } from "./auth-handlers";
import type { FormFailure } from "./form-runtime-handlers";
import { workflowSeedExportHandler } from "./seed-export-handlers";
import { api } from "./server";
import { STAMP, workflowFragment } from "./workflow-fixtures";

export type WorkflowDesignOperation =
  | "SaveWorkflowVersionDraft"
  | "DeleteWorkflowVersionDraft"
  | "ValidateWorkflowVersion"
  | "PublishWorkflowVersion"
  | "CreateWorkflow"
  | "BindFormWorkflow"
  | "ExportWorkflowSeed";

type WorkflowOption =
  FormWorkflowOptionsQuery["formWorkflowOptions"]["items"][number];

export interface WorkflowDesignWorldOptions {
  workflows?: WorkflowFieldsFragment[];
  /** 流程 key → 全部版本(含草稿) */
  versions?: Record<string, WorkflowVersionFieldsFragment[]>;
  /** 表單 key → 流程下拉(`formWorkflowOptions`) */
  bindingOptions?: Record<string, WorkflowOption[]>;
  /** 表單管理的表單(綁定後寫回 `workflowBinding`) */
  forms?: FormFieldsFragment[];
  failures?: Partial<Record<WorkflowDesignOperation, FormFailure>>;
  /** 「檢查」鈕(`validateWorkflowVersion`)回的結果;沒給 = 沒有問題 */
  validation?: WorkflowValidationFieldsFragment;
}

export interface WorkflowDesignWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  inputs: {
    saveDraft: SaveWorkflowVersionDraftMutationVariables["input"][];
    deleteDraft: DeleteWorkflowVersionDraftMutationVariables["input"][];
    validate: ValidateWorkflowVersionQueryVariables["input"][];
    publish: PublishWorkflowVersionMutationVariables["input"][];
    createDraft: CreateWorkflowVersionDraftMutationVariables["input"][];
    createWorkflow: CreateWorkflowMutationVariables["input"][];
    fork: ForkWorkflowMutationVariables["input"][];
    bind: BindFormWorkflowMutationVariables["input"][];
    unbind: UnbindFormWorkflowMutationVariables["input"][];
    exportSeed: ExportWorkflowSeedQueryVariables["input"][];
  };
}

const notFound = () => graphqlError("NOT_FOUND" as AuthErrorCode);

/** 單個流程的 payload(`{ <操作名>: { workflow } }`)。 */
const workflowPayload = (name: string, workflow: WorkflowFieldsFragment) =>
  HttpResponse.json<GraphQLResponseBody<Record<string, never>>>({
    data: { [name]: { workflow } } as Record<string, never>,
  });
const EMPTY_REPORT = { errors: [], warnings: [] };

/**
 * 流程設計端與綁定的假 api(docs/modules/workflows.md「api 介面」)。有狀態:存草稿 `draftRevision + 1`、
 * `expectedDraftRevision` 不符 → `CONFLICT`(`DRAFT_REVISION_MISMATCH`);發布把草稿變成新的已發布版;
 * 綁定 / 解除寫回表單的 `workflowBinding`。檢查器的真正判斷在 api 與 domain 測試,這裡只給畫面要的形狀。
 */
export const workflowDesignWorld = (
  options: WorkflowDesignWorldOptions = {},
): WorkflowDesignWorld => {
  const workflows = structuredClone(options.workflows ?? []);
  const versions = structuredClone(options.versions ?? {});
  const forms = structuredClone(options.forms ?? []);
  const failures = options.failures ?? {};
  const inputs: WorkflowDesignWorld["inputs"] = {
    saveDraft: [],
    deleteDraft: [],
    validate: [],
    publish: [],
    createDraft: [],
    createWorkflow: [],
    fork: [],
    bind: [],
    unbind: [],
    exportSeed: [],
  };
  const fail = (operation: WorkflowDesignOperation) => {
    const failure = failures[operation];
    return failure === undefined
      ? null
      : graphqlError(
          failure.code as AuthErrorCode,
          failure.code,
          failure.extensions ?? {},
        );
  };
  const findWorkflow = (key: string) =>
    workflows.find((workflow) => workflow.key === key);
  const versionsOf = (key: string) => (versions[key] ??= []);
  const draftOf = (key: string) =>
    versionsOf(key).find((item) => item.status === WorkflowVersionStatus.Draft);

  const handlers = [
    api.query("Workflows", ({ variables }) => {
      const { input } = variables as WorkflowsQueryVariables;
      const keyword = input.keyword?.trim() ?? "";
      const items = workflows.filter(
        (item) =>
          keyword === "" ||
          item.name.includes(keyword) ||
          item.key.includes(keyword),
      );
      return HttpResponse.json({
        data: {
          workflows: {
            items,
            totalCount: items.length,
            page: 1,
            pageSize: 100,
          },
        },
      });
    }),
    api.query("Workflow", ({ variables }) => {
      const workflow = findWorkflow((variables as { key: string }).key);
      return workflow === undefined
        ? notFound()
        : HttpResponse.json({ data: { workflow: { workflow } } });
    }),
    api.query("WorkflowVersion", ({ variables }) => {
      const { workflowKey, version } =
        variables as WorkflowVersionQueryVariables;
      const found =
        version === null || version === undefined
          ? draftOf(workflowKey)
          : versionsOf(workflowKey).find((item) => item.version === version);
      return found === undefined
        ? notFound()
        : HttpResponse.json({
            data: {
              workflowVersion: {
                workflowVersion: found,
                validation: EMPTY_REPORT,
              },
            },
          });
    }),
    api.query("WorkflowVersions", ({ variables }) => {
      const items = versionsOf(
        (variables as { workflowKey: string }).workflowKey,
      );
      return HttpResponse.json({
        data: { workflowVersions: { items, totalCount: items.length } },
      });
    }),
    workflowSeedExportHandler({ findWorkflow, versionsOf, fail, inputs }),
    api.query("ValidateWorkflowVersion", ({ variables }) => {
      const { input } = variables as ValidateWorkflowVersionQueryVariables;
      inputs.validate.push(input);
      const failure = fail("ValidateWorkflowVersion");
      if (failure !== null) {
        return failure;
      }
      return HttpResponse.json({
        data: { validateWorkflowVersion: options.validation ?? EMPTY_REPORT },
      });
    }),
    api.mutation("CreateWorkflow", ({ variables }) => {
      const { input } = variables as CreateWorkflowMutationVariables;
      inputs.createWorkflow.push(input);
      const failure = fail("CreateWorkflow");
      if (failure !== null) {
        return failure;
      }
      const workflow = workflowFragment({
        key: input.key,
        name: input.name,
        currentVersion: null,
        hasDraft: false,
      });
      workflows.push(workflow);
      return workflowPayload("createWorkflow", workflow);
    }),
    api.mutation("UpdateWorkflow", ({ variables }) => {
      const { input } = variables as { input: { key: string; name: string } };
      const workflow = findWorkflow(input.key);
      if (workflow === undefined) {
        return notFound();
      }
      workflow.name = input.name;
      return workflowPayload("updateWorkflow", workflow);
    }),
    api.mutation("ForkWorkflow", ({ variables }) => {
      const { input } = variables as ForkWorkflowMutationVariables;
      inputs.fork.push(input);
      const source = findWorkflow(input.sourceKey);
      const base = versionsOf(input.sourceKey).find(
        (item) => item.version === input.sourceVersion,
      );
      if (source === undefined || base === undefined) {
        return notFound();
      }
      const workflow = workflowFragment({
        key: input.key,
        name: input.name,
        isShared: false,
        forkedFrom: {
          workflowKey: input.sourceKey,
          version: input.sourceVersion,
        },
        currentVersion: null,
        hasDraft: true,
      });
      workflows.push(workflow);
      versions[input.key] = [
        {
          ...base,
          id: `wv-${input.key}-draft`,
          workflowKey: input.key,
          version: null,
          status: WorkflowVersionStatus.Draft,
          draftRevision: 1,
          baseVersion: null,
        },
      ];
      return workflowPayload("forkWorkflow", workflow);
    }),
    api.mutation("CreateWorkflowVersionDraft", ({ variables }) => {
      const { input } =
        variables as CreateWorkflowVersionDraftMutationVariables;
      inputs.createDraft.push(input);
      const workflow = findWorkflow(input.workflowKey);
      if (workflow === undefined) {
        return notFound();
      }
      const base = versionsOf(input.workflowKey).find(
        (item) => item.version === input.baseVersion,
      );
      const draft: WorkflowVersionFieldsFragment = {
        id: `wv-${input.workflowKey}-draft`,
        workflowKey: input.workflowKey,
        version: null,
        status: WorkflowVersionStatus.Draft,
        draftRevision: 1,
        baseVersion: input.baseVersion ?? null,
        steps: base?.steps ?? [],
        edges: base?.edges ?? null,
        checkFormKey: base?.checkFormKey ?? null,
        cc: base?.cc ?? null,
        changelog: null,
        publishedAt: null,
        publishedBy: null,
      };
      versionsOf(input.workflowKey).unshift(draft);
      workflow.hasDraft = true;
      return HttpResponse.json({
        data: {
          createWorkflowVersionDraft: {
            workflowVersion: draft,
            validation: EMPTY_REPORT,
          },
        },
      });
    }),
    api.mutation("SaveWorkflowVersionDraft", ({ variables }) => {
      const { input } = variables as SaveWorkflowVersionDraftMutationVariables;
      inputs.saveDraft.push(input);
      const failure = fail("SaveWorkflowVersionDraft");
      if (failure !== null) {
        return failure;
      }
      const draft = draftOf(input.workflowKey);
      if (draft === undefined) {
        return notFound();
      }
      if (draft.draftRevision !== input.expectedDraftRevision) {
        return graphqlError("CONFLICT" as AuthErrorCode, "CONFLICT", {
          reason: "DRAFT_REVISION_MISMATCH",
        });
      }
      Object.assign(draft, {
        steps: input.definition.steps,
        edges: input.definition.edges ?? null,
        // 缺席 = 不動、null = 清掉(同 api)
        ...(input.definition.checkFormKey !== undefined && {
          checkFormKey: input.definition.checkFormKey,
        }),
        ...(input.definition.cc !== undefined && { cc: input.definition.cc }),
        draftRevision: draft.draftRevision + 1,
      });
      return HttpResponse.json({
        data: {
          saveWorkflowVersionDraft: {
            workflowVersion: draft,
            validation: EMPTY_REPORT,
          },
        },
      });
    }),
    api.mutation("DeleteWorkflowVersionDraft", ({ variables }) => {
      const { input } =
        variables as DeleteWorkflowVersionDraftMutationVariables;
      inputs.deleteDraft.push(input);
      const failure = fail("DeleteWorkflowVersionDraft");
      if (failure !== null) {
        return failure;
      }
      const workflow = findWorkflow(input.workflowKey);
      const draft = draftOf(input.workflowKey);
      if (workflow === undefined || draft === undefined) {
        return graphqlError("CONFLICT" as AuthErrorCode, "CONFLICT", {
          reason: "DRAFT_MISSING",
        });
      }
      if (draft.draftRevision !== input.expectedDraftRevision) {
        return graphqlError("CONFLICT" as AuthErrorCode, "CONFLICT", {
          reason: "DRAFT_REVISION_MISMATCH",
        });
      }
      versions[input.workflowKey] = versionsOf(input.workflowKey).filter(
        (item) => item !== draft,
      );
      workflow.hasDraft = false;
      return workflowPayload("deleteWorkflowVersionDraft", workflow);
    }),
    api.mutation("PublishWorkflowVersion", ({ variables }) => {
      const { input } = variables as PublishWorkflowVersionMutationVariables;
      inputs.publish.push(input);
      const failure = fail("PublishWorkflowVersion");
      if (failure !== null) {
        return failure;
      }
      const workflow = findWorkflow(input.workflowKey);
      const draft = draftOf(input.workflowKey);
      if (workflow === undefined || draft === undefined) {
        return notFound();
      }
      const next = (workflow.currentVersion ?? 0) + 1;
      Object.assign(draft, {
        version: next,
        status: WorkflowVersionStatus.Published,
        changelog: input.changelog,
        publishedAt: STAMP,
        publishedBy: { id: "user-1", name: "小華" },
      });
      Object.assign(workflow, { currentVersion: next, hasDraft: false });
      return HttpResponse.json({
        data: { publishWorkflowVersion: { workflowVersion: draft } },
      });
    }),
    api.mutation("RetireCurrentWorkflowVersion", ({ variables }) => {
      const { input } = variables as { input: { workflowKey: string } };
      const workflow = findWorkflow(input.workflowKey);
      if (workflow === undefined) {
        return notFound();
      }
      for (const item of versionsOf(input.workflowKey)) {
        if (item.version === workflow.currentVersion) {
          item.status = WorkflowVersionStatus.Retired;
        }
      }
      workflow.currentVersion = null;
      return workflowPayload("retireCurrentWorkflowVersion", workflow);
    }),
    api.query("FormWorkflowOptions", ({ variables }) => {
      const items =
        options.bindingOptions?.[(variables as { formKey: string }).formKey] ??
        [];
      return HttpResponse.json({
        data: { formWorkflowOptions: { items, totalCount: items.length } },
      });
    }),
    api.mutation("BindFormWorkflow", ({ variables }) => {
      const { input } = variables as BindFormWorkflowMutationVariables;
      inputs.bind.push(input);
      const failure = fail("BindFormWorkflow");
      if (failure !== null) {
        return failure;
      }
      const form = forms.find((item) => item.key === input.formKey);
      if (form === undefined) {
        return notFound();
      }
      form.workflowBinding = {
        workflowKey: input.workflowKey,
        workflowName:
          findWorkflow(input.workflowKey)?.name ?? input.workflowKey,
        isValid: true,
      };
      return HttpResponse.json({ data: { bindFormWorkflow: { form } } });
    }),
    api.mutation("UnbindFormWorkflow", ({ variables }) => {
      const { input } = variables as UnbindFormWorkflowMutationVariables;
      inputs.unbind.push(input);
      const form = forms.find((item) => item.key === input.formKey);
      if (form === undefined) {
        return notFound();
      }
      form.workflowBinding = null;
      return HttpResponse.json({ data: { unbindFormWorkflow: { form } } });
    }),
  ];

  return { handlers, inputs };
};
