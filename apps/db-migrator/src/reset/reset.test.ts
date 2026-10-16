import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Db, ObjectId, type WithId } from "mongodb";

import { baseOnlyProjectSettings } from "../../test/fixtures/seeds-base/project-source";
import {
  RESET_ENTRY,
  type ResetOptions,
  confirmationOf,
  dumpApplicationData,
  runReset as runResetCommand,
} from "../../test/support/reset-harness";
import {
  BASE_ONLY_REGISTRY,
  BUILD_TIMEOUT_MS,
  ROOT_ADMIN_ENV,
  SEED_ENTRY,
  TestMongo,
  buildDefinitionCli,
  changelogOf,
  dumpDatabase,
  journalOf,
  lockOf,
  startEntry,
  withDatabase,
} from "../../test/support/update-harness";

/**
 * reset 指令對真的拋棄式 MongoDB(九支歷史 migration 與空專案來源的夾具 registry):`data` / `full` 的清留、
 * 安全閥(環境允許清單 + 完整人工確認,缺一即零刪除)、以拋棄式資料庫模擬 production 的確認。
 * 資料庫名刻意不帶環境字樣:目標環境只由 `--environment` 與確認字串決定,不從名字推測。
 *
 * 清留的數量是底座自己的內容,所以 seed 與 reset 都指定夾具 registry(`--registry=`),不讀引用專案在
 * `seeds/project/` 登記的內容;帶受管定義的 reset 見 `reset-managed.test.ts` / `reset-full.test.ts`。
 */

/** reset 指令,registry 固定為空專案來源的夾具。 */
function runReset(databaseUri: string, options: ResetOptions) {
  return runResetCommand(databaseUri, {
    ...options,
    args: [BASE_ONLY_REGISTRY, ...(options.args ?? [])],
  });
}

const mongo = new TestMongo("db-migrator-reset");

function createTestDatabaseUri(suffix: string): string {
  return mongo.uri(suffix);
}

interface Keyed {
  key?: string;
  [field: string]: unknown;
}

interface Relationship {
  type?: string;
  firstId?: ObjectId;
  secondId?: ObjectId;
  [field: string]: unknown;
}

/** 以種子 key 反查該環境的 _id(核心關聯的兩端只存 id)。 */
const idOf = (documents: WithId<Keyed>[], key: string): ObjectId | undefined =>
  documents.find((document) => document.key === key)?._id;

const relation = (
  type: string,
  firstId: ObjectId,
  secondId: ObjectId,
): Record<string, unknown> => ({
  type,
  firstId,
  secondId,
  thirdId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

/**
 * 灌一份「人建的資料」:開通一個租戶之後資料庫會多出來的那些
 * —— 租戶組織、租戶使用者、租戶副本角色與自建角色、它們的四種核心關聯、
 * 租戶自訂的欄位選項、root 在畫面建的欄位類別、資料範圍規則、人新增的示範項目,以及四張純業務表。
 */
async function insertHumanData(database: Db): Promise<void> {
  const now = new Date();
  const rootModule = await database.collection("modules").findOne({});
  const rootPermission = await database.collection("permissions").findOne({});
  const rootOrg = await database.collection("orgs").findOne({ key: "root" });

  const { insertedId: tenantOrgId } = await database
    .collection("orgs")
    .insertOne({
      name: "人建的租戶",
      parentId: rootOrg?._id ?? null,
      ancestors: rootOrg ? [rootOrg._id] : [],
      enabled: true,
      isSystem: false,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });

  const { insertedId: tenantUserId } = await database
    .collection("users")
    .insertOne({
      name: "人建的使用者",
      account: "tenant-user",
      email: "tenant-user@example.com",
      passwordHash: ["not", "a", "real", "hash"].join("-"),
      enabled: true,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });

  const roles = database.collection("roles");
  // 開通租戶時複製的租戶管理員副本(沒有 key,ADR-0009)
  const { insertedId: tenantRoleId } = await roles.insertOne({
    name: "租戶管理員",
    enabled: true,
    isSystem: false,
    settings: {},
    createdAt: now,
    updatedAt: now,
  });
  // 租戶自建角色
  const { insertedId: customRoleId } = await roles.insertOne({
    name: "門市店長",
    enabled: true,
    isSystem: false,
    settings: {},
    createdAt: now,
    updatedAt: now,
  });

  await database
    .collection("core_relationships")
    .insertMany([
      relation("org_user", tenantOrgId, tenantUserId),
      relation("org_role", tenantOrgId, tenantRoleId),
      relation("org_role", tenantOrgId, customRoleId),
      relation("user_role", tenantUserId, tenantRoleId),
      relation("role_module", tenantRoleId, rootModule?._id ?? new ObjectId()),
      relation(
        "role_permission",
        tenantRoleId,
        rootPermission?._id ?? new ObjectId(),
      ),
    ]);

  // root 在欄位管理畫面新增的類別(isSystem false、seed 沒宣告)與它底下根組織加的選項
  const { insertedId: rootCategoryId } = await database
    .collection("field_categories")
    .insertOne({
      key: "cuisine",
      name: "料理類型",
      enabled: true,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    });
  await database.collection("fields").insertOne({
    categoryId: rootCategoryId,
    orgId: rootOrg?._id ?? null,
    value: "spicy",
    label: "辣味",
    order: 1,
    enabled: true,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  });

  await database.collection("fields").insertOne({
    categoryId: new ObjectId(),
    orgId: tenantOrgId,
    value: "dessert",
    label: "甜點",
    order: 9,
    enabled: true,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  });

  await database.collection("data_scope_rules").insertOne({
    collection: "demo_items_one",
    rules: [],
    createdAt: now,
    updatedAt: now,
  });

  await database.collection("demo_items_one").insertOne({
    orgId: tenantOrgId,
    name: "人建的示範項目",
    category: "staple",
    status: "draft",
    enabled: true,
    createdBy: tenantUserId,
    createdAt: now,
    updatedAt: now,
  });

  for (const collection of [
    "audit_logs",
    "action_tokens",
    "refresh_tokens",
    "customers",
  ]) {
    await database
      .collection(collection)
      .insertOne({ orgId: tenantOrgId, createdAt: now, updatedAt: now });
  }
}

/** 人在系統內改過的初始 seed 值欄位(ADR-0002):`data` 模式必須原封不動。 */
async function tweakInitialSeedValues(database: Db): Promise<void> {
  await database
    .collection("orgs")
    .updateOne(
      { key: "root" },
      { $set: { name: "專案營運組織", description: "由後台修改的描述" } },
    );
  await database
    .collection("modules")
    .updateOne({ key: "demo.sample-two" }, { $set: { enabled: false } });
  await database
    .collection("modules")
    .updateOne({ key: "overview" }, { $set: { icon: "home" } });
}

async function readState(databaseUri: string) {
  return withDatabase(databaseUri, async (database) => {
    const documentsIn = (name: string) =>
      database.collection<Keyed>(name).find().sort({ key: 1 }).toArray();
    const existing = await database
      .listCollections({}, { nameOnly: true })
      .toArray();
    return {
      collections: existing.map(({ name }) => name),
      orgs: await documentsIn("orgs"),
      users: await documentsIn("users"),
      roles: await documentsIn("roles"),
      modules: await documentsIn("modules"),
      permissions: await documentsIn("permissions"),
      fields: await documentsIn("fields"),
      fieldCategories: await documentsIn("field_categories"),
      dataScopeTargets: await documentsIn("data_scope_targets"),
      dataScopeRules: await documentsIn("data_scope_rules"),
      demoItemsOne: await documentsIn("demo_items_one"),
      demoItemsTwo: await documentsIn("demo_items_two"),
      auditLogs: await documentsIn("audit_logs"),
      actionTokens: await documentsIn("action_tokens"),
      refreshTokens: await documentsIn("refresh_tokens"),
      customers: await documentsIn("customers"),
      relationships: await database
        .collection<Relationship>("core_relationships")
        .find()
        .toArray(),
    };
  });
}

function runSeedCommand(databaseUri: string) {
  return startEntry(SEED_ENTRY, [BASE_ONLY_REGISTRY], databaseUri).done;
}

/** 種子 + 人建資料 + 人改過的開關 / 圖示。 */
async function prepareDatabase(databaseUri: string): Promise<void> {
  const seeded = await runSeedCommand(databaseUri);
  expect(seeded.stderr).toBe("");
  expect(seeded.status).toBe(0);
  await withDatabase(databaseUri, async (database) => {
    await insertHumanData(database);
    await tweakInitialSeedValues(database);
  });
}

beforeAll(async () => {
  await mongo.start();
  // full reset 一律經 api 的受管定義 CLI 建回索引(沒有登記定義時也一樣)
  await buildDefinitionCli();
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
  await mongo.stop();
}, 60_000);

describe("reset --mode=data(對真 MongoDB)", () => {
  it("只刪人建的資料:seed 文件與人改過的 enabled / icon 原封不動,示範項目補回,事後重跑 seed 為 0 / 0 / 0 / K", async () => {
    const databaseUri = createTestDatabaseUri("data");
    await prepareDatabase(databaseUri);
    const changelog = await changelogOf(databaseUri);
    const runsBefore = await journalOf(databaseUri, "run");

    const result = await runReset(databaseUri, { mode: "data" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const state = await readState(databaseUri);

    // 人建的都不在
    expect(state.orgs.map((org) => org.key)).toEqual(["root"]);
    expect(state.users.map((user) => user.account)).toEqual([
      ROOT_ADMIN_ENV.ROOT_ADMIN_ACCOUNT,
    ]);
    expect(state.roles.map((role) => role.key)).toEqual([
      "super-admin",
      "tenant-admin",
    ]);
    expect(state.dataScopeRules).toHaveLength(0);
    expect(state.auditLogs).toHaveLength(0);
    expect(state.actionTokens).toHaveLength(0);
    expect(state.refreshTokens).toHaveLength(0);
    expect(state.customers).toHaveLength(0);
    // 租戶自訂的欄位選項被刪,seed 宣告的七筆留著(判準是 registry 的 key,不是 isSystem)
    expect(state.fields).toHaveLength(7);
    expect(state.fields.map((field) => field.label)).not.toContain("甜點");
    expect(state.fields.map((field) => field.label)).not.toContain("辣味");

    // seed 管的設定留著(數量正本:src/seed/seed.test.ts 的模組 / 權限斷言)
    expect(state.modules).toHaveLength(39);
    expect(state.permissions).toHaveLength(117);
    // root 在畫面建的類別(isSystem false、key 不在 registry)算人建資料,一起刪
    expect(state.fieldCategories.map((category) => category.key)).toEqual([
      "demo-category",
      "gender",
    ]);
    expect(state.dataScopeTargets).toHaveLength(4);

    // 人改過的初始 seed 值欄位沒有被翻回宣告值(ADR-0002)
    const moduleBy = (key: string) =>
      state.modules.find((module) => module.key === key);
    expect(moduleBy("demo.sample-two")?.enabled).toBe(false);
    expect(moduleBy("overview")?.icon).toBe("home");
    expect(state.orgs.find((org) => org.key === "root")).toMatchObject({
      name: "專案營運組織",
      description: "由後台修改的描述",
    });

    // 示範項目:人新增的那筆不在,宣告的十筆由同一次執行的 seed 補回
    expect(state.demoItemsOne).toHaveLength(5);
    expect(state.demoItemsTwo).toHaveLength(5);
    expect(state.demoItemsOne.map((item) => item.name)).not.toContain(
      "人建的示範項目",
    );
    for (const item of [...state.demoItemsOne, ...state.demoItemsTwo]) {
      expect(typeof item.key).toBe("string");
    }

    // 已成功的 migration 紀錄原封不動(不重跑);先前的執行紀錄都留著,另外多一筆這次的 reset
    expect(await changelogOf(databaseUri)).toEqual(changelog);
    const runs = await journalOf(databaseUri, "run");
    expect(runs.slice(0, runsBefore.length)).toEqual(runsBefore);
    expect(runs).toHaveLength(runsBefore.length + 1);
    expect(runs.at(-1)).toMatchObject({
      operation: "reset-data",
      status: "succeeded",
      stage: "done",
    });
    expect(await lockOf(databaseUri)).toBeNull();
    // 執行摘要列出環境、資料庫名與模式
    expect(result.stdout).toContain("環境 dev");
    expect(result.stdout).toContain("模式 data");
    expect(result.stdout).toContain(
      new URL(databaseUri).pathname.replace(/^\//, ""),
    );

    // 事後重跑 seed:完全冪等
    const rerun = await runSeedCommand(databaseUri);
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toMatch(/新增 0 \/ 更新 0 \/ 認養 0 \/ 未變 [1-9]\d*/);
  }, 300_000);

  it("核心關聯只刪「任一端指向被刪文件」的那些:root ↔ 根組織、root ↔ 超級管理員、種子角色的綁定都留著", async () => {
    const databaseUri = createTestDatabaseUri("data-relations");
    await prepareDatabase(databaseUri);

    const result = await runReset(databaseUri, { mode: "data" });
    expect(result.status).toBe(0);

    const state = await readState(databaseUri);
    const rootOrgId = idOf(state.orgs, "root");
    const rootUserId = state.users[0]?._id;
    const superAdminId = idOf(state.roles, "super-admin");
    const tenantAdminId = idOf(state.roles, "tenant-admin");
    const countOf = (type: string, firstId: ObjectId | undefined) =>
      state.relationships.filter(
        (link) =>
          link.type === type &&
          firstId !== undefined &&
          link.firstId?.equals(firstId),
      ).length;

    expect(state.relationships).toContainEqual(
      expect.objectContaining({
        type: "org_user",
        firstId: rootOrgId,
        secondId: rootUserId,
      }),
    );
    expect(state.relationships).toContainEqual(
      expect.objectContaining({
        type: "user_role",
        firstId: rootUserId,
        secondId: superAdminId,
      }),
    );
    // 種子角色的擁有組織兩筆 + 租戶管理員模板的 35 + 35 綁定(正本:src/seed/seed.test.ts)
    expect(countOf("org_role", rootOrgId)).toBe(2);
    expect(countOf("role_module", tenantAdminId)).toBe(35);
    expect(countOf("role_permission", tenantAdminId)).toBe(35);
    // 掛在被刪租戶 / 使用者 / 角色上的六筆關聯全數消失
    expect(state.relationships).toHaveLength(2 + 1 + 1 + 35 + 35);
  }, 300_000);
});

describe("reset --mode=full(對真 MongoDB)", () => {
  it("資料庫從空重建:人建的資料與其 collection 都不在,初始 seed 值欄位回到宣告值,遷移重新跑過", async () => {
    const databaseUri = createTestDatabaseUri("full");
    await prepareDatabase(databaseUri);
    const changelogBefore = await changelogOf(databaseUri);

    const result = await runReset(databaseUri, { mode: "full" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    // 逐一清除 collection,不是 dropDatabase(那會連整批鎖一起丟掉)
    expect(result.stdout).not.toContain("dropDatabase");
    expect(result.stdout).toContain("保留 changelog_lock");

    const state = await readState(databaseUri);

    expect(state.orgs.map((org) => org.key)).toEqual(["root"]);
    expect(state.users).toHaveLength(1);
    expect(state.roles).toHaveLength(2);
    expect(state.modules).toHaveLength(39);
    expect(state.demoItemsOne).toHaveLength(5);
    expect(state.demoItemsTwo).toHaveLength(5);
    // 業務表整個被 drop;api 的 runtime 之後依 schema 建回空的 collection 與索引,人建的資料不在
    expect(state.customers).toHaveLength(0);
    // data_scope_rules 的 collection 會被遷移(建唯一索引)重新建出來,但人建的規則不在
    expect(state.dataScopeRules).toHaveLength(0);
    // 全新安裝:初始 seed 值欄位也回到宣告值(這是與 data 模式唯一的差別)
    const moduleBy = (key: string) =>
      state.modules.find((module) => module.key === key);
    expect(moduleBy("demo.sample-two")?.enabled).toBe(true);
    expect(moduleBy("overview")?.icon).toBe("dashboard");
    expect(state.orgs.find((org) => org.key === "root")).toMatchObject({
      name: baseOnlyProjectSettings.rootOrg.name,
      description: baseOnlyProjectSettings.rootOrg.description,
    });
    // changelog 清掉後重新長出來:同樣九支,但每一筆都是這次重跑記的
    const changelog = await changelogOf(databaseUri);
    expect(changelog.map((entry) => entry.fileName as string)).toEqual(
      changelogBefore.map((entry) => entry.fileName as string),
    );
    const oldIds = new Set(changelogBefore.map((entry) => String(entry._id)));
    expect(changelog.some((entry) => oldIds.has(String(entry._id)))).toBe(
      false,
    );
    // 執行紀錄也清掉重建:只剩這一次,而且走完
    const runs = await journalOf(databaseUri, "run");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      operation: "reset-full",
      status: "succeeded",
      stage: "done",
    });
    expect(await lockOf(databaseUri)).toBeNull();
    expect(state.collections).toContain("changelog_lock");
  }, 300_000);
});

describe("reset 的安全閥:缺值或任何一段不符 → exit 1、零刪除", () => {
  let guarded: string;
  let before: Awaited<ReturnType<typeof dumpDatabase>>;

  beforeAll(async () => {
    guarded = createTestDatabaseUri("guard");
    await prepareDatabase(guarded);
    before = await dumpDatabase(guarded);
  }, 300_000);

  /** 安全閥在連線之前:整個資料庫(連鎖與執行紀錄)都沒有任何變化。 */
  async function expectUntouched(): Promise<void> {
    expect(await dumpDatabase(guarded)).toEqual(before);
  }

  it.each(["data", "full"] as const)(
    "%s:沒有 --confirm",
    async (mode) => {
      const result = await runReset(guarded, { mode, confirm: null });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--confirm");
      expect(result.stdout).toBe("");
      await expectUntouched();
    },
    120_000,
  );

  it.each(["data", "full"] as const)(
    "%s:沒有 --environment",
    async (mode) => {
      const result = await runReset(guarded, {
        mode,
        environment: null,
        confirm: confirmationOf("dev", guarded, mode),
        env: { RESET_ALLOW_ENV: "dev,staging,production" },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--environment");
      await expectUntouched();
    },
    120_000,
  );

  it("確認的環境段不符(以 staging 的確認打 dev)", async () => {
    const result = await runReset(guarded, {
      mode: "data",
      confirm: confirmationOf("staging", guarded, "data"),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("環境");
    await expectUntouched();
  }, 120_000);

  it("確認的資料庫名段不符(打錯環境的資料庫)", async () => {
    const result = await runReset(guarded, {
      mode: "full",
      confirm: "reset:dev:cookhome-dev:full",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("資料庫名");
    await expectUntouched();
  }, 120_000);

  it("確認的模式段不符(確認的是 data,執行的是 full)", async () => {
    const result = await runReset(guarded, {
      mode: "full",
      confirm: confirmationOf("dev", guarded, "data"),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("模式");
    await expectUntouched();
  }, 120_000);

  it("舊格式(只給資料庫名)不再被接受", async () => {
    const result = await runReset(guarded, {
      mode: "data",
      confirm: new URL(guarded).pathname.replace(/^\//, ""),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("格式");
    await expectUntouched();
  }, 120_000);

  it("RESET_ALLOW_ENV 未設或不含目標環境時拒絕(確認完全正確也一樣)", async () => {
    const notSet = await runReset(guarded, {
      mode: "data",
      env: { RESET_ALLOW_ENV: undefined },
    });
    expect(notSet.status).toBe(1);
    expect(notSet.stderr).toContain("RESET_ALLOW_ENV");
    expect(notSet.stderr).toContain("不含目標環境 dev");

    const otherEnv = await runReset(guarded, {
      mode: "data",
      environment: "production",
      env: { RESET_ALLOW_ENV: "dev,staging" },
    });
    expect(otherEnv.status).toBe(1);
    expect(otherEnv.stderr).toContain("不含目標環境 production");
    await expectUntouched();
  }, 120_000);

  it("不認得的環境或模式直接拒絕", async () => {
    const environment = await runReset(guarded, {
      mode: "data",
      environment: "qa",
      env: { RESET_ALLOW_ENV: "qa" },
    });
    expect(environment.status).toBe(1);
    expect(environment.stderr).toContain("--environment");

    const mode = await startEntry(
      RESET_ENTRY,
      [
        "--mode=wipe",
        "--environment=dev",
        `--confirm=${confirmationOf("dev", guarded, "wipe")}`,
      ],
      guarded,
      { RESET_ALLOW_ENV: "dev" },
    ).done;
    expect(mode.status).toBe(1);
    expect(mode.stderr).toContain("--mode");
    await expectUntouched();
  }, 120_000);
});

describe("以拋棄式資料庫模擬 production:完整確認才執行", () => {
  /** 連線字串帶一段不該出現在任何輸出裡的內容(真實環境是帳密與叢集參數)。 */
  const URI_MARKER = "uri-secret-marker";

  function productionUri(suffix: string): string {
    const uri = new URL(createTestDatabaseUri(suffix));
    uri.searchParams.set("appName", URI_MARKER);
    return uri.toString();
  }

  function expectNoSecrets(output: { stdout: string; stderr: string }): void {
    for (const text of [output.stdout, output.stderr]) {
      expect(text).not.toContain(URI_MARKER);
      expect(text).not.toContain("mongodb://");
      expect(text).not.toContain(ROOT_ADMIN_ENV.ROOT_ADMIN_PASSWORD);
    }
  }

  it("data:environment=production、允許清單含 production、確認完全相符 → 照常清人建資料並補種", async () => {
    const databaseUri = productionUri("production-data");
    await prepareDatabase(databaseUri);

    const result = await runReset(databaseUri, {
      mode: "data",
      environment: "production",
      env: { RESET_ALLOW_ENV: "dev,staging,production" },
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("環境 production");
    expectNoSecrets(result);

    const state = await readState(databaseUri);
    expect(state.orgs.map((org) => org.key)).toEqual(["root"]);
    expect(state.customers).toHaveLength(0);
    expect(state.modules).toHaveLength(39);
    // production 的 data reset 同樣保留 root 現值
    expect(state.orgs[0]).toMatchObject({ name: "專案營運組織" });
  }, 300_000);

  it("full:完整確認 → 整庫重建;缺任何一項(確認、環境、允許清單、資料庫名、模式)都零刪除", async () => {
    const databaseUri = productionUri("production-full");
    await prepareDatabase(databaseUri);
    const before = await dumpDatabase(databaseUri);
    const allow = { RESET_ALLOW_ENV: "production" };

    const rejected = [
      await runReset(databaseUri, {
        mode: "full",
        environment: "production",
        confirm: null,
        env: allow,
      }),
      // 以 dev 的確認打 production
      await runReset(databaseUri, {
        mode: "full",
        environment: "production",
        confirm: confirmationOf("dev", databaseUri, "full"),
        env: allow,
      }),
      await runReset(databaseUri, {
        mode: "full",
        environment: "production",
        confirm: "reset:production:cookhome:full",
        env: allow,
      }),
      await runReset(databaseUri, {
        mode: "full",
        environment: "production",
        confirm: confirmationOf("production", databaseUri, "data"),
        env: allow,
      }),
      // 允許清單沒有 production
      await runReset(databaseUri, {
        mode: "full",
        environment: "production",
        env: { RESET_ALLOW_ENV: "dev,staging" },
      }),
      // 環境選 dev、確認也寫 dev,但允許清單只有 production
      await runReset(databaseUri, {
        mode: "full",
        environment: "dev",
        env: allow,
      }),
    ];
    for (const result of rejected) {
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expectNoSecrets(result);
    }
    expect(await dumpDatabase(databaseUri)).toEqual(before);

    const result = await runReset(databaseUri, {
      mode: "full",
      environment: "production",
      env: allow,
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("環境 production");
    expect(result.stdout).toContain("模式 full");
    expectNoSecrets(result);

    const state = await readState(databaseUri);
    expect(state.customers).toHaveLength(0);
    expect(state.orgs.find((org) => org.key === "root")).toMatchObject({
      name: baseOnlyProjectSettings.rootOrg.name,
    });
    const applicationData = await dumpApplicationData(databaseUri);
    expect(Object.keys(applicationData)).toContain("changelog");
  }, 300_000);
});
