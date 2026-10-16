import { GraphQLError } from "graphql";

import type { SubmitCheckIssue, WorkflowIssue } from "@repo/domain/workflow";

/**
 * 審核流程(`workflows/`)的錯誤(正本 `docs/modules/workflows.md`「錯誤」)。通用碼沿用 GQL-04
 * (`NOT_FOUND` / `VALIDATION_FAILED` / `FORBIDDEN` / `CONFLICT`),「為什麼」一律放 `extensions.reason`,
 * 不新增 code。message 給開發者看(英文);使用者文案由前端依 code / reason 對應。
 */

/** `CONFLICT` 的 `extensions.reason`。 */
export const WORKFLOW_CONFLICT_REASONS = [
  /** 存草稿 / 發布帶的 `expectedDraftRevision` 與草稿不符。 */
  "DRAFT_REVISION_MISMATCH",
  /** 已有草稿時又要開一份。 */
  "DRAFT_EXISTS",
  /** 要存 / 發布的草稿不存在。 */
  "DRAFT_MISSING",
  /** 退役目前版本時沒有已發布的版本。 */
  "NO_CURRENT_VERSION",
  /** 讀到之後 `currentVersion` 被別人改了。 */
  "CURRENT_VERSION_CHANGED",
  /** 提交 / 任務的 `expectedEditVersion` 與目前不符(兩個分頁重複送)。 */
  "EDIT_VERSION_MISMATCH",
  /** 提交的狀態不允許這個動作(不是審核中不能撤回、不是已核准不能作廢…)。 */
  "STATUS_MISMATCH",
  /** 撤回:已有被接受的審核意見。 */
  "HAS_DECISIONS",
  /** 改派:這個任務已有決定。 */
  "ALREADY_DECIDED",
  /** 改派 / 新增審核者:新的人已在這一關的派任計畫裡。 */
  "ALREADY_IN_STEP",
  /** 實例或關卡已不在可處理的狀態(已結束、關卡已前進、不是解析為空的阻擋)。 */
  "INSTANCE_CHANGED",
  /** 受管定義安裝的條件更新:比對之後流程身分、目前版本或名稱被別人改了(只有內部的安裝流程會帶預期值)。 */
  "METADATA_CHANGED",
] as const;

export type WorkflowConflictReason = (typeof WORKFLOW_CONFLICT_REASONS)[number];

/** `FORBIDDEN` 的 `extensions.reason`(端點本身可用,擋的是這一筆)。 */
export const WORKFLOW_FORBIDDEN_REASONS = [
  /** 只有站在根組織才能做(分派 / 收回)。 */
  "ROOT_ONLY",
  /** 流程不是操作者擁有的(共用流程只有 root 能改;客製流程只有擁有它的租戶能改)。 */
  "NOT_WORKFLOW_OWNER",
  /** 綁定要站在租戶內(root 沒有自己的表單綁定)。 */
  "TENANT_ONLY",
  /** 送出時檢查:進過審核但綁定被解除 / 流程被收回,或綁定指向已失效的流程。 */
  "WORKFLOW_REMOVED",
  /** 送出時檢查:綁的流程沒有已發布版本。 */
  "WORKFLOW_UNPUBLISHED",
  /** 送出時檢查:流程引用的欄位在這一版表單不存在 / 不是使用者引用欄 / 受保護(`extensions.issues`)。 */
  "WORKFLOW_MISCONFIGURED",
  /** 只有申請人本人能做(撤回)。 */
  "NOT_APPLICANT",
  /** 改派 / 新增審核者的對象不合格(停用、不在本租戶、是申請人)。 */
  "ASSIGNEE_NOT_ELIGIBLE",
] as const;

export type WorkflowForbiddenReason =
  (typeof WORKFLOW_FORBIDDEN_REASONS)[number];

export function workflowConflictError(
  message: string,
  reason: WorkflowConflictReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "CONFLICT", reason },
  });
}

export function workflowForbiddenError(
  message: string,
  reason?: WorkflowForbiddenReason,
  extra: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "FORBIDDEN",
      ...(reason === undefined ? {} : { reason }),
      ...extra,
    },
  });
}

export function workflowNotFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export function workflowValidationError(
  message: string,
  fields: string[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields },
  });
}

/** 定義檢查器有錯(發布):`VALIDATION_FAILED` + `issues`(每筆帶關卡 / 連線定位)。 */
export function workflowDefinitionInvalidError(
  message: string,
  issues: readonly WorkflowIssue[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields: ["definition"], issues },
  });
}

/** 綁定時檢查未過:`VALIDATION_FAILED` + `issues`(指出哪一關、哪種來源不能直接綁)。 */
export function bindingInvalidError(
  message: string,
  issues: readonly BindingIssue[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields: ["workflowKey"], issues },
  });
}

/** 送出時檢查擋下:`FORBIDDEN` + reason + `issues`(設定有誤時指出第幾關、缺哪個欄位)。 */
export function submitBlockedError(
  message: string,
  reason: Extract<
    WorkflowForbiddenReason,
    "WORKFLOW_REMOVED" | "WORKFLOW_UNPUBLISHED" | "WORKFLOW_MISCONFIGURED"
  >,
  issues: readonly SubmitCheckIssue[],
): GraphQLError {
  return workflowForbiddenError(message, reason, { issues });
}

/** 綁定時檢查的一個問題(Spec 6b §3「綁定時檢查」表)。 */
export interface BindingIssue {
  stepKey: string;
  stepNumber: number;
  problem:
    | "ROLE_IN_SHARED"
    | "USERS_IN_SHARED"
    | "USER_NOT_IN_TENANT"
    | "ROLE_NOT_IN_TENANT"
    | "FIELD_FORM_MISMATCH"
    | "FIELD_MISSING"
    | "FIELD_NOT_USER_REFERENCE";
  detail: string;
}

/** Mongo 唯一索引衝突(E11000)。 */
export function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11_000
  );
}
