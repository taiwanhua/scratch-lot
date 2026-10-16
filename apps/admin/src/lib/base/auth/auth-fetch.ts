import { authErrorCodeOfBody, isSessionEndedCode } from "./graphql-errors";
import type { SessionStore } from "./session-store";

interface AuthFetchDeps {
  store: SessionStore;
  /** 單飛的換票(見 session.ts);失敗會拋出並已清狀態 */
  refresh: () => Promise<string>;
}

/** 記憶體沒有 token 時的 GraphQL 形式錯誤,讓呼叫端(codegen hook)拿到和 api 一樣的 UNAUTHENTICATED。 */
const unauthenticatedResponse = (): Response =>
  Response.json({
    data: null,
    errors: [
      {
        message: "No active session",
        extensions: { code: "UNAUTHENTICATED" },
      },
    ],
  });

const codeOf = async (response: Response) => {
  try {
    return authErrorCodeOfBody(await response.clone().json());
  } catch {
    return null;
  }
};

/**
 * 受保護請求的 fetch 層(#61 / GQL-04):
 * 1. 記憶體沒 token → 先用 cookie 換票(開機中的請求會等同一個 refresh);換不到就回 UNAUTHENTICATED
 * 2. 帶 `Authorization: Bearer <access token>` 送出
 * 3. 回 `TOKEN_EXPIRED` → 靜默換票(單飛)後**只重送一次**
 * 4. 回 `UNAUTHENTICATED` / `ACCOUNT_DISABLED` → 清狀態(路由守門會導回 /login?next=…)
 * 5. 回 `MUST_CHANGE_PASSWORD` → 在 store 立旗(路由守門會導去 /change-password?next=…);回應原樣交回呼叫端
 */
export const createAuthFetch = ({
  store,
  refresh,
}: AuthFetchDeps): typeof fetch => {
  const ensureToken = async (): Promise<string | null> => {
    const { accessToken } = store.getState();
    if (accessToken !== null) {
      return accessToken;
    }
    try {
      return await refresh();
    } catch {
      return null;
    }
  };

  /** 換票時若別的請求已經換過(token 已不同),直接沿用新票,不再打第二次 refresh */
  const refreshIfStale = async (usedToken: string): Promise<string | null> => {
    const current = store.getState().accessToken;
    if (current !== null && current !== usedToken) {
      return current;
    }
    try {
      return await refresh();
    } catch {
      return null;
    }
  };

  const send = (input: RequestInfo | URL, init: RequestInit, token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  return async (input, init = {}) => {
    const token = await ensureToken();
    if (token === null) {
      return unauthenticatedResponse();
    }

    let response = await send(input, init, token);
    let code = await codeOf(response);

    if (code === "TOKEN_EXPIRED") {
      const fresh = await refreshIfStale(token);
      if (fresh === null) {
        return response;
      }
      response = await send(input, init, fresh);
      code = await codeOf(response);
    }

    if (isSessionEndedCode(code)) {
      store.getState().clear();
    } else if (code === "MUST_CHANGE_PASSWORD") {
      store.getState().setMustChangePassword(true);
    }
    return response;
  };
};
