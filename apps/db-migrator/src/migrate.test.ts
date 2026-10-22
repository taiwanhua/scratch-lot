import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import {
  PACKAGE_ROOT,
  TestMongo,
  changelogOf,
  collectionNames,
  journalOf,
  lockOf,
  runUpdate,
  withDatabase,
} from "../test/support/update-harness";
import { sourceFileHashOf } from "./update/content-hash";

const DEMO_MIGRATION_FILENAME =
  "20260913120000_schema_changelog-filename-unique-index.js";

/** 一個目錄裡的遷移檔名(沒有這個目錄 = 空)。 */
function migrationFilesIn(...segments: string[]): string[] {
  const directory = path.join(PACKAGE_ROOT, "migrations", ...segments);
  return existsSync(directory)
    ? readdirSync(directory).filter((fileName) => fileName.endsWith(".js"))
    : [];
}

const byFileName = (left: string, right: string): number =>
  left.localeCompare(right, "zh-Hant");

/** migrations/ 根目錄的遷移檔(已發布的歷史檔;依檔名 = 執行順序)。 */
const MIGRATION_FILENAMES = migrationFilesIn().toSorted(byFileName);

/** `base/`、`project/` 的遷移檔與來源標籤(`migrate:status` 的第二欄)。 */
const SUBDIRECTORY_MIGRATIONS: ReadonlyMap<string, "base" | "project"> =
  new Map([
    ...migrationFilesIn("base").map((fileName) => [fileName, "base"] as const),
    ...migrationFilesIn("project").map(
      (fileName) => [fileName, "project"] as const,
    ),
  ]);

/** 全部來源的遷移檔(檔名全域唯一,依檔名 = 執行順序)。 */
const ALL_MIGRATION_FILENAMES = [
  ...MIGRATION_FILENAMES,
  ...SUBDIRECTORY_MIGRATIONS.keys(),
].toSorted(byFileName);

/**
 * 已發布的九支歷史 migration:檔名與內容(SHA-256,換行統一成 LF)都不可變 —— changelog 以檔名識別,
 * 改了內容等於換掉已執行過的轉換。新 migration 放 `migrations/base/` 或 `migrations/project/`,
 * 不再加到根目錄,所以這份清單不會再變長。
 */
const PUBLISHED_MIGRATIONS: Readonly<Record<string, string>> = {
  "20260913120000_schema_changelog-filename-unique-index.js":
    "sha256:a7b3dca549c476115af0eda038d8e9694947b122bdaf9b40f88eab94f39f83c4",
  "20260925120000_data_module-data-fields.js":
    "sha256:3d50f7c52c507729be9dd24399495746f2b10dd31dfdd5589161fe305a041350",
  "20260925120100_schema_data-scope-module-key.js":
    "sha256:70821fbf1a77d711e3da271ad4b3f4ae72fd6cc2690f081116989e740415a3e1",
  "20260925120200_data_org-slug-permission-source-module-engine.js":
    "sha256:85747ef4f4924140fd2cc4c29faadb6645bc115ab7a106043872a64313b13971",
  "20260927120000_data_form-temporal-values.js":
    "sha256:484ed26c6fb3fef9c6f1a3d7be024b105e8aaa64ca2a83714fbe1774bf3278ae",
  "20260927130000_data_remove-shopping-list-leave-modules.js":
    "sha256:5be66676e37f6276195d26116749c9de5666ef624e833a5be6b3edb23f0acad2",
  "20260928120000_data_field-category-enabled.js":
    "sha256:5143fa6e340c1e78d2753d9131c08c2b3e7c688911f649e134f9edc7a1a0f676",
  "20260928120000_data_form-revision-version.js":
    "sha256:66bc864434e8879e74dc10db6535118e33fd00a17fc37a619e4362013ddf529b",
  "20260929120000_data_data-scope-date-instants.js":
    "sha256:fb9dcb052e3336160c28fdd438c0982ecf22f5cbd192c84be2fa5dcdaeb5632a",
};

/** down 那一案保留的 collection:migration 的紀錄、執行紀錄、鎖,以及用來確認種子沒被回滾的根組織。 */
const KEPT_COLLECTIONS: ReadonlySet<string> = new Set([
  "changelog",
  "changelog_lock",
  "seed_update_runs",
  "orgs",
]);

const mongo = new TestMongo("db-migrator-migrate");

/** `migrate` 別名(等同 `pnpm --filter @repo/db-migrator migrate`)。 */
const runMigrate = (databaseUri: string) =>
  runUpdate(databaseUri, ["--alias=migrate"]);
/** `migrate:down`。 */
const runDown = (databaseUri: string) => runUpdate(databaseUri, ["--down"]);
/** `migrate:status`。 */
const runStatus = (databaseUri: string) => runUpdate(databaseUri, ["--status"]);

/** 第一支歷史 migration 建的 changelog.fileName 唯一索引(沒有回 undefined)。 */
async function uniqueFileNameIndexOf(databaseUri: string) {
  return withDatabase(databaseUri, async (database) => {
    const collections = await database
      .listCollections({ name: "changelog" })
      .toArray();
    const indexes =
      collections.length === 0
        ? []
        : await database.collection("changelog").indexes();
    return indexes.find(
      (index) => index.unique === true && index.key.fileName === 1,
    );
  });
}

beforeAll(async () => {
  await mongo.start();
}, 600_000);

afterAll(async () => {
  await mongo.stop();
}, 60_000);

describe("已發布的歷史 migration(靜態檢查)", () => {
  it("根目錄只有這九支,檔名與內容都與發布時相同", () => {
    expect(MIGRATION_FILENAMES).toEqual(Object.keys(PUBLISHED_MIGRATIONS));
    const actual = Object.fromEntries(
      MIGRATION_FILENAMES.map((fileName) => [
        fileName,
        sourceFileHashOf(
          readFileSync(path.join(PACKAGE_ROOT, "migrations", fileName)),
        ),
      ]),
    );
    expect(actual).toEqual(PUBLISHED_MIGRATIONS);
  });
});

describe("migrate 指令(update 的別名,對真 MongoDB)", () => {
  it("執行所有未跑過的遷移並記錄於 changelog,示範遷移效果落地", async () => {
    const databaseUri = mongo.uri("up");

    const result = await runMigrate(databaseUri);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const changelog = await changelogOf(databaseUri);
    expect(changelog.map((entry) => entry.fileName as string)).toEqual(
      ALL_MIGRATION_FILENAMES,
    );
    expect(changelog[0]?.fileName).toBe(DEMO_MIGRATION_FILENAME);
    expect(changelog[0]?.appliedAt).toBeInstanceOf(Date);
    // changelog 仍是 migrate-mongo 自己寫的形狀(沒有 file hash、沒有來源前綴)
    expect(new Set(Object.keys(changelog[0] ?? {}))).toEqual(
      new Set(["_id", "appliedAt", "fileName", "migrationBlock"]),
    );

    // 示範遷移(schema 類)的可觀察效果:changelog.fileName 唯一索引
    expect(await uniqueFileNameIndexOf(databaseUri)).toBeDefined();
    // 別名執行的是完整更新:migration 之後種子也落地,結束時鎖已釋放
    expect(result.stdout).toMatch(/seed 完成:新增 [1-9]\d* \//);
    expect(await lockOf(databaseUri)).toBeNull();
    const [run] = await journalOf(databaseUri, "run");
    expect(run).toMatchObject({ operation: "update", status: "succeeded" });
  }, 180_000);

  it("重跑第二次不重複執行已跑過的遷移(changelog 防重跑)", async () => {
    const databaseUri = mongo.uri("rerun");

    const firstRun = await runMigrate(databaseUri);
    expect(firstRun.status).toBe(0);
    const firstState = await changelogOf(databaseUri);

    const secondRun = await runMigrate(databaseUri);
    expect(secondRun.stderr).toBe("");
    expect(secondRun.status).toBe(0);

    expect(await changelogOf(databaseUri)).toEqual(firstState);
    expect(secondRun.stdout).toContain(
      `migration ${DEMO_MIGRATION_FILENAME}:skipped`,
    );
    expect(secondRun.stdout).toMatch(
      /seed 完成:新增 0 \/ 更新 0 \/ 認養 0 \/ 未變 [1-9]\d*/,
    );
  }, 180_000);

  it("既有環境的 changelog(改版前由 migrate-mongo 直接寫的)零重跑:紀錄、appliedAt 與資料都不動", async () => {
    const databaseUri = mongo.uri("legacy-changelog");
    const appliedAt = new Date("2026-09-30T01:02:03.000Z");
    await withDatabase(databaseUri, (database) =>
      database.collection("changelog").insertMany(
        MIGRATION_FILENAMES.map((fileName) => ({
          fileName,
          appliedAt,
          migrationBlock: 1,
        })),
      ),
    );
    const before = await changelogOf(databaseUri);

    const result = await runMigrate(databaseUri);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    // 歷史檔的紀錄不動;之後新增的 base / project migration 照常執行
    const after = await changelogOf(databaseUri);
    expect(
      after.filter((entry) =>
        MIGRATION_FILENAMES.includes(entry.fileName as string),
      ),
    ).toEqual(before);
    expect(after.map((entry) => entry.fileName as string)).toEqual(
      ALL_MIGRATION_FILENAMES,
    );
    for (const fileName of MIGRATION_FILENAMES) {
      expect(result.stdout).toContain(`migration ${fileName}:skipped`);
    }
    // 第一支沒有被重跑:它會建的唯一索引不存在
    expect(await uniqueFileNameIndexOf(databaseUri)).toBeUndefined();
    // 沒有為已執行的 migration 補造任何 journal(只有新執行的那幾支有)
    const journal = await journalOf(databaseUri, "migration");
    expect(
      journal.filter((record) =>
        MIGRATION_FILENAMES.includes(record.fileName as string),
      ),
    ).toEqual([]);
  }, 180_000);

  it("status 唯讀:列出所有來源與 changelog 的狀態,不建立任何 collection、不取得鎖", async () => {
    const databaseUri = mongo.uri("status");

    const fresh = await runStatus(databaseUri);
    expect(fresh.stderr).toBe("");
    expect(fresh.status).toBe(0);
    for (const fileName of MIGRATION_FILENAMES) {
      expect(fresh.stdout).toContain(`${fileName}  legacy  PENDING`);
    }
    for (const [fileName, origin] of SUBDIRECTORY_MIGRATIONS) {
      expect(fresh.stdout).toContain(`${fileName}  ${origin}  PENDING`);
    }
    expect(fresh.stdout).toContain("鎖:無");
    expect(await collectionNames(databaseUri)).toEqual([]);

    const migrated = await runMigrate(databaseUri);
    expect(migrated.status).toBe(0);
    const names = await collectionNames(databaseUri);
    const applied = await runStatus(databaseUri);
    expect(applied.status).toBe(0);
    expect(applied.stdout).not.toContain("PENDING");
    expect(applied.stdout).toContain("最近一次執行:update succeeded");
    expect(await collectionNames(databaseUri)).toEqual(names);
  }, 180_000);

  it("down 可逐支還原到空(up/down 成對走通;每次 down 退最後一支)", async () => {
    const databaseUri = mongo.uri("down");

    const upResult = await runMigrate(databaseUri);
    expect(upResult.status).toBe(0);
    // 這一案驗的是 up / down 本身成對:有些 down 在有資料時會(正確地)拒絕退回,
    // 所以把別名順帶種下的業務資料清掉,只留 migration 的紀錄與根組織
    await withDatabase(databaseUri, async (database) => {
      const collections = await database
        .listCollections({}, { nameOnly: true })
        .toArray();
      for (const { name } of collections) {
        if (!KEPT_COLLECTIONS.has(name)) {
          await database.collection(name).drop();
        }
      }
    });

    for (const fileName of ALL_MIGRATION_FILENAMES.toReversed()) {
      const downResult = await runDown(databaseUri);
      expect({
        fileName,
        status: downResult.status,
        stderr: downResult.stderr,
      }).toEqual({ fileName, status: 0, stderr: "" });
      expect(downResult.stdout).toContain(`已還原 ${fileName}`);
    }

    expect(await changelogOf(databaseUri)).toHaveLength(0);
    expect(await uniqueFileNameIndexOf(databaseUri)).toBeUndefined();
    // 每一支都留下還原紀錄;down 不回滾種子(根組織還在)
    const journal = await journalOf(databaseUri, "migration");
    expect(journal.map((record) => record.status as string)).toEqual(
      ALL_MIGRATION_FILENAMES.map(() => "rolled-back"),
    );
    expect(
      await withDatabase(databaseUri, (database) =>
        database.collection("orgs").countDocuments({ key: "root" }),
      ),
    ).toBe(1);

    const nothingLeft = await runDown(databaseUri);
    expect(nothingLeft.status).toBe(0);
    expect(nothingLeft.stdout).toContain("沒有可還原的 migration");
  }, 300_000);
});
