import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Connection } from "mongoose";

import type { AuthTestApp } from "../auth/test-support/auth-app";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { WORKFLOW_TEST_TIMEOUT_MS } from "../workflows/test-support/workflow-fixtures";
import {
  dumpApplicationData,
  runDataReset,
} from "./test-support/reset-command";
import {
  type SeedTestApp,
  formSeed,
  holdSeedLock,
  installationOf,
  releaseSeedLock,
  runSeed,
  runSeeds,
  startSeedTestApp,
} from "./test-support/seed-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

/** 有檢查點的服務(安裝流程)。 */
interface CheckpointHooks {
  reached(checkpoint: string): Promise<void>;
}

/** 第一次走到 `checkpoint` 時丟錯(其餘照常放行)。 */
function failCheckpointOnce(hooks: CheckpointHooks, checkpoint: string): void {
  let hasFailed = false;
  jest.spyOn(hooks, "reached").mockImplementation((reached) => {
    if (!hasFailed && reached === checkpoint) {
      hasFailed = true;
      return Promise.reject(new Error(`injected failure at ${checkpoint}`));
    }
    return Promise.resolve();
  });
}

/**
 * `data` reset 遇到做到一半的受管定義安裝要整次拒絕(`docs/concepts/data-layer-and-isolation.md`
 * 「還原」)。半成品由**真的安裝流程**在它自己的檢查點中斷產生(不是插進資料庫的標記),
 * reset 是真的 db-migrator 指令子行程:中斷 → reset 被拒絕且一筆都沒動 → 以原本的操作續完 → reset 放行。
 * 發布與退役各是一個交易,不會停在半路,所以不在預檢範圍。
 */
describe("data reset:中斷的安裝一律拒絕,不續裝也不清掉", () => {
  let app: SeedTestApp;
  let api: AuthTestApp;
  let connection: Connection;
  let databaseUri: string;

  beforeAll(async () => {
    app = await startSeedTestApp("cookhome-test-reset-interrupted");
    ({ api, connection } = app);
    databaseUri = process.env.MONGODB_URI ?? "";
    // 夾具模擬最外層命令持鎖;reset 自己就是最外層命令,要拿得到鎖
    await releaseSeedLock(connection);
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  /** reset 被拒絕:原因列出、應用資料一筆都沒動、鎖已釋放。 */
  async function expectRefused(reason: string): Promise<void> {
    const before = await dumpApplicationData(connection);
    const result = await runDataReset(databaseUri);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("data reset 預檢未通過(尚未刪除任何資料)");
    expect(result.stderr).toContain(reason);
    expect(await dumpApplicationData(connection)).toEqual(before);
    expect(await connection.collection("changelog_lock").countDocuments()).toBe(
      0,
    );
  }

  it("受管定義的安裝停在發布之前(安裝紀錄 in-progress):拒絕;以同一份宣告續跑完成後不再擋", async () => {
    const seed = formSeed("managed_interrupted", "r1");
    await holdSeedLock(connection);
    failCheckpointOnce(app.hooks, "publish");
    const interrupted = await runSeeds(app, [seed]);
    expect(interrupted.errors.length + interrupted.results.length).toBe(1);
    jest.restoreAllMocks();
    expect(await installationOf(connection, seed)).toMatchObject({
      status: "in-progress",
    });
    await releaseSeedLock(connection);

    await expectRefused(
      "受管定義 form-definition:managed_interrupted@r1 的安裝尚未完成(in-progress)",
    );
    // 沒有替它發布、也沒有把半成品清掉
    expect(await installationOf(connection, seed)).toMatchObject({
      status: "in-progress",
    });

    await holdSeedLock(connection);
    const resumed = await runSeed(app, seed);
    expect(resumed.conflict).toBeNull();
    await releaseSeedLock(connection);
    expect(await installationOf(connection, seed)).toMatchObject({
      status: "installed",
      localVersion: 1,
    });
  });

  it("全部續完之後:同一個資料庫的 data reset 放行,畫面自建與不在 registry 的定義連同安裝紀錄清掉", async () => {
    const result = await runDataReset(databaseUri);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    for (const collection of [
      "forms",
      "form_versions",
      "workflows",
      "workflow_versions",
      "seed_definition_installations",
    ]) {
      expect(await connection.collection(collection).countDocuments()).toBe(0);
    }
    expect(
      await connection
        .collection("permissions")
        .countDocuments({ source: "dynamic" }),
    ).toBe(0);
  });
});
