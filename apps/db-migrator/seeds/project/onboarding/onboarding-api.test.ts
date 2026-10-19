/**
 * 開通腳本與 demo `create` 對**真的 api**(子行程)+ 真 MongoDB 的整合測試(規格 2.2 操作表、3.3、3.4)。
 *
 * - demo 指令以子行程跑入口,機密從標準輸入以管線送入(同 workflow)
 * - 開通腳本只透過 GraphQL 寫:最終狀態一律回資料庫查,操作紀錄的操作者 = 租戶管理員
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Document, ObjectId } from "mongodb";

import {
  type GraphqlClient,
  createGraphqlClient,
  loginAs,
} from "../../../src/demo/graphql-client";
import {
  type ApiServer,
  runDemoEntry,
  startApiServer,
} from "../../../test/support/api-server";
import {
  ROOT_ADMIN_ENV,
  TestMongo,
  withDatabase,
} from "../../../test/support/update-harness";
import { DEMO_TENANT, demoPlan } from "../demo";
import { OnboardingStoppedError, runOnboarding } from "./run-onboarding";
import { STORE_MANAGER_NOTIFICATION_TYPES } from "./steps/notification-recipients";

jest.setTimeout(240_000);

const DEMO_PASSWORD = ["demo", "pass", "word", "7"].join("-");
const EMAIL_BASE = ["owner", "example.test"].join("@");
const SETUP_TIMEOUT_MS = 900_000;

const ROLES = /* GraphQL */ `
  query TestRoles {
    roles(input: { pageSize: 100 }) {
      items {
        id
        name
        kind
        isTemplateCopy
      }
    }
  }
`;

const NOTIFICATION_SETTINGS = /* GraphQL */ `
  query TestNotificationSettings {
    notificationSettings(input: { pageSize: 100 }) {
      items {
        type
        isDefault
        audience
      }
    }
  }
`;

const ROLE_MATRIX = /* GraphQL */ `
  query TestRoleMatrix($roleId: ID!) {
    roleMatrix(roleId: $roleId) {
      granted {
        moduleKeys
        permissionKeys
      }
    }
  }
`;

const SAVE_ROLE_MATRIX = /* GraphQL */ `
  mutation TestSaveRoleMatrix($input: SaveRoleMatrixInput!) {
    saveRoleMatrix(input: $input) {
      granted {
        moduleKeys
      }
    }
  }
`;

interface RoleItem {
  id: string;
  name: string;
  kind: string;
  isTemplateCopy: boolean;
}

interface SettingItem {
  type: string;
  isDefault: boolean;
  audience: { filter?: { field?: string; value?: { values?: string[] } } };
}

describe("開通腳本與 demo create(真 api + 真 MongoDB)", () => {
  const mongo = new TestMongo("onboarding-api");
  let databaseUri: string;
  let databaseName: string;
  let server: ApiServer;
  let api: GraphqlClient;

  function demoArgs(): string[] {
    return [
      "--environment=dev",
      "--mode=create",
      `--confirm=demo:dev:${databaseName}:create`,
      `--api-url=${server.apiUrl}`,
    ];
  }

  function find(collection: string, filter: Document): Promise<Document[]> {
    return withDatabase(databaseUri, (database) =>
      database
        .collection(collection)
        .find({ ...filter })
        .toArray(),
    );
  }

  async function findOne(
    collection: string,
    filter: Document,
  ): Promise<Document> {
    const [document] = await find(collection, filter);
    if (document === undefined) {
      throw new Error(`${collection} 找不到 ${JSON.stringify(filter)}`);
    }
    return document;
  }

  function auditCount(): Promise<number> {
    return withDatabase(databaseUri, (database) =>
      database.collection("audit_logs").countDocuments(),
    );
  }

  function rootClient(): Promise<GraphqlClient> {
    return loginAs(
      api,
      {
        account: ROOT_ADMIN_ENV.ROOT_ADMIN_ACCOUNT,
        password: ROOT_ADMIN_ENV.ROOT_ADMIN_PASSWORD,
      },
      "root",
    );
  }

  beforeAll(async () => {
    await mongo.start();
    databaseUri = mongo.uri("main");
    databaseName = new URL(databaseUri).pathname.slice(1);
    server = await startApiServer(databaseUri);
    api = createGraphqlClient({ apiUrl: server.apiUrl });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await server.stop();
    await mongo.stop();
  });

  describe("demo --mode=create", () => {
    const admin = `owner+${DEMO_TENANT.adminAlias}@example.test`;
    let startedAt: Date;
    let tenantId: ObjectId;
    let adminId: ObjectId;
    let adminClient: GraphqlClient;

    beforeAll(async () => {
      startedAt = new Date();
      const result = await runDemoEntry(demoArgs(), databaseUri, [
        DEMO_PASSWORD,
        EMAIL_BASE,
      ]);
      // 失敗時把 stderr 帶出來看
      expect(result.status === 0 ? "" : result.stderr).toBe("");
      // 輸出不含密碼與真實信箱(連別名形式也不印)
      expect(result.stdout).not.toContain(DEMO_PASSWORD);
      expect(result.stdout).not.toContain("example.test");

      const tenant = await findOne("orgs", { name: DEMO_TENANT.name });
      tenantId = tenant._id as ObjectId;
      const adminRow = await findOne("users", { account: admin });
      adminId = adminRow._id as ObjectId;
      adminClient = await loginAs(
        api,
        { account: admin, password: DEMO_PASSWORD },
        "示範管理員",
      );
    }, SETUP_TIMEOUT_MS);

    it("建立標「示範」的機構與首任租戶管理員(擁有者、密碼可登入、不強改)", async () => {
      const tenant = await findOne("orgs", { _id: tenantId });
      expect(tenant).toMatchObject({
        isDemo: true,
        slug: DEMO_TENANT.slug,
        ownerUserId: adminId,
      });
      const adminRow = await findOne("users", { _id: adminId });
      expect(adminRow.settings).toMatchObject({ mustChangePassword: false });
    });

    it("開通腳本建出整套示範資料:可見性、分店、使用者與所屬、崗位", async () => {
      const tenant = await findOne("orgs", { _id: tenantId });
      expect(tenant.settings).toMatchObject({ visibility: "subtree" });
      const branches = await find("orgs", { parentId: tenantId });
      expect(new Set(branches.map((branch) => branch.name as string))).toEqual(
        new Set(["中山店", "信義店"]),
      );

      const plan = demoPlan(EMAIL_BASE);
      const users = await find("users", {
        account: { $in: plan.users.map((user) => user.account) },
      });
      expect(users).toHaveLength(plan.users.length);
      // 新建的示範帳號照一般規則:只存雜湊、首登要改密碼
      for (const user of users) {
        expect(user.passwordHash).not.toContain(DEMO_PASSWORD);
        expect(user.settings).toMatchObject({ mustChangePassword: true });
      }
      // 總部人員屬於租戶本身(最上層組織)
      const hq = users.find((user) => user.name === "示範總部人員");
      const hqLinks = await find("core_relationships", {
        type: "org_user",
        secondId: hq?._id as ObjectId | undefined,
      });
      expect(hqLinks.map((link) => String(link.firstId))).toContain(
        String(tenantId),
      );

      const category = await findOne("field_categories", {
        key: "schedule-position",
      });
      // 租戶自訂的選項(orgId 有值;全域種子的 orgId 為 null)
      const positions = await find("fields", {
        categoryId: category._id as ObjectId,
        orgId: { $ne: null },
      });
      expect(new Set(positions.map((field) => field.label as string))).toEqual(
        new Set(["彩券機旁", "櫃台 A", "櫃台 B"]),
      );
    });

    it("三個角色在角色管理是一般角色,沒有「預設角色」標籤(規格 3.3)", async () => {
      const { roles } = await adminClient.request<{
        roles: { items: RoleItem[] };
      }>(ROLES);
      const created = roles.items.filter((role) =>
        ["總部管理", "店長", "店員"].includes(role.name),
      );
      expect(created).toHaveLength(3);
      for (const role of created) {
        expect(role).toMatchObject({ kind: "CUSTOM", isTemplateCopy: false });
      }
      // 對照:租戶管理員副本才是「預設角色」
      expect(
        roles.items
          .filter((role) => role.isTemplateCopy)
          .map((role) => role.kind),
      ).toEqual(["TEMPLATE_COPY"]);
    });

    it("四種通知的收件人 = 角色 店長(用建立時的角色 id)", async () => {
      const { roles } = await adminClient.request<{
        roles: { items: RoleItem[] };
      }>(ROLES);
      const manager = roles.items.find((role) => role.name === "店長");
      const { notificationSettings } = await adminClient.request<{
        notificationSettings: { items: SettingItem[] };
      }>(NOTIFICATION_SETTINGS);
      for (const type of STORE_MANAGER_NOTIFICATION_TYPES) {
        const setting = notificationSettings.items.find(
          (item) => item.type === type,
        );
        expect(setting?.isDefault).toBe(false);
        expect(setting?.audience.filter).toMatchObject({
          field: "role",
          value: { values: [manager?.id] },
        });
      }
      // 其他類型不動(例:關帳逾期仍是權限預設)
      const closing = notificationSettings.items.find(
        (item) => item.type === "lottery.period-close-overdue",
      );
      expect(closing?.isDefault).toBe(true);
    });

    it("走 api:操作紀錄的操作者 = 租戶管理員(root 只有開通機構那一筆)", async () => {
      const logs = await find("audit_logs", { createdAt: { $gte: startedAt } });
      const byRoot = logs.filter(
        (log) => String(log.actorId) !== String(adminId),
      );
      expect(byRoot.map((log) => log.action as string)).toEqual([
        "org.provision",
      ]);
      const byAdmin = new Set(
        logs
          .filter((log) => String(log.actorId) === String(adminId))
          .map((log) => log.action as string),
      );
      expect(byAdmin.size).toBeGreaterThan(3);
    });

    it("同一個環境再跑 create:只補缺的,一筆都沒寫;店員已改過的密碼不變", async () => {
      const clerk = `owner+demo-clerk-a@example.test`;
      const changed = ["changed", "by", "clerk", "5"].join("-");
      const clerkClient = await loginAs(
        api,
        { account: clerk, password: DEMO_PASSWORD },
        "店員",
      );
      await clerkClient.request(
        /* GraphQL */ `
          mutation TestChangePassword($input: ChangePasswordInput!) {
            changePassword(input: $input) {
              success
            }
          }
        `,
        { input: { currentPassword: DEMO_PASSWORD, newPassword: changed } },
      );
      const before = await auditCount();

      const again = await runDemoEntry(demoArgs(), databaseUri, [
        DEMO_PASSWORD,
        EMAIL_BASE,
      ]);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain("已存在");
      expect(await auditCount()).toBe(before);
      await expect(
        loginAs(api, { account: clerk, password: changed }, "店員"),
      ).resolves.toBeDefined();
    });

    it("同名機構沒有「示範」標記:拒絕執行,一筆都不寫", async () => {
      await withDatabase(databaseUri, (database) =>
        database
          .collection("orgs")
          .updateOne({ _id: tenantId }, { $unset: { isDemo: "" } }),
      );
      const before = await auditCount();
      try {
        const result = await runDemoEntry(demoArgs(), databaseUri, [
          DEMO_PASSWORD,
          EMAIL_BASE,
        ]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/沒有「示範」標記/);
        expect(await auditCount()).toBe(before);
      } finally {
        await withDatabase(databaseUri, (database) =>
          database
            .collection("orgs")
            .updateOne({ _id: tenantId }, { $set: { isDemo: true } }),
        );
      }
    });
  });

  describe("開通腳本某一步沒有權限:停在那一步,重跑從缺的開始補", () => {
    const account = "resume-admin@example.test";
    let root: GraphqlClient;
    let tenantAdmin: GraphqlClient;
    let tenantAdminId: string;
    let copyRoleId: string;
    let originalGrant: { moduleKeys: string[]; permissionKeys: string[] };
    const lines: string[] = [];
    const plan = demoPlan("resume@example.test");

    function run() {
      return runOnboarding({
        client: tenantAdmin,
        plan,
        activation: { mode: "PASSWORD", password: DEMO_PASSWORD },
        print: (line) => lines.push(line),
      });
    }

    beforeAll(async () => {
      root = await rootClient();
      const { tenantModuleOptions } = await root.request<{
        tenantModuleOptions: { key: string }[];
      }>(/* GraphQL */ `
        query TestModuleOptions {
          tenantModuleOptions {
            key
          }
        }
      `);
      const { provisionTenant } = await root.request<{
        provisionTenant: { ownerUserId: string; roleId: string };
      }>(
        /* GraphQL */ `
          mutation TestProvision($input: ProvisionTenantInput!) {
            provisionTenant(input: $input) {
              ownerUserId
              roleId
            }
          }
        `,
        {
          input: {
            name: "續跑測試機構",
            slug: "resume_test",
            adminAccount: account,
            adminEmail: account,
            moduleKeys: tenantModuleOptions.map((option) => option.key),
            demo: true,
            adminInitialPassword: DEMO_PASSWORD,
          },
        },
      );
      tenantAdminId = provisionTenant.ownerUserId;
      copyRoleId = provisionTenant.roleId;
      tenantAdmin = await loginAs(
        api,
        { account, password: DEMO_PASSWORD },
        "租戶管理員",
      );
      // 租戶事先自己調整了一種通知的收件人
      await tenantAdmin.request(
        /* GraphQL */ `
          mutation TestUpdateSetting($input: UpdateNotificationSettingInput!) {
            updateNotificationSetting(input: $input) {
              setting {
                isDefault
              }
            }
          }
        `,
        {
          input: {
            type: "lottery.license-expiring",
            audience: {
              mode: "match",
              filter: {
                field: "user",
                cond: "in",
                value: { kind: "static", values: [tenantAdminId] },
              },
            },
          },
        },
      );
      // 平台管理員把這個租戶管理員的欄位管理收回 → 開通腳本到「崗位」會沒有權限
      const { roleMatrix } = await root.request<{
        roleMatrix: {
          granted: { moduleKeys: string[]; permissionKeys: string[] };
        };
      }>(ROLE_MATRIX, { roleId: copyRoleId });
      originalGrant = roleMatrix.granted;
      await root.request(SAVE_ROLE_MATRIX, {
        input: {
          roleId: copyRoleId,
          moduleKeys: originalGrant.moduleKeys.filter(
            (key) => !key.startsWith("system.field-manager"),
          ),
          permissionKeys: originalGrant.permissionKeys.filter(
            (key) => !key.startsWith("system.field-manager"),
          ),
        },
      });
    }, SETUP_TIMEOUT_MS);

    it("沒有權限 → 照 api 回錯誤停在「崗位」並列出未執行的步驟;已完成的保留", async () => {
      const failure = run();
      await expect(failure).rejects.toBeInstanceOf(OnboardingStoppedError);
      const error = (await failure.catch(
        (error_: unknown) => error_,
      )) as OnboardingStoppedError;
      expect(error.stepKey).toBe("positions");
      expect(error.code).toBe("FORBIDDEN");
      expect(lines.join("\n")).toMatch(/✗ \[6\/7\] 崗位:.*FORBIDDEN/);
      expect(lines.join("\n")).toContain("未執行:通知收件人");

      const users = await find("users", {
        account: { $in: plan.users.map((user) => user.account) },
      });
      expect(users).toHaveLength(plan.users.length);
    });

    it("補好權限後重跑:前面的步驟回報已存在,只補崗位與通知收件人;租戶改過的收件人不動", async () => {
      await root.request(SAVE_ROLE_MATRIX, {
        input: { roleId: copyRoleId, ...originalGrant },
      });
      tenantAdmin = await loginAs(
        api,
        { account, password: DEMO_PASSWORD },
        "租戶管理員",
      );
      lines.length = 0;
      const startedAt = new Date();
      await run();

      const output = lines.join("\n");
      expect(output).toContain("「中山店」已存在");
      expect(output).toContain("「店長」已存在,權限不覆蓋");
      expect(output).toContain("「中山店店員」已存在");
      expect(output).toContain("建立「櫃台 A」");
      expect(output).toContain("「證照到期」租戶已調整過收件人,不動");

      const writes = await find("audit_logs", {
        createdAt: { $gte: startedAt },
      });
      for (const log of writes) {
        expect(String(log.actorId)).toBe(tenantAdminId);
      }
      expect(new Set(writes.map((log) => log.action as string))).toEqual(
        new Set(["field.create", "notification-settings.edit"]),
      );

      const { notificationSettings } = await tenantAdmin.request<{
        notificationSettings: { items: SettingItem[] };
      }>(NOTIFICATION_SETTINGS);
      const license = notificationSettings.items.find(
        (item) => item.type === "lottery.license-expiring",
      );
      expect(license?.audience.filter).toMatchObject({
        field: "user",
        value: { values: [tenantAdminId] },
      });
      const shipped = notificationSettings.items.find(
        (item) => item.type === "lottery.transfer-shipped",
      );
      expect(shipped?.audience.filter?.field).toBe("role");
    });
  });
});
