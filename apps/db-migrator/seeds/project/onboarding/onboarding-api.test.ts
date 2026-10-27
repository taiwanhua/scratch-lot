/**
 * 開通腳本與 demo `create` 對**真的 api**(子行程)+ 真 MongoDB 的整合測試(規格 2.2 操作表、3.3、3.4)。
 *
 * - demo 指令以子行程跑入口,機密從標準輸入以管線送入(同 workflow)
 * - 開通腳本只透過 GraphQL 寫:最終狀態一律回資料庫查,操作紀錄的操作者 = 租戶管理員
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
import { DEMO_CASH_POINTS } from "../demo/cash-points";
import { DEMO_GAMES } from "../demo/games";
import { runOnboardCommand } from "./command";
import { SUPPORT_REQUEST_FORM_KEY } from "./form-workflows/support-request";
import { OnboardingStoppedError, runOnboarding } from "./run-onboarding";
import { STORE_MANAGER_NOTIFICATION_TYPES } from "./steps/notification-recipients";

jest.setTimeout(240_000);

/** 字串排序(STRUCT-10:明給 zh-Hant)。 */
const byText = (left: string, right: string): number =>
  left.localeCompare(right, "zh-Hant");

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
  let server: ApiServer | undefined;
  let apiUrl = "";
  let api: GraphqlClient;

  function demoArgs(): string[] {
    return [
      "--environment=dev",
      "--mode=create",
      `--confirm=demo:dev:${databaseName}:create`,
      `--api-url=${apiUrl}`,
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

  /** 示範帳號首登要先改密碼(一般規則),改完再登入。 */
  async function signIn(
    account: string,
    label: string,
    changed = ["changed", "by", label, "9"].join("-"),
  ) {
    const first = await loginAs(
      api,
      { account, password: DEMO_PASSWORD },
      label,
    ).catch(() => null);
    if (first !== null) {
      await first.request(
        /* GraphQL */ `
          mutation TestRequisitionChangePassword($input: ChangePasswordInput!) {
            changePassword(input: $input) {
              success
            }
          }
        `,
        { input: { currentPassword: DEMO_PASSWORD, newPassword: changed } },
      );
    }
    return loginAs(api, { account, password: changed }, label);
  }

  beforeAll(async () => {
    await mongo.start();
    databaseUri = mongo.uri("main");
    databaseName = new URL(databaseUri).pathname.slice(1);
    server = await startApiServer(databaseUri);
    apiUrl = server.apiUrl;
    api = createGraphqlClient({ apiUrl });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await server?.stop();
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
      // 崗位全是租戶自己的選項(專案 seed 不內建崗位,沒有 orgId 為 null 的全域選項)
      const positions = await find("fields", {
        categoryId: category._id as ObjectId,
      });
      expect(positions.every((field) => field.orgId !== null)).toBe(true);
      expect(new Set(positions.map((field) => field.label as string))).toEqual(
        new Set(["店內櫃台A", "店外櫃台B"]),
      );
      // 選項顏色(P02 的 project_field_option_colors:一筆 = 一個選項的色票代號)
      const colors = await find("project_field_option_colors", {
        fieldId: { $in: positions.map((field) => field._id as ObjectId) },
      });
      const labelOf = new Map(
        positions.map((field) => [String(field._id), field.label as string]),
      );
      expect(
        Object.fromEntries(
          colors.map((color) => [
            labelOf.get(String(color.fieldId)),
            color.paletteKey as string,
          ]),
        ),
      ).toEqual({
        店內櫃台A: "blue",
        店外櫃台B: "green",
      });
    });

    it("檔案管理:示範遊戲與收銀點(兩家店都是 店內櫃台A、店外櫃台B,對應同名崗位)", async () => {
      const games = await find("lottery_games", { tenantId });
      expect(new Set(games.map((game) => game.gameCode as string))).toEqual(
        new Set(DEMO_GAMES.map((game) => game.gameCode)),
      );
      const points = await find("lottery_cash_points", { tenantId });
      expect(
        new Set(
          points.map(
            (point) => `${point.name as string}/${point.positionKey as string}`,
          ),
        ),
      ).toEqual(
        new Set(
          DEMO_CASH_POINTS.map((point) => `${point.name}/${point.positionKey}`),
        ),
      );
    });

    it("示範專用:三個角色多了列印權限(總部管理、店長 列印 + 補印;店員只有列印)", async () => {
      const { roles } = await adminClient.request<{
        roles: { items: RoleItem[] };
      }>(ROLES);
      const printingOf = async (name: string) => {
        const role = roles.items.find((item) => item.name === name);
        const { roleMatrix } = await adminClient.request<{
          roleMatrix: { granted: { permissionKeys: string[] } };
        }>(ROLE_MATRIX, { roleId: role?.id });
        return roleMatrix.granted.permissionKeys
          .filter((key) => key.startsWith("api.printing."))
          .toSorted(byText);
      };
      // 兩筆都給 = 收斂成這一層的 `*`(矩陣的正規化)
      expect(await printingOf("總部管理")).toEqual([
        "api.printing.*",
        "api.printing.print",
        "api.printing.reprint",
      ]);
      expect(await printingOf("店長")).toEqual([
        "api.printing.*",
        "api.printing.print",
        "api.printing.reprint",
      ]);
      expect(await printingOf("店員")).toEqual(["api.printing.print"]);
    });

    it("示範專用:受託人、甲類(兩個批購基準日、共同銷售處所、受託人)與銀行帳戶 A / B", async () => {
      const { lotteryDealers } = await adminClient.request<{
        lotteryDealers: { items: Document[] };
      }>(/* GraphQL */ `
        query TestClassADealers {
          lotteryDealers(input: { type: A, pageSize: 100 }) {
            items {
              licenseNo
              name
              lastPurchaseBaseDate
              lastSelfPurchaseBaseDate
              coSalesDealer {
                licenseNo
              }
              trustees {
                name
              }
            }
          }
        }
      `);
      // 2026-03-01 00:00(租戶時區 Asia/Taipei)
      expect(lotteryDealers.items).toEqual([
        {
          licenseNo: "90000011",
          name: "示範甲類一",
          lastPurchaseBaseDate: "2026-02-28T16:00:00.000Z",
          lastSelfPurchaseBaseDate: "2026-02-28T16:00:00.000Z",
          coSalesDealer: { licenseNo: "90000001" },
          trustees: [{ name: "王受託" }],
        },
      ]);

      const { lotteryBankAccounts } = await adminClient.request<{
        lotteryBankAccounts: { items: Document[] };
      }>(/* GraphQL */ `
        query TestBankAccounts {
          lotteryBankAccounts(input: { pageSize: 100 }) {
            items {
              label
              openingBalance
              openingDate
              balance
              usageOrgs {
                name
              }
            }
          }
        }
      `);
      expect(
        lotteryBankAccounts.items.map((item) => ({
          ...item,
          usageOrgs: (item.usageOrgs as { name: string }[])
            .map((org) => org.name)
            .toSorted(byText),
        })),
      ).toEqual(
        expect.arrayContaining([
          {
            label: "示範彩券行 末 56789",
            openingBalance: 500_000,
            openingDate: "2026-09-30T16:00:00.000Z",
            balance: 500_000,
            usageOrgs: ["中山店", "信義店"].toSorted(byText),
          },
          {
            label: "信義店零用 末 22333",
            openingBalance: 120_000,
            openingDate: "2026-09-30T16:00:00.000Z",
            balance: 120_000,
            usageOrgs: ["信義店"],
          },
        ]),
      );
      expect(lotteryBankAccounts.items).toHaveLength(2);
    });

    it("示範專用:中山店小金庫起始現金 20,000 = 一張待店長核准的現金更正單(核准前不寫小金庫)", async () => {
      const branch = await findOne("orgs", {
        parentId: tenantId,
        name: "中山店",
      });
      const corrections = await find("form_submissions", {
        tenantId,
        formKey: "cash_correction",
      });
      expect(corrections).toHaveLength(1);
      expect(corrections[0]).toMatchObject({
        status: "reviewing",
        serialNo: "X-0001",
      });
      expect(corrections[0]?.values).toMatchObject({
        direction: "increase",
        // 數字欄以十進位字串存
        amount: "20000",
        place: "vault",
        note: "上線前小金庫既有現金",
      });
      expect(
        await find("lottery_cash_movements", { orgId: branch._id as ObjectId }),
      ).toEqual([]);
      // 審核者 = 中山店店長(流程「店長限定分店」)
      const manager = await findOne("users", {
        account: `owner+demo-manager-a@example.test`,
      });
      const tasks = await find("workflow_tasks", {
        submissionId: corrections[0]?._id as ObjectId,
      });
      expect(tasks.map((task) => String(task.assigneeId))).toEqual([
        String(manager._id),
      ]);
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
      // 當事人通知(收件人由事件決定)不在通知設定頁、開通也不設:例 畫休被代改
      expect(notificationSettings.items.map((item) => item.type)).not.toContain(
        "schedule.day-off-overridden",
      );
    });

    it("走 api:操作紀錄的操作者 = 租戶管理員(root 只有開通機構與分派受管表單)", async () => {
      const logs = await find("audit_logs", { createdAt: { $gte: startedAt } });
      const byRoot = logs.filter(
        (log) => String(log.actorId) !== String(adminId),
      );
      expect(byRoot.map((log) => log.action as string)).toEqual([
        "org.provision",
        // 受管表單分派給示範機構(分派只有站在根組織做得到):支援需求單、補打卡申請、叫貨單、進貨單、調貨單、
        // 撤銷售出申請、現金更正單、盤點確認申請、結帳確認申請各一筆
        "form.assign",
        "form.assign",
        "form.assign",
        "form.assign",
        "form.assign",
        "form.assign",
        "form.assign",
        "form.assign",
        "form.assign",
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

    it("確認字串的資料庫名不是 api 實際連的資料庫:不執行,一筆都不寫", async () => {
      const before = await auditCount();
      const result = await runDemoEntry(
        [
          "--environment=dev",
          "--mode=create",
          "--confirm=demo:dev:some-other-db:create",
          `--api-url=${apiUrl}`,
        ],
        databaseUri,
        [DEMO_PASSWORD, EMAIL_BASE],
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/資料庫名段不符/);
      expect(await auditCount()).toBe(before);
    });

    it("同短碼的機構沒有「示範」標記:拒絕執行,一筆都不寫", async () => {
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

    async function requisitionValues(clientRequestId: string) {
      const branch = await findOne("orgs", {
        parentId: tenantId,
        name: "中山店",
      });
      const game = await findOne("lottery_games", {
        tenantId,
        gameCode: "5164",
      });
      return {
        formKey: "requisition",
        clientRequestId,
        values: {
          branch: String(branch._id),
          lines: [
            {
              rowId: "00000000-0000-4000-8000-000000000001",
              game: String(game._id),
              books: 2,
            },
          ],
        },
      };
    }

    describe("支援需求單的流程(規格 2.1、14.10)", () => {
      it("demo create:平台管理員把受管表單分派給示範機構,開通腳本建客製流程、發布、綁定", async () => {
        const form = await findOne("forms", { key: SUPPORT_REQUEST_FORM_KEY });
        const assignments = await find("business_relationships", {
          type: "org_form",
          tenantId,
          secondId: form._id as ObjectId,
        });
        expect(assignments).toHaveLength(1);

        const workflow = await findOne("workflows", {
          key: `${DEMO_TENANT.slug}_support_request`,
        });
        expect(workflow).toMatchObject({ tenantId, currentVersion: 1 });
        const bindings = await find("business_relationships", {
          type: "org_form_workflow",
          tenantId,
          thirdId: workflow._id as ObjectId,
        });
        expect(bindings).toHaveLength(1);
      });

      it("重跑開通腳本:表單已綁定流程就沿用,不另建", async () => {
        const lines: string[] = [];
        await runOnboarding({
          client: adminClient,
          plan: demoPlan(EMAIL_BASE),
          activation: { mode: "PASSWORD", password: DEMO_PASSWORD },
          tenantSlug: DEMO_TENANT.slug,
          print: (line) => lines.push(line),
        });
        expect(lines.join("\n")).toContain(
          "「支援需求單」已綁定流程「支援需求單審核」,沿用",
        );
        const workflows = await find("workflows", {
          tenantId,
          key: `${DEMO_TENANT.slug}_support_request`,
        });
        expect(workflows).toHaveLength(1);
      });

      it("中山店店長送出 → 單號 SP-0001,審核者 = 角色 總部管理 且屬於最上層組織的人(示範總部人員)", async () => {
        // 新建的示範帳號首登要先改密碼(一般規則),改完再登入
        const account = `owner+demo-manager-a@example.test`;
        const changed = ["changed", "by", "manager", "8"].join("-");
        const firstLogin = await loginAs(
          api,
          { account, password: DEMO_PASSWORD },
          "中山店店長",
        );
        await firstLogin.request(
          /* GraphQL */ `
            mutation TestManagerChangePassword($input: ChangePasswordInput!) {
              changePassword(input: $input) {
                success
              }
            }
          `,
          { input: { currentPassword: DEMO_PASSWORD, newPassword: changed } },
        );
        const manager = await loginAs(
          api,
          { account, password: changed },
          "中山店店長",
        );
        const branch = await findOne("orgs", {
          parentId: tenantId,
          name: "中山店",
        });
        const SUBMIT_SUPPORT_REQUEST = /* GraphQL */ `
          mutation TestSubmitSupportRequest(
            $input: CreateAndSubmitFormSubmissionInput!
          ) {
            createAndSubmitFormSubmission(input: $input) {
              submission {
                id
                status
                serialNo
              }
            }
          }
        `;
        const supportValues = (endAt: string) => ({
          // 台北 11/12 17:00–21:00
          start_at: "2026-11-12T09:00:00.000Z",
          end_at: endAt,
          position: "in-store-counter-a",
          headcount: 1,
          branch: String(branch._id),
          note: "颱風後補人,晚間人手不足",
        });
        // 結束跨過午夜(台北 11/13 01:00)→ 擋下(要在同一天)
        await expect(
          manager.request(SUBMIT_SUPPORT_REQUEST, {
            input: {
              formKey: SUPPORT_REQUEST_FORM_KEY,
              clientRequestId: "support-request-overnight",
              values: supportValues("2026-11-12T17:00:00.000Z"),
            },
          }),
        ).rejects.toMatchObject({
          code: "VALIDATION_FAILED",
          fields: expect.arrayContaining(["end_at"]),
        });
        const { createAndSubmitFormSubmission } = await manager.request<{
          createAndSubmitFormSubmission: {
            submission: { id: string; status: string; serialNo: string | null };
          };
        }>(SUBMIT_SUPPORT_REQUEST, {
          input: {
            formKey: SUPPORT_REQUEST_FORM_KEY,
            clientRequestId: "support-request-1",
            values: supportValues("2026-11-12T13:00:00.000Z"),
          },
        });
        expect(createAndSubmitFormSubmission.submission.status).toBe(
          "REVIEWING",
        );
        // 受管表單宣告的單號格式(SP + 4 位、不分期間):這個租戶的第一張
        expect(createAndSubmitFormSubmission.submission.serialNo).toBe(
          "SP-0001",
        );
        // 開始 / 結束存成時點(Mongo Date)
        const stored = await findOne("form_submissions", {
          _id: new ObjectId(createAndSubmitFormSubmission.submission.id),
        });
        expect(stored.values).toMatchObject({
          start_at: new Date("2026-11-12T09:00:00.000Z"),
          end_at: new Date("2026-11-12T13:00:00.000Z"),
        });

        const hq = await findOne("users", {
          account: `owner+demo-hq@example.test`,
        });
        const tasks = await find("workflow_tasks", {
          submissionId: new ObjectId(
            createAndSubmitFormSubmission.submission.id,
          ),
        });
        expect(tasks.map((task) => String(task.assigneeId))).toEqual([
          String(hq._id),
        ]);
      });
    });

    describe("叫貨單的流程(規格 2.1、8.1)", () => {
      const SUBMIT_REQUISITION = /* GraphQL */ `
        mutation TestSubmitRequisition(
          $input: CreateAndSubmitFormSubmissionInput!
        ) {
          createAndSubmitFormSubmission(input: $input) {
            submission {
              id
              status
              serialNo
            }
          }
        }
      `;

      interface Submitted {
        createAndSubmitFormSubmission: {
          submission: { id: string; status: string; serialNo: string | null };
        };
      }

      it("demo create:建客製流程「叫貨單審核」,一關 角色 總部管理、B4 跳過組織 = 租戶", async () => {
        const workflow = await findOne("workflows", {
          key: `${DEMO_TENANT.slug}_requisition`,
        });
        expect(workflow).toMatchObject({ tenantId, currentVersion: 1 });
        const version = await findOne("workflow_versions", {
          workflowKey: `${DEMO_TENANT.slug}_requisition`,
          version: 1,
        });
        const [step] = version.steps as Document[];
        expect(step).toMatchObject({
          key: "hq",
          skipOrgs: { orgIds: ["tenant"], includeDescendants: false },
        });
      });

      it("總部人員(屬於租戶)替中山店送出 → 跳過審核直接完成,寫叫貨明細副本", async () => {
        const hq = await signIn("owner+demo-hq@example.test", "hq");
        const { createAndSubmitFormSubmission } = await hq.request<Submitted>(
          SUBMIT_REQUISITION,
          {
            input: await requisitionValues("requisition-hq-1"),
          },
        );
        expect(createAndSubmitFormSubmission.submission).toMatchObject({
          status: "COMPLETED",
          serialNo: "R-0001",
        });
        const branch = await findOne("orgs", {
          parentId: tenantId,
          name: "中山店",
        });
        const lines = await find("lottery_requisition_lines", {
          requisitionId: new ObjectId(
            createAndSubmitFormSubmission.submission.id,
          ),
        });
        expect(lines).toEqual([
          expect.objectContaining({
            orgId: branch._id as ObjectId,
            tenantId,
            books: 2,
            serialNo: "R-0001",
            voidedAt: null,
            referencedBy: null,
          }),
        ]);
      });

      it("中山店店長送出 → 審核中,任務派給總部管理(示範總部人員);還沒完成就沒有副本", async () => {
        // 上面支援需求單的測試已經替中山店店長改過密碼
        const manager = await signIn(
          "owner+demo-manager-a@example.test",
          "manager",
          ["changed", "by", "manager", "8"].join("-"),
        );
        const { createAndSubmitFormSubmission } =
          await manager.request<Submitted>(SUBMIT_REQUISITION, {
            input: await requisitionValues("requisition-manager-1"),
          });
        expect(createAndSubmitFormSubmission.submission.status).toBe(
          "REVIEWING",
        );
        const submissionId = new ObjectId(
          createAndSubmitFormSubmission.submission.id,
        );
        const hq = await findOne("users", {
          account: "owner+demo-hq@example.test",
        });
        const tasks = await find("workflow_tasks", { submissionId });
        expect(tasks.map((task) => String(task.assigneeId))).toEqual([
          String(hq._id),
        ]);
        expect(
          await find("lottery_requisition_lines", {
            requisitionId: submissionId,
          }),
        ).toEqual([]);
      });
    });
  });

  describe("onboard 指令(真實租戶):--tenant 比對登入者的租戶、新建的人寄啟用信", () => {
    const account = "email-admin@example.test";
    let planPath: string;

    function onboard(tenant: string, lines: string[]) {
      return runOnboardCommand(
        [
          `--api-url=${apiUrl}`,
          `--tenant=${tenant}`,
          `--account=${account}`,
          `--plan=${planPath}`,
        ],
        {
          readSecret: () => Promise.resolve(DEMO_PASSWORD),
          print: (line) => lines.push(line),
        },
      );
    }

    beforeAll(async () => {
      const root = await rootClient();
      const { tenantModuleOptions } = await root.request<{
        tenantModuleOptions: { key: string }[];
      }>(/* GraphQL */ `
        query TestEmailModuleOptions {
          tenantModuleOptions {
            key
          }
        }
      `);
      // 測試用的租戶需要一位有密碼的租戶管理員:用示範開通的形式建立(開通腳本不看這個標記)
      await root.request(
        /* GraphQL */ `
          mutation TestEmailProvision($input: ProvisionTenantInput!) {
            provisionTenant(input: $input) {
              ownerUserId
            }
          }
        `,
        {
          input: {
            name: "啟用信測試機構",
            slug: "email_test",
            adminAccount: account,
            adminEmail: account,
            moduleKeys: tenantModuleOptions.map((option) => option.key),
            demo: true,
            adminInitialPassword: DEMO_PASSWORD,
          },
        },
      );
      const directory = mkdtempSync(path.join(tmpdir(), "onboard-email-"));
      planPath = path.join(directory, "plan.json");
      writeFileSync(
        planPath,
        JSON.stringify({
          branches: [{ name: "一店" }],
          users: [
            {
              account: "email-clerk@example.test",
              email: "email-clerk@example.test",
              name: "一店店員",
              branches: ["一店"],
              roles: ["clerk"],
            },
          ],
        }),
      );
    }, SETUP_TIMEOUT_MS);

    it("--tenant 不是登入者所屬的租戶:停在第一步,一筆都不寫", async () => {
      const before = await auditCount();
      const lines: string[] = [];
      await expect(onboard("demo_lottery", lines)).rejects.toThrow(
        /不是要開通的 demo_lottery/,
      );
      expect(lines.join("\n")).toMatch(/✗ \[1\/12\] 租戶/);
      expect(await auditCount()).toBe(before);
    });

    it("新建的使用者走啟用信:沒有可用密碼、首登不強改(本人用啟用信設定)", async () => {
      await onboard("email_test", []);
      const clerk = await findOne("users", {
        account: "email-clerk@example.test",
      });
      expect(clerk.settings).toMatchObject({ mustChangePassword: false });
      const tokens = await find("action_tokens", {
        userId: clerk._id as ObjectId,
      });
      expect(tokens.map((token) => token.type as string)).toContain(
        "activation",
      );
      await expect(
        loginAs(
          api,
          { account: "email-clerk@example.test", password: DEMO_PASSWORD },
          "店員",
        ),
      ).rejects.toThrow(/登入失敗/);
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
        tenantSlug: "resume_test",
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
      expect(lines.join("\n")).toMatch(/✗ \[6\/12\] 崗位:.*FORBIDDEN/);
      // 整行比對:後面的步驟一個都不能漏(流程是最後一步)
      expect(lines).toContain(
        "  未執行:乙類與對應分店、排班人員、人力需求範本、通知收件人、收銀點、流程",
      );

      const users = await find("users", {
        account: { $in: plan.users.map((user) => user.account) },
      });
      expect(users).toHaveLength(plan.users.length);
    });

    it("補好權限後重跑:前面的步驟回報已存在,只補崗位、排班人員與範本、通知收件人;租戶改過的收件人不動", async () => {
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
      expect(output).toContain("建立「店內櫃台A」");
      expect(output).toContain("建立乙類「示範彩券 中山店」,對應「中山店」");
      expect(output).toContain("「證照到期」租戶已調整過收件人,不動");

      const writes = await find("audit_logs", {
        createdAt: { $gte: startedAt },
      });
      for (const log of writes) {
        expect(String(log.actorId)).toBe(tenantAdminId);
      }
      expect(new Set(writes.map((log) => log.action as string))).toEqual(
        new Set([
          "field.create",
          "field.set-color",
          // 乙類與對應分店(經銷商管理):前一次停在「崗位」,這一步重跑時才建
          "lottery-dealer.create",
          "lottery-relationship.create",
          "schedule-staff.create",
          "schedule-staff.edit",
          "schedule-demand-template.create",
          "schedule-demand-week-template.create",
          "notification-settings.edit",
          // 檔案管理的收銀點排在通知收件人之後,第一次停在崗位時還沒建(遊戲只有示範指令建)
          "lottery-cash-point.create",
        ]),
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
