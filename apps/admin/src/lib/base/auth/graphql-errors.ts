import type { PasswordRuleViolation } from "@repo/domain/password";
import { ClientError } from "@repo/graphql";

/**
 * GQL-04 的登入線錯誤碼(正本 `docs/standards/api/graphql-schema.md`;api 的程式正本 `apps/api/src/auth/auth-error.ts`)。
 * GraphQL 永遠回 HTTP 200,前端只靠 `extensions.code` 分流。
 */
export const AUTH_ERROR_CODES = [
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  "FORBIDDEN",
  "INVALID_CREDENTIALS",
  "ACCOUNT_DISABLED",
  "TOO_MANY_ATTEMPTS",
  "MUST_CHANGE_PASSWORD",
  /** 信件連結的 token 不存在 / 已用 / 逾期(同碼)→ 連結失效頁,不是換票 */
  "ACTION_TOKEN_INVALID",
  /** 已登入者改密碼時「目前密碼」錯 → 文案「目前密碼錯誤」 */
  "CURRENT_PASSWORD_INVALID",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** 收到即代表「登入狀態已無效」的碼:清狀態、回登入頁(GQL-04)。 */
const SESSION_ENDED_CODES: ReadonlySet<AuthErrorCode> = new Set([
  "UNAUTHENTICATED",
  "ACCOUNT_DISABLED",
]);

const PASSWORD_RULE_VIOLATIONS: ReadonlySet<string> =
  new Set<PasswordRuleViolation>(["too-short", "digits-only"]);

interface GraphqlErrorShape {
  extensions?: { code?: unknown; violations?: unknown };
}

const isAuthErrorCode = (value: unknown): value is AuthErrorCode =>
  typeof value === "string" &&
  (AUTH_ERROR_CODES as readonly string[]).includes(value);

const errorsOfBody = (body: unknown): GraphqlErrorShape[] => {
  if (typeof body !== "object" || body === null || !("errors" in body)) {
    return [];
  }
  const { errors } = body as { errors?: unknown };
  return Array.isArray(errors) ? (errors as GraphqlErrorShape[]) : [];
};

/** 從 GraphQL 回應 body 的 `errors[]` 取出第一個登入線錯誤碼;沒有則 null。 */
export const authErrorCodeOfBody = (body: unknown): AuthErrorCode | null => {
  for (const error of errorsOfBody(body)) {
    const code = error.extensions?.code;
    if (isAuthErrorCode(code)) {
      return code;
    }
  }
  return null;
};

/** 從 codegen hook 拋出的錯誤(graphql-request 的 ClientError)取出登入線錯誤碼。 */
export const authErrorCodeOf = (error: unknown): AuthErrorCode | null =>
  error instanceof ClientError ? authErrorCodeOfBody(error.response) : null;

/**
 * 密碼不符規則時 api 回 `VALIDATION_FAILED` + `extensions.violations`(正本 `apps/api/src/auth/password/password-error.ts`);
 * 取出違規項供表單逐條提示。不是密碼規則錯誤則回 null。
 */
export const passwordViolationsOf = (
  error: unknown,
): PasswordRuleViolation[] | null => {
  if (!(error instanceof ClientError)) {
    return null;
  }
  for (const item of errorsOfBody(error.response)) {
    const { code, violations } = item.extensions ?? {};
    if (code === "VALIDATION_FAILED" && Array.isArray(violations)) {
      return (violations as unknown[]).filter(
        (violation): violation is PasswordRuleViolation =>
          typeof violation === "string" &&
          PASSWORD_RULE_VIOLATIONS.has(violation),
      );
    }
  }
  return null;
};

export const isSessionEndedCode = (code: AuthErrorCode | null): boolean =>
  code !== null && SESSION_ENDED_CODES.has(code);
