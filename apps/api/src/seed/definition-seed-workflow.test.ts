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

import type { WorkflowDefinitionSeedSet } from "@repo/domain/seed";

import type { AuthTestApp } from "../auth/test-support/auth-app";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { field, ok } from "../forms/test-support/form-fixtures";
import {
  ASSIGN_WORKFLOW,
  CREATE_WORKFLOW,
  CREATE_WORKFLOW_DRAFT,
  FORK_WORKFLOW,
  FORM_BINDING,
  PUBLISH_WORKFLOW,
  WORKFLOW,
  WORKFLOW_TEST_TIMEOUT_MS,
  type WorkflowRow,
  type WorkflowVersionRow,
  type World,
  bindForm,
  currentInstance,
  decideOn,
  reviewStep,
  saveWorkflowDraft,
  setupWorld,
  submission,
  submitLeave,
} from "../workflows/test-support/workflow-fixtures";
import {
  type SeedTestApp,
  auditActionsOf,
  auditCount,
  definitionDoc,
  formSeed,
  installationOf,
  installationsOf,
  managerStep,
  persistedStateOf,
  placeholderStep,
  runSeed,
  runSeeds,
  seedHashes,
  startSeedTestApp,
  versionDocs,
  workflowSeed,
} from "./test-support/seed-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const WORKFLOW_KIND = "workflow-definition";
const FORM_KIND = "form-definition";

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

/**
 * 受管流程的安裝(`docs/concepts/data-layer-and-isolation.md`「受管表單與流程」):與表單同一套安裝流程,
 * 差異在適配(沒有欄位級權限、檢查用表單存在版本上、退役要指名版本)。接縫同 `definition-seed.test.ts`。
 */
describe("受管流程:安裝、重跑、採納、改版、退役與在途保護", () => {
  let app: SeedTestApp;
  let api: AuthTestApp;
  let connection: Connection;
  let world: World;

  beforeAll(async () => {
    app = await startSeedTestApp("cookhome-test-seed-workflows");
    ({ api, connection } = app);
    world = await setupWorld(api, connection, 0);
  }, HOOK_TIMEOUT_MS * 2);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  /** root 在畫面上建共用流程並發布(與宣告相同的內容)。 */
  async function publishInUi(seed: WorkflowDefinitionSeedSet): Promise<void> {
    await ok(api, world.root, CREATE_WORKFLOW, {
      input: { key: seed.key, name: seed.name },
    });
    await publishDraftInUi(seed, null);
  }

  async function publishDraftInUi(
    seed: WorkflowDefinitionSeedSet,
    baseVersion: number | null,
  ): Promise<void> {
    const draft = await ok<{
      createWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
    }>(api, world.root, CREATE_WORKFLOW_DRAFT, {
      input: { workflowKey: seed.key, baseVersion },
    });
    const saved = await saveWorkflowDraft(
      world,
      seed.key,
      { steps: seed.definition.steps, checkFormKey: seed.checkFormKey },
      draft.createWorkflowVersionDraft.workflowVersion.draftRevision,
      world.root,
    );
    await ok(api, world.root, PUBLISH_WORKFLOW, {
      input: {
        workflowKey: seed.key,
        expectedDraftRevision: saved.draftRevision,
        changelog: seed.changelog,
      },
    });
  }

  const twoSteps = [
    managerStep("boss"),
    reviewStep("upper", { kind: "manager", level: 2 }),
  ];

  it("首次安裝一批:表單先、引用它的流程後;流程以原服務建立與發布,檢查用表單存在版本上", async () => {
    const form = formSeed("seed_flow_form", "r1", {
      fields: [
        field("title", "text"),
        field("approver", "reference", {
          source: { provider: "user", labelField: "name" },
        }),
      ],
    });
    const flow = workflowSeed("seed_flow_first", "r1", {
      checkFormKey: "seed_flow_form",
      steps: [
        managerStep("boss"),
        reviewStep("pick", {
          kind: "field",
          formKey: "seed_flow_form",
          fieldKey: "approver",
        }),
        placeholderStep("hr", "人資"),
      ],
    });

    const result = await runSeeds(app, [form, flow]);

    expect(result.errors).toEqual([]);
    const workflow = await definitionDoc(
      connection,
      WORKFLOW_KIND,
      "seed_flow_first",
    );
    expect(result.results).toMatchObject([
      { kind: FORM_KIND, outcome: "created", localVersion: 1 },
      {
        kind: WORKFLOW_KIND,
        key: "seed_flow_first",
        ...seedHashes(flow),
        definitionId: String(workflow?._id),
        localVersion: 1,
        outcome: "created",
        conflict: null,
      },
    ]);
    expect(workflow).toMatchObject({
      name: flow.name,
      ownerOrgId: null,
      tenantId: null,
      currentVersion: 1,
      createdBy: app.rootUserId,
    });
    const [version, ...rest] = await versionDocs(
      connection,
      WORKFLOW_KIND,
      "seed_flow_first",
    );
    expect(rest).toEqual([]);
    expect(version).toMatchObject({
      version: 1,
      status: "published",
      checkFormKey: "seed_flow_form",
      changelog: "發布 r1",
      publishedBy: app.rootUserId,
    });
    if (!workflow || !version) {
      throw new Error("安裝後找不到流程或版本");
    }
    expect(
      await auditActionsOf(connection, [workflow._id, version._id]),
    ).toEqual([
      "workflow.create",
      "workflow-version.create-draft",
      "workflow-version.save-draft",
      "workflow-version.publish",
    ]);
    const installation = await installationOf(connection, flow);
    expect(installation).toMatchObject({
      status: "installed",
      mode: "created",
      localVersion: 1,
      metadata: { name: flow.name, checkFormKey: "seed_flow_form" },
    });
    expect(installation?.definitionId).toEqual(workflow._id);
    expect(installation?.draftId).toEqual(version._id);
    // 畫面上是一個已發布、帶角色佔位的共用流程
    const shown = await ok<{ workflow: { workflow: WorkflowRow } }>(
      api,
      world.root,
      WORKFLOW,
      { key: "seed_flow_first" },
    );
    expect(shown.workflow.workflow).toMatchObject({
      isShared: true,
      currentVersion: 1,
      hasDraft: false,
      hasRolePlaceholder: true,
    });
  });

  it("被引用的表單還沒裝好:流程在登記之前就停(定義檢查不通過),後面的宣告也不寫", async () => {
    const flow = workflowSeed("seed_flow_order", "r1", {
      steps: [
        reviewStep("pick", {
          kind: "field",
          formKey: "seed_flow_missing_form",
          fieldKey: "approver",
        }),
      ],
    });
    const auditsBefore = await auditCount(connection);

    const result = await runSeeds(app, [
      flow,
      formSeed("seed_flow_missing_form", "r1"),
    ]);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.conflict?.code).toBe("DEFINITION_INVALID");
    expect(
      await definitionDoc(connection, WORKFLOW_KIND, "seed_flow_order"),
    ).toBeNull();
    expect(
      await definitionDoc(connection, FORM_KIND, "seed_flow_missing_form"),
    ).toBeNull();
    expect(await installationsOf(connection, "seed_flow_order")).toEqual([]);
    expect(await auditCount(connection)).toBe(auditsBefore);
  });

  it("共用流程指名環境裡的人:檢查器擋下(共用流程不能帶 users),不會被繞過", async () => {
    const result = await runSeed(
      app,
      workflowSeed("seed_flow_users", "r1", {
        steps: [
          reviewStep("one", {
            kind: "users",
            userIds: [String(world.manager.userId)],
          }),
        ],
      }),
    );

    expect(result.conflict?.code).toBe("DEFINITION_INVALID");
    expect(result.conflict?.message).toContain("USERS_IN_SHARED");
  });

  it("重跑未變:流程、版本、安裝紀錄逐欄不變,沒有新增稽核", async () => {
    const seed = workflowSeed("seed_flow_rerun", "r1");
    await runSeeds(app, [seed]);
    const before = await persistedStateOf(
      connection,
      WORKFLOW_KIND,
      "seed_flow_rerun",
    );

    const rerun = await runSeed(app, seed);

    expect(rerun).toMatchObject({ outcome: "unchanged", localVersion: 1 });
    expect(
      await persistedStateOf(connection, WORKFLOW_KIND, "seed_flow_rerun"),
    ).toEqual(before);
  });

  it("畫面先發布相同內容:採納,保留 id 與版號;內容不同的初次納管則衝突", async () => {
    const seed = workflowSeed("seed_flow_adopt", "r1", { steps: twoSteps });
    await publishInUi(seed);
    await publishInUi(workflowSeed("seed_flow_unmanaged", "r1"));
    const before = await persistedStateOf(
      connection,
      WORKFLOW_KIND,
      "seed_flow_adopt",
    );

    const adopted = await runSeed(app, seed);
    const conflict = await runSeed(
      app,
      workflowSeed("seed_flow_unmanaged", "r1", { steps: twoSteps }),
    );

    expect(adopted).toMatchObject({ outcome: "adopted", localVersion: 1 });
    expect(
      await persistedStateOf(connection, WORKFLOW_KIND, "seed_flow_adopt"),
    ).toMatchObject({
      definition: (before as { definition: unknown }).definition,
      versions: (before as { versions: unknown }).versions,
      audits: (before as { audits: number }).audits,
    });
    expect(conflict.conflict?.code).toBe("UNMANAGED_DEFINITION");
  });

  it("正常新版:名稱以條件更新、發布下一版、前一版退役;畫面改過名或留了草稿則衝突", async () => {
    const r1 = workflowSeed("seed_flow_next", "r1", {
      checkFormKey: "sick_leave",
    });
    const r2 = workflowSeed("seed_flow_next", "r2", {
      name: "受管流程(改名)",
      steps: twoSteps,
      checkFormKey: null,
    });
    await runSeeds(app, [r1]);

    const updated = await runSeed(app, r2);

    expect(updated).toMatchObject({ outcome: "updated", localVersion: 2 });
    expect(
      await definitionDoc(connection, WORKFLOW_KIND, "seed_flow_next"),
    ).toMatchObject({ name: "受管流程(改名)", currentVersion: 2 });
    const versions = await versionDocs(
      connection,
      WORKFLOW_KIND,
      "seed_flow_next",
    );
    expect(
      versions.map(({ version, status, checkFormKey }) => ({
        version,
        status,
        checkFormKey,
      })),
    ).toEqual([
      { version: 1, status: "retired", checkFormKey: "sick_leave" },
      { version: 2, status: "published", checkFormKey: null },
    ]);
    expect(
      await auditCount(connection, {
        action: "workflow.update",
        "after.name": "受管流程(改名)",
      }),
    ).toBe(1);

    // 畫面留了草稿:要再發新版時衝突,草稿不丟
    await ok(api, world.root, CREATE_WORKFLOW_DRAFT, {
      input: { workflowKey: "seed_flow_next", baseVersion: 2 },
    });
    const blocked = await runSeed(
      app,
      workflowSeed("seed_flow_next", "r3", { name: "受管流程(改名)" }),
    );
    expect(blocked.conflict?.code).toBe("UNEXPECTED_DRAFT");
    expect(
      await versionDocs(connection, WORKFLOW_KIND, "seed_flow_next"),
    ).toHaveLength(3);
    // 歷史 revision 仍可核對:以安裝時的名稱快照,不要求等於現在的名稱
    const inspected = await runSeed(app, r1, "inspect");
    expect(inspected).toMatchObject({
      outcome: "unchanged",
      localVersion: 1,
      currentVersion: 2,
      currentContentHash: seedHashes(r2).contentHash,
    });
  });

  it("明示退役指名本地版號;已退役後重跑不再退役、不寫稽核;重新發布是新版號", async () => {
    const r1 = workflowSeed("seed_flow_retire", "r1");
    const r2 = workflowSeed("seed_flow_retire", "r2", {
      desiredStatus: "retired",
    });
    await runSeeds(app, [r1]);

    const retired = await runSeed(app, r2);

    expect(retired).toMatchObject({ outcome: "updated", localVersion: 1 });
    expect(
      await definitionDoc(connection, WORKFLOW_KIND, "seed_flow_retire"),
    ).toMatchObject({ currentVersion: null });
    const before = await persistedStateOf(
      connection,
      WORKFLOW_KIND,
      "seed_flow_retire",
    );
    const rerun = await runSeed(app, r2);
    expect(rerun.outcome).toBe("unchanged");
    expect(
      await persistedStateOf(connection, WORKFLOW_KIND, "seed_flow_retire"),
    ).toEqual(before);

    const republished = await runSeed(
      app,
      workflowSeed("seed_flow_retire", "r3"),
    );
    expect(republished).toMatchObject({ outcome: "updated", localVersion: 2 });

    // 退役宣告重跑時目前版本已是別的版本:不退役那個新版
    const drifted = await runSeed(app, r2);
    expect(drifted.conflict?.code).toBe("CURRENT_VERSION_DRIFT");
    expect(
      await definitionDoc(connection, WORKFLOW_KIND, "seed_flow_retire"),
    ).toMatchObject({ currentVersion: 2 });
  });

  it("退役只針對指名的版本:核對之後、退役之前畫面發布了新版 → 不退役那個新版;名稱也是條件更新", async () => {
    const r1 = workflowSeed("seed_flow_race", "r1");
    await runSeeds(app, [r1]);
    const reached = app.hooks.reached.bind(app.hooks);
    jest.spyOn(app.hooks, "reached").mockImplementation(async (checkpoint) => {
      if (checkpoint === "retire") {
        await publishDraftInUi(
          workflowSeed("seed_flow_race", "ui", { steps: twoSteps }),
          1,
        );
      }
      return reached(checkpoint);
    });

    const retireRaced = await runSeeds(app, [
      workflowSeed("seed_flow_race", "r2", { desiredStatus: "retired" }),
    ]);

    expect(retireRaced.results).toEqual([]);
    expect(retireRaced.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
    expect(
      await definitionDoc(connection, WORKFLOW_KIND, "seed_flow_race"),
    ).toMatchObject({ currentVersion: 2 });
    const versions = await versionDocs(
      connection,
      WORKFLOW_KIND,
      "seed_flow_race",
    );
    expect(
      versions.map(({ version, status }) => ({ version, status })),
    ).toEqual([
      { version: 1, status: "retired" },
      { version: 2, status: "published" },
    ]);

    // 另一個流程:名稱在比對之後被畫面改掉,條件更新不覆蓋
    await runSeeds(app, [workflowSeed("seed_flow_cas", "r1")]);
    jest.restoreAllMocks();
    jest.spyOn(app.hooks, "reached").mockImplementation(async (checkpoint) => {
      if (checkpoint === "update-metadata") {
        await ok(api, world.root, UPDATE_WORKFLOW, {
          input: { key: "seed_flow_cas", name: "畫面剛改的名字" },
        });
      }
      return reached(checkpoint);
    });
    const renameRaced = await runSeeds(app, [
      workflowSeed("seed_flow_cas", "r2", {
        name: "宣告的新名字",
        steps: twoSteps,
      }),
    ]);
    jest.restoreAllMocks();

    expect(renameRaced.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
    expect(
      await definitionDoc(connection, WORKFLOW_KIND, "seed_flow_cas"),
    ).toMatchObject({ name: "畫面剛改的名字", currentVersion: 1 });
    expect(
      await versionDocs(connection, WORKFLOW_KIND, "seed_flow_cas"),
    ).toHaveLength(1);
  });

  it("同 key 是租戶的客製流程:衝突,不讀也不接管租戶的流程", async () => {
    await ok(api, world.admin.token, CREATE_WORKFLOW, {
      input: { key: "seed_flow_tenant", name: "租戶自己的流程" },
    });
    const auditsBefore = await auditCount(connection);

    const result = await runSeed(app, workflowSeed("seed_flow_tenant", "r1"));
    const inspected = await runSeed(
      app,
      workflowSeed("seed_flow_tenant", "r1"),
      "inspect",
    );

    expect(result.conflict?.code).toBe("OWNER_MISMATCH");
    expect(inspected).toMatchObject({
      outcome: "absent",
      currentVersion: null,
      currentContentHash: null,
    });
    expect(await installationsOf(connection, "seed_flow_tenant")).toEqual([]);
    expect(await auditCount(connection)).toBe(auditsBefore);
  });

  it("在途保護:改版後進行中的實例照原版走完,分派、綁定與租戶的 fork 不動;新送出才用新版", async () => {
    const r1 = workflowSeed("seed_flow_live", "r1");
    await runSeeds(app, [r1]);
    await ok(api, world.root, ASSIGN_WORKFLOW, {
      input: {
        workflowKey: "seed_flow_live",
        tenantOrgIds: [String(world.tenant)],
      },
    });
    await ok(api, world.admin.token, FORK_WORKFLOW, {
      input: {
        sourceKey: "seed_flow_live",
        sourceVersion: 1,
        key: "seed_flow_live_tenant",
        name: "租戶客製流程",
      },
    });
    await bindForm(world, "seed_flow_live");
    const pending = await submitLeave(world);
    const before = await currentInstance(world, pending.id);
    expect(before.workflowVersion).toBe(1);
    const forkBefore = await persistedStateOf(
      connection,
      WORKFLOW_KIND,
      "seed_flow_live_tenant",
    );

    const updated = await runSeed(
      app,
      workflowSeed("seed_flow_live", "r2", { steps: twoSteps }),
    );

    expect(updated).toMatchObject({ outcome: "updated", localVersion: 2 });
    // 進行中的實例仍綁原版,照原版一關就走完
    const during = await currentInstance(world, pending.id);
    expect(during).toMatchObject({
      workflowVersion: 1,
      status: before.status,
      activeStepKeys: before.activeStepKeys,
    });
    expect(during.steps.map((step) => step.stepKey)).toEqual(["boss"]);
    await decideOn(world, world.manager, pending.id, "APPROVE");
    const finished = await submission(world, world.applicant, pending.id);
    expect(finished.status).toBe("COMPLETED");
    // 分派、綁定與 fork 不動
    const shown = await ok<{ workflow: { workflow: WorkflowRow } }>(
      api,
      world.root,
      WORKFLOW,
      { key: "seed_flow_live" },
    );
    expect(shown.workflow.workflow.assignments).toEqual([
      { tenantOrgId: String(world.tenant) },
    ]);
    const binding = await ok<{
      form: { form: { workflowBinding: { workflowKey: string } | null } };
    }>(api, world.admin.token, FORM_BINDING, { key: "sick_leave" });
    expect(binding.form.form.workflowBinding?.workflowKey).toBe(
      "seed_flow_live",
    );
    expect(
      await persistedStateOf(
        connection,
        WORKFLOW_KIND,
        "seed_flow_live_tenant",
      ),
    ).toMatchObject({
      definition: (forkBefore as { definition: unknown }).definition,
      versions: (forkBefore as { versions: unknown }).versions,
    });
    // 新送出用新版(兩關)
    const next = await submitLeave(world);
    const nextInstance = await currentInstance(world, next.id);
    expect(nextInstance.workflowVersion).toBe(2);
    expect(nextInstance.steps.map((step) => step.stepKey)).toEqual([
      "boss",
      "upper",
    ]);
  });
});
