import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { FORM_TEST_TIMEOUT_MS } from "../forms/test-support/form-fixtures";
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

jest.setTimeout(FORM_TEST_TIMEOUT_MS * 4);

const LAST_MIGRATION = "20260929120000_data_data-scope-date-instants.js";

/**
 * 中斷的受管定義安裝不會被 `migrate:down` 越過(`docs/deployment.md`「設定與資料更新」:
 * 存在未完成 update 時 down 拒絕)。安裝在這裡由原服務**真的**中斷(安裝流程的檢查點丟錯,留下 in-progress
 * 的安裝紀錄),down / update 則是 db-migrator 的真指令(子行程)對同一個資料庫。
 *
 * 重點情境:中斷之後換了一份**不再登記該定義**的 registry,update 可以成功 —— 最近一次執行是成功的,
 * 但那筆安裝仍未完成,down 不能因此放行。
 */
describe("migrate:down 不越過中斷的受管定義安裝", () => {
  let app: SeedTestApp;

  beforeAll(async () => {
    app = await startSeedTestApp("cookhome-test-seed-down-guard");
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.api.close();
  }, HOOK_TIMEOUT_MS);

  function changelogFileNames(): Promise<string[]> {
    return app.connection
      .collection("changelog")
      .find<{ fileName: string }>({})
      .sort({ fileName: 1 })
      .map(({ fileName }) => fileName)
      .toArray();
  }

  function rollbackRecords(): Promise<number> {
    return app.connection.collection("seed_update_runs").countDocuments({
      type: "migration",
      status: { $in: ["rollback-in-progress", "rolled-back"] },
    });
  }

  it("安裝真的中斷後,不含該定義的 registry 讓 update 成功:down 仍被拒絕且零寫入;以原 revision 續跑完成後 down 才可行", async () => {
    const seed = formSeed("down_guard_form", "r1");

    // 真中斷:草稿已建、存檔那一步之前失敗,安裝紀錄停在 in-progress
    jest
      .spyOn(app.hooks, "reached")
      .mockImplementation((checkpoint) =>
        checkpoint === "save-draft"
          ? Promise.reject(new Error("injected failure at save-draft"))
          : Promise.resolve(),
      );
    const interrupted = await runSeeds(app, [seed]);
    expect(interrupted.errors).toHaveLength(1);
    jest.restoreAllMocks();
    expect(await installationOf(app.connection, seed)).toMatchObject({
      status: "in-progress",
    });

    // 之後以沒有登記這張表單的 registry(空專案來源的夾具)跑 update:成功,成為最近一次執行
    await releaseSeedLock(app.connection);
    const updated = await app.api.runUpdate([]);
    expect(updated.stderr).toBe("");
    expect(updated.status).toBe(0);
    expect(await installationOf(app.connection, seed)).toMatchObject({
      status: "in-progress",
    });
    const changelog = await changelogFileNames();
    expect(changelog.at(-1)).toBe(LAST_MIGRATION);

    const down = await app.api.runUpdate(["--down"]);
    expect(down.status).toBe(1);
    expect(down.stderr).toContain("有未完成的受管定義安裝");
    expect(down.stderr).toContain("form-definition:down_guard_form@r1");
    expect(await changelogFileNames()).toEqual(changelog);
    expect(await rollbackRecords()).toBe(0);
    // down 只拒絕,不替它發布或清理
    expect(await installationOf(app.connection, seed)).toMatchObject({
      status: "in-progress",
    });

    // 以同一個 revision / 內容真的續跑完成(由持鎖的安裝流程接續)
    await holdSeedLock(app.connection);
    const resumed = await runSeed(app, seed);
    expect(resumed.conflict).toBeNull();
    expect(await installationOf(app.connection, seed)).toMatchObject({
      status: "installed",
    });
    await releaseSeedLock(app.connection);

    // 已完成的安裝紀錄留著也不再擋
    const allowed = await app.api.runUpdate(["--down"]);
    expect(allowed.stderr).toBe("");
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain(`已還原 ${LAST_MIGRATION}`);
    expect(await changelogFileNames()).toEqual(changelog.slice(0, -1));
  });
});
