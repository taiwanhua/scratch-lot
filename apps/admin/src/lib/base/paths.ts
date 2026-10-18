import { z } from "zod";

export const LOGIN_PATH = "/login";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
/** 啟用信與重設信共用:`/set-password?token=…` */
export const SET_PASSWORD_PATH = "/set-password";
export const CHANGE_PASSWORD_PATH = "/change-password";
/**
 * 個人設定:殼層路由、不是模組 —— 不分配給角色,所有登入者都能開;
 * 分頁記在 `?tab=`(`preferences` 偏好 / `delegations` 代理人),不帶 = 偏好。
 */
export const PERSONAL_SETTINGS_PATH = "/settings/personal";
export const NEXT_PARAM = "next";
export const TOKEN_PARAM = "token";

/**
 * `?next=` / `?token=` 的 `useUrlState` schema:原字串照收,沒帶 = 空字串。
 * 登入、改密碼、設定密碼三頁經 `useUrlState` 讀它們(REACT-14)。
 */
export const urlStringSchema = z.string().default("");

/** 未登入時導向的登入頁網址,帶原路徑供登入後回去(`/login?next=<原路徑>`)。 */
export const loginPathWithNext = (next: string): string =>
  `${LOGIN_PATH}?${NEXT_PARAM}=${encodeURIComponent(next)}`;

/** 首登須改密碼者被導去的改密碼頁,帶原路徑供改完回去。 */
export const changePasswordPathWithNext = (next: string): string =>
  `${CHANGE_PASSWORD_PATH}?${NEXT_PARAM}=${encodeURIComponent(next)}`;

/** `next` 只接受站內相對路徑(防 open redirect);其他一律回首頁。 */
export const safeNextPath = (next: string | null): string =>
  next !== null && next.startsWith("/") && !next.startsWith("//") ? next : "/";
