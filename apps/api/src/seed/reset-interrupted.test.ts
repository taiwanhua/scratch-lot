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

import type { StepDef } from "@repo/domain/workflow";

import type { AuthTestApp } from "../auth/test-support/auth-app";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { FormPublishHooks } from "../forms/form-design/form-publish-hooks";
import {
  CREATE_DRAFT,
  CREATE_FORM,
  type InterruptedPublishStage,
  MODULE_KEY,
  RETIRE_CURRENT,
  RETRY_PUBLISH,
  type VersionRow,
  call,
  definitionOf,
  field,
  ok,
  publishNewForm,
  saveDefinition,
  simulateInterruptedPublish,
} from "../forms/test-support/form-fixtures";
import {
  CREATE_WORKFLOW,
  CREATE_WORKFLOW_DRAFT,
  PUBLISH_WORKFLOW,
  RETRY_PUBLISH_WORKFLOW,
  SAVE_WORKFLOW_DRAFT,
  WORKFLOW_TEST_TIMEOUT_MS,
} from "../workflows/test-support/workflow-fixtures";
import { WorkflowPublishHooks } from "../workflows/workflow-design/workflow-publish.service";
import {
  dumpApplicationData,
  runDataReset,
} from "./test-support/reset-command";
import {
  type SeedTestApp,
  formSeed,
  holdSeedLock,
  installationOf,
  managerStep,
  releaseSeedLock,
  runSeed,
  runSeeds,
  startSeedTestApp,
} from "./test-support/seed-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

/** 有檢查點的服務(安裝流程、表單發布、流程發布各一個)。 */
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

interface WorkflowVersionData {
  workflowVersion: { draftRevision: number };
}

/**
 * `data` reset 遇到做到一半的發布、退役或受管定義安裝要整次拒絕(`docs/concepts/data-layer-and-isolation.md`
 * 「還原」)。半成品由**真的發布 / 安裝流程**在它自己的檢查點中斷產生(不是插進資料庫的標記),
 * reset 是真的 db-migrator 指令子行程。每個情境:中斷 → reset 被拒絕且一筆都沒動 → 以原本的操作續完。
 * 最後確認續完之後 reset 放行。
 */
describe("data reset:中斷的發布、退役與安裝一律拒絕,不續發也不清掉", () => {
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

  /** root 建共用表單並開始發布(在指定的檢查點中斷)。 */
  /** 表單發布是一個交易、不會再中斷:以直接寫入模擬交易之前留下的中斷資料。 */
  async function interruptFormPublish(
    key: string,
    stage: InterruptedPublishStage,
  ): Promise<void> {
    await ok(api, app.root, CREATE_FORM, {
      input: { key, moduleKey: MODULE_KEY, name: `表單 ${key}` },
    });
    const draft = await ok<{
      createFormVersionDraft: { formVersion: VersionRow };
    }>(api, app.root, CREATE_DRAFT, {
      input: { formKey: key, baseVersion: null },
    });
    await saveDefinition(
      api,
      app.root,
      key,
      definitionOf([field("title", "text")]),
      draft.createFormVersionDraft.formVersion.draftRevision,
    );
    await simulateInterruptedPublish(connection, key, stage);
  }

  async function interruptWorkflowPublish(
    key: string,
    steps: StepDef[],
    checkpoint: string,
  ): Promise<void> {
    await ok(api, app.root, CREATE_WORKFLOW, {
      input: { key, name: `流程 ${key}` },
    });
    const draft = await ok<{ createWorkflowVersionDraft: WorkflowVersionData }>(
      api,
      app.root,
      CREATE_WORKFLOW_DRAFT,
      { input: { workflowKey: key, baseVersion: null } },
    );
    const saved = await ok<{ saveWorkflowVersionDraft: WorkflowVersionData }>(
      api,
      app.root,
      SAVE_WORKFLOW_DRAFT,
      {
        input: {
          workflowKey: key,
          expectedDraftRevision:
            draft.createWorkflowVersionDraft.workflowVersion.draftRevision,
          definition: { steps, edges: null },
        },
      },
    );
    failCheckpointOnce(api.app.get(WorkflowPublishHooks), checkpoint);
    const interrupted = await call(api, app.root, PUBLISH_WORKFLOW, {
      input: {
        workflowKey: key,
        expectedDraftRevision:
          saved.saveWorkflowVersionDraft.workflowVersion.draftRevision,
        changelog: "測試發布",
      },
    });
    expect(interrupted.errors).toBeDefined();
    jest.restoreAllMocks();
  }

  it("畫面上的表單發布停在 publishing(沒有安裝紀錄):拒絕;重試發布完成後不再擋", async () => {
    await interruptFormPublish("ui_publishing", "publishing");
    expect(
      await connection
        .collection("form_versions")
        .findOne({ formKey: "ui_publishing" }),
    ).toMatchObject({ status: "publishing", version: 1 });

    await expectRefused("表單 ui_publishing 的版本 1 發布進行中(publishing)");
    // 被拒絕的那一次沒有替它發布
    expect(
      await connection.collection("forms").findOne({ key: "ui_publishing" }),
    ).toMatchObject({ currentVersion: null });

    await ok(api, app.root, RETRY_PUBLISH, {
      input: { formKey: "ui_publishing" },
    });
  });

  it("表單版本已是 published、currentVersion 還沒切換:拒絕;重試發布完成後不再擋", async () => {
    await interruptFormPublish("ui_unswitched", "unswitched");
    expect(
      await connection
        .collection("form_versions")
        .findOne({ formKey: "ui_unswitched" }),
    ).toMatchObject({ status: "published", version: 1 });
    expect(
      await connection.collection("forms").findOne({ key: "ui_unswitched" }),
    ).toMatchObject({ currentVersion: null });

    await expectRefused(
      "表單 ui_unswitched 的版本 1 已是 published,但 currentVersion 尚未切換(目前 null)",
    );

    await ok(api, app.root, RETRY_PUBLISH, {
      input: { formKey: "ui_unswitched" },
    });
  });

  it("流程版本已是 published、currentVersion 還沒切換:拒絕;重試發布完成後不再擋", async () => {
    await interruptWorkflowPublish(
      "ui_flow_unswitched",
      [managerStep("boss")],
      "current-version",
    );

    await expectRefused(
      "流程 ui_flow_unswitched 的版本 1 已是 published,但 currentVersion 尚未切換(目前 null)",
    );

    await ok(api, app.root, RETRY_PUBLISH_WORKFLOW, {
      input: { workflowKey: "ui_flow_unswitched" },
    });
  });

  it("退役只做了第一步(版本已 retired、currentVersion 還指著它):拒絕;再退役一次完成後不再擋", async () => {
    await publishNewForm(
      api,
      app.root,
      "ui_retiring",
      definitionOf([field("title", "text")]),
    );
    failCheckpointOnce(api.app.get(FormPublishHooks), "retire-current");
    const interrupted = await call(api, app.root, RETIRE_CURRENT, {
      input: { formKey: "ui_retiring", expectedVersion: 1 },
    });
    expect(interrupted.errors).toBeDefined();
    jest.restoreAllMocks();

    await expectRefused(
      "表單 ui_retiring 的 currentVersion 指向版本 1,但它不是 published(退役未完成)",
    );

    await ok(api, app.root, RETIRE_CURRENT, {
      input: { formKey: "ui_retiring", expectedVersion: 1 },
    });
  });

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
