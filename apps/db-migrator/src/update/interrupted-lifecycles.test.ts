import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Db, ObjectId } from "mongodb";

import { runReset } from "../../test/support/reset-harness";
import {
  BASE_ONLY_REGISTRY,
  TestMongo,
  changelogOf,
  runUpdate,
  withDatabase,
} from "../../test/support/update-harness";
import { findInterruptedLifecycles } from "./interrupted-lifecycles";

/**
 * 底座交易化之前留下的中斷發布 / 退役(不清庫的升級才會遇到):update 與 data reset 的預檢都要擋下,
 * 每筆附處理方式;依 `docs/deployment.md`「舊版留下的發布 / 退役中斷」的步驟手動補完後就放行。
 * 夾具直接寫進資料庫(新版的 api 做不出這種資料)。
 */

const mongo = new TestMongo("db-migrator-interrupted-lifecycles");

const STORES = [
  {
    label: "表單",
    identities: "forms",
    versions: "form_versions",
    keyField: "formKey",
  },
  {
    label: "流程",
    identities: "workflows",
    versions: "workflow_versions",
    keyField: "workflowKey",
  },
] as const;

type Store = (typeof STORES)[number];

/** 一個身分 + 它的版本(`[版號, 狀態]`)。 */
async function seedDefinition(
  database: Db,
  store: Store,
  key: string,
  currentVersion: number | null,
  versions: [number | null, string][],
): Promise<ObjectId> {
  const identityId = new ObjectId();
  await database
    .collection(store.identities)
    .insertOne({ _id: identityId, key, currentVersion });
  for (const [version, status] of versions) {
    await database
      .collection(store.versions)
      .insertOne({ [store.keyField]: key, version, status });
  }
  return identityId;
}

function blockersOf(databaseUri: string): Promise<string[]> {
  return withDatabase(databaseUri, (database) =>
    findInterruptedLifecycles(database),
  );
}

beforeAll(async () => {
  await mongo.start();
});

afterAll(async () => {
  await mongo.stop();
}, 60_000);

describe("舊版留下的中斷發布 / 退役(唯讀檢查)", () => {
  it("乾淨的庫(已發布且是目前版本、已退役、草稿、從未發布)→ 沒有 blocker", async () => {
    const databaseUri = mongo.uri("clean");
    await withDatabase(databaseUri, async (database) => {
      for (const store of STORES) {
        await seedDefinition(database, store, "settled", 2, [
          [1, "retired"],
          [2, "published"],
          [null, "draft"],
        ]);
        await seedDefinition(database, store, "retired", null, [
          [1, "retired"],
        ]);
        await seedDefinition(database, store, "never", null, [[null, "draft"]]);
      }
    });
    expect(await blockersOf(databaseUri)).toEqual([]);
  });

  describe.each(STORES)("$label", (store) => {
    it("停在 publishing → blocker(第 1 種);改回草稿後放行", async () => {
      const databaseUri = mongo.uri(`publishing-${store.identities}`);
      await withDatabase(databaseUri, (database) =>
        seedDefinition(database, store, "stuck", 1, [
          [1, "published"],
          [2, "publishing"],
        ]),
      );
      const blockers = await blockersOf(databaseUri);
      expect(blockers).toHaveLength(1);
      expect(blockers[0]).toContain(
        `${store.label} stuck 的版本 2 停在 publishing`,
      );
      expect(blockers[0]).toContain("第 1 種");

      // 文件第 1 種的處理:改回草稿(之後在畫面重新發布)
      await withDatabase(databaseUri, (database) =>
        database
          .collection(store.versions)
          .updateOne(
            { [store.keyField]: "stuck", status: "publishing" },
            { $set: { status: "draft", version: null, changelog: null } },
          ),
      );
      expect(await blockersOf(databaseUri)).toEqual([]);
    });

    it("published 卻不是 currentVersion → blocker(第 2 種);補完切換後放行", async () => {
      const databaseUri = mongo.uri(`unswitched-${store.identities}`);
      const identityId = await withDatabase(databaseUri, (database) =>
        seedDefinition(database, store, "half", 1, [
          [1, "published"],
          [2, "published"],
        ]),
      );
      const blockers = await blockersOf(databaseUri);
      expect(blockers).toHaveLength(1);
      expect(blockers[0]).toContain(
        `${store.label} half 的版本 2 已是 published,但 currentVersion 是 1`,
      );
      expect(blockers[0]).toContain(identityId.toHexString());
      expect(blockers[0]).toContain("第 2 種");

      // 文件第 2 種的處理:其餘 published 改 retired,currentVersion 指向新版
      await withDatabase(databaseUri, async (database) => {
        await database.collection(store.versions).updateMany(
          {
            [store.keyField]: "half",
            status: "published",
            version: { $ne: 2 },
          },
          { $set: { status: "retired" } },
        );
        await database
          .collection(store.identities)
          .updateOne({ _id: identityId }, { $set: { currentVersion: 2 } });
      });
      expect(await blockersOf(databaseUri)).toEqual([]);
    });

    it("currentVersion 指到不是 published 的版本 → blocker(第 3 種);補完退役後放行", async () => {
      const databaseUri = mongo.uri(`retiring-${store.identities}`);
      const identityId = await withDatabase(databaseUri, (database) =>
        seedDefinition(database, store, "retiring", 1, [[1, "retired"]]),
      );
      const blockers = await blockersOf(databaseUri);
      expect(blockers).toHaveLength(1);
      expect(blockers[0]).toContain(
        `${store.label} retiring 的 currentVersion 指向版本 1,但它不是 published`,
      );
      expect(blockers[0]).toContain("第 3 種");

      // 文件第 3 種的處理:currentVersion 清成 null
      await withDatabase(databaseUri, (database) =>
        database
          .collection(store.identities)
          .updateOne({ _id: identityId }, { $set: { currentVersion: null } }),
      );
      expect(await blockersOf(databaseUri)).toEqual([]);
    });
  });
});

describe("update 與 data reset 的預檢", () => {
  it("update:有舊中斷 → 執行任何 migration 之前就拒絕,並指向處理說明", async () => {
    const databaseUri = mongo.uri("update-blocked");
    await withDatabase(databaseUri, (database) =>
      seedDefinition(database, STORES[0], "stuck", 1, [
        [1, "published"],
        [2, "publishing"],
      ]),
    );

    const result = await runUpdate(databaseUri, [BASE_ONLY_REGISTRY]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("update 預檢未通過");
    expect(result.stderr).toContain("表單 stuck 的版本 2 停在 publishing");
    expect(result.stderr).toContain(
      "docs/deployment.md「舊版留下的發布 / 退役中斷」",
    );
    expect(await changelogOf(databaseUri)).toEqual([]);
  }, 300_000);

  it("data reset:有舊中斷 → 刪除之前就拒絕", async () => {
    const databaseUri = mongo.uri("reset-blocked");
    await withDatabase(databaseUri, (database) =>
      seedDefinition(database, STORES[1], "half", 1, [
        [1, "published"],
        [2, "published"],
      ]),
    );

    const result = await runReset(databaseUri, {
      mode: "data",
      args: [BASE_ONLY_REGISTRY],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("data reset 預檢未通過");
    expect(result.stderr).toContain(
      "流程 half 的版本 2 已是 published,但 currentVersion 是 1",
    );
    const remaining = await withDatabase(databaseUri, (database) =>
      database.collection("workflow_versions").countDocuments(),
    );
    expect(remaining).toBe(2);
  }, 300_000);
});
