import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Types } from "mongoose";

import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import { MailService } from "../../mail/mail.service";
import { RecordingMailService } from "../../mail/recording-mail.service";
import {
  type AuthTestApp,
  REFRESH_COOKIE_NAME,
  cookiePair,
  startAuthTestApp,
} from "../test-support/auth-app";
import { createOrg, createUser, findRootOrgId } from "../test-support/fixtures";
import { PasswordService } from "./password.service";

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const REFRESH = /* GraphQL */ `
  mutation Refresh {
    refresh {
      accessToken
    }
  }
`;

const ME = /* GraphQL */ `
  query Me {
    me {
      mustChangePassword
      currentOrg {
        id
      }
    }
  }
`;

const SWITCH_ORG = /* GraphQL */ `
  mutation SwitchOrg($input: SwitchOrgInput!) {
    switchOrg(input: $input) {
      accessToken
    }
  }
`;

const REQUEST_PASSWORD_RESET = /* GraphQL */ `
  mutation RequestPasswordReset($input: RequestPasswordResetInput!) {
    requestPasswordReset(input: $input) {
      success
    }
  }
`;

const SET_PASSWORD = /* GraphQL */ `
  mutation SetPassword($input: SetPasswordInput!) {
    setPassword(input: $input) {
      accessToken
    }
  }
`;

const CHANGE_PASSWORD = /* GraphQL */ `
  mutation ChangePassword($input: ChangePasswordInput!) {
    changePassword(input: $input) {
      success
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

interface MeData {
  me: { mustChangePassword: boolean; currentOrg: { id: string } | null };
}

interface RequestPasswordResetData {
  requestPasswordReset: { success: boolean };
}

interface SetPasswordData {
  setPassword: { accessToken: string };
}

interface ChangePasswordData {
  changePassword: { success: boolean };
}

interface ActionTokenRow {
  userId: Types.ObjectId;
  type: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

const PASSWORD = ["old", "pass", "word"].join("-");
const NEW_PASSWORD = ["new", "pass", "word"].join("-");
const WRONG_PASSWORD = ["not", "the", "password"].join("-");

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** 只假造 Date(token 效期讀的是時鐘),網路與計時器維持真實,否則 supertest / MongoDB 會卡住。 */
function travelTo(timestamp: number): void {
  jest.useFakeTimers({
    doNotFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "setImmediate",
      "clearImmediate",
      "nextTick",
      "queueMicrotask",
      "hrtime",
      "performance",
    ],
    now: timestamp,
  });
}

/** 從信件連結取出 token(連結形如 `<ADMIN_APP_URL>/set-password?token=…`)。 */
function tokenOf(link: string): string {
  const token = new URL(link).searchParams.get("token");
  if (!token) {
    throw new Error(`信件連結沒有 token:${link}`);
  }
  return token;
}

describe("登入線3:requestPasswordReset / setPassword / changePassword(GraphQL 端點,對真 Nest app + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let mail: RecordingMailService;

  /** 寄信在背景執行(時間側信道,ADR-0003),測試要等記錄用 adapter 收到 */
  async function waitForSent(count: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (mail.sent.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-password", {
      ADMIN_APP_URL: "https://erp-test.cookhome.online",
    });
    const mailService = api.app.get(MailService);
    if (!(mailService instanceof RecordingMailService)) {
      throw new TypeError(
        "測試環境沒設 RESEND_API_KEY,MailService 應是記錄用 adapter",
      );
    }
    mail = mailService;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.useRealTimers();
    mail.sent.length = 0;
  });

  async function login(account: string, password: string) {
    return api.graphql<LoginData>(LOGIN, { input: { account, password } });
  }

  async function requestReset(email: string) {
    return api.graphql<RequestPasswordResetData>(REQUEST_PASSWORD_RESET, {
      input: { email },
    });
  }

  async function setPassword(token: string, newPassword: string) {
    return api.graphql<SetPasswordData>(SET_PASSWORD, {
      input: { token, newPassword },
    });
  }

  /** 走一次忘記密碼,回信裡的 token。 */
  async function resetTokenFor(account: string): Promise<string> {
    const result = await requestReset(`${account}@example.com`);
    expect(result.errors).toBeUndefined();
    // 寄信是 fire-and-forget(`void issueResetAndSend`,時間側信道 ADR-0003):
    // mutation 回來時信可能還沒寄出,一定要等記錄用 adapter 收到才讀(漏等會 flaky)
    await waitForSent(1);
    const sent = mail.sent.at(-1);
    if (!sent) {
      throw new Error("記錄用 adapter 沒收到重設信");
    }
    return tokenOf(sent.link ?? "");
  }

  async function actionTokensOf(
    userId: Types.ObjectId,
  ): Promise<ActionTokenRow[]> {
    return api.connection
      .collection("action_tokens")
      .find<ActionTokenRow>({ userId })
      .toArray();
  }

  describe("requestPasswordReset(忘記密碼)", () => {
    it("email 存在:回成功、記錄用 adapter 收到一封含 token 連結的重設信、action_tokens 存雜湊不存明碼、30 分鐘效期", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      const userId = await createUser(api.connection, {
        account: "forgot-user",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const start = Date.now();
      travelTo(start);

      const result = await requestReset("forgot-user@example.com");
      expect(result.errors).toBeUndefined();
      expect(result.data?.requestPasswordReset.success).toBe(true);

      await waitForSent(1);
      expect(mail.sent).toHaveLength(1);
      const [sent] = mail.sent;
      expect(sent).toMatchObject({
        kind: "password-reset",
        to: "forgot-user@example.com",
      });
      expect(
        sent?.link?.startsWith(
          "https://erp-test.cookhome.online/set-password?token=",
        ),
      ).toBe(true);
      const token = tokenOf(sent?.link ?? "");
      expect(token.length).toBeGreaterThanOrEqual(32);

      const rows = await actionTokensOf(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "password-reset", usedAt: null });
      expect(rows[0]?.tokenHash).not.toBe(token);
      expect(rows[0]?.tokenHash).not.toContain(token);
      expect(rows[0]?.expiresAt.getTime()).toBe(start + 30 * MINUTE_MS);
    });

    it("email 不存在:回應與存在時完全相同(不透露帳號是否存在),但不寄信、不建 token", async () => {
      const result = await requestReset("nobody@example.com");
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({ requestPasswordReset: { success: true } });
      expect(mail.sent).toHaveLength(0);
    });

    it("停用帳號:同樣回成功但不寄信(停用者不得經此取得登入 token)", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      await createUser(api.connection, {
        account: "forgot-disabled",
        password: PASSWORD,
        enabled: false,
        orgIds: [rootOrgId],
      });
      const result = await requestReset("forgot-disabled@example.com");
      expect(result.errors).toBeUndefined();
      expect(result.data?.requestPasswordReset.success).toBe(true);
      expect(mail.sent).toHaveLength(0);
    });
  });

  describe("setPassword(設定新密碼:重設信 / 啟用信共用)", () => {
    it("成功:直接回登入 token(access + refresh cookie)、新密碼可登入、舊密碼不行、舊 refresh 全失效、token 標 usedAt 不可再用、清 mustChangePassword", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      const userId = await createUser(api.connection, {
        account: "reset-user",
        password: PASSWORD,
        settings: { mustChangePassword: true },
        orgIds: [rootOrgId],
      });
      const oldSession = await login("reset-user", PASSWORD);
      const oldCookie = cookiePair(oldSession.setCookies, REFRESH_COOKIE_NAME);
      expect(oldCookie).toBeDefined();

      const token = await resetTokenFor("reset-user");
      const result = await setPassword(token, NEW_PASSWORD);
      expect(result.errors).toBeUndefined();
      const accessToken = result.data?.setPassword.accessToken;
      expect(typeof accessToken).toBe("string");
      const newCookie = cookiePair(result.setCookies, REFRESH_COOKIE_NAME);
      expect(newCookie).toBeDefined();

      // 啟用 / 重設後免再登入:拿到的 token 立即可用,且旗標已清
      const me = await api.graphql<MeData>(ME, {}, { accessToken });
      expect(me.errors).toBeUndefined();
      expect(me.data?.me.mustChangePassword).toBe(false);

      // 舊 refresh 全部失效;新 cookie 可用
      const oldRefresh = await api.graphql(REFRESH, {}, { cookie: oldCookie });
      expect(oldRefresh.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
      const newRefresh = await api.graphql(REFRESH, {}, { cookie: newCookie });
      expect(newRefresh.errors).toBeUndefined();

      // 新密碼可登入、舊密碼不行
      const withNew = await login("reset-user", NEW_PASSWORD);
      expect(withNew.errors).toBeUndefined();
      const withOld = await login("reset-user", PASSWORD);
      expect(withOld.errors?.[0]?.extensions?.code).toBe("INVALID_CREDENTIALS");

      // token 單次使用
      const rows = await actionTokensOf(userId);
      expect(rows[0]?.usedAt).toBeInstanceOf(Date);
      const reused = await setPassword(token, "another-password-1");
      expect(reused.errors?.[0]?.extensions?.code).toBe("ACTION_TOKEN_INVALID");
      expect(reused.setCookies).toEqual([]);
    });

    it("逾期(30 分鐘後)→ ACTION_TOKEN_INVALID;不存在的 token → 同碼(連結失效頁,不透露差別)", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      await createUser(api.connection, {
        account: "expired-user",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const start = Date.now();
      travelTo(start);
      const token = await resetTokenFor("expired-user");

      travelTo(start + 31 * MINUTE_MS);
      const expired = await setPassword(token, NEW_PASSWORD);
      expect(expired.errors?.[0]?.extensions?.code).toBe(
        "ACTION_TOKEN_INVALID",
      );

      const bogus = await setPassword("not-a-real-token", NEW_PASSWORD);
      expect(bogus.errors?.[0]?.extensions?.code).toBe("ACTION_TOKEN_INVALID");

      // 密碼未被改動
      const stillOld = await login("expired-user", PASSWORD);
      expect(stillOld.errors).toBeUndefined();
    });

    it("密碼不符規則(不足 8 碼 / 純數字)→ VALIDATION_FAILED 並列出違規項;token 不被消耗、可再試", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      await createUser(api.connection, {
        account: "weak-user",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const token = await resetTokenFor("weak-user");

      const short = await setPassword(token, "abc1234");
      expect(short.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
      expect(short.errors?.[0]?.extensions).toMatchObject({
        violations: ["too-short"],
      });
      const digits = await setPassword(token, "12345678");
      expect(digits.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        violations: ["digits-only"],
      });

      const retry = await setPassword(token, NEW_PASSWORD);
      expect(retry.errors).toBeUndefined();
    });

    it("啟用信:token 建立函式(7 天)+ sendActivationEmail 可供第 3 段呼叫;activation 型別同樣走 setPassword 並回登入 token", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      const userId = await createUser(api.connection, {
        account: "activate-user",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const start = Date.now();
      travelTo(start);

      await api.app.get(PasswordService).sendActivationEmail(userId);

      await waitForSent(1);
      expect(mail.sent).toHaveLength(1);
      const [sent] = mail.sent;
      expect(sent).toMatchObject({
        kind: "activation",
        to: "activate-user@example.com",
      });
      const rows = await actionTokensOf(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "activation", usedAt: null });
      expect(rows[0]?.expiresAt.getTime()).toBe(start + 7 * DAY_MS);

      travelTo(start + 6 * DAY_MS);
      const result = await setPassword(tokenOf(sent?.link ?? ""), NEW_PASSWORD);
      expect(result.errors).toBeUndefined();
      expect(typeof result.data?.setPassword.accessToken).toBe("string");
      expect(cookiePair(result.setCookies, REFRESH_COOKIE_NAME)).toBeDefined();

      const withNew = await login("activate-user", NEW_PASSWORD);
      expect(withNew.errors).toBeUndefined();
    });
  });

  describe("changePassword(已登入者;首登強改走此路)", () => {
    it("首登強改:旗標 true → 登入成功但其他受保護操作回 MUST_CHANGE_PASSWORD → 改密後旗標清除、放行", async () => {
      const tenant = await createOrg(api.connection, { name: "強改租戶" });
      await createUser(api.connection, {
        account: "must-change-user",
        password: PASSWORD,
        settings: { mustChangePassword: true },
        orgIds: [tenant],
      });
      const session = await login("must-change-user", PASSWORD);
      expect(session.errors).toBeUndefined();
      const accessToken = session.data?.login.accessToken;

      const blocked = await api.graphql(
        SWITCH_ORG,
        { input: { orgId: String(tenant) } },
        { accessToken },
      );
      expect(blocked.errors?.[0]?.extensions?.code).toBe(
        "MUST_CHANGE_PASSWORD",
      );

      const changed = await api.graphql<ChangePasswordData>(
        CHANGE_PASSWORD,
        { input: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } },
        { accessToken },
      );
      expect(changed.errors).toBeUndefined();
      expect(changed.data?.changePassword.success).toBe(true);

      const me = await api.graphql<MeData>(ME, {}, { accessToken });
      expect(me.data?.me.mustChangePassword).toBe(false);
      const allowed = await api.graphql(
        SWITCH_ORG,
        { input: { orgId: String(tenant) } },
        { accessToken },
      );
      expect(allowed.errors).toBeUndefined();

      const withNew = await login("must-change-user", NEW_PASSWORD);
      expect(withNew.errors).toBeUndefined();
    });

    it("目前密碼錯誤 → CURRENT_PASSWORD_INVALID 且密碼不變;新密碼不符規則 → VALIDATION_FAILED", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      await createUser(api.connection, {
        account: "change-user",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const session = await login("change-user", PASSWORD);
      const accessToken = session.data?.login.accessToken;

      const wrongCurrent = await api.graphql<ChangePasswordData>(
        CHANGE_PASSWORD,
        {
          input: { currentPassword: WRONG_PASSWORD, newPassword: NEW_PASSWORD },
        },
        { accessToken },
      );
      expect(wrongCurrent.errors?.[0]?.extensions?.code).toBe(
        "CURRENT_PASSWORD_INVALID",
      );
      const stillOld = await login("change-user", PASSWORD);
      expect(stillOld.errors).toBeUndefined();

      const weak = await api.graphql<ChangePasswordData>(
        CHANGE_PASSWORD,
        { input: { currentPassword: PASSWORD, newPassword: "1234567" } },
        { accessToken },
      );
      expect(weak.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        violations: ["too-short", "digits-only"],
      });
    });

    it("要求已登入(沒 access token → UNAUTHENTICATED);requestPasswordReset / setPassword 為公開端點", async () => {
      const anonymous = await api.graphql<ChangePasswordData>(CHANGE_PASSWORD, {
        input: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      });
      expect(anonymous.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");

      // 公開端點:未登入也能打到業務邏輯(而非被 guard 擋下)
      const reset = await requestReset("nobody@example.com");
      expect(reset.errors).toBeUndefined();
      const set = await setPassword("not-a-real-token", NEW_PASSWORD);
      expect(set.errors?.[0]?.extensions?.code).toBe("ACTION_TOKEN_INVALID");
    });
  });
});
