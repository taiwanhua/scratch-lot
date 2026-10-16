import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Db, MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PACKAGE_ROOT,
  "migrations",
  "20260927130000_data_remove-shopping-list-leave-modules.js",
);

/**
 * 直接 import 遷移檔、呼叫 `up` `times` 次(不經 migrate-mongo 的 changelog 防重跑)——
 * 驗的是遷移**本身**冪等。遷移檔是 ESM,jest 這邊是 CJS,所以在子行程裡跑。
 */
const RUN_UP_DIRECTLY = `
import { pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";
const [uri, times, file, failOn = ""] = process.argv.slice(1);
const client = await MongoClient.connect(uri);
// failOn = collection 名:對它的第一個 deleteMany 丟錯,模擬遷移跑到一半中斷
const failing = (db) => ({
  collection: (name) => {
    const collection = db.collection(name);
    if (name !== failOn) return collection;
    return new Proxy(collection, {
      get: (target, key) =>
        key === "deleteMany"
          ? async () => { throw new Error("模擬中斷:" + name); }
          : Reflect.get(target, key).bind?.(target) ?? Reflect.get(target, key),
    });
  },
});
try {
  const migration = await import(pathToFileURL(file).href);
  for (let round = 0; round < Number(times); round += 1) {
    await migration.up(failOn === "" ? client.db() : failing(client.db()));
  }
} finally {
  await client.close();
}
`;

/** 沿用 jest globalSetup 起的單一成員 replica set(MONGODB_URI);沒有時自起 MongoMemoryReplSet。 */
let memoryServer: MongoMemoryReplSet | undefined;
let baseUri: string;
const clients: MongoClient[] = [];

function databaseUriOf(suffix: string): string {
  const uri = new URL(baseUri);
  uri.pathname = `/db-migrator-retired-forms-${String(process.pid)}-${suffix}`;
  return uri.toString();
}

async function openDatabase(databaseUri: string): Promise<Db> {
  const client = await MongoClient.connect(databaseUri);
  clients.push(client);
  return client.db();
}

function runUpDirectly(databaseUri: string, times: number, failOn = "") {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      RUN_UP_DIRECTLY,
      databaseUri,
      String(times),
      MIGRATION,
      failOn,
    ],
    { cwd: PACKAGE_ROOT, encoding: "utf8" },
  );
}

/** 舊模組兩個 + 留下來的對照組(示範表單)一個,各自的模組樹、權限、資料。 */
const RETIRED = ["shopping-list", "leave"] as const;
const KEPT = "demo-form";

const tenantId = new ObjectId();
const roleId = new ObjectId();
const moduleIdOf = new Map<string, ObjectId>();
const formIdOf = new Map<string, ObjectId>();
const workflowIdOf = new Map<string, ObjectId>();

function idIn(ids: Map<string, ObjectId>, key: string): ObjectId {
  const id = ids.get(key);
  if (id === undefined) {
    throw new Error(`前置沒有建 ${key}`);
  }
  return id;
}

function moduleKeysOf(owner: string): string[] {
  return [
    owner,
    `${owner}.view-page`,
    `${owner}.create-page`,
    `${owner}.edit-page`,
  ];
}

/** 模組樹 + 權限 + 角色授予(一個角色把每個節點與每筆權限都授了)。 */
async function seedModuleTree(database: Db, owner: string): Promise<void> {
  const ownerId = new ObjectId();
  for (const key of moduleKeysOf(owner)) {
    const id = key === owner ? ownerId : new ObjectId();
    moduleIdOf.set(key, id);
    await database.collection("modules").insertOne({
      _id: id,
      key,
      name: key,
      parentId: key === owner ? null : ownerId,
      engine: key === owner ? "form" : "fixed",
    });
  }
  const permissionKeys = [
    ...moduleKeysOf(owner).map((key) => `${key}.*`),
    `${owner}.view`,
    `${owner}.create`,
    `${owner}.edit`,
    `${owner}.delete`,
    // 表單發布產生的欄位級權限
    `${owner}.show-${owner.replace("-", "_")}_form-amount`,
  ];
  for (const key of permissionKeys) {
    const permissionId = new ObjectId();
    const ownerKey = key.slice(0, key.lastIndexOf("."));
    await database.collection("permissions").insertOne({
      _id: permissionId,
      key,
      moduleId: moduleIdOf.get(ownerKey),
      source: key.includes(".show-") ? "dynamic" : "seed",
    });
    await database.collection("core_relationships").insertOne({
      type: "role_permission",
      firstId: roleId,
      secondId: permissionId,
      thirdId: null,
    });
  }
  for (const key of moduleKeysOf(owner)) {
    await database.collection("core_relationships").insertOne({
      type: "role_module",
      firstId: roleId,
      secondId: moduleIdOf.get(key),
      thirdId: null,
    });
  }
}

/** 資料範圍、表單、流程、業務關聯與執行期資料。 */
async function seedModuleData(database: Db, owner: string): Promise<void> {
  await database.collection("data_scope_targets").insertOne({
    collection: "form_submissions",
    moduleKey: owner,
    name: owner,
  });
  await database.collection("data_scope_rules").insertOne({
    collection: "form_submissions",
    moduleKey: owner,
    combineOp: "OR",
    conditions: [],
  });

  const formKey = `${owner.replace("-", "_")}_form`;
  const formId = new ObjectId();
  formIdOf.set(owner, formId);
  await database.collection("forms").insertOne({
    _id: formId,
    key: formKey,
    moduleKey: owner,
    name: formKey,
  });
  await database
    .collection("form_versions")
    .insertOne({ formKey, version: 1, status: "published" });

  const workflowKey = `${owner.replace("-", "_")}_review`;
  const workflowId = new ObjectId();
  workflowIdOf.set(owner, workflowId);
  await database
    .collection("workflows")
    .insertOne({ _id: workflowId, key: workflowKey, name: workflowKey });
  await database
    .collection("workflow_versions")
    .insertOne({ workflowKey, version: 1, status: "published" });

  await database.collection("business_relationships").insertMany([
    {
      tenantId,
      type: "org_form",
      firstId: tenantId,
      secondId: formId,
      thirdId: null,
    },
    {
      tenantId,
      type: "org_workflow",
      firstId: tenantId,
      secondId: workflowId,
      thirdId: null,
    },
    {
      tenantId,
      type: "org_form_workflow",
      firstId: tenantId,
      secondId: formId,
      thirdId: workflowId,
    },
  ]);

  const submissionId = new ObjectId();
  await database.collection("form_submissions").insertOne({
    _id: submissionId,
    moduleKey: owner,
    formKey,
    version: 1,
    status: "reviewing",
  });
  const instanceId = new ObjectId();
  await database.collection("workflow_instances").insertOne({
    _id: instanceId,
    moduleKey: owner,
    submissionId,
    formKey,
    workflowKey,
    status: "running",
  });
  await database.collection("workflow_tasks").insertOne({
    instanceId,
    moduleKey: owner,
    formKey,
    status: "pending",
  });
}

async function seedPreState(database: Db): Promise<void> {
  for (const owner of [...RETIRED, KEPT]) {
    await seedModuleTree(database, owner);
    await seedModuleData(database, owner);
  }

  // 被舊模組與留下的模組共用的流程:舊模組的綁定刪掉,流程本身留著
  const sharedWorkflowId = new ObjectId();
  workflowIdOf.set("shared", sharedWorkflowId);
  await database
    .collection("workflows")
    .insertOne({ _id: sharedWorkflowId, key: "shared_review", name: "共用" });
  await database
    .collection("workflow_versions")
    .insertOne({ workflowKey: "shared_review", version: 1 });
  for (const owner of ["leave", KEPT]) {
    await database.collection("business_relationships").insertOne({
      tenantId,
      type: "org_form_workflow",
      firstId: tenantId,
      secondId: formIdOf.get(owner),
      thirdId: sharedWorkflowId,
    });
  }
}

const RETIRED_KEY_PATTERN = /^(shopping-list|leave)(\.|$)/;

async function countRetired(database: Db): Promise<Record<string, number>> {
  const byModuleKey = { moduleKey: { $regex: RETIRED_KEY_PATTERN } };
  const retiredFormIds = RETIRED.map((owner) => idIn(formIdOf, owner));
  const retiredWorkflowIds = RETIRED.map((owner) => idIn(workflowIdOf, owner));
  return {
    modules: await database
      .collection("modules")
      .countDocuments({ key: { $regex: RETIRED_KEY_PATTERN } }),
    permissions: await database
      .collection("permissions")
      .countDocuments({ key: { $regex: RETIRED_KEY_PATTERN } }),
    roleGrants: await database.collection("core_relationships").countDocuments({
      secondId: {
        $nin: [
          ...(await database
            .collection("modules")
            .distinct("_id", { key: { $regex: /^demo-form/ } })),
          ...(await database
            .collection("permissions")
            .distinct("_id", { key: { $regex: /^demo-form/ } })),
        ],
      },
    }),
    dataScopeTargets: await database
      .collection("data_scope_targets")
      .countDocuments(byModuleKey),
    dataScopeRules: await database
      .collection("data_scope_rules")
      .countDocuments(byModuleKey),
    forms: await database.collection("forms").countDocuments(byModuleKey),
    formVersions: await database.collection("form_versions").countDocuments({
      formKey: { $in: ["shopping_list_form", "leave_form"] },
    }),
    formSubmissions: await database
      .collection("form_submissions")
      .countDocuments(byModuleKey),
    workflows: await database
      .collection("workflows")
      .countDocuments({ _id: { $in: retiredWorkflowIds } }),
    workflowVersions: await database
      .collection("workflow_versions")
      .countDocuments({
        workflowKey: { $in: ["shopping_list_review", "leave_review"] },
      }),
    workflowInstances: await database
      .collection("workflow_instances")
      .countDocuments(byModuleKey),
    workflowTasks: await database
      .collection("workflow_tasks")
      .countDocuments(byModuleKey),
    businessRelationships: await database
      .collection("business_relationships")
      .countDocuments({
        $or: [
          { secondId: { $in: [...retiredFormIds, ...retiredWorkflowIds] } },
          { thirdId: { $in: retiredWorkflowIds } },
        ],
      }),
  };
}

beforeAll(async () => {
  if (process.env.MONGODB_URI) {
    baseUri = process.env.MONGODB_URI;
  } else {
    memoryServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    baseUri = memoryServer.getUri();
  }
}, 600_000);

afterAll(async () => {
  for (const client of clients) {
    await client.db().dropDatabase();
    await client.close();
  }
  await memoryServer?.stop();
}, 60_000);

describe("遷移:移除 shopping-list / leave 兩個舊表單模組", () => {
  let database: Db;

  beforeAll(async () => {
    const databaseUri = databaseUriOf("once");
    database = await openDatabase(databaseUri);
    await seedPreState(database);
    const result = runUpDirectly(databaseUri, 1);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 120_000);

  it("舊模組的模組樹、權限、角色授予、資料範圍、表單、提交、流程與關聯全部查不到", async () => {
    const counts = await countRetired(database);
    for (const [collection, count] of Object.entries(counts)) {
      expect([collection, count]).toEqual([collection, 0]);
    }
  });

  it("留下的示範表單原封不動:模組樹、權限、角色授予、表單、提交、流程都還在", async () => {
    expect(
      await database
        .collection("modules")
        .countDocuments({ key: { $regex: /^demo-form/ } }),
    ).toBe(4);
    // 4 個 wildcard + 4 個動作 + 1 個欄位級
    expect(
      await database
        .collection("permissions")
        .countDocuments({ key: { $regex: /^demo-form/ } }),
    ).toBe(9);
    expect(
      await database.collection("core_relationships").countDocuments(),
    ).toBe(13);
    const keptOnly = { moduleKey: KEPT };
    for (const collection of [
      "data_scope_targets",
      "data_scope_rules",
      "forms",
      "form_submissions",
      "workflow_instances",
      "workflow_tasks",
    ]) {
      expect([
        collection,
        await database.collection(collection).countDocuments(),
      ]).toEqual([
        collection,
        await database.collection(collection).countDocuments(keptOnly),
      ]);
      expect(
        await database.collection(collection).countDocuments(keptOnly),
      ).toBe(1);
    }
    expect(
      await database
        .collection("form_versions")
        .countDocuments({ formKey: "demo_form_form" }),
    ).toBe(1);
    // 示範表單自己的流程 + 與舊模組共用的流程都留著(仍被示範表單綁定)
    const keptWorkflowKeys = await database
      .collection("workflows")
      .distinct("key");
    expect(new Set(keptWorkflowKeys)).toEqual(
      new Set(["demo_form_review", "shared_review"]),
    );
    expect(
      await database.collection("workflow_versions").countDocuments(),
    ).toBe(2);
    // 示範表單的 org_form / org_workflow / org_form_workflow ×2(自己的 + 共用的)
    expect(
      await database.collection("business_relationships").countDocuments(),
    ).toBe(4);
  });

  it("重跑冪等:再跑兩次不報錯、結果不變", async () => {
    const databaseUri = databaseUriOf("once");
    const result = runUpDirectly(databaseUri, 2);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const counts = await countRetired(database);
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    expect(
      await database.collection("business_relationships").countDocuments(),
    ).toBe(4);
    expect(await database.collection("workflows").countDocuments()).toBe(2);
  }, 120_000);
});

describe("遷移:中途中斷後重跑仍刪乾淨", () => {
  let database: Db;

  beforeAll(async () => {
    const databaseUri = databaseUriOf("interrupted");
    database = await openDatabase(databaseUri);
    await seedPreState(database);
    // 跑到刪完關聯與實例、要刪 forms 時中斷:認流程用的 org_form_workflow / workflow_instances 已經沒了
    const interrupted = runUpDirectly(databaseUri, 1, "forms");
    expect(interrupted.status).not.toBe(0);
    expect(interrupted.stderr).toContain("模擬中斷:forms");
    const result = runUpDirectly(databaseUri, 1);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 120_000);

  it("舊模組的資料(含只屬於它們的流程)全部查不到;共用流程留著", async () => {
    const counts = await countRetired(database);
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    expect(
      new Set(await database.collection("workflows").distinct("key")),
    ).toEqual(new Set(["demo_form_review", "shared_review"]));
  });
});

describe("遷移:沒有綁定的流程怎麼判", () => {
  let database: Db;

  beforeAll(async () => {
    const databaseUri = databaseUriOf("workflow-criteria");
    database = await openDatabase(databaseUri);
    const cases: [string, string[]][] = [
      // 沒被綁、只被其他模組的實例用過
      ["other_only_review", [KEPT]],
      // 沒被綁、舊模組與其他模組的實例都用過
      ["mixed_review", ["leave", KEPT]],
      // 沒被綁、只被舊模組的實例用過
      ["retired_only_review", ["shopping-list"]],
    ];
    for (const [workflowKey, moduleKeys] of cases) {
      await database
        .collection("workflows")
        .insertOne({ key: workflowKey, name: workflowKey });
      await database
        .collection("workflow_versions")
        .insertOne({ workflowKey, version: 1 });
      for (const moduleKey of moduleKeys) {
        await database.collection("workflow_instances").insertOne({
          moduleKey,
          workflowKey,
          formKey: `${moduleKey.replace("-", "_")}_form`,
        });
      }
    }
    const result = runUpDirectly(databaseUri, 1);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 120_000);

  it("只被其他模組的實例用過 → 保留;也被其他模組用過 → 保留", async () => {
    expect(
      new Set(await database.collection("workflows").distinct("key")),
    ).toEqual(new Set(["other_only_review", "mixed_review"]));
    expect(
      new Set(
        await database.collection("workflow_versions").distinct("workflowKey"),
      ),
    ).toEqual(new Set(["other_only_review", "mixed_review"]));
  });

  it("只被舊模組的實例用過、從沒綁過 → 刪(連同版本);舊模組的實例刪掉、其他模組的留著", async () => {
    expect(
      await database
        .collection("workflows")
        .countDocuments({ key: "retired_only_review" }),
    ).toBe(0);
    expect(
      await database.collection("workflow_instances").distinct("moduleKey"),
    ).toEqual([KEPT]);
    expect(
      await database.collection("workflow_instances").countDocuments(),
    ).toBe(2);
  });
});
