export const LOGIN_PATH = "/login";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
/** 啟用信與重設信共用(#61):`/set-password?token=…` */
export const SET_PASSWORD_PATH = "/set-password";
export const CHANGE_PASSWORD_PATH = "/change-password";
export const NEXT_PARAM = "next";
export const TOKEN_PARAM = "token";

/** 未登入時導向的登入頁網址,帶原路徑供登入後回去(#61:`/login?next=<原路徑>`)。 */
export const loginPathWithNext = (next: string): string =>
  `${LOGIN_PATH}?${NEXT_PARAM}=${encodeURIComponent(next)}`;

/** 首登須改密碼者被導去的改密碼頁,帶原路徑供改完回去。 */
export const changePasswordPathWithNext = (next: string): string =>
  `${CHANGE_PASSWORD_PATH}?${NEXT_PARAM}=${encodeURIComponent(next)}`;

/** `next` 只接受站內相對路徑(防 open redirect);其他一律回首頁。 */
export const safeNextPath = (next: string | null): string =>
  next !== null && next.startsWith("/") && !next.startsWith("//") ? next : "/";
