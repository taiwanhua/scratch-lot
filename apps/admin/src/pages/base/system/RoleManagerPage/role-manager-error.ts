import { ClientError } from "@repo/graphql";

import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 角色管理會收到的業務錯誤碼(GQL-04;api 的程式正本 `apps/api/src/roles/`)。
 * 認不出來的一律當 `UNEXPECTED`,文案在 `admin.roleManager.errors.*`。
 */
export const ROLE_MANAGER_ERROR_CODES = [
  "ROLE_NOT_DELETABLE",
  "ROLE_OUT_OF_REACH",
  "USER_NOT_ELIGIBLE",
  "OWNER_PROTECTED",
  "NOT_FOUND",
  "FORBIDDEN",
  "VALIDATION_FAILED",
] as const;

export type RoleManagerErrorCode =
  (typeof ROLE_MANAGER_ERROR_CODES)[number] | "UNEXPECTED";

/**
 * `ROLE_NOT_DELETABLE` 的四個前置檢查(`extensions.reasons`,逐項顯示成清單;
 * 正本 `docs/modules/role-manager.md`「api 介面」與 `apps/api/src/roles/roles-error.ts`)。
 */
export const ROLE_NOT_DELETABLE_REASONS = [
  "HAS_GRANTS",
  "SYSTEM_ROLE",
  "TEMPLATE_COPY",
  "REFERENCED_BY_AUDIENCE",
] as const;

export type RoleNotDeletableReason =
  (typeof ROLE_NOT_DELETABLE_REASONS)[number];

/**
 * `REFERENCED_BY_AUDIENCE` 的引用處種類(`extensions.references[].kind`;正本
 * `apps/api/src/audience/audience-references.service.ts` 的 `AUDIENCE_REFERENCE_KINDS`)。
 * 文案在 `admin.roleManager.delete.references.<kind>`;認不得的種類不列。
 */
export const ROLE_REFERENCE_KINDS = [
  "notification-setting",
  "workflow-approver",
  "workflow-step-cc",
  "workflow-overdue",
  "workflow-cc",
  "data-scope",
] as const;

export type RoleReferenceKind = (typeof ROLE_REFERENCE_KINDS)[number];

/** 一個引用處:哪一種設定、它的名稱(流程關卡另帶關卡名稱)。 */
export interface RoleReference {
  kind: RoleReferenceKind;
  name: string;
  stepName?: string;
}

/**
 * 共用形狀(`lib/base/errors.ts`)加上本頁的 `references`。用到的選填欄位:`reasons`(`ROLE_NOT_DELETABLE`
 * 時逐項列出為什麼不能刪)、`references`(`REFERENCED_BY_AUDIENCE` 的引用處)與
 * `fields`(`VALIDATION_FAILED` 時不合法的欄位)。
 */
export interface RoleManagerError extends AdminError<
  RoleManagerErrorCode,
  RoleNotDeletableReason
> {
  references?: RoleReference[];
}

const isReference = (value: unknown): value is RoleReference => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { kind, name, stepName } = value as Record<string, unknown>;
  return (
    (ROLE_REFERENCE_KINDS as readonly unknown[]).includes(kind) &&
    typeof name === "string" &&
    (stepName === undefined || typeof stepName === "string")
  );
};

/** `ROLE_NOT_DELETABLE` 的 `extensions.references`(同 `parseAdminError`,取第一個錯誤)。 */
const referencesOf = (error: unknown): RoleReference[] => {
  if (!(error instanceof ClientError)) {
    return [];
  }
  const { errors } = error.response as {
    errors?: { extensions?: { code?: unknown; references?: unknown } }[];
  };
  const extensions = errors?.find(
    (item) => item.extensions?.code === "ROLE_NOT_DELETABLE",
  )?.extensions;
  return Array.isArray(extensions?.references)
    ? extensions.references.filter(isReference)
    : [];
};

export const roleManagerErrorOf = (error: unknown): RoleManagerError => {
  const parsed = parseAdminError(error, {
    codes: ROLE_MANAGER_ERROR_CODES,
    reasons: ROLE_NOT_DELETABLE_REASONS,
  });
  const references = referencesOf(error);
  return references.length > 0 ? { ...parsed, references } : parsed;
};
