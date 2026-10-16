import { type GraphQLResponseBody, HttpResponse } from "msw";

import { validatePassword } from "@repo/domain/password";
import {
  type ChangePasswordMutationVariables,
  MeQuery,
  ModuleEngine,
  ModuleSidebarType,
  RequestPasswordResetMutationVariables,
  SetPasswordMutationVariables,
  SwitchOrgMutationVariables,
} from "@repo/graphql";

import { api } from "./server";

/** GQL-04 的錯誤碼(前端只靠它分流);api 的正本 `apps/api/src/auth/auth-error.ts`。 */
export type AuthErrorCode =
  | "UNAUTHENTICATED"
  | "TOKEN_EXPIRED"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_DISABLED"
  | "TOO_MANY_ATTEMPTS"
  | "FORBIDDEN"
  | "MUST_CHANGE_PASSWORD"
  | "ACTION_TOKEN_INVALID"
  | "CURRENT_PASSWORD_INVALID"
  | "VALIDATION_FAILED";

type ErrorBody = GraphQLResponseBody<Record<string, never>>;

/** 以 GQL-04 形式回業務錯誤:HTTP 200 + `errors[].extensions.code`(`extensions` 可附加如 `violations`)。 */
export const graphqlError = (
  code: AuthErrorCode,
  message: string = code,
  extensions: Record<string, unknown> = {},
) =>
  HttpResponse.json<ErrorBody>({
    data: null,
    errors: [{ message, extensions: { ...extensions, code } }],
  });

export type TestModule = MeQuery["me"]["modules"][number];
export type TestOrg = MeQuery["me"]["orgs"][number];
/** 當前組織比所屬組織清單多一個 `logoUrl`(側欄的商標;清單不顯示商標所以不簽)。 */
export type TestCurrentOrg = NonNullable<MeQuery["me"]["currentOrg"]>;

export const testOrg: TestOrg = { id: "org-1", name: "平台根組織" };

/** 總覽模組(seeds/base/modules/overview.ts):登入後的第一頁;預設每個測試使用者都有它 */
export const overviewModule: TestModule = {
  id: "m-overview",
  key: "overview",
  name: "總覽",
  parentId: null,
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order: 0,
  route: "/overview",
  icon: "dashboard",
  permissions: ["overview.*"],
};

export const testUser: MeQuery["me"] = {
  id: "user-1",
  account: "root",
  name: "小華",
  email: "root@example.invalid",
  nickname: null,
  mustChangePassword: false,
  currentOrg: { ...testOrg, logoUrl: null, timezone: "Asia/Taipei" },
  orgs: [testOrg],
  modules: [overviewModule],
};

export const bearerOf = (request: Request): string | null => {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
};

export interface AuthWorldOptions {
  /** 一開始就有有效的 refresh cookie(模擬「重新整理頁面」);預設沒有 */
  hasRefreshCookie?: boolean;
  /** Login 發的 access token */
  accessToken?: string;
  /** Refresh 依序發的 access token(用完重複最後一個) */
  refreshedTokens?: string[];
  /** 帶這些 token 的受保護請求回 TOKEN_EXPIRED */
  expiredTokens?: string[];
  /** `me.modules`(預設只有總覽) */
  modules?: TestModule[];
  /** `me.id`(預設 `testUser.id`);換人登入、依使用者分把的儲存鍵用 */
  userId?: string;
  /** 所屬組織清單(預設只有平台根組織);當前組織預設 = 第一個(#66 組織切換器) */
  orgs?: TestOrg[];
  /** 當前組織的商標網址(側欄有商標就顯示圖、沒有才顯示名稱);預設沒有 */
  currentOrgLogoUrl?: string | null;
  /** 當前組織的租戶時區(`me.currentOrg.timezone`);預設 `Asia/Taipei` */
  currentOrgTimezone?: string;
  /** 首登須改密碼(預設 false):true 時除 me / changePassword / logout 外的受保護操作回 MUST_CHANGE_PASSWORD */
  mustChangePassword?: boolean;
  /** 使用者目前的密碼(changePassword 驗「目前密碼」用) */
  currentPassword?: string;
  /** 信件連結裡仍有效的 token(setPassword 用;用過即失效) */
  validActionTokens?: string[];
  /** setPassword 成功後發的 access token */
  setPasswordAccessToken?: string;
}

export interface AuthWorld {
  handlers: ReturnType<typeof api.mutation>[];
  /** 各操作被打到的次數(驗證「只重試一次」「refresh 只打一次」「違規不送出」) */
  calls: {
    login: number;
    refresh: number;
    me: number;
    logout: number;
    logoutAllDevices: number;
    switchOrg: number;
    requestPasswordReset: number;
    setPassword: number;
    changePassword: number;
  };
  /** requestPasswordReset 收到的 email(依序) */
  resetRequests: string[];
}

/** SwitchOrg 發的 access token(換組織即換票,ADR-0003)。 */
export const SWITCHED_ACCESS_TOKEN = "access-switched";

/**
 * 「登入線」的假 api(httpOnly cookie 用 `hasRefreshCookie` 旗標模擬,jsdom 看不到真 cookie):
 * - Login:任何帳密都成功,發 `accessToken` 並「種下」refresh cookie
 * - Refresh:有 cookie 才依序發 `refreshedTokens`;沒有回 UNAUTHENTICATED
 * - Logout / LogoutAllDevices:清 cookie
 * - SwitchOrg:orgId 須在所屬組織內(否則 FORBIDDEN);換發 `SWITCHED_ACCESS_TOKEN` 並更新 `me.currentOrg`
 * - Me:帶有效 bearer 才回使用者;沒帶回 UNAUTHENTICATED;在 `expiredTokens` 內回 TOKEN_EXPIRED
 * - RequestPasswordReset:任何 email 都回成功(api 不透露帳號是否存在)
 * - SetPassword:token 在 `validActionTokens` 內才成功(用過即失效),否則 ACTION_TOKEN_INVALID;
 *   密碼不符規則回 VALIDATION_FAILED + violations;成功發 token、種 cookie、清 mustChangePassword
 * - ChangePassword:要有效 bearer;目前密碼不對回 CURRENT_PASSWORD_INVALID;成功清 mustChangePassword
 * - 其他受保護操作(本檔內為 SwitchOrg):mustChangePassword 時回 MUST_CHANGE_PASSWORD
 */
export const authWorld = (options: AuthWorldOptions = {}): AuthWorld => {
  const {
    accessToken = "access-1",
    refreshedTokens = ["access-2"],
    expiredTokens = [],
    modules = [overviewModule],
    userId = testUser.id,
    orgs = [testOrg],
    currentOrgLogoUrl = null,
    currentOrgTimezone = "Asia/Taipei",
    currentPassword = "secret-1234",
    validActionTokens = ["token-1"],
    setPasswordAccessToken = "access-set",
  } = options;
  let hasRefreshCookie = options.hasRefreshCookie ?? false;
  let mustChangePassword = options.mustChangePassword ?? false;
  const validTokens = new Set([
    accessToken,
    ...refreshedTokens,
    setPasswordAccessToken,
  ]);
  const actionTokens = new Set(validActionTokens);
  const calls = {
    login: 0,
    refresh: 0,
    me: 0,
    logout: 0,
    logoutAllDevices: 0,
    switchOrg: 0,
    requestPasswordReset: 0,
    setPassword: 0,
    changePassword: 0,
  };
  const resetRequests: string[] = [];
  /** 所屬組織 → 當前組織(多一個現簽的商標網址)。 */
  const toCurrentOrg = (org: TestOrg | undefined): TestCurrentOrg | null =>
    org === undefined
      ? null
      : { ...org, logoUrl: currentOrgLogoUrl, timezone: currentOrgTimezone };

  const me: MeQuery["me"] = {
    ...testUser,
    id: userId,
    modules,
    orgs,
    currentOrg: toCurrentOrg(orgs[0]),
  };

  /** 受保護操作共用的守門(對應 api 的 AuthGuard):回 null 代表放行 */
  const guard = (request: Request, allowMustChange = false) => {
    const token = bearerOf(request);
    if (token === null) {
      return graphqlError("UNAUTHENTICATED", "Missing access token");
    }
    if (expiredTokens.includes(token)) {
      return graphqlError("TOKEN_EXPIRED", "Access token expired");
    }
    if (!validTokens.has(token)) {
      return graphqlError("UNAUTHENTICATED", "Invalid access token");
    }
    if (mustChangePassword && !allowMustChange) {
      return graphqlError("MUST_CHANGE_PASSWORD", "Password change required");
    }
    return null;
  };

  const handlers = [
    api.mutation("Login", () => {
      calls.login += 1;
      hasRefreshCookie = true;
      return HttpResponse.json({ data: { login: { accessToken } } });
    }),
    api.mutation("Refresh", () => {
      calls.refresh += 1;
      if (!hasRefreshCookie) {
        return graphqlError("UNAUTHENTICATED", "Invalid refresh token");
      }
      const index = Math.min(calls.refresh, refreshedTokens.length) - 1;
      return HttpResponse.json({
        data: { refresh: { accessToken: refreshedTokens[index] } },
      });
    }),
    api.mutation("Logout", () => {
      calls.logout += 1;
      hasRefreshCookie = false;
      return HttpResponse.json({ data: { logout: { success: true } } });
    }),
    api.mutation("LogoutAllDevices", () => {
      calls.logoutAllDevices += 1;
      hasRefreshCookie = false;
      return HttpResponse.json({
        data: { logoutAllDevices: { success: true } },
      });
    }),
    api.mutation("SwitchOrg", ({ request, variables }) => {
      calls.switchOrg += 1;
      const denied = guard(request);
      if (denied !== null) {
        return denied;
      }
      const { input } = variables as SwitchOrgMutationVariables;
      const target = orgs.find((org) => org.id === input.orgId);
      if (target === undefined) {
        return graphqlError("FORBIDDEN", "Not a member of that org");
      }
      me.currentOrg = toCurrentOrg(target);
      validTokens.add(SWITCHED_ACCESS_TOKEN);
      return HttpResponse.json({
        data: { switchOrg: { accessToken: SWITCHED_ACCESS_TOKEN } },
      });
    }),
    api.query("Me", ({ request }) => {
      calls.me += 1;
      return (
        guard(request, true) ??
        HttpResponse.json({ data: { me: { ...me, mustChangePassword } } })
      );
    }),
    api.mutation("RequestPasswordReset", ({ variables }) => {
      calls.requestPasswordReset += 1;
      const { input } = variables as RequestPasswordResetMutationVariables;
      resetRequests.push(input.email);
      return HttpResponse.json({
        data: { requestPasswordReset: { success: true } },
      });
    }),
    api.mutation("SetPassword", ({ variables }) => {
      calls.setPassword += 1;
      const { token, newPassword } = (variables as SetPasswordMutationVariables)
        .input;
      if (!actionTokens.has(token)) {
        return graphqlError("ACTION_TOKEN_INVALID", "Action token invalid");
      }
      const violations = validatePassword(newPassword);
      if (violations.length > 0) {
        return graphqlError("VALIDATION_FAILED", "Password rules", {
          violations,
        });
      }
      actionTokens.delete(token);
      hasRefreshCookie = true;
      mustChangePassword = false;
      return HttpResponse.json({
        data: { setPassword: { accessToken: setPasswordAccessToken } },
      });
    }),
    api.mutation("ChangePassword", ({ request, variables }) => {
      calls.changePassword += 1;
      const denied = guard(request, true);
      if (denied !== null) {
        return denied;
      }
      const { input } = variables as ChangePasswordMutationVariables;
      if (input.currentPassword !== currentPassword) {
        return graphqlError(
          "CURRENT_PASSWORD_INVALID",
          "Current password invalid",
        );
      }
      const violations = validatePassword(input.newPassword);
      if (violations.length > 0) {
        return graphqlError("VALIDATION_FAILED", "Password rules", {
          violations,
        });
      }
      mustChangePassword = false;
      return HttpResponse.json({ data: { changePassword: { success: true } } });
    }),
  ];

  return { handlers, calls, resetRequests };
};

/** 只要 handler、不需要計數時的簡寫。 */
export const authHandlers = (options: AuthWorldOptions = {}) =>
  authWorld(options).handlers;
