import { GraphQLError } from "graphql";

import type { DefinitionIssue, ValueIssue } from "@repo/domain/form";

/**
 * 表單引擎(`forms/`)的錯誤。通用碼沿用 GQL-04(`NOT_FOUND` / `VALIDATION_FAILED` / `FORBIDDEN`),
 * 「為什麼」一律以 `extensions.reason` 表示;新增兩個 code(正本 `docs/modules/forms.md`「錯誤」):
 *
 * - `CONFLICT`:樂觀鎖 / 搶鎖沒搶到(Spec 寫的「409」)。前端提示「已被別人更新,請重新載入」
 * - `PERMISSION_NOT_DELETABLE`:退役權限清理的前置檢查未過(同 `ORG_NOT_DELETABLE` 的形狀)
 *
 * message 給開發者看(英文);使用者文案由前端依 code / reason 對應。
 */

/** `CONFLICT` 的 `extensions.reason`。 */
export const FORM_CONFLICT_REASONS = [
  /** `expectedDraftRevision` 與草稿目前的 `draftRevision` 不符(兩人同時改草稿,後存的被擋)。 */
  "DRAFT_REVISION_MISMATCH",
  /** 已有草稿時又要開一份(一張表單同時只有一份草稿)。 */
  "DRAFT_EXISTS",
  /** 要存 / 發布的草稿不存在(已被發布或還沒開)。 */
  "DRAFT_MISSING",
  /** 退役目前版本時表單沒有已發布的版本。 */
  "NO_CURRENT_VERSION",
  /** 讀到之後 `currentVersion` 被別人改了(同時的退役 / 發布);重新載入再做。 */
  "CURRENT_VERSION_CHANGED",
  /** 提交的 `expectedEditVersion` 與目前不符(兩個分頁同時改同一筆,後存的被擋)。 */
  "EDIT_VERSION_MISMATCH",
  /** 已完成修改的 `expectedRevision` 與目前修訂號不符。 */
  "REVISION_MISMATCH",
  /** 狀態不對:草稿的動作打在已完成的提交上,或反之。 */
  "STATUS_MISMATCH",
  /** 同一個 `clientRequestId` 被拿去建另一張表單(或已被刪除),不能當成重試。 */
  "CLIENT_REQUEST_REUSED",
  /** 複製為新單:這筆已經複製過(`replacedById` 有值),不能再複製一次。 */
  "ALREADY_COPIED",
  /** 綁了流程的表單,這次寫入會讓修訂超過每筆 50 筆的上限;請建立新的申請。 */
  "REVISION_LIMIT",
  /** 這次寫入後的整份文件(值 + 全部修訂快照)會超過 8MB;修訂記錄已達容量上限,無法再修改。 */
  "DOCUMENT_TOO_LARGE",
  /** 舊版資料升級:這張表單在本租戶綁了流程(只限沒綁流程的表單)。 */
  "FORM_HAS_WORKFLOW",
  /** 舊版資料升級:目標版本不是已發布的版本。 */
  "VERSION_NOT_PUBLISHED",
  /** 受管定義安裝的條件更新:比對之後表單身分、目前版本或名稱 / 頁籤模板 / 允許存草稿被別人改了(只有內部的安裝流程會帶預期值)。 */
  "METADATA_CHANGED",
] as const;

export type FormConflictReason = (typeof FORM_CONFLICT_REASONS)[number];

/** `FORBIDDEN` 的 `extensions.reason`(端點本身可用,擋的是這一筆 / 這一欄)。 */
export const FORM_FORBIDDEN_REASONS = [
  /** 欄位級權限:沒有該欄的 `edit`(或看不到它)卻送了與既有值不同的值(Spec §5 原因 3)。 */
  "FIELD_FORBIDDEN",
  /** 這張表單不在操作者可新增的清單內(未分派 / 已停用 / 無發布版本 / 不在該模組)。 */
  "FORM_NOT_AVAILABLE",
  /** 表單不是操作者擁有的(共用表單只有 root 能改;客製表單只有擁有它的租戶能改)。 */
  "NOT_FORM_OWNER",
  /** 只有站在根組織才能做(分派 / 收回、建共用表單)。 */
  "ROOT_ONLY",
  /** 表單關了「允許存草稿」:不能建草稿、不能存狀態為草稿的單(只能直接送出)。 */
  "DRAFT_DISABLED",
] as const;

export type FormForbiddenReason = (typeof FORM_FORBIDDEN_REASONS)[number];

/** `PERMISSION_NOT_DELETABLE` 的 `extensions.reasons`。 */
export const PERMISSION_NOT_DELETABLE_REASONS = [
  /** 不是表單發布產生的權限(`source != dynamic`)。 */
  "NOT_DYNAMIC",
  /** 還沒退役(目前版本仍宣告它)。 */
  "NOT_RETIRED",
  /** 還有草稿(6b 起含審核中)的提交綁的版本宣告這個欄位:擋下。 */
  "USED_BY_DRAFTS",
  /** 只剩已完成的提交用到:要帶 `confirmCompletedUsage: true` 才刪。 */
  "CONFIRM_REQUIRED",
] as const;

export type PermissionNotDeletableReason =
  (typeof PERMISSION_NOT_DELETABLE_REASONS)[number];

export function conflictError(
  message: string,
  reason: FormConflictReason,
  extra: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "CONFLICT", reason, ...extra },
  });
}

export function forbiddenError(
  message: string,
  reason?: FormForbiddenReason,
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

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/** 一般輸入錯誤(GQL-04 `VALIDATION_FAILED`),`fields` 標在哪幾個 input 欄位上。 */
export function validationError(
  message: string,
  fields: string[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields },
  });
}

/**
 * 定義檢查器有錯(發布 / 存草稿時的正則不安全):`VALIDATION_FAILED` + `extensions.issues`
 * (`@repo/domain/form` 的 `DefinitionIssue[]`,每筆帶定位)。
 */
export function definitionInvalidError(
  message: string,
  issues: readonly DefinitionIssue[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields: ["definition"],
      issues,
    },
  });
}

/**
 * 提交的值不合法(送出 / 已完成修改的規則驗證、任何寫入的型別驗證):
 * `VALIDATION_FAILED` + `fields`(欄位 key)+ `fieldErrors`(`{ fieldKey, code, message }`)。
 */
export function valuesInvalidError(
  issues: readonly ValueIssue[],
): GraphQLError {
  const summary = issues
    .map((issue) => issue.fieldKey + "(" + issue.code + ")")
    .join(", ");
  return new GraphQLError(`Form values are invalid: ${summary}`, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields: issues.map((issue) => issue.fieldKey),
      fieldErrors: issues,
    },
  });
}

export function permissionNotDeletableError(
  message: string,
  reasons: PermissionNotDeletableReason[],
  extra: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "PERMISSION_NOT_DELETABLE", reasons, ...extra },
  });
}

/** Mongo 唯一索引衝突(E11000)。 */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11_000
  );
}
