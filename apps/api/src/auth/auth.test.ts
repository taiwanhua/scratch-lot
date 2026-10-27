import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { sign as signJwt } from "jsonwebtoken";
import type { Types } from "mongoose";

import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  createRole,
  setRoleEnabled,
} from "../permission/test-support/fixtures";
import { OperatorContextService } from "./operator-context.service";
import {
  type AuthTestApp,
  REFRESH_COOKIE_NAME,
  ROOT_ADMIN,
  TEST_JWT_SECRET,
  cookiePair,
  startAuthTestApp,
} from "./test-support/auth-app";
import {
  createOrg,
  createUser,
  findRootOrgId,
  setUserEnabled,
} from "./test-support/fixtures";
import { PublicProbeModule } from "./test-support/public-probe";

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const ME = /* GraphQL */ `
  query Me {
    me {
      id
      account
      name
      email
      mustChangePassword
      currentOrg {
        id
        name
      }
      orgs {
        id
        name
      }
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

const LOGOUT = /* GraphQL */ `
  mutation Logout {
    logout {
      success
    }
  }
`;

const LOGOUT_ALL_DEVICES = /* GraphQL */ `
  mutation LogoutAllDevices {
    logoutAllDevices {
      success
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

interface LoginData {
  login: { accessToken: string };
}

interface RefreshData {
  refresh: { accessToken: string };
}

interface LogoutData {
  logout: { success: boolean };
}

interface LogoutAllData {
  logoutAllDevices: { success: boolean };
}

interface SwitchOrgData {
  switchOrg: { accessToken: string };
}

interface OrgSummary {
  id: string;
  name: string;
}

interface MeData {
  me: {
    id: string;
    account: string;
    name: string;
    email: string;
    mustChangePassword: boolean;
    currentOrg: OrgSummary | null;
    orgs: OrgSummary[];
  };
}

/** 解出 JWT payload(不驗簽 — 簽章正確性由 api 自己的 guard 驗證)。 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  return JSON.parse(
    Buffer.from(payload ?? "", "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

const PASSWORD = ["test", "pass", "word"].join("-");

/** 商標的 GCS 物件路徑(ADR-0010;格式同 createUploadUrl 簽出來的)。 */
const TENANT_LOGO_PATH = "org-logos/1b4e28ba-2fa1-11d2-883f-b9a761bde3fb.png";
const OWN_LOGO_PATH = "org-logos/c9bf9e57-1685-4c89-bafb-ff5af830be8a.webp";

/** 只假造 Date(節流與 token 效期讀的是時鐘),網路與計時器維持真實,否則 supertest / MongoDB 會卡住。 */
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

describe("登入線1:login / refresh / logout / switchOrg / me(GraphQL 端點,對真 Nest app + 真 MongoDB)", () => {
  let api: AuthTestApp;

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-auth", {}, [PublicProbeModule]);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.useRealTimers();
  });

  async function login(
    account: string,
    password: string,
  ): Promise<
    ReturnType<AuthTestApp["graphql"]> extends Promise<infer R> ? R : never
  > {
    return api.graphql<LoginData>(LOGIN, { input: { account, password } });
  }

  async function loginAccessToken(
    account: string,
    password: string,
  ): Promise<string> {
    const result = await login(account, password);
    expect(result.errors).toBeUndefined();
    const token = (result.data as LoginData | null)?.login.accessToken;
    if (!token) {
      throw new Error("login 沒有回 accessToken");
    }
    return token;
  }

  describe("login", () => {
    it("帳密正確:body 回 access token(aud=admin、只含 userId 與當前組織 id),refresh token 以 httpOnly cookie 回傳", async () => {
      const result = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);

      expect(result.errors).toBeUndefined();
      const accessToken = (result.data as LoginData | null)?.login.accessToken;
      expect(typeof accessToken).toBe("string");

      const payload = decodeJwtPayload(accessToken ?? "");
      expect(payload.aud).toBe("admin");
      expect(typeof payload.sub).toBe("string");
      expect(typeof payload.orgId).toBe("string");
      // payload 只含 userId 與當前組織 id(加上 JWT 標準欄位),不夾帶其他個資
      const customClaims = Object.keys(payload).filter(
        (key) => !["aud", "exp", "iat"].includes(key),
      );
      expect(customClaims).toHaveLength(2);
      expect(customClaims).toEqual(expect.arrayContaining(["orgId", "sub"]));

      const refreshCookie = result.setCookies.find((line) =>
        line.startsWith(`${REFRESH_COOKIE_NAME}=`),
      );
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/Secure/i);
      expect(refreshCookie).toMatch(/SameSite=Lax/i);
      expect(refreshCookie).toMatch(/Path=\/graphql/);
      // 本地不設 COOKIE_DOMAIN → 不帶 Domain 屬性
      expect(refreshCookie).not.toMatch(/Domain=/i);
    });

    it("帳號不存在與密碼錯誤回同一個 INVALID_CREDENTIALS(不可枚舉帳號),且不發 cookie", async () => {
      const unknownAccount = await login("no-such-account", PASSWORD);
      const wrongPassword = await login(ROOT_ADMIN.account, "wrong-password");

      expect(unknownAccount.errors?.[0]?.extensions?.code).toBe(
        "INVALID_CREDENTIALS",
      );
      expect(wrongPassword.errors?.[0]?.extensions?.code).toBe(
        "INVALID_CREDENTIALS",
      );
      expect(unknownAccount.errors?.[0]?.message).toBe(
        wrongPassword.errors?.[0]?.message,
      );
      expect(unknownAccount.data).toBeNull();
      expect(unknownAccount.setCookies).toEqual([]);
      expect(wrongPassword.setCookies).toEqual([]);
    });

    it("停用帳號即使密碼正確也被拒:ACCOUNT_DISABLED", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      await createUser(api.connection, {
        account: "disabled-user",
        password: PASSWORD,
        enabled: false,
        orgIds: [rootOrgId],
      });

      const result = await login("disabled-user", PASSWORD);
      expect(result.errors?.[0]?.extensions?.code).toBe("ACCOUNT_DISABLED");
      expect(result.setCookies).toEqual([]);
    });

    it("同帳號連續 5 次失敗 → 第 6 次(即使密碼正確)TOO_MANY_ATTEMPTS;1 分鐘後可再試", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      await createUser(api.connection, {
        account: "throttled-user",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const start = Date.now();
      travelTo(start);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const failed = await login("throttled-user", "wrong-password");
        expect(failed.errors?.[0]?.extensions?.code).toBe(
          "INVALID_CREDENTIALS",
        );
      }
      const locked = await login("throttled-user", PASSWORD);
      expect(locked.errors?.[0]?.extensions?.code).toBe("TOO_MANY_ATTEMPTS");

      // 其他帳號不受影響
      const other = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);
      expect(other.errors).toBeUndefined();

      travelTo(start + 61_000);
      const afterLock = await login("throttled-user", PASSWORD);
      expect(afterLock.errors).toBeUndefined();
    });
  });

  describe("登入守門(全域 guard)", () => {
    it("未標 @Public() 的 query 沒帶 token → UNAUTHENTICATED;帶有效 token 才通過", async () => {
      const anonymous = await api.graphql<MeData>(ME);
      expect(anonymous.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
      expect(anonymous.data).toBeNull();

      const accessToken = await loginAccessToken(
        ROOT_ADMIN.account,
        ROOT_ADMIN.password,
      );
      const authenticated = await api.graphql<MeData>(ME, {}, { accessToken });
      expect(authenticated.errors).toBeUndefined();
      expect(authenticated.data?.me.account).toBe(ROOT_ADMIN.account);
    });

    it("會員(aud=front)的 token 打後台 API 一律拒:UNAUTHENTICATED", async () => {
      const rootAdmin = await api.connection
        .collection("users")
        .findOne<{ _id: Types.ObjectId }>({ account: ROOT_ADMIN.account });
      const frontToken = signJwt({}, TEST_JWT_SECRET, {
        algorithm: "HS256",
        audience: "front",
        subject: String(rootAdmin?._id),
        expiresIn: "15m",
      });

      const result = await api.graphql<MeData>(
        ME,
        {},
        { accessToken: frontToken },
      );
      expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    });

    it("停用後既有 access token 的下一請求即 ACCOUNT_DISABLED(每請求現查、不快取)", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      const userId = await createUser(api.connection, {
        account: "soon-disabled",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const accessToken = await loginAccessToken("soon-disabled", PASSWORD);
      const before = await api.graphql<MeData>(ME, {}, { accessToken });
      expect(before.errors).toBeUndefined();

      await setUserEnabled(api.connection, userId, false);

      const after = await api.graphql<MeData>(ME, {}, { accessToken });
      expect(after.errors?.[0]?.extensions?.code).toBe("ACCOUNT_DISABLED");
    });

    it("標 @Public() 的 query 沒帶 token 也通過(測試專用探針,不進正式 schema)", async () => {
      const result = await api.graphql(/* GraphQL */ `
        query {
          publicProbe
        }
      `);
      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({ publicProbe: true });
    });
  });

  describe("me", () => {
    it("回傳基本資料(不含 passwordHash / nationalId)、mustChangePassword、當前組織(= 所屬組織依加入時間第一個)、所屬組織清單", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      const tenantA = await createOrg(api.connection, { name: "租戶 A" });
      const tenantB = await createOrg(api.connection, { name: "租戶 B" });
      await createUser(api.connection, {
        account: "two-org-user",
        password: PASSWORD,
        orgIds: [tenantB, tenantA],
        settings: { mustChangePassword: true },
        nationalId: "A123456789",
      });
      const accessToken = await loginAccessToken("two-org-user", PASSWORD);

      const result = await api.graphql<MeData>(ME, {}, { accessToken });
      expect(result.errors).toBeUndefined();
      expect(result.data?.me).toMatchObject({
        account: "two-org-user",
        name: "two-org-user",
        email: "two-org-user@example.com",
        mustChangePassword: true,
        currentOrg: { id: String(tenantB), name: "租戶 B" },
      });
      expect(result.data?.me.orgs.map((org) => org.id)).toEqual([
        String(tenantB),
        String(tenantA),
      ]);
      expect(result.data?.me.orgs.map((org) => org.id)).not.toContain(
        String(rootOrgId),
      );

      // schema 層就沒有這兩個欄位:查了會被 GraphQL 驗證擋下
      const leak = await api.graphql(
        /* GraphQL */ `
          query {
            me {
              passwordHash
            }
          }
        `,
        {},
        { accessToken },
      );
      expect(leak.errors?.[0]?.message).toMatch(/passwordHash/);
      const leakNationalId = await api.graphql(
        /* GraphQL */ `
          query {
            me {
              nationalId
            }
          }
        `,
        {},
        { accessToken },
      );
      expect(leakNationalId.errors?.[0]?.message).toMatch(/nationalId/);
    });

    it("root 帳號的當前組織是根組織,mustChangePassword 預設 false", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      const orgs = api.connection.collection("orgs");
      // 根組織名稱是各專案 seed 的值:以測試資料庫的實際名稱為準,不寫死品牌
      const seededRoot = await orgs.findOne<{ name: string }>({
        _id: rootOrgId,
      });
      const seededName = seededRoot?.name;
      expect(typeof seededName).toBe("string");
      expect(seededName).not.toBe("");

      const accessToken = await loginAccessToken(
        ROOT_ADMIN.account,
        ROOT_ADMIN.password,
      );
      const result = await api.graphql<MeData>(ME, {}, { accessToken });
      expect(result.errors).toBeUndefined();
      expect(result.data?.me.currentOrg).toEqual({
        id: String(rootOrgId),
        name: seededName,
      });
      expect(result.data?.me.mustChangePassword).toBe(false);
      expect(result.data?.me.orgs).toEqual([
        { id: String(rootOrgId), name: seededName },
      ]);

      // 換成測試專用名稱後 me 跟著變:回傳的是資料庫現值,不依賴任何專案的 seed 名稱
      const neutralName = "測試根組織";
      await orgs.updateOne({ _id: rootOrgId }, { $set: { name: neutralName } });
      try {
        const renamed = await api.graphql<MeData>(ME, {}, { accessToken });
        expect(renamed.errors).toBeUndefined();
        expect(renamed.data?.me.currentOrg).toEqual({
          id: String(rootOrgId),
          name: neutralName,
        });
        expect(renamed.data?.me.orgs).toEqual([
          { id: String(rootOrgId), name: neutralName },
        ]);
      } finally {
        await orgs.updateOne(
          { _id: rootOrgId },
          { $set: { name: seededName } },
        );
      }
    });
  });

  describe("refresh(每次使用即輪替)", () => {
    it("帶 refresh cookie 換到新 access token 與新 cookie;舊 cookie 再用 → 視為外洩,該帳號全部 refresh 作廢", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      await createUser(api.connection, {
        account: "rotate-user",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const first = await login("rotate-user", PASSWORD);
      const firstCookie = cookiePair(first.setCookies, REFRESH_COOKIE_NAME);
      expect(firstCookie).toBeDefined();

      const rotated = await api.graphql<RefreshData>(
        REFRESH,
        {},
        { cookie: firstCookie },
      );
      expect(rotated.errors).toBeUndefined();
      expect(typeof rotated.data?.refresh.accessToken).toBe("string");
      const secondCookie = cookiePair(rotated.setCookies, REFRESH_COOKIE_NAME);
      expect(secondCookie).toBeDefined();
      expect(secondCookie).not.toBe(firstCookie);

      // 新 access token 可用
      const me = await api.graphql<MeData>(
        ME,
        {},
        { accessToken: rotated.data?.refresh.accessToken },
      );
      expect(me.errors).toBeUndefined();

      // 舊 cookie 重用 → 拒,並且連新 cookie 也一併作廢
      const reused = await api.graphql<RefreshData>(
        REFRESH,
        {},
        { cookie: firstCookie },
      );
      expect(reused.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
      const afterLeak = await api.graphql<RefreshData>(
        REFRESH,
        {},
        { cookie: secondCookie },
      );
      expect(afterLeak.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    });

    it("沒有 cookie 或 cookie 不對 → UNAUTHENTICATED;refresh 逾期(30 天)→ TOKEN_EXPIRED", async () => {
      const noCookie = await api.graphql<RefreshData>(REFRESH);
      expect(noCookie.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");

      const bogus = await api.graphql<RefreshData>(
        REFRESH,
        {},
        { cookie: `${REFRESH_COOKIE_NAME}=not-a-real-token` },
      );
      expect(bogus.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");

      const start = Date.now();
      travelTo(start);
      const session = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);
      const cookie = cookiePair(session.setCookies, REFRESH_COOKIE_NAME);

      travelTo(start + 31 * 24 * 60 * 60 * 1000);
      const expired = await api.graphql<RefreshData>(REFRESH, {}, { cookie });
      expect(expired.errors?.[0]?.extensions?.code).toBe("TOKEN_EXPIRED");
    });

    it("使用者被停用後 refresh 也被拒:ACCOUNT_DISABLED", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      const userId = await createUser(api.connection, {
        account: "disabled-before-refresh",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const session = await login("disabled-before-refresh", PASSWORD);
      const cookie = cookiePair(session.setCookies, REFRESH_COOKIE_NAME);
      await setUserEnabled(api.connection, userId, false);

      const result = await api.graphql<RefreshData>(REFRESH, {}, { cookie });
      expect(result.errors?.[0]?.extensions?.code).toBe("ACCOUNT_DISABLED");
    });
  });

  describe("logout / logoutAllDevices", () => {
    it("logout 作廢當前 refresh(cookie 被清除、再 refresh 被拒),其他裝置的 session 不受影響", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      await createUser(api.connection, {
        account: "logout-user",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const deviceA = await login("logout-user", PASSWORD);
      const deviceB = await login("logout-user", PASSWORD);
      const cookieA = cookiePair(deviceA.setCookies, REFRESH_COOKIE_NAME);
      const cookieB = cookiePair(deviceB.setCookies, REFRESH_COOKIE_NAME);

      const result = await api.graphql<LogoutData>(
        LOGOUT,
        {},
        {
          accessToken: (deviceA.data as LoginData | null)?.login.accessToken,
          cookie: cookieA,
        },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.logout.success).toBe(true);
      const clearing = result.setCookies.find((line) =>
        line.startsWith(`${REFRESH_COOKIE_NAME}=`),
      );
      expect(clearing).toMatch(/Expires=Thu, 01 Jan 1970/i);

      const refreshA = await api.graphql<RefreshData>(
        REFRESH,
        {},
        { cookie: cookieA },
      );
      expect(refreshA.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
      const refreshB = await api.graphql<RefreshData>(
        REFRESH,
        {},
        { cookie: cookieB },
      );
      expect(refreshB.errors).toBeUndefined();
    });

    it("logoutAllDevices 作廢該帳號全部 refresh", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      await createUser(api.connection, {
        account: "logout-all-user",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const deviceA = await login("logout-all-user", PASSWORD);
      const deviceB = await login("logout-all-user", PASSWORD);
      const cookieA = cookiePair(deviceA.setCookies, REFRESH_COOKIE_NAME);
      const cookieB = cookiePair(deviceB.setCookies, REFRESH_COOKIE_NAME);

      const result = await api.graphql<LogoutAllData>(
        LOGOUT_ALL_DEVICES,
        {},
        {
          accessToken: (deviceA.data as LoginData | null)?.login.accessToken,
          cookie: cookieA,
        },
      );
      expect(result.errors).toBeUndefined();
      expect(result.data?.logoutAllDevices.success).toBe(true);

      for (const cookie of [cookieA, cookieB]) {
        const refresh = await api.graphql<RefreshData>(REFRESH, {}, { cookie });
        expect(refresh.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
      }
    });

    it("logout / logoutAllDevices 要求已登入(沒 access token → UNAUTHENTICATED)", async () => {
      const logout = await api.graphql<LogoutData>(LOGOUT);
      expect(logout.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
      const logoutAll = await api.graphql<LogoutAllData>(LOGOUT_ALL_DEVICES);
      expect(logoutAll.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("switchOrg", () => {
    it("在所屬組織範圍內換發 access token(當前組織改變,refresh 後仍保持);範圍外 → FORBIDDEN", async () => {
      const tenantA = await createOrg(api.connection, { name: "切換 A" });
      const tenantB = await createOrg(api.connection, { name: "切換 B" });
      const tenantC = await createOrg(api.connection, {
        name: "切換 C(非所屬)",
      });
      await createUser(api.connection, {
        account: "switch-user",
        password: PASSWORD,
        orgIds: [tenantA, tenantB],
      });
      const session = await login("switch-user", PASSWORD);
      const accessToken = (session.data as LoginData | null)?.login.accessToken;
      const cookie = cookiePair(session.setCookies, REFRESH_COOKIE_NAME);
      expect(decodeJwtPayload(accessToken ?? "").orgId).toBe(String(tenantA));

      const switched = await api.graphql<SwitchOrgData>(
        SWITCH_ORG,
        { input: { orgId: String(tenantB) } },
        { accessToken, cookie },
      );
      expect(switched.errors).toBeUndefined();
      const switchedToken = switched.data?.switchOrg.accessToken ?? "";
      expect(decodeJwtPayload(switchedToken).orgId).toBe(String(tenantB));

      const me = await api.graphql<MeData>(
        ME,
        {},
        { accessToken: switchedToken },
      );
      expect(me.data?.me.currentOrg?.id).toBe(String(tenantB));

      // refresh 換到的新 access token 仍是切換後的組織
      const rotated = await api.graphql<RefreshData>(REFRESH, {}, { cookie });
      expect(rotated.errors).toBeUndefined();
      expect(
        decodeJwtPayload(rotated.data?.refresh.accessToken ?? "").orgId,
      ).toBe(String(tenantB));

      const outside = await api.graphql<SwitchOrgData>(
        SWITCH_ORG,
        { input: { orgId: String(tenantC) } },
        { accessToken: switchedToken },
      );
      expect(outside.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    });
  });

  describe("操作者上下文(guard 的產物;規則 ADR-0005)", () => {
    it('可見範圍:根組織成員 → "all";租戶成員 = 所屬組織聯集;租戶頂層 visibility=subtree 時含其整棵下層', async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      const rootMember = await createUser(api.connection, {
        account: "ctx-root-member",
        password: PASSWORD,
        orgIds: [rootOrgId],
      });
      const ownTenant = await createOrg(api.connection, { name: "own 租戶" });
      const ownChild = await createOrg(api.connection, {
        name: "own 租戶的部門",
        parentId: ownTenant,
      });
      const subtreeTenant = await createOrg(api.connection, {
        name: "subtree 租戶",
        settings: { visibility: "subtree" },
      });
      const subtreeChild = await createOrg(api.connection, {
        name: "subtree 租戶的部門",
        parentId: subtreeTenant,
      });
      const subtreeGrandchild = await createOrg(api.connection, {
        name: "subtree 租戶的小組",
        parentId: subtreeChild,
      });
      const tenantMember = await createUser(api.connection, {
        account: "ctx-tenant-member",
        password: PASSWORD,
        orgIds: [ownTenant, subtreeChild],
      });

      const service = api.app.get(OperatorContextService);
      const asRoot = await service.resolve(rootMember, null);
      expect(asRoot.operator).toEqual({
        actorId: rootMember,
        currentOrgId: rootOrgId,
        visibleOrgIds: "all",
        // 這個人沒有任何角色 → 管理範圍是空的(所屬哪裡不給管理範圍,ADR-0003)
        managedOrgIds: [],
        // 資料範圍規則的比對來源(ADR-0008):所屬組織是 org_user 的直接關聯
        memberOrgIds: [rootOrgId],
        roleIds: [],
        // 資料共用的比對來源(ADR-0014):根組織沒有上層、不屬於任何租戶
        memberTenants: [],
      });

      const asTenant = await service.resolve(tenantMember, null);
      expect(asTenant.operator.actorId).toEqual(tenantMember);
      expect(asTenant.operator.currentOrgId).toEqual(ownTenant);
      const visible = (asTenant.operator.visibleOrgIds as Types.ObjectId[]).map(
        String,
      );
      // own 租戶:只有自己,不含部門;subtree 租戶的部門:含自己與其下層小組,不含租戶頂層本身
      expect(visible).toHaveLength(3);
      expect(visible).toEqual(
        expect.arrayContaining([
          String(ownTenant),
          String(subtreeChild),
          String(subtreeGrandchild),
        ]),
      );
      expect(visible).not.toContain(String(ownChild));
      expect(visible).not.toContain(String(subtreeTenant));
      // 管理範圍由角色決定,與所屬組織無關:這個人沒有角色 → 空
      expect(asTenant.operator.managedOrgIds).toEqual([]);
      // 資料共用(ADR-0014):所屬組織依租戶分組,各帶上層鏈(去掉根組織、不含自己),不隨可見性開關展開
      const tenants = asTenant.operator.memberTenants.map((tenant) => ({
        tenantId: String(tenant.tenantId),
        memberOrgIds: tenant.memberOrgIds.map(String),
        ancestorOrgIds: tenant.ancestorOrgIds.map(String),
      }));
      expect(tenants).toHaveLength(2);
      expect(tenants).toEqual(
        expect.arrayContaining([
          {
            tenantId: String(ownTenant),
            memberOrgIds: [String(ownTenant)],
            ancestorOrgIds: [],
          },
          {
            tenantId: String(subtreeTenant),
            memberOrgIds: [String(subtreeChild)],
            ancestorOrgIds: [String(subtreeTenant)],
          },
        ]),
      );
    });

    it("管理範圍:持有的啟用中角色之擁有組織子樹的聯集;與所屬組織、可見性開關都無關(ADR-0003)", async () => {
      const tenant = await createOrg(api.connection, { name: "managed 租戶" });
      const deptOne = await createOrg(api.connection, {
        name: "managed 部門一",
        parentId: tenant,
      });
      const teamOne = await createOrg(api.connection, {
        name: "managed 小組一",
        parentId: deptOne,
      });
      const deptTwo = await createOrg(api.connection, {
        name: "managed 部門二",
        parentId: tenant,
      });
      // 所屬組織刻意只有小組一 — 管理範圍不該跟著它走
      const userId = await createUser(api.connection, {
        account: "ctx-managed",
        password: PASSWORD,
        orgIds: [teamOne],
      });
      const deptOneRoleId = await createRole(api.app, api.connection, {
        name: "managed 部門一 管理員",
        ownerOrgId: deptOne,
        assignTo: [userId],
      });
      await createRole(api.app, api.connection, {
        name: "managed 部門二 管理員",
        ownerOrgId: deptTwo,
        assignTo: [userId],
      });

      const service = api.app.get(OperatorContextService);
      const managedOf = async (): Promise<string[]> => {
        const { operator } = await service.resolve(userId, null);
        return (operator.managedOrgIds as Types.ObjectId[]).map(String);
      };

      // 兩個角色 → 兩棵子樹的聯集;租戶頂層不是任一擁有組織,不在範圍內
      const bothRoles = await managedOf();
      expect(new Set(bothRoles)).toEqual(
        new Set([String(deptOne), String(teamOne), String(deptTwo)]),
      );

      // 停用其中一個角色 → 它那棵子樹整個退出管理範圍
      await setRoleEnabled(api.connection, deptOneRoleId, false);
      const oneRole = await managedOf();
      expect(oneRole).toEqual([String(deptTwo)]);
      await setRoleEnabled(api.connection, deptOneRoleId, true);
    });

    it("擁有組織是根組織的角色 → 管理範圍是全部(不列舉 id)", async () => {
      const rootOrgId = await findRootOrgId(api.connection);
      const userId = await createUser(api.connection, {
        account: "ctx-managed-root",
        password: PASSWORD,
        orgIds: [
          await createOrg(api.connection, { name: "managed root 租戶" }),
        ],
      });
      await createRole(api.app, api.connection, {
        name: "根組織 管理員",
        ownerOrgId: rootOrgId,
        assignTo: [userId],
      });

      const { operator } = await api.app
        .get(OperatorContextService)
        .resolve(userId, null);
      expect(operator.managedOrgIds).toBe("all");
    });

    it("側欄商標:自己沒設就沿 ancestors 由近到遠繼承最近有商標的上層(ADR-0010)", async () => {
      const tenant = await createOrg(api.connection, {
        name: "有商標的租戶",
      });
      const dept = await createOrg(api.connection, {
        name: "沒商標的部門",
        parentId: tenant,
      });
      const team = await createOrg(api.connection, {
        name: "沒商標的小組",
        parentId: dept,
      });
      const ownLogoOrg = await createOrg(api.connection, {
        name: "自己有商標的部門",
        parentId: tenant,
      });
      await api.connection
        .collection("orgs")
        .updateOne({ _id: tenant }, { $set: { logoPath: TENANT_LOGO_PATH } });
      await api.connection
        .collection("orgs")
        .updateOne({ _id: ownLogoOrg }, { $set: { logoPath: OWN_LOGO_PATH } });

      const userId = await createUser(api.connection, {
        account: "ctx-logo-inherit",
        password: PASSWORD,
        orgIds: [team, ownLogoOrg, tenant],
      });

      const { memberOrgs } = await api.app
        .get(OperatorContextService)
        .resolve(userId, null);
      const logoOf = (orgId: Types.ObjectId): string | undefined =>
        memberOrgs.find((org) => org.id.equals(orgId))?.logoPath;

      // 隔兩層也繼承得到;自己有的優先於繼承;有商標的那一層回自己的
      expect(logoOf(team)).toBe(TENANT_LOGO_PATH);
      expect(logoOf(ownLogoOrg)).toBe(OWN_LOGO_PATH);
      expect(logoOf(tenant)).toBe(TENANT_LOGO_PATH);
    });
  });
});
