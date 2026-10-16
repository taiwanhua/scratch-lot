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

import type { DefinitionSeedSet } from "@repo/domain/seed";

import type { AuthTestApp } from "../auth/test-support/auth-app";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  FORM_TEST_TIMEOUT_MS,
  RETIRE_CURRENT,
  UPDATE_FORM,
  call,
  field,
  getForm,
  ok,
} from "../forms/test-support/form-fixtures";
import {
  CREATE_WORKFLOW_DRAFT,
  PUBLISH_WORKFLOW,
  RETIRE_WORKFLOW,
  SAVE_WORKFLOW_DRAFT,
  type WorkflowVersionRow,
} from "../workflows/test-support/workflow-fixtures";
import type { SeedInstallCheckpoint } from "./seed-install-hooks";
import {
  type SeedTestApp,
  auditCount,
  definitionDoc,
  formSeed,
  installationOf,
  installationsOf,
  managerStep,
  persistedStateOf,
  runSeed,
  runSeeds,
  startSeedTestApp,
  versionDocs,
  workflowSeed,
} from "./test-support/seed-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const FORM = "form-definition";
const WORKFLOW = "workflow-definition";

/** 畫面上改流程名稱。 */
const UPDATE_WORKFLOW = /* GraphQL */ `
  mutation UpdateWorkflow($input: UpdateWorkflowInput!) {
    updateWorkflow(input: $input) {
      workflow {
        key
        name
      }
    }
  }
`;

/** 有檢查點的服務(安裝流程、表單發布、流程發布)。 */
interface CheckpointHooks {
  reached(checkpoint: string): Promise<void>;
}

function doNothing(): void {
  // 預設的空動作(沒有要插入的步驟)
}

/** 第一次走到 `checkpoint` 時丟錯;回還原用的函式。 */
function failCheckpointOnce(
  hooks: CheckpointHooks,
  checkpoint: string,
): () => void {
  let hasFailed = false;
  const spy = jest.spyOn(hooks, "reached").mockImplementation((reached) => {
    if (!hasFailed && reached === checkpoint) {
      hasFailed = true;
      return Promise.reject(new Error(`injected failure at ${checkpoint}`));
    }
    return Promise.resolve();
  });
  return () => {
    spy.mockRestore();
  };
}

/**
 * 續跑的前置核對與「只處理自己的版本」(`docs/concepts/data-layer-and-isolation.md`「受管表單與流程」):
 * 未完成的安裝在任何一種可續跑狀態下,現場的外部漂移都要在整批的第一筆寫入之前被拒絕;
 * 重試發布與發布本身綁定這次安裝的版本與登記時的目前版本,不替別人完成發布、也不忽略中途的版本變更。
 * 競爭一律由真的 `/graphql` 操作造成,插入點是安裝流程與原發布生命週期的檢查點。
 */
describe("受管定義:續跑先核對現場,重試與發布只處理自己的版本", () => {
  let app: SeedTestApp;
  let api: AuthTestApp;
  let connection: Connection;

  beforeAll(async () => {
    app = await startSeedTestApp("cookhome-test-seed-resume-guards");
    ({ api, connection } = app);
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  /** 安裝走到 `checkpoint` 的那一筆寫入之前,先做一次 `action`(只做一次)。 */
  function beforeWrite(
    checkpoint: SeedInstallCheckpoint,
    action: () => Promise<unknown>,
  ): void {
    const reached = app.hooks.reached.bind(app.hooks);
    let isDone = false;
    jest.spyOn(app.hooks, "reached").mockImplementation(async (current) => {
      if (!isDone && current === checkpoint) {
        isDone = true;
        await action();
      }
      return reached(current);
    });
  }

  /** 讓一次安裝中斷,留下未完成的安裝紀錄。 */
  async function interruptInstall(
    seed: DefinitionSeedSet,
    inject: () => void,
  ): Promise<void> {
    inject();
    const interrupted = await runSeeds(app, [seed]);
    jest.restoreAllMocks();
    expect(interrupted.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
    expect(await installationOf(connection, seed)).toMatchObject({
      status: "in-progress",
    });
  }

  function rename(seed: DefinitionSeedSet, name: string): Promise<unknown> {
    return seed.kind === "form-definition"
      ? ok(api, app.root, UPDATE_FORM, { input: { key: seed.key, name } })
      : ok(api, app.root, UPDATE_WORKFLOW, { input: { key: seed.key, name } });
  }

  /**
   * 續跑放在一批的第二筆:預檢必須在第一筆(另一份新宣告)寫入之前就回這一筆的衝突,
   * 而且這個定義自己的身分、版本、安裝紀錄與稽核都不變。
   */
  async function expectRejectedBeforeAnyWrite(
    seed: DefinitionSeedSet,
    code: string,
  ): Promise<void> {
    const other = formSeed(`${seed.key}_other`, "r1");
    const before = await persistedStateOf(connection, seed.kind, seed.key);

    const batch = await runSeeds(app, [other, seed]);

    expect(batch.errors).toEqual([]);
    expect(batch.results).toMatchObject([
      { key: seed.key, revision: seed.revision, conflict: { code } },
    ]);
    expect(await definitionDoc(connection, FORM, other.key)).toBeNull();
    expect(await installationsOf(connection, other.key)).toEqual([]);
    expect(await persistedStateOf(connection, seed.kind, seed.key)).toEqual(
      before,
    );
  }

  const nextFields = [field("title", "text"), field("memo", "text")];
  describe("未完成安裝的每一種續跑狀態:現場漂移在整批第一筆寫入前就拒絕", () => {
    it("表單照既有版本退役(已登記、尚未退役)期間畫面改了名稱:不先退役才報錯", async () => {
      const r1 = formSeed("resume_retire_form", "r1");
      await runSeeds(app, [r1]);
      const r2 = formSeed(r1.key, "r2", { desiredStatus: "retired" });
      await interruptInstall(r2, () => failCheckpointOnce(app.hooks, "retire"));
      await rename(r2, "畫面改的名字");

      await expectRejectedBeforeAnyWrite(r2, "METADATA_DRIFT");

      const form = await getForm(api, app.root, r1.key);
      expect(form).toMatchObject({ name: "畫面改的名字", currentVersion: 1 });
    });

    it("流程照既有版本退役(已登記、尚未退役)期間畫面改了名稱:不先退役才報錯", async () => {
      const r1 = workflowSeed("resume_retire_flow", "r1");
      await runSeeds(app, [r1]);
      const r2 = workflowSeed(r1.key, "r2", { desiredStatus: "retired" });
      await interruptInstall(r2, () => failCheckpointOnce(app.hooks, "retire"));
      await rename(r2, "畫面改的名字");

      await expectRejectedBeforeAnyWrite(r2, "METADATA_DRIFT");

      expect(await definitionDoc(connection, WORKFLOW, r1.key)).toMatchObject({
        name: "畫面改的名字",
        currentVersion: 1,
      });
    });

    it("照既有版本退役期間凍結內容被改掉:預檢就拒絕,那一版沒有被退役", async () => {
      const r1 = formSeed("resume_retire_content", "r1");
      await runSeeds(app, [r1]);
      const r2 = formSeed(r1.key, "r2", { desiredStatus: "retired" });
      await interruptInstall(r2, () => failCheckpointOnce(app.hooks, "retire"));
      await connection
        .collection("form_versions")
        .updateOne(
          { formKey: r1.key, version: 1 },
          { $set: { "fields.0.label": "被改過的凍結內容" } },
        );

      await expectRejectedBeforeAnyWrite(r2, "CONTENT_MISMATCH");

      const [version] = await versionDocs(connection, FORM, r1.key);
      expect(version).toMatchObject({ version: 1, status: "published" });
    });

    it("已切換目前版本、只差記成功時畫面改了名稱:整批預檢就拒絕", async () => {
      const r1 = formSeed("resume_recorded_form", "r1");
      await runSeeds(app, [r1]);
      const r2 = formSeed(r1.key, "r2", { fields: nextFields });
      await interruptInstall(r2, () =>
        failCheckpointOnce(app.hooks, "record-installed"),
      );
      await rename(r2, "畫面改的名字");

      await expectRejectedBeforeAnyWrite(r2, "METADATA_DRIFT");
    });

    it("已切換目前版本、只差記成功時畫面又發布了別的版本:整批預檢就拒絕", async () => {
      const r1 = workflowSeed("resume_recorded_flow", "r1");
      await runSeeds(app, [r1]);
      const r2 = workflowSeed(r1.key, "r2", {
        steps: [managerStep("boss"), managerStep("second")],
      });
      await interruptInstall(r2, () =>
        failCheckpointOnce(app.hooks, "record-installed"),
      );
      await publishWorkflowInUi(r1.key, [managerStep("ui_step")], 2);

      await expectRejectedBeforeAnyWrite(r2, "CURRENT_VERSION_DRIFT");
    });
  });

  async function publishWorkflowInUi(
    workflowKey: string,
    steps: ReturnType<typeof managerStep>[],
    baseVersion: number | null,
    beforePublish: () => void = doNothing,
  ): Promise<{ errors?: unknown[] }> {
    const draft = await ok<{
      createWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
    }>(api, app.root, CREATE_WORKFLOW_DRAFT, {
      input: { workflowKey, baseVersion },
    });
    const saved = await ok<{
      saveWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
    }>(api, app.root, SAVE_WORKFLOW_DRAFT, {
      input: {
        workflowKey,
        expectedDraftRevision:
          draft.createWorkflowVersionDraft.workflowVersion.draftRevision,
        definition: { steps, checkFormKey: null },
      },
    });
    beforePublish();
    return call(api, app.root, PUBLISH_WORKFLOW, {
      input: {
        workflowKey,
        expectedDraftRevision:
          saved.saveWorkflowVersionDraft.workflowVersion.draftRevision,
        changelog: "畫面發布",
      },
    });
  }

  describe("發布綁定登記時的目前版本", () => {
    it("表單:草稿存好之後、發布之前,畫面退役了舊的目前版本 → 不把新版照常發布", async () => {
      const r1 = formSeed("publish_bound_form", "r1");
      await runSeeds(app, [r1]);
      const r2 = formSeed(r1.key, "r2", { fields: nextFields });
      beforeWrite("publish", () =>
        ok(api, app.root, RETIRE_CURRENT, {
          input: { formKey: r1.key, expectedVersion: 1 },
        }),
      );

      const raced = await runSeeds(app, [r2]);
      jest.restoreAllMocks();

      expect(raced.results).toEqual([]);
      expect(raced.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
      expect(await definitionDoc(connection, FORM, r1.key)).toMatchObject({
        currentVersion: null,
      });
      const versions = await versionDocs(connection, FORM, r1.key);
      expect(
        versions.map(({ version, status, draftRevision }) => ({
          version,
          status,
          draftRevision,
        })),
      ).toEqual([
        { version: 1, status: "retired", draftRevision: 1 },
        { version: null, status: "draft", draftRevision: 1 },
      ]);
      expect(
        await auditCount(connection, {
          action: "form-version.publish",
          "after.formKey": r1.key,
          "after.version": 2,
        }),
      ).toBe(0);
      // 重跑回報現場另外退役過
      const rerun = await runSeed(app, r2);
      expect(rerun.conflict?.code).toBe("CURRENT_VERSION_DRIFT");
    });

    it("流程:草稿存好之後、發布之前,畫面退役了舊的目前版本 → 不把新版照常發布", async () => {
      const r1 = workflowSeed("publish_bound_flow", "r1");
      await runSeeds(app, [r1]);
      const r2 = workflowSeed(r1.key, "r2", {
        steps: [managerStep("boss"), managerStep("second")],
      });
      beforeWrite("publish", () =>
        ok(api, app.root, RETIRE_WORKFLOW, {
          input: { workflowKey: r1.key },
        }),
      );

      const raced = await runSeeds(app, [r2]);
      jest.restoreAllMocks();

      expect(raced.results).toEqual([]);
      expect(raced.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
      expect(await definitionDoc(connection, WORKFLOW, r1.key)).toMatchObject({
        currentVersion: null,
      });
      const versions = await versionDocs(connection, WORKFLOW, r1.key);
      expect(
        versions.map(({ version, status }) => ({ version, status })),
      ).toEqual([
        { version: 1, status: "retired" },
        { version: null, status: "draft" },
      ]);
      const rerun = await runSeed(app, r2);
      expect(rerun.conflict?.code).toBe("CURRENT_VERSION_DRIFT");
    });
  });
});
