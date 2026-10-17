import { authErrorCodeOf } from "@/lib/base/auth/graphql-errors";

/** 改密碼表單的錯誤文案 key(`admin.changePassword.errors.*`);GQL-04 對照表決定哪個碼顯示什麼。 */
export type ChangePasswordErrorKey =
  "currentPasswordInvalid" | "tooManyAttempts" | "unexpected";

export const changePasswordErrorKeyOf = (
  error: unknown,
): ChangePasswordErrorKey => {
  switch (authErrorCodeOf(error)) {
    case "CURRENT_PASSWORD_INVALID": {
      return "currentPasswordInvalid";
    }
    case "TOO_MANY_ATTEMPTS": {
      return "tooManyAttempts";
    }
    default: {
      return "unexpected";
    }
  }
};
