import {
  type AuthErrorCode,
  authErrorCodeOf,
} from "@/lib/base/auth/graphql-errors";

/** 登入表單的錯誤文案 key(`admin.login.errors.*`);GQL-04 對照表決定哪個碼顯示什麼。 */
export type LoginErrorKey =
  "invalidCredentials" | "accountDisabled" | "tooManyAttempts" | "unexpected";

const ERROR_KEY_BY_CODE: Partial<Record<AuthErrorCode, LoginErrorKey>> = {
  INVALID_CREDENTIALS: "invalidCredentials",
  ACCOUNT_DISABLED: "accountDisabled",
  TOO_MANY_ATTEMPTS: "tooManyAttempts",
};

export const loginErrorKeyOf = (error: unknown): LoginErrorKey => {
  const code = authErrorCodeOf(error);
  return (code === null ? undefined : ERROR_KEY_BY_CODE[code]) ?? "unexpected";
};
