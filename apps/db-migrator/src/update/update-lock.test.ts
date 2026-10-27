import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import {
  FAULT_ENTRY,
  HARD_ABORT_EXIT_CODE,
  SEED_ENTRY,
  TestMongo,
  changelogOf,
  collectionNames,
  journalOf,
  lockOf,
  migrationFileNames,
  runUpdate,
  runUpdateWithFault,
  startEntry,
} from "../../test/support/update-harness";

/**
 * 整批互斥與 down 的保護(`docs/deployment.md`「設定與資料更新」),
 * 以正式來源(全部 migration 與正式 registry)對真的拋棄式 MongoDB。
 */

const FIRST = "20260913120000_schema_changelog-filename-unique-index.js";
const SECOND = "20260925120000_data_module-data-fields.js";
/** 最後一支(含 base/、project/ 子目錄;down 一次退的就是它)。 */
const MIGRATIONS = migrationFileNames();
const LAST = MIGRATIONS.at(-1) ?? "";
const MIGRATION_COUNT = MIGRATIONS.length;

const mongo = new TestMongo("db-migrator-lock");

async function changelogNames(databaseUri: string): Promise<string[]> {
  const changelog = await changelogOf(databaseUri);
  return changelog.map((entry) => entry.fileName as string);
}

async function openStatuses(databaseUri: string): Promise<string[]> {
  const journal = await journalOf(databaseUri, "migration");
  return journal
    .filter(
      (record) =>
        record.status !== "applied" && record.status !== "rolled-back",
    )
    .map((record) => `${String(record.fileName)}:${String(record.status)}`);
}

/** 輪詢直到條件成立(另一個程序走到指定的步驟)。 */
async function waitFor(
  probe: () => Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await probe()) {
      return;
    }
    await delay(100);
  }
  throw new Error(`等待「${label}」逾時`);
}

beforeAll(async () => {
  await mongo.start();
}, 600_000);

afterAll(async () => {
  await mongo.stop();
}, 60_000);

describe("兩個程序不能同時寫", () => {
  it("第一個程序執行中:第二個 update、seed 別名與 down 都立刻被擋且零寫入;第一個照常完成", async () => {
    const databaseUri = mongo.uri("two-processes");
    const release = path.join(
      mkdtempSync(path.join(os.tmpdir(), "db-migrator-lock-")),
      "release",
    );

    // 第一個程序:記下第二支 migration 的 started 之後停住,直到放行檔出現
    const first = startEntry(
      FAULT_ENTRY,
      [`migration-started@${SECOND}`, `wait:${release}`],
      databaseUri,
    );
    await waitFor(async () => {
      const open = await openStatuses(databaseUri);
      return open.includes(`${SECOND}:started`);
    }, "第一個程序停在第二支 migration");
    const lock = await lockOf(databaseUri);
    expect(lock).toMatchObject({ operation: "update" });
    const before = {
      changelog: await changelogOf(databaseUri),
      collections: await collectionNames(databaseUri),
      journal: await journalOf(databaseUri, "migration"),
      runs: await journalOf(databaseUri, "run"),
    };
    expect(before.changelog.map((entry) => entry.fileName as string)).toEqual([
      FIRST,
    ]);

    const second = await runUpdate(databaseUri);
    const secondSeed = await startEntry(SEED_ENTRY, [], databaseUri).done;
    const secondDown = await runUpdate(databaseUri, ["--down"]);
    for (const result of [second, secondSeed, secondDown]) {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("無法取得整批互斥鎖");
      expect(result.stderr).toContain(`owner ${String(lock?.owner)}`);
    }
    expect(secondSeed.stderr).toMatch(/^seed 失敗:/);
    // 被擋下的三次沒有留下任何東西:沒有新的 collection、changelog、journal 或執行紀錄
    expect({
      changelog: await changelogOf(databaseUri),
      collections: await collectionNames(databaseUri),
      journal: await journalOf(databaseUri, "migration"),
      runs: await journalOf(databaseUri, "run"),
    }).toEqual(before);
    expect(await lockOf(databaseUri)).toEqual(lock);

    writeFileSync(release, "");
    const finished = await first.done;
    expect(finished.stderr).toBe("");
    expect(finished.status).toBe(0);
    expect(await changelogNames(databaseUri)).toHaveLength(MIGRATION_COUNT);
    expect(await lockOf(databaseUri)).toBeNull();

    // 鎖釋放後,下一個程序正常執行
    const next = await runUpdate(databaseUri);
    expect(next.stderr).toBe("");
    expect(next.status).toBe(0);
  }, 300_000);
});

describe("down 與 update 互相不繞過", () => {
  it("有未完成的 update 時 down 被拒絕;update 接續完成後才能 down", async () => {
    const databaseUri = mongo.uri("down-blocked");

    const interrupted = await runUpdateWithFault(
      databaseUri,
      [],
      `migration-up-done@${SECOND}`,
    );
    expect(interrupted.status).toBe(1);
    expect(await openStatuses(databaseUri)).toEqual([`${SECOND}:started`]);
    const changelog = await changelogOf(databaseUri);

    const down = await runUpdate(databaseUri, ["--down"]);
    expect(down.status).toBe(1);
    expect(down.stderr).toContain("有未完成的 update");
    expect(down.stderr).toContain(`${SECOND}:started`);
    expect(await changelogOf(databaseUri)).toEqual(changelog);
    expect(await openStatuses(databaseUri)).toEqual([`${SECOND}:started`]);
    expect(await lockOf(databaseUri)).toBeNull();

    const resumed = await runUpdate(databaseUri);
    expect(resumed.stderr).toBe("");
    expect(resumed.status).toBe(0);
    expect(await changelogNames(databaseUri)).toHaveLength(MIGRATION_COUNT);
  }, 300_000);

  it("down 中斷在執行前:update 被拒絕、不把它補記成功;down 接續完成後,update 重新執行那一支", async () => {
    const databaseUri = mongo.uri("rollback-started");
    const installed = await runUpdate(databaseUri);
    expect(installed.status).toBe(0);
    const applied = await changelogOf(databaseUri);

    const interrupted = await runUpdateWithFault(
      databaseUri,
      ["--down"],
      `rollback-started@${LAST}`,
    );
    expect(interrupted.status).toBe(1);
    expect(await openStatuses(databaseUri)).toEqual([
      `${LAST}:rollback-in-progress`,
    ]);
    // down 還沒執行:changelog 紀錄還在
    expect(await changelogOf(databaseUri)).toEqual(applied);

    const rejected = await runUpdate(databaseUri);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(`${LAST} 的還原(down)尚未完成`);
    expect(await changelogOf(databaseUri)).toEqual(applied);
    expect(await openStatuses(databaseUri)).toEqual([
      `${LAST}:rollback-in-progress`,
    ]);

    const down = await runUpdate(databaseUri, ["--down"]);
    expect(down.stderr).toBe("");
    expect(down.status).toBe(0);
    expect(down.stdout).toContain(`已還原 ${LAST}`);
    expect(await changelogNames(databaseUri)).not.toContain(LAST);
    expect(await openStatuses(databaseUri)).toEqual([]);

    // 還原後這一支恢復為未執行:update 重新執行它(新的一筆紀錄),其餘不重跑
    const reapplied = await runUpdate(databaseUri);
    expect(reapplied.stderr).toBe("");
    expect(reapplied.status).toBe(0);
    expect(reapplied.stdout).toContain(`migration ${LAST}:applied(`);
    expect(reapplied.stdout).toContain(`migration ${FIRST}:skipped`);
    const after = await changelogOf(databaseUri);
    expect(after.slice(0, -1)).toEqual(applied.slice(0, -1));
    const journal = await journalOf(databaseUri, "migration");
    expect(
      journal
        .filter((record) => record.fileName === LAST)
        .map((record) => record.status as string),
    ).toEqual(["rolled-back", "applied"]);
  }, 300_000);

  it("down 做完、只差最後一筆紀錄時中斷:接續時不再執行 down,只補記", async () => {
    const databaseUri = mongo.uri("rollback-done");
    const installed = await runUpdate(databaseUri);
    expect(installed.status).toBe(0);

    const interrupted = await runUpdateWithFault(
      databaseUri,
      ["--down"],
      `rollback-done@${LAST}`,
    );
    expect(interrupted.status).toBe(1);
    // 原套件已刪掉 changelog 紀錄,journal 還停在還原中
    expect(await changelogNames(databaseUri)).not.toContain(LAST);
    expect(await openStatuses(databaseUri)).toEqual([
      `${LAST}:rollback-in-progress`,
    ]);
    const rejected = await runUpdate(databaseUri);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(`${LAST} 的還原(down)尚未完成`);

    const down = await runUpdate(databaseUri, ["--down"]);
    expect(down.stderr).toBe("");
    expect(down.status).toBe(0);
    expect(down.stdout).toContain(`已還原 ${LAST}`);
    expect(await openStatuses(databaseUri)).toEqual([]);
    // 只補記這一支,沒有再往前多退一支
    expect(await changelogNames(databaseUri)).toHaveLength(MIGRATION_COUNT - 1);
  }, 300_000);
});

describe("update 的 migration 都完成、但整批還沒完成:down 不越過它", () => {
  it("update 停在普通種子之後(失敗):down 被拒絕且零 migration 寫入;update 接續完成後 down 正常", async () => {
    const databaseUri = mongo.uri("unfinished-seeds");

    const interrupted = await runUpdateWithFault(
      databaseUri,
      [],
      "seeds-applied",
    );
    expect(interrupted.status).toBe(1);
    // migration 全數記完、沒有未完成的 migration 紀錄;未完成的是這次執行本身
    expect(await changelogNames(databaseUri)).toHaveLength(MIGRATION_COUNT);
    expect(await openStatuses(databaseUri)).toEqual([]);
    const failedRuns = await journalOf(databaseUri, "run");
    expect(failedRuns.at(-1)).toMatchObject({
      operation: "update",
      status: "failed",
      stage: "seeds",
    });
    const changelog = await changelogOf(databaseUri);
    const journal = await journalOf(databaseUri, "migration");

    const down = await runUpdate(databaseUri, ["--down"]);
    expect(down.status).toBe(1);
    expect(down.stderr).toContain("有未完成的 update");
    expect(down.stderr).toContain(String(failedRuns.at(-1)?.runId));
    expect(await changelogOf(databaseUri)).toEqual(changelog);
    expect(await journalOf(databaseUri, "migration")).toEqual(journal);
    expect(await lockOf(databaseUri)).toBeNull();

    // 接續完成(歷史上的失敗紀錄仍保留)之後,down 不再被它擋住
    const resumed = await runUpdate(databaseUri);
    expect(resumed.stderr).toBe("");
    expect(resumed.status).toBe(0);
    const runs = await journalOf(databaseUri, "run");
    expect(
      runs
        .filter((run) => run.operation === "update")
        .map((run) => run.status as string),
    ).toEqual(["failed", "succeeded"]);
    const allowed = await runUpdate(databaseUri, ["--down"]);
    expect(allowed.stderr).toBe("");
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain(`已還原 ${LAST}`);
    // 成功的 down 之後可以再 down 一支(邊界是最近一次 update,不是 down 自己)
    const again = await runUpdate(databaseUri, ["--down"]);
    expect(again.stderr).toBe("");
    expect(again.status).toBe(0);
    expect(await changelogNames(databaseUri)).toHaveLength(MIGRATION_COUNT - 2);
  }, 300_000);

  it("update 在普通種子之後被硬中止、鎖由操作者解除(aborted):down 仍被拒絕,直到 update 完成", async () => {
    const databaseUri = mongo.uri("unfinished-aborted");

    const aborted = await runUpdateWithFault(
      databaseUri,
      [],
      "seeds-applied",
      "exit",
    );
    expect(aborted.status).toBe(HARD_ABORT_EXIT_CODE);
    const lock = await lockOf(databaseUri);
    const unlocked = await runUpdate(databaseUri, [
      `--unlock-owner=${String(lock?.owner)}`,
    ]);
    expect(unlocked.status).toBe(0);
    const changelog = await changelogOf(databaseUri);

    const down = await runUpdate(databaseUri, ["--down"]);
    expect(down.status).toBe(1);
    expect(down.stderr).toContain("有未完成的 update");
    expect(down.stderr).toContain("aborted");
    expect(await changelogOf(databaseUri)).toEqual(changelog);

    const resumed = await runUpdate(databaseUri);
    expect(resumed.status).toBe(0);
    const allowed = await runUpdate(databaseUri, ["--down"]);
    expect(allowed.stderr).toBe("");
    expect(allowed.status).toBe(0);
  }, 300_000);
});
