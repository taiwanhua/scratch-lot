import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Document, ObjectId } from "mongodb";

import {
  LEGACY,
  MARKER,
  TICKET,
  TICKET_INDEX,
  TICKET_V2,
  TICKET_V3,
  V1,
  V3,
  V3_MIGRATIONS,
  completedId,
  draftId,
  formOf,
  inFlightId,
  insertV1Data,
  installationsOf,
  versionsOf,
} from "../../test/support/update-evolve";
import {
  BUILD_TIMEOUT_MS,
  SEED_ENTRY,
  TestMongo,
  buildDefinitionCli,
  changelogOf,
  documentsOf,
  fixtureSourceRoot,
  journalOf,
  lockOf,
  migrationFileNames,
  runUpdate,
  startEntry,
  withDatabase,
} from "../../test/support/update-harness";

/**
 * 累積版本升級與全新安裝(`docs/concepts/data-layer-and-isolation.md`「Migration 與設定順序」):
 * 真的拋棄式 MongoDB、真的 update 指令子行程、真的 api 受管定義 CLI(不 mock 發布)。
 *
 * 夾具 `test/fixtures/update-evolve/`:版本 1 登記工單第一版與舊版登記表;版本 3 把工單改到第三版、
 * 不再登記舊版登記表,並帶兩支依賴快照的資料 migration(第一版 → 第二版 → 第三版)。
 */

/** 兩次部署各自的設定 commit(與 api image 的 SHA 無關)。 */
const COMMIT_V1 = "1111111111111111111111111111111111111111";
const COMMIT_V3 = "3333333333333333333333333333333333333333";

const mongo = new TestMongo("db-migrator-upgrade");

beforeAll(async () => {
  await mongo.start();
  await buildDefinitionCli();
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
  await mongo.stop();
}, 60_000);

describe("版本 1 的真資料直接升到版本 3", () => {
  let upgraded: string;
  let changelogV1: Document[];
  let inFlightBefore: Document[];
  let instancesBefore: Document[];

  it("版本 1:migration、種子與兩張共用表單的初版落地,設定 commit 記在執行紀錄", async () => {
    upgraded = mongo.uri("upgrade");

    const result = await runUpdate(upgraded, [V1], { GITHUB_SHA: COMMIT_V1 });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    changelogV1 = await changelogOf(upgraded);
    expect(changelogV1.map((entry) => entry.fileName as string)).toEqual([
      MARKER,
    ]);
    expect(await formOf(upgraded, TICKET)).toMatchObject({ currentVersion: 1 });
    expect(await formOf(upgraded, LEGACY)).toMatchObject({ currentVersion: 1 });
    const installations = await installationsOf(upgraded);
    expect(
      installations.map(({ key, revision, status, releaseCommit }) => ({
        key: key as string,
        revision: revision as string,
        status: status as string,
        releaseCommit: releaseCommit as string,
      })),
    ).toEqual([
      {
        key: LEGACY,
        revision: "r1",
        status: "installed",
        releaseCommit: COMMIT_V1,
      },
      {
        key: TICKET,
        revision: "r1",
        status: "installed",
        releaseCommit: COMMIT_V1,
      },
    ]);
    const [run] = await journalOf(upgraded, "run");
    expect(run).toMatchObject({
      operation: "update",
      status: "succeeded",
      stage: "done",
      releaseCommit: COMMIT_V1,
    });
    expect(await lockOf(upgraded)).toBeNull();

    await insertV1Data(upgraded);
    inFlightBefore = await documentsOf(upgraded, "form_submissions", {
      _id: inFlightId,
    });
    instancesBefore = await documentsOf(upgraded, "workflow_instances");
  }, 300_000);

  it("版本 3:先以不可變的第二版快照做明示轉換,再第三版;歷史 changelog 不動、不重跑", async () => {
    const result = await runUpdate(upgraded, [V3], { GITHUB_SHA: COMMIT_V3 });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    // 舊 changelog 原封不動(同一筆 _id 與 appliedAt),新的三支依完整檔名排序
    const changelog = await changelogOf(upgraded);
    expect(changelog[0]).toEqual(changelogV1[0]);
    expect(changelog.map((entry) => entry.fileName as string)).toEqual(
      V3_MIGRATIONS,
    );
    const marks = await documentsOf(upgraded, "update_fixture_marks");
    const markOf = (id: string) => marks.find((mark) => mark._id === id);
    expect(markOf("ticket-marker")).toMatchObject({ runs: 1 });
    expect(result.stdout).toContain(`migration ${MARKER}:skipped`);

    // 定義:第二、三版各自以新的本地版號發布,第一版保留;安裝紀錄映射 revision → 本地版號
    expect(await formOf(upgraded, TICKET)).toMatchObject({ currentVersion: 3 });
    const versions = await versionsOf(upgraded, TICKET);
    expect(versions.map((version) => version.version as number)).toEqual([
      1, 2, 3,
    ]);
    const installations = await installationsOf(upgraded);
    const ticketInstallations = installations
      .filter((item) => item.key === TICKET)
      .map(({ revision, status, localVersion, releaseCommit }) => ({
        revision: revision as string,
        status: status as string,
        localVersion: localVersion as number,
        releaseCommit: releaseCommit as string,
      }));
    expect(ticketInstallations).toEqual([
      {
        revision: "r1",
        status: "installed",
        localVersion: 1,
        releaseCommit: COMMIT_V1,
      },
      {
        revision: "r2",
        status: "installed",
        localVersion: 2,
        releaseCommit: COMMIT_V3,
      },
      {
        revision: "r3",
        status: "installed",
        localVersion: 3,
        releaseCommit: COMMIT_V3,
      },
    ]);

    // 資料:沒走流程的兩筆經第二版再到第三版;修訂原樣
    const submissions = await documentsOf(upgraded, "form_submissions");
    const byId = (id: ObjectId) =>
      submissions.find((submission) => id.equals(submission._id as ObjectId));
    expect(byId(draftId)).toMatchObject({
      version: 3,
      values: { title: "草稿", priority: "normal", note: "" },
    });
    expect(byId(completedId)).toMatchObject({
      version: 3,
      values: { title: "已完成", priority: "normal", note: "" },
      revision: 1,
      revisions: [{ version: 1, kind: "edit", values: { title: "修訂前" } }],
    });
    // 走流程中的提交與流程實例完全不動(仍是第一版)
    expect([byId(inFlightId)]).toEqual(inFlightBefore);
    expect(await documentsOf(upgraded, "workflow_instances")).toEqual(
      instancesBefore,
    );

    // 第二版的 migration 拿到的是第二版在這個環境的映射(不是目前 registry 的第三版)
    const upMark = markOf(`up:${TICKET_V2}`);
    expect(upMark).toMatchObject({ runs: 1 });
    const runs = await journalOf(upgraded, "run");
    const run = runs.at(-1);
    expect(run).toMatchObject({
      status: "succeeded",
      releaseCommit: COMMIT_V3,
    });
    const [context] = upMark?.contexts as Document[];
    expect(context).toMatchObject({
      runId: run?.runId as string,
      releaseCommit: COMMIT_V3,
      definitions: [{ key: TICKET, revision: "r2", localVersion: 2 }],
    });
    expect(result.stdout).toContain(
      `migration ${TICKET_V2}:applied(資料 處理 2 / 跳過 1 / 衝突 0;verify 通過)`,
    );
    expect(result.stdout).toContain(
      `migration ${TICKET_V3}:applied(資料 處理 2 / 跳過 0 / 衝突 0;verify 通過)`,
    );
    expect(result.stdout).toContain(
      `migration ${TICKET_INDEX}:applied(資料筆數未回報;verify 通過)`,
    );

    // journal:依賴安裝前記下當時的檢視(第二版尚未安裝、目前內容是第一版),最後都是 applied
    const journal = await journalOf(upgraded, "migration");
    const recordOf = (fileName: string) =>
      journal.find((record) => record.fileName === fileName);
    expect(recordOf(TICKET_V2)).toMatchObject({
      status: "applied",
      mode: "convert",
      inspection: {
        pending: [
          "project/revisions/ticket-priority.c1.seed.ts",
          "project/revisions/project-form-module.m1.seed.ts",
          "project/revisions/update_ticket.r2.seed.ts",
        ],
      },
      context: { definitions: [{ revision: "r2", localVersion: 2 }] },
      stats: { processed: 2, skipped: 1, conflicts: 0 },
    });
    expect(
      (recordOf(TICKET_V2)?.checkpoints as Document[]).map(
        (checkpoint) => checkpoint.status as string,
      ),
    ).toEqual(["preparing", "started", "verified", "applied"]);
    expect(recordOf(TICKET_INDEX)).toMatchObject({
      status: "applied",
      mode: "plain",
    });
    expect(recordOf(TICKET_V3)).toMatchObject({
      status: "applied",
      mode: "convert",
    });
    expect(recordOf(MARKER)).toMatchObject({ runId: expect.any(String) });

    // 已移除宣告的舊版登記表:不退役、不刪除
    expect(await formOf(upgraded, LEGACY)).toMatchObject({ currentVersion: 1 });
    // 歷史的普通種子快照套用過,最後仍以目前 registry 的內容為準
    expect(
      await documentsOf(upgraded, "field_categories", {
        key: "ticket-priority",
      }),
    ).toMatchObject([{ name: "優先度" }]);
    // 執行紀錄的摘要:revision → 本地版號
    expect(run?.report).toMatchObject({
      definitions: [{ key: TICKET, revision: "r3", localVersion: 3 }],
    });
    expect(run?.planHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await lockOf(upgraded)).toBeNull();
  }, 300_000);

  it("同一版本重跑:不增版、不重跑 migration、changelog 與提交都不變", async () => {
    const changelog = await changelogOf(upgraded);
    const submissions = await documentsOf(upgraded, "form_submissions");
    const versions = await versionsOf(upgraded, TICKET);

    const result = await runUpdate(upgraded, [V3], { GITHUB_SHA: COMMIT_V3 });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    expect(await changelogOf(upgraded)).toEqual(changelog);
    expect(await documentsOf(upgraded, "form_submissions")).toEqual(
      submissions,
    );
    expect(await versionsOf(upgraded, TICKET)).toEqual(versions);
    expect(result.stdout).toMatch(
      /seed 完成:新增 0 \/ 更新 0 \/ 認養 0 \/ 未變 [1-9]\d*/,
    );
    expect(result.stdout).toContain(
      `定義 form-definition:${TICKET}@r3 → 版本 3(unchanged)`,
    );
  }, 300_000);

  it("全新資料庫直接裝版本 3:沒有舊資料就不做歷史轉換,只建立目前登記的定義,不重建已移除的", async () => {
    const fresh = mongo.uri("fresh");

    const result = await runUpdate(fresh, [V3], { GITHUB_SHA: COMMIT_V3 });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const changelog = await changelogOf(fresh);
    expect(changelog.map((entry) => entry.fileName as string)).toEqual(
      V3_MIGRATIONS,
    );
    // 兩支資料 migration 都是 no-op(verify 通過才記),沒有呼叫 assertSeedInstallable 與 up
    expect(result.stdout).toContain(
      `migration ${TICKET_V2}:applied(no-op:沒有待轉換的資料;verify 通過)`,
    );
    const marks = await documentsOf(fresh, "update_fixture_marks");
    expect(marks.map((mark) => mark._id as string)).toEqual(["ticket-marker"]);
    const journal = await journalOf(fresh, "migration");
    expect(
      journal
        .filter((record) => record.mode === "noop")
        .map((record) => ({
          fileName: record.fileName as string,
          status: record.status as string,
          definitions: (record.context as Document).definitions as unknown[],
        })),
    ).toEqual([
      { fileName: TICKET_V2, status: "applied", definitions: [] },
      { fileName: TICKET_V3, status: "applied", definitions: [] },
    ]);

    // 只有目前登記的第三版:一個版本、一筆安裝紀錄;第一、二版與舊版登記表都沒有被建立
    expect(await formOf(fresh, LEGACY)).toBeUndefined();
    expect(await formOf(fresh, TICKET)).toMatchObject({ currentVersion: 1 });
    expect(await versionsOf(fresh, TICKET)).toHaveLength(1);
    const [installation, ...others] = await installationsOf(fresh);
    expect(others).toEqual([]);
    expect(installation).toMatchObject({
      key: TICKET,
      revision: "r3",
      localVersion: 1,
    });

    // 兩個環境:定義的 id 與本地版號不同,目標內容的 hash 相同
    const upgradedInstallations = await installationsOf(upgraded);
    const upgradedR3 = upgradedInstallations.find(
      (item) => item.key === TICKET && item.revision === "r3",
    );
    expect(installation?.contentHash).toBe(upgradedR3?.contentHash);
    expect(installation?.snapshotHash).toBe(upgradedR3?.snapshotHash);
    expect(String(installation?.definitionId)).not.toBe(
      String(upgradedR3?.definitionId),
    );
    expect(upgradedR3?.localVersion).toBe(3);
  }, 300_000);

  it("status 也列出 base / project 的新 migration 與它們的來源", async () => {
    const pending = mongo.uri("status");

    const before = await runUpdate(pending, [V3, "--status"]);
    expect(before.stderr).toBe("");
    expect(before.status).toBe(0);
    expect(before.stdout).toContain(`${MARKER}  legacy  PENDING`);
    expect(before.stdout).toContain(`${TICKET_V2}  project  PENDING`);
    expect(before.stdout).toContain(`${TICKET_INDEX}  base  PENDING`);
    expect(before.stdout).toContain(`${TICKET_V3}  project  PENDING`);

    const after = await runUpdate(upgraded, [V3, "--status"]);
    expect(after.status).toBe(0);
    expect(after.stdout).not.toContain("PENDING");
    expect(after.stdout).toContain("鎖:無");
  }, 120_000);

  it("down:最後一支沒有 down 實作就拒絕,不刪 changelog、不留還原紀錄", async () => {
    const changelog = await changelogOf(upgraded);

    const result = await runUpdate(upgraded, [V3, "--down"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${TICKET_V3} 沒有 export down`);
    expect(await changelogOf(upgraded)).toEqual(changelog);
    const journal = await journalOf(upgraded, "migration");
    expect(journal.filter((record) => record.status !== "applied")).toEqual([]);
    expect(await lockOf(upgraded)).toBeNull();
  }, 120_000);

  it("api 子程序回報錯誤(沒有適用的操作者)時整批失敗:不記成功、定義不動、鎖釋放", async () => {
    const versions = await versionsOf(upgraded, TICKET);
    await withDatabase(upgraded, (database) =>
      database
        .collection("users")
        .updateOne({ account: "root-admin" }, { $set: { enabled: false } }),
    );

    const result = await runUpdate(upgraded, [V3], { GITHUB_SHA: COMMIT_V3 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("受管定義 CLI(apply)回報失敗");
    expect(result.stdout).not.toContain("seed 完成");
    const runs = await journalOf(upgraded, "run");
    expect(runs.at(-1)).toMatchObject({
      status: "failed",
      stage: "definitions",
    });
    expect(await versionsOf(upgraded, TICKET)).toEqual(versions);
    expect(await lockOf(upgraded)).toBeNull();
  }, 120_000);
});

describe("seed 別名(src/seed/run.ts)也走完整更新並發布定義", () => {
  const registry = path.join(
    fixtureSourceRoot("seeds-definition"),
    "registry.ts",
  );

  it("以第一個參數指定 registry:migration → 普通種子 → 依引用順序發布表單與流程;重跑未變", async () => {
    const databaseUri = mongo.uri("seed-alias");

    const first = await startEntry(SEED_ENTRY, [registry], databaseUri).done;
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    // 流程引用表單:表單先發布(registry 裡流程登記在前,順序由組裝排)
    const formAt = first.stdout.indexOf(
      "form-definition:project_request@r1 → 版本 1:新增 1",
    );
    const workflowAt = first.stdout.indexOf(
      "workflow-definition:project_review@r1 → 版本 1:新增 1",
    );
    expect(formAt).toBeGreaterThan(-1);
    expect(workflowAt).toBeGreaterThan(formAt);
    expect(first.stdout).toMatch(/seed 完成:新增 [1-9]\d* \//);
    // 正式來源的全部 migration 也在同一次執行裡跑完
    expect(await changelogOf(databaseUri)).toHaveLength(
      migrationFileNames().length,
    );
    expect(await formOf(databaseUri, "project_request")).toMatchObject({
      currentVersion: 1,
    });
    expect(
      await documentsOf(databaseUri, "workflows", { key: "project_review" }),
    ).toMatchObject([{ currentVersion: 1 }]);

    const second = await startEntry(SEED_ENTRY, [registry], databaseUri).done;
    expect(second.stderr).toBe("");
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(
      /seed 完成:新增 0 \/ 更新 0 \/ 認養 0 \/ 未變 [1-9]\d*/,
    );
    expect(await versionsOf(databaseUri, "project_request")).toHaveLength(1);
  }, 300_000);

  it("--check-cli:建置後的受管定義 CLI 啟動得起來(不需要資料庫)", async () => {
    const result = await runUpdate("mongodb://127.0.0.1:1/unused", [
      "--check-cli",
    ]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("受管定義 CLI 可啟動");
  }, 120_000);
});
