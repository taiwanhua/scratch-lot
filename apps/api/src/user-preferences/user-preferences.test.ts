import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg, createUser } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const MY_PREFERENCES = /* GraphQL */ `
  query MyPreferences {
    myPreferences {
      settings
    }
  }
`;

const UPDATE_MY_PREFERENCES = /* GraphQL */ `
  mutation UpdateMyPreferences($input: UpdateMyPreferencesInput!) {
    updateMyPreferences(input: $input) {
      settings
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

interface SettingsData {
  myPreferences?: { settings: Record<string, unknown> };
  updateMyPreferences?: { settings: Record<string, unknown> };
}

/** 沒有任何角色的使用者(個人設定不分配給角色:沒有權限也能讀寫自己的偏好)。 */
const PLAIN_USER = {
  account: "pref-plain",
  password: ["pref", "secret", "123"].join("-"),
};

describe("個人偏好 user_preferences(規格 10.6)", () => {
  let api: AuthTestApp;

  /** 每次登入都是一個新的 session(= 另一台裝置)。 */
  async function login(account: string, password: string): Promise<string> {
    const result = await api.graphql<LoginData>(LOGIN, {
      input: { account, password },
    });
    expect(result.errors).toBeUndefined();
    const token = result.data?.login.accessToken;
    if (!token) {
      throw new Error("login 沒有回 accessToken");
    }
    return token;
  }

  async function read(token: string): Promise<Record<string, unknown>> {
    const result = await api.graphql<SettingsData>(
      MY_PREFERENCES,
      {},
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    const settings = result.data?.myPreferences?.settings;
    if (!settings) {
      throw new Error("myPreferences 沒有回 settings");
    }
    return settings;
  }

  function update(token: string, settings: Record<string, unknown>) {
    return api.graphql<SettingsData>(
      UPDATE_MY_PREFERENCES,
      { input: { settings } },
      { accessToken: token },
    );
  }

  /** 寫入且必須成功。 */
  async function save(token: string, settings: Record<string, unknown>) {
    const result = await update(token, settings);
    expect(result.errors).toBeUndefined();
    return result.data?.updateMyPreferences?.settings;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-user-preferences");
    const orgId = await createOrg(api.connection, { name: "偏好測試組織" });
    await createUser(api.connection, { ...PLAIN_USER, orgIds: [orgId] });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("新帳號沒有語言設定:locale 為 null(前端改用本機快取並寫回)", async () => {
    const token = await login(PLAIN_USER.account, PLAIN_USER.password);
    expect(await read(token)).toEqual({ locale: null });
  });

  it("A 裝置改語言 → B 裝置登入後讀到新語言", async () => {
    const deviceA = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);
    expect(await save(deviceA, { locale: "en" })).toEqual({ locale: "en" });

    const deviceB = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);
    expect(await read(deviceB)).toEqual({ locale: "en" });
  });

  it("每個使用者一筆、只讀寫自己的:別人的設定不受影響", async () => {
    const root = await login(ROOT_ADMIN.account, ROOT_ADMIN.password);
    const plain = await login(PLAIN_USER.account, PLAIN_USER.password);
    await save(plain, { locale: "zh-TW" });
    await save(root, { locale: "en" });

    expect(await read(plain)).toEqual({ locale: "zh-TW" });
    expect(await read(root)).toEqual({ locale: "en" });
    const rows = await api.connection
      .collection("user_preferences")
      .countDocuments({});
    expect(rows).toBe(2);
  });

  it("值 null = 拿掉、回到預設", async () => {
    const token = await login(PLAIN_USER.account, PLAIN_USER.password);
    await save(token, { locale: "en" });
    expect(await save(token, { locale: null })).toEqual({ locale: null });
  });

  it("未登記的 key 寫入 → VALIDATION_FAILED(reason UNKNOWN_KEY),整筆不寫", async () => {
    const token = await login(PLAIN_USER.account, PLAIN_USER.password);
    await save(token, { locale: "zh-TW" });

    const result = await update(token, { locale: "en", density: "compact" });
    expect(result.errors?.[0]?.extensions).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "UNKNOWN_KEY",
      key: "density",
    });
    // 同一筆裡合法的 locale 也沒有寫進去
    expect(await read(token)).toEqual({ locale: "zh-TW" });
  });

  it("值不合登記的型別 → VALIDATION_FAILED(reason INVALID_VALUE)", async () => {
    const token = await login(PLAIN_USER.account, PLAIN_USER.password);
    for (const locale of [true, 42, "not a locale!", "x".repeat(40)]) {
      const result = await update(token, { locale });
      expect(result.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "INVALID_VALUE",
        key: "locale",
      });
    }
  });

  it("沒登入 → UNAUTHENTICATED", async () => {
    const result = await api.graphql<SettingsData>(MY_PREFERENCES);
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });
});
