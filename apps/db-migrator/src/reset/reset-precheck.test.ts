import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import { runReset } from "../../test/support/reset-harness";
import {
  BASE_ONLY_REGISTRY,
  BUILD_TIMEOUT_MS,
  PACKAGE_ROOT,
  SEED_ENTRY,
  TestMongo,
  buildDefinitionCli,
  documentsOf,
  dumpDatabase,
  startEntry,
  withDatabase,
} from "../../test/support/update-harness";

/**
 * reset 的零刪除預檢(對真 MongoDB):之後的 update 跑不完時,`data` 與 `full` 都要在**刪除之前**拒絕。
 * 以夾具 registry 驗(`--registry=`):組裝時撞 key、缺 root 初始帳號的環境變數;
 * 另驗登記了版本化定義的 registry 由同一次 reset 經 api 的受管定義 CLI 發布(不再是「這個入口不能發布」)。
 */

const mongo = new TestMongo("db-migrator-reset-precheck");

function fixtureRegistry(fixtureName: string): string {
  return `--registry=${path.join(PACKAGE_ROOT, "test", "fixtures", fixtureName, "registry.ts")}`;
}

/**
 * 底座種子(空專案來源的夾具 registry)+ 一些人建的資料(租戶組織、業務表),reset 成功的話這些會被刪掉。
 * 不用正式 registry:之後的 reset 換上夾具 registry,起點若已裝了引用專案登記的同 key 模組或定義,
 * 「補上專案模組」與「定義首次發布(created)」就不是這裡要驗的情境。
 */
async function prepareDatabase(databaseUri: string): Promise<void> {
  const seeded = await startEntry(SEED_ENTRY, [BASE_ONLY_REGISTRY], databaseUri)
    .done;
  expect(seeded.stderr).toBe("");
  expect(seeded.status).toBe(0);
  await withDatabase(databaseUri, async (database) => {
    const now = new Date();
    await database.collection("orgs").insertOne({
      name: "人建的租戶",
      enabled: true,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    });
    await database.collection("customers").insertOne({ name: "客戶甲" });
  });
}

beforeAll(async () => {
  await mongo.start();
  await buildDefinitionCli();
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
  await mongo.stop();
}, 60_000);

describe("reset 的零刪除預檢", () => {
  it.each(["data", "full"] as const)(
    "%s:registry 組裝不合法(專案重宣告底座的種子)→ 刪除之前就拒絕,資料庫原封不動",
    async (mode) => {
      const databaseUri = mongo.uri(`collision-${mode}`);
      await prepareDatabase(databaseUri);
      const before = await dumpDatabase(databaseUri);

      const result = await runReset(databaseUri, {
        mode,
        args: [fixtureRegistry("seeds-collision")],
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("orgs.root 重複宣告(base 與 project)");
      expect(result.stdout).toBe("");
      // 連鎖與執行紀錄都沒有動:來源不合法時還沒有連線
      expect(await dumpDatabase(databaseUri)).toEqual(before);
    },
    180_000,
  );

  it.each(["data", "full"] as const)(
    "%s:缺 root 初始帳號的環境變數(之後的種子補不回 root)→ 刪除之前就拒絕,資料庫原封不動",
    async (mode) => {
      const databaseUri = mongo.uri(`root-env-${mode}`);
      await prepareDatabase(databaseUri);
      const before = await dumpDatabase(databaseUri);

      const result = await runReset(databaseUri, {
        mode,
        env: { RESET_ALLOW_ENV: "dev", ROOT_ADMIN_PASSWORD: undefined },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("ROOT_ADMIN_PASSWORD");
      expect(result.stdout).toBe("");
      expect(await dumpDatabase(databaseUri)).toEqual(before);
    },
    180_000,
  );

  it("對照組:同一個資料庫用合法的夾具 registry(底座 + 專案來源,沒有定義)做 data reset 會照常刪人建資料並補種", async () => {
    const databaseUri = mongo.uri("valid-data");
    await prepareDatabase(databaseUri);

    const result = await runReset(databaseUri, {
      mode: "data",
      args: [fixtureRegistry("seeds-project")],
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const after = await dumpDatabase(databaseUri);
    expect(after.customers).toEqual([]);
    expect(after.orgs).toHaveLength(1);
    // 專案來源的模組由同一次執行的 seed 補上
    expect(after.modules).toHaveLength(42 + 8);
  }, 180_000);

  it.each(["data", "full"] as const)(
    "%s:registry 登記了版本化定義 → 同一次 reset 在同一把鎖內經 api 的受管定義 CLI 發布,不需要另外執行 update",
    async (mode) => {
      const databaseUri = mongo.uri(`definition-${mode}`);
      await prepareDatabase(databaseUri);

      const result = await runReset(databaseUri, {
        mode,
        args: [fixtureRegistry("seeds-definition")],
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "定義 form-definition:project_request@r1 → 版本 1(created)",
      );
      expect(result.stdout).toContain(
        "定義 workflow-definition:project_review@r1 → 版本 1(created)",
      );

      expect(
        await documentsOf(databaseUri, "forms", { key: "project_request" }),
      ).toMatchObject([{ currentVersion: 1 }]);
      expect(
        await documentsOf(databaseUri, "workflows", { key: "project_review" }),
      ).toMatchObject([{ currentVersion: 1 }]);
      expect(await documentsOf(databaseUri, "customers")).toEqual([]);
      const installations = await documentsOf(
        databaseUri,
        "seed_definition_installations",
      );
      expect(installations.map((item) => item.status as string)).toEqual([
        "installed",
        "installed",
      ]);
    },
    300_000,
  );
});
