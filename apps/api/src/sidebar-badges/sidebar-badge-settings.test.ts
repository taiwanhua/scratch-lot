import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Types } from "mongoose";

import type { Audience } from "@repo/domain/audience";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg } from "../auth/test-support/fixtures";
import { call, ok, rootToken } from "../forms/test-support/form-fixtures";
import { createRole } from "../permission/test-support/fixtures";
import {
  type Person,
  WORKFLOW_MODULE,
  WORKFLOW_TEST_TIMEOUT_MS,
  person,
} from "../workflows/test-support/workflow-fixtures";
import {
  PROBE_BADGE_COUNT,
  ProbeBadgesModule,
} from "./test-support/probe-badges.module";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const SIDEBAR_BADGES = /* GraphQL */ `
  query SidebarBadges {
    sidebarBadges {
      moduleKey
      count
    }
  }
`;

const SETTINGS = /* GraphQL */ `
  query SidebarBadgeSettings {
    sidebarBadgeSettings {
      totalCount
      items {
        moduleKey
        moduleName
        descriptionKey
        requires
        audience
        isDefault
        updatedAt
        updatedBy
      }
    }
  }
`;

const UPDATE = /* GraphQL */ `
  mutation UpdateSidebarBadgeSetting($input: UpdateSidebarBadgeSettingInput!) {
    updateSidebarBadgeSetting(input: $input) {
      setting {
        moduleKey
        audience
        isDefault
      }
    }
  }
`;

const RESET = /* GraphQL */ `
  mutation ResetSidebarBadgeSetting($input: ResetSidebarBadgeSettingInput!) {
    resetSidebarBadgeSetting(input: $input) {
      setting {
        moduleKey
        audience
        isDefault
      }
    }
  }
`;

const APPLY_CENTER = "apply-center";
const SETTINGS_PERMISSIONS = [
  "system.notification-settings.view",
  "system.notification-settings.edit",
];
const SETTINGS_MODULES = ["system", "system.notification-settings"];

interface SettingItem {
  moduleKey: string;
  moduleName: string;
  descriptionKey: string | null;
  requires: string | null;
  audience: Audience | null;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

function roleAudience(roleId: Types.ObjectId): Audience {
  return {
    mode: "match",
    filter: {
      field: "role",
      cond: "in",
      value: { kind: "static", values: [String(roleId)] },
    },
  };
}

describe("側欄數字的人員條件(sidebarBadgeSettings)", () => {
  let api: AuthTestApp;
  let tenantA: Types.ObjectId;
  let tenantB: Types.ObjectId;
  /** 租戶 A 的通知設定管理者(綁了通知設定、有 view / edit) */
  let settingsAdmin: Person;
  /** 租戶 A:只綁了探針模組(`demo.form`)、不是角色 A */
  let boundOnly: Person;
  /** 租戶 A:綁了探針模組、另外持有角色 A */
  let roleAMember: Person;
  let roleA: Types.ObjectId;
  /** 租戶 A:持有角色 A,但沒綁探針模組 */
  let roleAUnbound: Person;
  /** 租戶 B:綁了探針模組 */
  let otherTenantMember: Person;
  let otherTenantAdmin: Person;
  let otherTenantRole: Types.ObjectId;

  async function badgesOf(who: Person): Promise<Record<string, number>> {
    const data = await ok<{
      sidebarBadges: { moduleKey: string; count: number }[];
    }>(api, who.token, SIDEBAR_BADGES);
    return Object.fromEntries(
      data.sidebarBadges.map((badge) => [badge.moduleKey, badge.count]),
    );
  }

  async function settingsOf(token: string): Promise<SettingItem[]> {
    const data = await ok<{
      sidebarBadgeSettings: { items: SettingItem[]; totalCount: number };
    }>(api, token, SETTINGS);
    expect(data.sidebarBadgeSettings.totalCount).toBe(
      data.sidebarBadgeSettings.items.length,
    );
    return data.sidebarBadgeSettings.items;
  }

  async function errorOf(
    token: string,
    query: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const result = await call(api, token, query, { input });
    return result.errors?.[0]?.extensions;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("sidebar_badge_settings", {}, [
      ProbeBadgesModule,
    ]);
    const { connection } = api;
    tenantA = await createOrg(connection, { name: "側欄租戶 A" });
    tenantB = await createOrg(connection, { name: "側欄租戶 B" });
    settingsAdmin = await person(api, connection, tenantA, tenantA, {
      moduleKeys: SETTINGS_MODULES,
      permissionKeys: SETTINGS_PERMISSIONS,
    });
    boundOnly = await person(api, connection, tenantA, tenantA, {
      moduleKeys: [WORKFLOW_MODULE, APPLY_CENTER],
      permissionKeys: [],
    });
    roleAMember = await person(api, connection, tenantA, tenantA, {
      moduleKeys: [WORKFLOW_MODULE, APPLY_CENTER],
      permissionKeys: [],
    });
    roleAUnbound = await person(api, connection, tenantA, tenantA, {
      moduleKeys: [APPLY_CENTER],
      permissionKeys: [],
    });
    roleA = await createRole(api.app, connection, {
      name: "角色 A",
      ownerOrgId: tenantA,
      assignTo: [roleAMember.userId, roleAUnbound.userId],
    });
    otherTenantMember = await person(api, connection, tenantB, tenantB, {
      moduleKeys: [WORKFLOW_MODULE],
      permissionKeys: [],
    });
    otherTenantAdmin = await person(api, connection, tenantB, tenantB, {
      moduleKeys: SETTINGS_MODULES,
      permissionKeys: SETTINGS_PERMISSIONS,
    });
    otherTenantRole = await createRole(api.app, connection, {
      name: "租戶 B 的角色",
      ownerOrgId: tenantB,
    });
  });

  afterAll(async () => {
    await api.close();
  });

  it("沒覆寫:列出登記的數字(說明 key、預設要求的權限),都是預設;行為同程式登記", async () => {
    const items = await settingsOf(settingsAdmin.token);

    expect(items.map((item) => item.moduleKey)).toEqual(
      expect.arrayContaining([APPLY_CENTER, WORKFLOW_MODULE]),
    );
    expect(items.find((item) => item.moduleKey === APPLY_CENTER)).toEqual({
      moduleKey: APPLY_CENTER,
      moduleName: expect.any(String),
      descriptionKey: "admin.sidebarBadgeSettings.descriptions.apply-center",
      requires: "apply-center.view",
      audience: null,
      isDefault: true,
      updatedAt: null,
      updatedBy: null,
    });
    expect(
      items.find((item) => item.moduleKey === WORKFLOW_MODULE),
    ).toMatchObject({ descriptionKey: null, requires: null, isDefault: true });
    // 綁了模組就算;申請中心登記了 requires,沒有 apply-center.view 就拿不到
    await expect(badgesOf(boundOnly)).resolves.toEqual({
      [WORKFLOW_MODULE]: PROBE_BADGE_COUNT,
    });
    await expect(badgesOf(roleAMember)).resolves.toEqual({
      [WORKFLOW_MODULE]: PROBE_BADGE_COUNT,
    });
  });

  it("覆寫成「角色 A」:綁了模組但不是角色 A 的拿不到,是角色 A 的拿得到;別租戶不受影響", async () => {
    const saved = await ok<{
      updateSidebarBadgeSetting: { setting: SettingItem };
    }>(api, settingsAdmin.token, UPDATE, {
      input: { moduleKey: WORKFLOW_MODULE, audience: roleAudience(roleA) },
    });
    expect(saved.updateSidebarBadgeSetting.setting).toEqual({
      moduleKey: WORKFLOW_MODULE,
      audience: roleAudience(roleA),
      isDefault: false,
    });

    await expect(badgesOf(boundOnly)).resolves.toEqual({});
    await expect(badgesOf(roleAMember)).resolves.toEqual({
      [WORKFLOW_MODULE]: PROBE_BADGE_COUNT,
    });
    // 租戶隔離:租戶 B 沒有覆寫,照程式預設
    await expect(badgesOf(otherTenantMember)).resolves.toEqual({
      [WORKFLOW_MODULE]: PROBE_BADGE_COUNT,
    });
    const otherItems = await settingsOf(otherTenantAdmin.token);
    expect(
      otherItems.find((item) => item.moduleKey === WORKFLOW_MODULE),
    ).toMatchObject({ isDefault: true, audience: null });
    const own = await settingsOf(settingsAdmin.token);
    expect(
      own.find((item) => item.moduleKey === WORKFLOW_MODULE),
    ).toMatchObject({
      isDefault: false,
      audience: roleAudience(roleA),
      updatedBy: String(settingsAdmin.userId),
    });
  });

  it("綁了模組仍是前提:沒綁探針模組的角色 A 成員拿不到", async () => {
    await ok(api, settingsAdmin.token, UPDATE, {
      input: { moduleKey: WORKFLOW_MODULE, audience: roleAudience(roleA) },
    });
    await expect(badgesOf(roleAUnbound)).resolves.toEqual({});
  });

  it("覆寫取代登記的 requires:申請中心改成角色 A 後,沒有 apply-center.view 的角色 A 成員也拿得到", async () => {
    await ok(api, settingsAdmin.token, UPDATE, {
      input: { moduleKey: APPLY_CENTER, audience: roleAudience(roleA) },
    });

    await expect(badgesOf(roleAMember)).resolves.toMatchObject({
      [APPLY_CENTER]: 0,
    });
    await expect(badgesOf(boundOnly)).resolves.toEqual({});

    await ok(api, settingsAdmin.token, RESET, {
      input: { moduleKey: APPLY_CENTER },
    });
    await expect(badgesOf(roleAMember)).resolves.not.toHaveProperty(
      APPLY_CENTER,
    );
  });

  it("還原預設:回到程式預設(綁了模組就算)", async () => {
    const reset = await ok<{
      resetSidebarBadgeSetting: { setting: SettingItem };
    }>(api, settingsAdmin.token, RESET, {
      input: { moduleKey: WORKFLOW_MODULE },
    });
    expect(reset.resetSidebarBadgeSetting.setting).toEqual({
      moduleKey: WORKFLOW_MODULE,
      audience: null,
      isDefault: true,
    });

    await expect(badgesOf(boundOnly)).resolves.toEqual({
      [WORKFLOW_MODULE]: PROBE_BADGE_COUNT,
    });
    const items = await settingsOf(settingsAdmin.token);
    expect(
      items.find((item) => item.moduleKey === WORKFLOW_MODULE),
    ).toMatchObject({ isDefault: true, audience: null });
  });

  it("擋下:格式不對、別租戶的角色、沒登記的模組、站在根組織、沒有 edit", async () => {
    await expect(
      errorOf(settingsAdmin.token, UPDATE, {
        moduleKey: WORKFLOW_MODULE,
        audience: { mode: "all" },
      }),
    ).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "AUDIENCE_INVALID",
      moduleKey: WORKFLOW_MODULE,
    });
    await expect(
      errorOf(settingsAdmin.token, UPDATE, {
        moduleKey: WORKFLOW_MODULE,
        audience: roleAudience(otherTenantRole),
      }),
    ).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "OUT_OF_TENANT",
      path: "filter.value.values[0]",
    });
    await expect(
      errorOf(settingsAdmin.token, RESET, { moduleKey: "no.such-module" }),
    ).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "UNKNOWN_BADGE",
    });

    const root = await rootToken(api);
    await expect(
      errorOf(root, RESET, { moduleKey: WORKFLOW_MODULE }),
    ).resolves.toMatchObject({ code: "FORBIDDEN", reason: "TENANT_ONLY" });
    // 根組織看得到全部登記(唯讀、都是預設)
    const rootItems = await settingsOf(root);
    expect(rootItems.every((item) => item.isDefault)).toBe(true);

    const viewer = await person(api, api.connection, tenantA, tenantA, {
      moduleKeys: SETTINGS_MODULES,
      permissionKeys: ["system.notification-settings.view"],
    });
    await expect(
      errorOf(viewer.token, RESET, { moduleKey: WORKFLOW_MODULE }),
    ).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("只列這個租戶有開通的模組(租戶管理員副本綁的模組);沒開通的不能改", async () => {
    const tenantC = await createOrg(api.connection, { name: "側欄租戶 C" });
    const copy = await createRole(api.app, api.connection, {
      name: "租戶管理員",
      ownerOrgId: tenantC,
      moduleKeys: [...SETTINGS_MODULES, WORKFLOW_MODULE],
    });
    await api.connection
      .collection("roles")
      .updateOne(
        { _id: copy },
        { $set: { "settings.templateKey": "tenant-admin" } },
      );
    const admin = await person(api, api.connection, tenantC, tenantC, {
      moduleKeys: SETTINGS_MODULES,
      permissionKeys: SETTINGS_PERMISSIONS,
    });

    const items = await settingsOf(admin.token);
    expect(items.map((item) => item.moduleKey)).toEqual([WORKFLOW_MODULE]);
    await expect(
      errorOf(admin.token, RESET, { moduleKey: APPLY_CENTER }),
    ).resolves.toMatchObject({ reason: "UNKNOWN_BADGE" });
  });
});
