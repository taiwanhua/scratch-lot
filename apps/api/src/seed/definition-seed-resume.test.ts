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

import type { FieldDef } from "@repo/domain/form";
import type { DefinitionSeedSet } from "@repo/domain/seed";

import { AuditService } from "../audit/audit.service";
import type { AuthTestApp } from "../auth/test-support/auth-app";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { FormPublishHooks } from "../forms/form-design/form-publish-hooks";
import {
  FORM_TEST_TIMEOUT_MS,
  FORM_VERSION,
  type VersionRow,
  definitionOf,
  field,
  ok,
  publishDefinition,
  saveDefinition,
} from "../forms/test-support/form-fixtures";
import { WorkflowPublishHooks } from "../workflows/workflow-design/workflow-publish.service";
import type { SeedInstallCheckpoint } from "./seed-install-hooks";
import {
  type InstallationDoc,
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

/** 有檢查點的服務(安裝流程、表單發布、流程發布各一個)。 */
interface CheckpointHooks {
  reached(checkpoint: string): Promise<void>;
}

/** 一種中斷方式:讓某一筆寫入(或它之後的稽核)真的在半路失敗一次。 */
type Interruption =
  | { at: "install"; checkpoint: SeedInstallCheckpoint }
  | { at: "form-publish"; checkpoint: string }
  | { at: "workflow-publish"; checkpoint: string }
  | { at: "audit"; action: string };

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

function labelOf(interruption: Interruption): string {
  return interruption.at === "audit"
    ? `稽核 ${interruption.action} 寫入失敗`
    : `${interruption.at} 的 ${interruption.checkpoint} 之前`;
}

/**
 * 逐一中斷點的續跑(`docs/concepts/data-layer-and-isolation.md`「受管表單與流程」):
 * 每個情境先讓指定的那一步真的失敗(安裝流程自己的檢查點、原發布生命週期的檢查點、或原服務寫稽核的那一筆),
 * 再以同一份宣告重跑。斷言:以**同一個預配置的定義 id / 草稿 id**接續、只有一個正式版本、
 * 最終狀態與一次成功的安裝相同、之後重跑未變且不再寫稽核。
 */
describe("受管定義:每個中斷點都能以同一組 id 續跑,不會重試成第二個正式版本", () => {
  let app: SeedTestApp;
  let api: AuthTestApp;
  let connection: Connection;
  let sequence = 0;

  beforeAll(async () => {
    app = await startSeedTestApp("cookhome-test-seed-resume");
    ({ api, connection } = app);
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  function nextKey(prefix: string): string {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  }

  function failAuditOnce(action: string): void {
    const audit = api.app.get(AuditService);
    const record = audit.record.bind(audit);
    let hasFailed = false;
    jest.spyOn(audit, "record").mockImplementation((operator, input) => {
      if (!hasFailed && input.action === action) {
        hasFailed = true;
        return Promise.reject(new Error(`injected audit failure: ${action}`));
      }
      return record(operator, input);
    });
  }

  function interrupt(interruption: Interruption): void {
    switch (interruption.at) {
      case "install": {
        failCheckpointOnce(app.hooks, interruption.checkpoint);
        break;
      }
      case "form-publish": {
        failCheckpointOnce(
          api.app.get(FormPublishHooks),
          interruption.checkpoint,
        );
        break;
      }
      case "workflow-publish": {
        failCheckpointOnce(
          api.app.get(WorkflowPublishHooks),
          interruption.checkpoint,
        );
        break;
      }
      case "audit": {
        failAuditOnce(interruption.action);
        break;
      }
    }
  }

  /** 去掉 key 的最終狀態,拿來與「一次成功」的對照組比。 */
  async function settledShapeOf(seed: DefinitionSeedSet): Promise<unknown> {
    const definition = await definitionDoc(connection, seed.kind, seed.key);
    const versions = await versionDocs(connection, seed.kind, seed.key);
    const permissions = await connection
      .collection("permissions")
      .find<{ key: string; name: string; retiredAt: Date | null }>({
        key: { $regex: `-${seed.key}-` },
      })
      .sort({ key: 1 })
      .toArray();
    const mask = (text: string): string => text.replaceAll(seed.key, "<key>");
    return {
      name: mask(String(definition?.name)),
      tabLabelTemplate: definition?.tabLabelTemplate ?? null,
      currentVersion: definition?.currentVersion,
      versions: versions.map(({ version, status, changelog }) => ({
        version,
        status,
        changelog,
      })),
      permissions: permissions.map((permission) => ({
        key: mask(permission.key),
        name: mask(permission.name),
        isRetired: permission.retiredAt !== null,
      })),
    };
  }

  interface Scenario {
    /** 這個情境要安裝的宣告(每個 key 不同)。 */
    seedFor: (key: string) => DefinitionSeedSet;
    /** 先裝好的前一個 revision(改版情境)。 */
    priorFor?: (key: string) => DefinitionSeedSet;
    outcome: "created" | "updated";
    localVersion: number;
  }

  /**
   * 跑一個中斷情境:中斷 → 核對停在半路 → 同一份宣告重跑 → 核對接續結果 → 再重跑未變。
   * 回中斷當下的安裝紀錄(`reserve` 之前中斷時為 null)。
   */
  async function resumeAfter(
    scenario: Scenario,
    interruption: Interruption,
  ): Promise<void> {
    const key = nextKey("seed_resume");
    const controlKey = nextKey("seed_control");
    const seed = scenario.seedFor(key);
    const control = scenario.seedFor(controlKey);
    if (scenario.priorFor) {
      await runSeeds(app, [
        scenario.priorFor(key),
        scenario.priorFor(controlKey),
      ]);
    }
    const numberedBefore = await versionDocs(connection, seed.kind, key);

    interrupt(interruption);
    const interrupted = await runSeeds(app, [seed]);
    jest.restoreAllMocks();

    // 中斷:不宣稱成功,錯誤指名這一筆
    expect(interrupted.results).toEqual([]);
    expect(interrupted.errors).toMatchObject([
      { code: "APPLY_FAILED", kind: seed.kind, key, revision: seed.revision },
    ]);
    const reserved = await installationOf(connection, seed);
    const isBeforeReserve =
      interruption.at === "install" && interruption.checkpoint === "reserve";
    if (isBeforeReserve) {
      // 登記之前失敗:沒有任何身分 / 版本寫入
      expect(reserved).toBeNull();
      expect(await versionDocs(connection, seed.kind, key)).toEqual(
        numberedBefore,
      );
    } else {
      expect(reserved).toMatchObject({ status: "in-progress" });
    }

    const resumed = await runSeed(app, seed, "apply", {
      runId: "resume-run",
    });

    expect(resumed).toMatchObject({
      outcome: scenario.outcome,
      localVersion: scenario.localVersion,
      conflict: null,
    });
    const installation = await installationOf(connection, seed);
    expect(installation).toMatchObject({
      status: "installed",
      step: "installed",
      localVersion: scenario.localVersion,
    });
    if (reserved !== null) {
      // 同一筆紀錄、同一組預配置的 id
      expect(installation?._id).toEqual(reserved._id);
      expect(installation?.definitionId).toEqual(reserved.definitionId);
      expect(installation?.draftId).toEqual(reserved.draftId);
      expect(resumed.definitionId).toBe(String(reserved.definitionId));
    }
    await expectSingleVersion(seed, installation, scenario.localVersion);
    // 最終狀態與一次成功相同
    const controlResult = await runSeed(app, control);
    expect(controlResult.outcome).toBe(scenario.outcome);
    expect(await settledShapeOf(seed)).toEqual(await settledShapeOf(control));
    // 之後重跑未變、不再寫任何東西
    const before = await persistedStateOf(connection, seed.kind, key);
    const rerun = await runSeed(app, seed);
    expect(rerun.outcome).toBe("unchanged");
    expect(await persistedStateOf(connection, seed.kind, key)).toEqual(before);
  }

  /** 這次安裝只產生一個正式版本:預配置的草稿 id 就是那一版,沒有殘留草稿或第二個版號。 */
  async function expectSingleVersion(
    seed: DefinitionSeedSet,
    installation: InstallationDoc | null,
    localVersion: number,
  ): Promise<void> {
    const versions = await versionDocs(connection, seed.kind, seed.key);
    expect(versions.map((version) => version.version)).toEqual(
      Array.from({ length: localVersion }, (_, index) => index + 1),
    );
    const ours = versions.find((version) =>
      version._id.equals(installation?.draftId ?? ""),
    );
    expect(ours).toMatchObject({
      version: localVersion,
      status: seed.desiredStatus,
      // 存過一次就不再存:草稿只被這次安裝存過一次
      draftRevision: 1,
    });
  }

  const r1Fields: FieldDef[] = [
    field("title", "text"),
    field("amount", "number", { permission: { show: true, edit: false } }),
    field("note", "text", { permission: { show: false, edit: true } }),
  ];
  const r2Fields: FieldDef[] = [
    field("title", "text"),
    field("amount", "number", {
      label: "內部金額",
      permission: { show: true, edit: true },
    }),
    field("memo", "text"),
  ];

  describe("表單:首次安裝", () => {
    const scenario: Scenario = {
      seedFor: (key) =>
        formSeed(key, "r1", {
          fields: r1Fields,
          tabLabelTemplate: "{{title}}",
        }),
      outcome: "created",
      localVersion: 1,
    };
    const interruptions: Interruption[] = [
      { at: "install", checkpoint: "reserve" },
      { at: "install", checkpoint: "create-identity" },
      { at: "audit", action: "form.create" },
      { at: "install", checkpoint: "update-metadata" },
      { at: "audit", action: "form.update" },
      { at: "install", checkpoint: "create-draft" },
      { at: "audit", action: "form-version.create-draft" },
      { at: "install", checkpoint: "save-draft" },
      { at: "audit", action: "form-version.save-draft" },
      { at: "install", checkpoint: "publish" },
      { at: "audit", action: "form-version.publish" },
      { at: "form-publish", checkpoint: "permission" },
      { at: "form-publish", checkpoint: "publish-version" },
      { at: "form-publish", checkpoint: "current-version" },
      { at: "install", checkpoint: "record-installed" },
    ];

    it.each(interruptions.map((one) => [labelOf(one), one] as const))(
      "中斷在 %s:重跑接續",
      async (_label, interruption) => {
        await resumeAfter(scenario, interruption);
      },
    );
  });

  describe("表單:改版(前一版退役、權限同步、名稱條件更新)", () => {
    const scenario: Scenario = {
      priorFor: (key) => formSeed(key, "r1", { fields: r1Fields }),
      seedFor: (key) =>
        formSeed(key, "r2", {
          name: `受管表單 ${key} 二版`,
          fields: r2Fields,
        }),
      outcome: "updated",
      localVersion: 2,
    };
    const interruptions: Interruption[] = [
      { at: "install", checkpoint: "update-metadata" },
      { at: "install", checkpoint: "create-draft" },
      { at: "form-publish", checkpoint: "retire-permission" },
      { at: "form-publish", checkpoint: "retire-previous" },
      { at: "form-publish", checkpoint: "current-version" },
      { at: "install", checkpoint: "record-installed" },
    ];

    it.each(interruptions.map((one) => [labelOf(one), one] as const))(
      "中斷在 %s:重跑接續",
      async (_label, interruption) => {
        await resumeAfter(scenario, interruption);
      },
    );
  });

  describe("表單:明示退役", () => {
    const scenario: Scenario = {
      seedFor: (key) =>
        formSeed(key, "r1", { fields: r1Fields, desiredStatus: "retired" }),
      outcome: "created",
      localVersion: 1,
    };
    const interruptions: Interruption[] = [
      { at: "install", checkpoint: "retire" },
      { at: "form-publish", checkpoint: "retire-current" },
      { at: "audit", action: "form-version.retire" },
      { at: "install", checkpoint: "record-installed" },
    ];

    it.each(interruptions.map((one) => [labelOf(one), one] as const))(
      "中斷在 %s:重跑接續",
      async (_label, interruption) => {
        await resumeAfter(scenario, interruption);
      },
    );
  });

  describe("流程:首次安裝", () => {
    const scenario: Scenario = {
      seedFor: (key) => workflowSeed(key, "r1"),
      outcome: "created",
      localVersion: 1,
    };
    const interruptions: Interruption[] = [
      { at: "install", checkpoint: "create-identity" },
      { at: "audit", action: "workflow.create" },
      { at: "install", checkpoint: "create-draft" },
      { at: "audit", action: "workflow-version.create-draft" },
      { at: "install", checkpoint: "save-draft" },
      { at: "audit", action: "workflow-version.save-draft" },
      { at: "install", checkpoint: "publish" },
      { at: "audit", action: "workflow-version.publish" },
      { at: "workflow-publish", checkpoint: "publish-version" },
      { at: "workflow-publish", checkpoint: "current-version" },
      { at: "install", checkpoint: "record-installed" },
    ];

    it.each(interruptions.map((one) => [labelOf(one), one] as const))(
      "中斷在 %s:重跑接續",
      async (_label, interruption) => {
        await resumeAfter(scenario, interruption);
      },
    );
  });

  describe("流程:改版與明示退役", () => {
    const update: Scenario = {
      priorFor: (key) => workflowSeed(key, "r1"),
      seedFor: (key) =>
        workflowSeed(key, "r2", {
          name: `受管流程 ${key} 二版`,
          steps: [managerStep("boss"), managerStep("second")],
        }),
      outcome: "updated",
      localVersion: 2,
    };
    const retire: Scenario = {
      seedFor: (key) => workflowSeed(key, "r1", { desiredStatus: "retired" }),
      outcome: "created",
      localVersion: 1,
    };

    it.each(
      (
        [
          { at: "install", checkpoint: "update-metadata" },
          { at: "audit", action: "workflow.update" },
          { at: "workflow-publish", checkpoint: "retire-previous" },
          { at: "workflow-publish", checkpoint: "current-version" },
        ] satisfies Interruption[]
      ).map((one) => [labelOf(one), one] as const),
    )("改版中斷在 %s:重跑接續", async (_label, interruption) => {
      await resumeAfter(update, interruption);
    });

    it.each(
      (
        [
          { at: "install", checkpoint: "retire" },
          { at: "workflow-publish", checkpoint: "retire-current" },
          { at: "audit", action: "workflow-version.retire" },
        ] satisfies Interruption[]
      ).map((one) => [labelOf(one), one] as const),
    )("退役中斷在 %s:重跑接續", async (_label, interruption) => {
      await resumeAfter(retire, interruption);
    });
  });

  describe("中斷窗口裡的稽核與現場變動", () => {
    it("表單發布的稽核失敗:發布整個回復(仍是同一份草稿、沒配版號);重跑以同一份草稿發布成版本 1", async () => {
      const seed = formSeed(nextKey("seed_window"), "r1");
      failAuditOnce("form-version.publish");
      await runSeeds(app, [seed]);
      jest.restoreAllMocks();
      const [draft] = await versionDocs(connection, FORM, seed.key);
      expect(draft).toMatchObject({ version: null, status: "draft" });

      const resumed = await runSeed(app, seed);

      expect(resumed).toMatchObject({ outcome: "created", localVersion: 1 });
      expect(
        await auditCount(connection, {
          action: "form-version.retry-publish",
          targetId: draft?._id,
        }),
      ).toBe(0);
      const [published] = await versionDocs(connection, FORM, seed.key);
      expect(published?._id).toEqual(draft?._id);
      expect(published).toMatchObject({ version: 1, status: "published" });
    });

    it("草稿已存(draftRevision 已加一)但檢查點沒記到:重跑不再存一次", async () => {
      const seed = formSeed(nextKey("seed_window"), "r1");
      failAuditOnce("form-version.save-draft");
      await runSeeds(app, [seed]);
      jest.restoreAllMocks();
      const reserved = await installationOf(connection, seed);
      expect(reserved?.step).toBe("draft");
      const [draft] = await versionDocs(connection, FORM, seed.key);
      expect(draft).toMatchObject({ status: "draft", draftRevision: 1 });

      await runSeed(app, seed);

      const [published] = await versionDocs(connection, FORM, seed.key);
      expect(published).toMatchObject({
        status: "published",
        draftRevision: 1,
      });
      expect(
        await auditCount(connection, {
          action: "form-version.save-draft",
          targetId: draft?._id,
        }),
      ).toBe(0);
    });

    it("未完成的安裝只可由同一個 revision、同一份內容接續:別的 revision 或改過的內容都衝突", async () => {
      const key = nextKey("seed_window");
      const seed = formSeed(key, "r1");
      failCheckpointOnce(app.hooks, "publish");
      await runSeeds(app, [seed]);
      jest.restoreAllMocks();
      const before = await persistedStateOf(connection, FORM, key);

      const otherRevision = await runSeed(
        app,
        formSeed(key, "r2", { fields: r2Fields }),
      );
      const changedContent = await runSeed(
        app,
        formSeed(key, "r1", { fields: r2Fields }),
      );

      expect(otherRevision.conflict?.code).toBe("INSTALLATION_IN_PROGRESS");
      expect(changedContent.conflict?.code).toBe("REVISION_HASH_MISMATCH");
      expect(await persistedStateOf(connection, FORM, key)).toEqual(before);
      const resumed = await runSeed(app, seed);
      expect(resumed).toMatchObject({ outcome: "created", localVersion: 1 });
    });

    it("這次安裝建的草稿在中斷期間被畫面改過:衝突,草稿不丟、不被覆蓋", async () => {
      const key = nextKey("seed_window");
      const seed = formSeed(key, "r1");
      failCheckpointOnce(app.hooks, "save-draft");
      await runSeeds(app, [seed]);
      jest.restoreAllMocks();
      const edited = definitionOf([
        field("title", "text"),
        field("ui", "text"),
      ]);
      await saveDefinition(api, app.root, key, edited, 0);

      const resumed = await runSeed(app, seed);

      expect(resumed.conflict?.code).toBe("DRAFT_DRIFT");
      const draft = await ok<{ formVersion: { formVersion: VersionRow } }>(
        api,
        app.root,
        FORM_VERSION,
        { formKey: key },
      );
      expect(draft.formVersion.formVersion).toMatchObject({
        status: "DRAFT",
        draftRevision: 1,
        fields: edited.fields,
      });
      expect(await installationOf(connection, seed)).toMatchObject({
        status: "in-progress",
      });
    });

    it("中斷期間畫面在同一張表單發布了別的版本:重跑衝突,不把自己的版本疊上去", async () => {
      const key = nextKey("seed_window");
      await runSeeds(app, [formSeed(key, "r1", { fields: r1Fields })]);
      const r2 = formSeed(key, "r2", { fields: r2Fields });
      failCheckpointOnce(app.hooks, "create-draft");
      await runSeeds(app, [r2]);
      jest.restoreAllMocks();
      await publishDefinition(
        api,
        app.root,
        key,
        definitionOf([field("title", "text"), field("ui", "text")]),
        1,
      );

      const resumed = await runSeed(app, r2);

      expect(resumed.conflict?.code).toBe("CURRENT_VERSION_DRIFT");
      expect(await definitionDoc(connection, FORM, key)).toMatchObject({
        currentVersion: 2,
      });
      expect(await versionDocs(connection, FORM, key)).toHaveLength(2);
    });

    it("流程發布的稽核失敗:發布整個回復(仍是草稿),重跑以同一份草稿發布;中斷期間不能改由別的 revision 安裝", async () => {
      const key = nextKey("seed_window_flow");
      const seed = workflowSeed(key, "r1");
      failAuditOnce("workflow-version.publish");
      await runSeeds(app, [seed]);
      jest.restoreAllMocks();
      const [allocated] = await versionDocs(connection, WORKFLOW, key);
      expect(allocated).toMatchObject({ version: null, status: "draft" });

      const other = await runSeed(
        app,
        workflowSeed(key, "r2", { steps: [managerStep("other")] }),
      );
      const resumed = await runSeed(app, seed);

      expect(other.conflict?.code).toBe("INSTALLATION_IN_PROGRESS");
      expect(resumed).toMatchObject({ outcome: "created", localVersion: 1 });
      const versions = await versionDocs(connection, WORKFLOW, key);
      expect(versions).toHaveLength(1);
      expect(versions[0]?._id).toEqual(allocated?._id);
      expect(await installationsOf(connection, key)).toHaveLength(1);
    });
  });
});
