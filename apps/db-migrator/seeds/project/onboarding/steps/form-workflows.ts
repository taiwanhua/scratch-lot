import { GraphqlRequestError } from "../../../../src/demo/graphql-client";
import type { OnboardingContext, OnboardingStep } from "../context";
import { FORM_WORKFLOWS } from "../form-workflows";
import { type FormWorkflowSpec, workflowKeyOf } from "../form-workflows/types";

const FORM = /* GraphQL */ `
  query OnboardingForm($key: ID!) {
    form(key: $key) {
      form {
        key
        currentVersion
        workflowBinding {
          workflowKey
          workflowName
          isValid
        }
      }
    }
  }
`;

const WORKFLOW = /* GraphQL */ `
  query OnboardingWorkflow($key: ID!) {
    workflow(key: $key) {
      workflow {
        key
        currentVersion
        hasDraft
      }
    }
  }
`;

const DRAFT = /* GraphQL */ `
  query OnboardingWorkflowDraft($workflowKey: ID!) {
    workflowVersion(workflowKey: $workflowKey) {
      workflowVersion {
        draftRevision
      }
    }
  }
`;

const CREATE_WORKFLOW = /* GraphQL */ `
  mutation OnboardingCreateWorkflow($input: CreateWorkflowInput!) {
    createWorkflow(input: $input) {
      workflow {
        key
      }
    }
  }
`;

const CREATE_DRAFT = /* GraphQL */ `
  mutation OnboardingCreateWorkflowDraft(
    $input: CreateWorkflowVersionDraftInput!
  ) {
    createWorkflowVersionDraft(input: $input) {
      workflowVersion {
        draftRevision
      }
    }
  }
`;

const SAVE_DRAFT = /* GraphQL */ `
  mutation OnboardingSaveWorkflowDraft($input: SaveWorkflowVersionDraftInput!) {
    saveWorkflowVersionDraft(input: $input) {
      workflowVersion {
        draftRevision
      }
      validation {
        errors {
          code
          message
        }
      }
    }
  }
`;

const PUBLISH = /* GraphQL */ `
  mutation OnboardingPublishWorkflow($input: PublishWorkflowVersionInput!) {
    publishWorkflowVersion(input: $input) {
      workflowVersion {
        version
      }
    }
  }
`;

const BIND = /* GraphQL */ `
  mutation OnboardingBindFormWorkflow($input: BindFormWorkflowInput!) {
    bindFormWorkflow(input: $input) {
      form {
        key
      }
    }
  }
`;

interface FormRow {
  key: string;
  currentVersion: number | null;
  workflowBinding: {
    workflowKey: string;
    workflowName: string | null;
    isValid: boolean;
  } | null;
}

interface WorkflowRow {
  key: string;
  currentVersion: number | null;
  hasDraft: boolean;
}

const isNotFound = (error: unknown): boolean =>
  error instanceof GraphqlRequestError && error.code === "NOT_FOUND";

/** 讀得到就回,`NOT_FOUND` 回 null,其他錯誤照丟。 */
async function findOrNull<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/** 流程的草稿修訂號:沒有草稿就開一份(以目前版本為基底)。 */
async function draftRevisionOf(
  { client }: OnboardingContext,
  workflow: WorkflowRow,
): Promise<number> {
  if (workflow.hasDraft) {
    const { workflowVersion } = await client.request<{
      workflowVersion: { workflowVersion: { draftRevision: number } };
    }>(DRAFT, { workflowKey: workflow.key });
    return workflowVersion.workflowVersion.draftRevision;
  }
  const { createWorkflowVersionDraft } = await client.request<{
    createWorkflowVersionDraft: { workflowVersion: { draftRevision: number } };
  }>(CREATE_DRAFT, { input: { workflowKey: workflow.key } });
  return createWorkflowVersionDraft.workflowVersion.draftRevision;
}

/** 建立(或接續)流程並發布第一版;已有發布版就沿用、不改內容。 */
async function ensurePublishedWorkflow(
  context: OnboardingContext,
  spec: FormWorkflowSpec,
  key: string,
): Promise<string> {
  const { client } = context;
  let workflow = await findOrNull(async () => {
    const { workflow: payload } = await client.request<{
      workflow: { workflow: WorkflowRow };
    }>(WORKFLOW, { key });
    return payload.workflow;
  });
  if (workflow?.currentVersion != null) {
    return `流程「${spec.workflowName}」已存在,沿用`;
  }
  if (workflow === null) {
    await client.request(CREATE_WORKFLOW, {
      input: { key, name: spec.workflowName },
    });
    workflow = { key, currentVersion: null, hasDraft: false };
  }
  const draftRevision = await draftRevisionOf(context, workflow);
  const { saveWorkflowVersionDraft } = await client.request<{
    saveWorkflowVersionDraft: {
      workflowVersion: { draftRevision: number };
      validation: { errors: { code: string; message: string }[] } | null;
    };
  }>(SAVE_DRAFT, {
    input: {
      workflowKey: key,
      expectedDraftRevision: draftRevision,
      definition: {
        steps: spec.steps(context),
        edges: null,
        checkFormKey: spec.formKey,
      },
    },
  });
  const errors = saveWorkflowVersionDraft.validation?.errors ?? [];
  if (errors.length > 0) {
    throw new Error(
      `流程「${spec.workflowName}」的定義有錯:${errors
        .map((error) => `${error.code} ${error.message}`)
        .join("; ")}`,
    );
  }
  await client.request(PUBLISH, {
    input: {
      workflowKey: key,
      expectedDraftRevision:
        saveWorkflowVersionDraft.workflowVersion.draftRevision,
      changelog: "開通時建立",
    },
  });
  return `建立並發布流程「${spec.workflowName}」`;
}

/**
 * 一張表單的流程:表單沒分派給這個租戶 → 略過(分派要平台管理員站在根組織做);
 * 表單已綁了流程 → 沿用(租戶自己換過的不改回去);否則建客製流程、發布、綁定。
 */
export async function ensureFormWorkflow(
  context: OnboardingContext,
  spec: FormWorkflowSpec,
): Promise<string[]> {
  const { client, tenantSlug } = context;
  const form = await findOrNull(async () => {
    const { form: payload } = await client.request<{
      form: { form: FormRow };
    }>(FORM, { key: spec.formKey });
    return payload.form;
  });
  if (form?.currentVersion == null) {
    return [
      `略過「${spec.formName}」:表單還沒分派給這個租戶(平台管理員在表單管理分派後重跑)`,
    ];
  }
  if (form.workflowBinding !== null) {
    const name =
      form.workflowBinding.workflowName ?? form.workflowBinding.workflowKey;
    return [`「${spec.formName}」已綁定流程「${name}」,沿用`];
  }
  const key = workflowKeyOf(tenantSlug, spec.formKey);
  const workflowLine = await ensurePublishedWorkflow(context, spec, key);
  await client.request(BIND, {
    input: { formKey: spec.formKey, workflowKey: key },
  });
  return [workflowLine, `「${spec.formName}」綁定流程「${spec.workflowName}」`];
}

/**
 * 開通清單第 7 點:依開通時建立的角色建立客製流程並綁定表單(規格 2.1;共用流程不能用角色條件)。
 * 每張表單的流程在 `../form-workflows/`;要排在「角色」之後(審核者用角色 id)。
 */
export const formWorkflowsStep: OnboardingStep = {
  key: "form-workflows",
  title: "流程",
  run: async (context) => {
    const lines: string[] = [];
    for (const spec of FORM_WORKFLOWS) {
      lines.push(...(await ensureFormWorkflow(context, spec)));
    }
    return lines;
  },
};
