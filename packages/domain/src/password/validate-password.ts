/** 密碼最少長度(以 JS 字串長度計)。 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * 違反的密碼規則(給表單逐條提示,文案由前端依 key 對應):
 * - `too-short`:不足 8 碼
 * - `digits-only`:整串都是 ASCII 數字(純數字密碼太好猜)
 */
export type PasswordRuleViolation = "too-short" | "digits-only";

const DIGITS_ONLY = /^\d+$/;

/**
 * 檢查密碼是否符合規則,回傳**全部**違規項(空陣列 = 通過)。
 * admin 表單即時提示、api 真正把關(違規回 `VALIDATION_FAILED`),兩邊用同一份。
 */
export function validatePassword(password: string): PasswordRuleViolation[] {
  const violations: PasswordRuleViolation[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    violations.push("too-short");
  }
  if (DIGITS_ONLY.test(password)) {
    violations.push("digits-only");
  }
  return violations;
}

export function isPasswordValid(password: string): boolean {
  return validatePassword(password).length === 0;
}
