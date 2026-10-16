import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Db, MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PACKAGE_ROOT,
  "migrations",
  "20260927120000_data_form-temporal-values.js",
);

/**
 * 直接 import 遷移檔、呼叫 `up` `times` 次(不經 migrate-mongo 的 changelog 防重跑)——
 * 驗的是遷移**本身**冪等。遷移檔是 ESM,jest 這邊是 CJS,所以在子行程裡跑。
 */
const RUN_UP_DIRECTLY = `
import { pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";
const [uri, times, file, direction = "up"] = process.argv.slice(1);
const client = await MongoClient.connect(uri);
try {
  const migration = await import(pathToFileURL(file).href);
  for (let round = 0; round < Number(times); round += 1) {
    await migration[direction](client.db());
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
  uri.pathname = `/db-migrator-temporal-${String(process.pid)}-${suffix}`;
  return uri.toString();
}

async function openDatabase(databaseUri: string): Promise<Db> {
  const client = await MongoClient.connect(databaseUri);
  clients.push(client);
  return client.db();
}

function runUpDirectly(
  databaseUri: string,
  times: number,
  direction: "up" | "down" = "up",
) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      RUN_UP_DIRECTLY,
      databaseUri,
      String(times),
      MIGRATION,
      direction,
    ],
    { cwd: PACKAGE_ROOT, encoding: "utf8" },
  );
}

const rootOrgId = new ObjectId("0000000000000000000d0001");
const tenantId = new ObjectId("0000000000000000000d0002");
const completedId = new ObjectId("0000000000000000000e0001");
const draftId = new ObjectId("0000000000000000000e0002");
const migratedId = new ObjectId("0000000000000000000e0003");
const instanceId = new ObjectId("0000000000000000000f0001");
const draftVersionId = new ObjectId("0000000000000000000f0002");
const publishedVersionId = new ObjectId("0000000000000000000f0003");

/** 「改存 Date 之前」的資料:date 存 `YYYY-MM-DD`、datetime 存 ISO 字串。 */
async function seedPreState(database: Db): Promise<void> {
  await database.collection("orgs").insertMany([
    { _id: rootOrgId, name: "根", parentId: null, ancestors: [], settings: {} },
    {
      _id: tenantId,
      name: "東京分店",
      parentId: rootOrgId,
      ancestors: [rootOrgId],
      settings: { timezone: "Asia/Tokyo" },
    },
  ]);
  await database.collection("form_versions").insertMany([
    {
      _id: publishedVersionId,
      formKey: "trip",
      version: 1,
      fields: [
        { key: "title", type: "text" },
        { key: "day", type: "date" },
        { key: "meeting", type: "datetime" },
      ],
      summaryMap: { title: "title", date: "day" },
    },
    {
      // 草稿:定義裡的日期字串(上下限、預設值、固定值、表達式常數)
      _id: draftVersionId,
      formKey: "trip",
      version: null,
      status: "draft",
      fields: [
        { key: "title", type: "text", valueSource: { kind: "input" } },
        {
          key: "day",
          type: "date",
          valueSource: { kind: "input" },
          rules: { required: true, min: "2026-01-01", max: "2026-12-31" },
          default: { kind: "constant", value: "2026-09-26" },
          visibleWhen: { ">=": [{ var: "day" }, "2026-01-01"] },
        },
        {
          key: "fixed_day",
          type: "date",
          valueSource: { kind: "constant", value: "2026-09-26" },
        },
        {
          key: "gap",
          type: "number",
          valueSource: {
            kind: "computed",
            expr: { dateDiff: [{ var: "day" }, "2026-10-01", "days"] },
          },
        },
        {
          key: "meeting",
          type: "datetime",
          valueSource: { kind: "input" },
          rules: { min: "2026-01-01T00:00:00Z" },
        },
      ],
      summaryMap: { title: "title" },
    },
  ]);
  await database.collection("form_submissions").insertMany([
    {
      // 已完成、改過一次:修訂 1 在台北送出、修訂 2 在紐約修改
      _id: completedId,
      formKey: "trip",
      version: 1,
      tenantId,
      status: "completed",
      values: {
        title: "2026-09-26",
        day: "2026-09-27",
        meeting: "2026-09-26T05:30:00Z",
      },
      summary: { title: "2026-09-26", date: "2026-09-27" },
      revisions: [
        {
          revision: 1,
          values: {
            title: "2026-09-26",
            day: "2026-09-26",
            meeting: "2026-09-26T05:30:00Z",
          },
          ctx: {
            at: new Date("2026-09-26T06:00:00Z"),
            timezone: "Asia/Taipei",
          },
        },
        {
          revision: 2,
          values: {
            title: "2026-09-26",
            day: "2026-09-27",
            meeting: "2026-09-26T05:30:00Z",
          },
          ctx: {
            at: new Date("2026-09-27T06:00:00Z"),
            timezone: "America/New_York",
          },
        },
      ],
    },
    {
      // 草稿:沒有修訂 → 租戶時區(東京)
      _id: draftId,
      formKey: "trip",
      version: 1,
      tenantId,
      status: "draft",
      values: { title: "草稿", day: "2026-09-26", meeting: null },
      summary: null,
      revisions: [],
    },
    {
      // 已經是 Date 的不動
      _id: migratedId,
      formKey: "trip",
      version: 1,
      tenantId,
      status: "draft",
      values: { day: new Date("2026-09-25T15:00:00.000Z") },
      summary: null,
      revisions: [],
    },
  ]);
  await database.collection("workflow_instances").insertOne({
    _id: instanceId,
    submissionId: completedId,
    revision: 1,
    summary: { title: "2026-09-26", date: "2026-09-26" },
  });
}

async function snapshotOf(database: Db): Promise<unknown> {
  return {
    submissions: await database
      .collection("form_submissions")
      .find({}, { sort: { _id: 1 } })
      .toArray(),
    instances: await database
      .collection("workflow_instances")
      .find({}, { sort: { _id: 1 } })
      .toArray(),
    versions: await database
      .collection("form_versions")
      .find({}, { sort: { _id: 1 } })
      .toArray(),
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

describe("遷移:表單提交的日期 / 日期時間字串 → Date", () => {
  let database: Db;

  beforeAll(async () => {
    const databaseUri = databaseUriOf("once");
    database = await openDatabase(databaseUri);
    await seedPreState(database);
    const result = runUpDirectly(databaseUri, 1);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 600_000);

  it("date 以該修訂的 ctx.timezone 算當地 00:00;datetime 直接 parse;文字欄不動", async () => {
    const completed = await database
      .collection("form_submissions")
      .findOne({ _id: completedId });
    const revisions = completed?.revisions as {
      values: Record<string, unknown>;
    }[];
    // 修訂 1:台北 09-26 00:00
    expect(revisions[0]?.values.day).toEqual(
      new Date("2026-09-25T16:00:00.000Z"),
    );
    // 修訂 2 與目前值、摘要:紐約 09-27 00:00(EDT)
    expect(revisions[1]?.values.day).toEqual(
      new Date("2026-09-27T04:00:00.000Z"),
    );
    expect(completed?.values).toEqual({
      title: "2026-09-26",
      day: new Date("2026-09-27T04:00:00.000Z"),
      meeting: new Date("2026-09-26T05:30:00.000Z"),
    });
    expect(completed?.summary).toEqual({
      title: "2026-09-26",
      date: new Date("2026-09-27T04:00:00.000Z"),
    });
  });

  it("草稿沒有修訂 → 租戶時區(東京);已是 Date 的不動;null 不動", async () => {
    const draft = await database
      .collection("form_submissions")
      .findOne({ _id: draftId });
    expect(draft?.values).toEqual({
      title: "草稿",
      day: new Date("2026-09-25T15:00:00.000Z"),
      meeting: null,
    });
    const migrated = await database
      .collection("form_submissions")
      .findOne({ _id: migratedId });
    expect(migrated?.values).toEqual({
      day: new Date("2026-09-25T15:00:00.000Z"),
    });
  });

  it("流程實例的摘要快照用它那個修訂的時區", async () => {
    const instance = await database
      .collection("workflow_instances")
      .findOne({ _id: instanceId });
    expect(instance?.summary).toEqual({
      title: "2026-09-26",
      date: new Date("2026-09-25T16:00:00.000Z"),
    });
  });
});

describe("遷移:版本定義裡的日期字串 → ISO(Asia/Taipei 00:00)", () => {
  it("日期欄的上下限、預設值、固定值與表達式常數換成 ISO;已是 ISO 與非日期字串不動", async () => {
    const databaseUri = databaseUriOf("definitions");
    const database = await openDatabase(databaseUri);
    await seedPreState(database);
    const result = runUpDirectly(databaseUri, 1);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const draft = await database
      .collection("form_versions")
      .findOne({ _id: draftVersionId });
    const fields = draft?.fields as Record<string, unknown>[];
    const byKey = new Map(fields.map((field) => [field.key, field]));
    expect(byKey.get("day")).toMatchObject({
      rules: {
        required: true,
        min: "2025-12-31T16:00:00.000Z",
        max: "2026-12-30T16:00:00.000Z",
      },
      default: { kind: "constant", value: "2026-09-25T16:00:00.000Z" },
      visibleWhen: { ">=": [{ var: "day" }, "2025-12-31T16:00:00.000Z"] },
    });
    expect(byKey.get("fixed_day")).toMatchObject({
      valueSource: { kind: "constant", value: "2026-09-25T16:00:00.000Z" },
    });
    expect(byKey.get("gap")).toMatchObject({
      valueSource: {
        kind: "computed",
        expr: {
          dateDiff: [{ var: "day" }, "2026-09-30T16:00:00.000Z", "days"],
        },
      },
    });
    expect(byKey.get("meeting")).toMatchObject({
      rules: { min: "2026-01-01T00:00:00Z" },
    });
    expect(byKey.get("title")).toEqual({
      key: "title",
      type: "text",
      valueSource: { kind: "input" },
    });
  }, 120_000);
});

describe("遷移的 down:還原成改存 Date 之前的形狀(依版本定義的欄位型別)", () => {
  it("date 欄 → 該修訂時區的 YYYY-MM-DD、datetime 欄 → 秒級 ISO;摘要槽對日期欄 → YYYY-MM-DD", async () => {
    const databaseUri = databaseUriOf("down");
    const database = await openDatabase(databaseUri);
    await seedPreState(database);
    expect(runUpDirectly(databaseUri, 1).status).toBe(0);
    const reverted = runUpDirectly(databaseUri, 1, "down");
    expect(reverted.stderr).toBe("");
    expect(reverted.status).toBe(0);

    const completed = await database
      .collection("form_submissions")
      .findOne({ _id: completedId });
    expect(completed?.values).toEqual({
      title: "2026-09-26",
      day: "2026-09-27",
      meeting: "2026-09-26T05:30:00Z",
    });
    expect(
      (completed?.revisions as { values: Record<string, unknown> }[]).map(
        (revision) => revision.values.day,
      ),
    ).toEqual(["2026-09-26", "2026-09-27"]);
    expect(completed?.summary).toEqual({
      title: "2026-09-26",
      date: "2026-09-27",
    });
    const draft = await database
      .collection("form_submissions")
      .findOne({ _id: draftId });
    expect(draft?.values).toEqual({
      title: "草稿",
      day: "2026-09-26",
      meeting: null,
    });
    const instance = await database
      .collection("workflow_instances")
      .findOne({ _id: instanceId });
    expect(instance?.summary).toEqual({
      title: "2026-09-26",
      date: "2026-09-26",
    });
  }, 120_000);
});

describe("遷移本身冪等:直接呼叫 up 兩次,結果與一次相同", () => {
  it("跑一次 vs 跑兩次(不經 changelog)→ 資料一模一樣", async () => {
    const onceUri = databaseUriOf("up-once");
    const twiceUri = databaseUriOf("up-twice");
    const once = await openDatabase(onceUri);
    const twice = await openDatabase(twiceUri);
    await seedPreState(once);
    await seedPreState(twice);

    const first = runUpDirectly(onceUri, 1);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    const second = runUpDirectly(twiceUri, 2);
    expect(second.stderr).toBe("");
    expect(second.status).toBe(0);

    expect(await snapshotOf(twice)).toEqual(await snapshotOf(once));
  }, 120_000);
});
