import { ClientError } from "@repo/graphql";

import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 審核流程(流程管理、綁定、阻擋清單、申請中心、審核動作)會收到的錯誤
 * (正本 docs/modules/workflows.md「錯誤」):通用碼照 GQL-04,「為什麼」在 `extensions.reason`。
 * 前端把幾個要分開講的 reason 升成自己的碼,文案在 `admin.workflows.errors.<code>`;認不出來的一律 `UNEXPECTED`。
 */
export const WORKFLOW_ERROR_CODES = [
  "CONFLICT",
  "DRAFT_REVISION_MISMATCH",
  "DRAFT_MISSING",
  "PUBLISH_IN_PROGRESS",
  "HAS_DECISIONS",
  "ALREADY_DECIDED",
  "ALREADY_IN_STEP",
  "INSTANCE_CHANGED",
  "ALREADY_COPIED",
  "FORBIDDEN",
  "ROOT_ONLY",
  "NOT_WORKFLOW_OWNER",
  "TENANT_ONLY",
  "WORKFLOW_UNPUBLISHED",
  "ASSIGNEE_NOT_ELIGIBLE",
  "NOT_APPLICANT",
  "NOT_FOUND",
  "VALIDATION_FAILED",
] as const;

export type WorkflowErrorCode =
  (typeof WORKFLOW_ERROR_CODES)[number] | "UNEXPECTED";

const REFINED: Partial<
  Record<string, Partial<Record<string, WorkflowErrorCode>>>
> = {
  CONFLICT: {
    DRAFT_REVISION_MISMATCH: "DRAFT_REVISION_MISMATCH",
    DRAFT_MISSING: "DRAFT_MISSING",
    PUBLISH_IN_PROGRESS: "PUBLISH_IN_PROGRESS",
    HAS_DECISIONS: "HAS_DECISIONS",
    ALREADY_DECIDED: "ALREADY_DECIDED",
    ALREADY_IN_STEP: "ALREADY_IN_STEP",
    INSTANCE_CHANGED: "INSTANCE_CHANGED",
    ALREADY_COPIED: "ALREADY_COPIED",
  },
  FORBIDDEN: {
    ROOT_ONLY: "ROOT_ONLY",
    NOT_WORKFLOW_OWNER: "NOT_WORKFLOW_OWNER",
    TENANT_ONLY: "TENANT_ONLY",
    WORKFLOW_UNPUBLISHED: "WORKFLOW_UNPUBLISHED",
    ASSIGNEE_NOT_ELIGIBLE: "ASSIGNEE_NOT_ELIGIBLE",
    NOT_APPLICANT: "NOT_APPLICANT",
  },
};

/** 發布擋錯(檢查器)的一筆:`VALIDATION_FAILED` + `fields: ["definition"]` 的 `extensions.issues`。 */
export interface WorkflowIssueLike {
  code: string;
  message: string;
  location?: { stepKey?: string; stepIndex?: number; edgeIndex?: number };
}

/** 綁定時檢查的一筆:`VALIDATION_FAILED` + `fields: ["workflowKey"]` 的 `extensions.issues`。 */
export interface BindingIssueLike {
  stepKey: string;
  stepNumber: number;
  problem: string;
  detail: string;
}

export interface WorkflowError extends AdminError<WorkflowErrorCode> {
  /** 發布擋錯的檢查器結果,或綁定擋下的原因(看 `fields` 分辨) */
  issues?: (WorkflowIssueLike | BindingIssueLike)[];
}

const issuesOf = (error: unknown): WorkflowError["issues"] => {
  if (!(error instanceof ClientError)) {
    return undefined;
  }
  const { errors } = error.response as {
    errors?: { extensions?: { issues?: unknown } }[];
  };
  const issues = errors?.[0]?.extensions?.issues;
  return Array.isArray(issues)
    ? (issues as (WorkflowIssueLike | BindingIssueLike)[])
    : undefined;
};

export const workflowErrorOf = (error: unknown): WorkflowError => {
  const parsed = parseAdminError<
    Exclude<WorkflowErrorCode, "UNEXPECTED">,
    string
  >(error, {
    codes: WORKFLOW_ERROR_CODES,
    refine: (code, reason) =>
      typeof reason === "string"
        ? (REFINED[code]?.[reason] as
            Exclude<WorkflowErrorCode, "UNEXPECTED"> | undefined)
        : undefined,
  });
  const issues = issuesOf(error);
  return { ...parsed, ...(issues !== undefined && { issues }) };
};

/** 綁定擋下的原因(有 `problem` 的那種)。 */
export const isBindingIssue = (
  issue: WorkflowIssueLike | BindingIssueLike,
): issue is BindingIssueLike => "problem" in issue;
