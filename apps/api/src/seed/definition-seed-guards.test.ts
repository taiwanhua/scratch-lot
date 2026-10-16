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
import {
  CREATE_DRAFT,
  FORM_TEST_TIMEOUT_MS,
  FORM_VERSION,
  type VersionRow,
  definitionOf,
  field,
  getForm,
  ok,
  publishDefinition,
  publishNewForm,
  saveDefinition,
  showKey,
} from "../forms/test-support/form-fixtures";
import {
  CREATE_WORKFLOW,
  CREATE_WORKFLOW_DRAFT,
  DELETE_WORKFLOW_DRAFT,
  PUBLISH_WORKFLOW,
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

/** 畫面上刪除表單草稿。 */
const DELETE_FORM_DRAFT = /* GraphQL */ `
  mutation DeleteFormVersionDraft($input: DeleteFormVersionDraftInput!) {
    deleteFormVersionDraft(input: $input) {
      form {
        key
        hasDraft
      }
    }
  }
`;

/**
 * 現場的草稿、版本與 metadata 不被安裝動到(`docs/concepts/data-layer-and-isolation.md`「受管表單與流程」):
 * 未預期的草稿一律先報衝突、採納前核對完整目標狀態、metadata 與草稿的寫入條件含身分 / 目前版本 / 草稿 id。
 * 競爭以安裝流程的檢查點注入:走到某一步寫入之前,先讓「畫面上的人」經真的 `/graphql` 做一件事。
 */
describe("受管定義:不略過、不覆蓋現場的草稿、版本與 metadata", () => {
  let app: SeedTestApp;
  let api: AuthTestApp;
  let connection: Connection;

  beforeAll(async () => {
    app = await startSeedTestApp("cookhome-test-seed-guards");
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

  /** 走到 `checkpoint` 就讓安裝失敗一次(停在那一筆寫入之前)。 */
  function failBefore(checkpoint: SeedInstallCheckpoint): void {
    let hasFailed = false;
    jest.spyOn(app.hooks, "reached").mockImplementation((current) => {
      if (!hasFailed && current === checkpoint) {
        hasFailed = true;
        return Promise.reject(new Error(`injected failure at ${checkpoint}`));
      }
      return Promise.resolve();
    });
  }

  async function formDraft(formKey: string): Promise<VersionRow> {
    const data = await ok<{ formVersion: { formVersion: VersionRow } }>(
      api,
      app.root,
      FORM_VERSION,
      { formKey },
    );
    return data.formVersion.formVersion;
  }

  /** 畫面上:刪掉現有草稿(安裝建的那一份),另開一份自己的。 */
  async function replaceFormDraft(
    formKey: string,
    expectedDraftRevision: number,
  ): Promise<VersionRow> {
    await ok(api, app.root, DELETE_FORM_DRAFT, {
      input: { formKey, expectedDraftRevision },
    });
    const created = await ok<{
      createFormVersionDraft: { formVersion: VersionRow };
    }>(api, app.root, CREATE_DRAFT, { input: { formKey, baseVersion: null } });
    return created.createFormVersionDraft.formVersion;
  }

  async function saveWorkflowInUi(
    seed: WorkflowDefinitionSeedSet,
    expectedDraftRevision: number,
  ): Promise<WorkflowVersionRow> {
    const saved = await ok<{
      saveWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
    }>(api, app.root, SAVE_WORKFLOW_DRAFT, {
      input: {
        workflowKey: seed.key,
        expectedDraftRevision,
        definition: { steps: seed.definition.steps, checkFormKey: null },
      },
    });
    return saved.saveWorkflowVersionDraft.workflowVersion;
  }

  async function openWorkflowDraft(
    workflowKey: string,
    baseVersion: number | null,
  ): Promise<WorkflowVersionRow> {
    const draft = await ok<{
      createWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
    }>(api, app.root, CREATE_WORKFLOW_DRAFT, {
      input: { workflowKey, baseVersion },
    });
    return draft.createWorkflowVersionDraft.workflowVersion;
  }

  /** 畫面上在既有流程發布一個新版本。 */
  async function publishWorkflowInUi(
    seed: WorkflowDefinitionSeedSet,
    baseVersion: number | null,
  ): Promise<void> {
    const draft = await openWorkflowDraft(seed.key, baseVersion);
    const saved = await saveWorkflowInUi(seed, draft.draftRevision);
    await ok(api, app.root, PUBLISH_WORKFLOW, {
      input: {
        workflowKey: seed.key,
        expectedDraftRevision: saved.draftRevision,
        changelog: seed.changelog,
      },
    });
  }

  const otherFields = [field("title", "text"), field("ui_only", "text")];

  describe("未預期的草稿:首次採納也先報衝突", () => {
    it("畫面發布了相同內容、又開了草稿:首次安裝不採納、不記成功;草稿與版本不動", async () => {
      const seed = formSeed("guard_adopt_draft", "r1");
      await publishNewForm(api, app.root, seed.key, seed.definition, seed.name);
      await ok(api, app.root, CREATE_DRAFT, {
        input: { formKey: seed.key, baseVersion: 1 },
      });
      const before = await persistedStateOf(connection, FORM, seed.key);

      const adopt = await runSeed(app, seed);
      const retire = await runSeed(
        app,
        formSeed(seed.key, "r2", { desiredStatus: "retired" }),
      );

      expect(adopt.conflict?.code).toBe("UNEXPECTED_DRAFT");
      expect(retire.conflict?.code).toBe("UNEXPECTED_DRAFT");
      expect(await persistedStateOf(connection, FORM, seed.key)).toEqual(
        before,
      );
      expect(await installationsOf(connection, seed.key)).toEqual([]);
    });

    it("流程:採納與已安裝的重跑遇到畫面草稿都衝突", async () => {
      const seed = workflowSeed("guard_flow_draft", "r1");
      await ok(api, app.root, CREATE_WORKFLOW, {
        input: { key: seed.key, name: seed.name },
      });
      await publishWorkflowInUi(seed, null);
      const draft = await openWorkflowDraft(seed.key, 1);

      const adopt = await runSeed(app, seed);

      expect(adopt.conflict?.code).toBe("UNEXPECTED_DRAFT");
      expect(await installationsOf(connection, seed.key)).toEqual([]);
      // 草稿拿掉後採納;之後畫面再開草稿,重跑也衝突
      await ok(api, app.root, DELETE_WORKFLOW_DRAFT, {
        input: {
          workflowKey: seed.key,
          expectedDraftRevision: draft.draftRevision,
        },
      });
      const adopted = await runSeed(app, seed);
      expect(adopted.outcome).toBe("adopted");
      await openWorkflowDraft(seed.key, 1);
      const rerun = await runSeed(app, seed);
      expect(rerun.conflict?.code).toBe("UNEXPECTED_DRAFT");
    });
  });

  describe("首次採納前核對完整目標狀態", () => {
    it("目前版本宣告的欄位級權限被退役或不見:第一次就衝突,不先記成功", async () => {
      const seed = formSeed("guard_adopt_perm", "r1");
      await publishNewForm(api, app.root, seed.key, seed.definition, seed.name);
      const permissionKey = showKey(seed.key, "amount");
      const permissions = connection.collection("permissions");
      await permissions.updateOne(
        { key: permissionKey },
        { $set: { retiredAt: new Date() } },
      );

      const retired = await runSeed(app, seed);

      expect(retired.conflict?.code).toBe("PERMISSIONS_INCOMPLETE");
      expect(retired.conflict?.message).toContain(permissionKey);
      expect(await installationsOf(connection, seed.key)).toEqual([]);

      await permissions.deleteOne({ key: permissionKey });
      const missing = await runSeed(app, seed);

      expect(missing.conflict?.code).toBe("PERMISSIONS_INCOMPLETE");
      expect(await installationsOf(connection, seed.key)).toEqual([]);
    });
  });

  describe("metadata 的條件更新含身分與目前版本", () => {
    it("表單:比對之後、改名之前畫面發布了新版(名稱沒變)→ 不把名稱改到別人的新版上", async () => {
      const r1 = formSeed("guard_meta_form", "r1");
      await runSeeds(app, [r1]);
      const r2 = formSeed(r1.key, "r2", {
        name: "宣告的新名字",
        tabLabelTemplate: "{{title}}",
        fields: [field("title", "text"), field("memo", "text")],
      });
      beforeWrite("update-metadata", () =>
        publishDefinition(api, app.root, r1.key, definitionOf(otherFields), 1),
      );
      const updateAudits = { action: "form.update" };
      const auditsBefore = await auditCount(connection, updateAudits);

      const raced = await runSeeds(app, [r2]);
      jest.restoreAllMocks();

      expect(raced.results).toEqual([]);
      expect(raced.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
      expect(raced.errors[0]?.message).toContain("changed");
      // 名稱、頁籤模板仍是原值;畫面的新版是目前版本,內容沒被動到
      const form = await getForm(api, app.root, r1.key);
      expect(form).toMatchObject({
        name: r1.name,
        tabLabelTemplate: null,
        currentVersion: 2,
        hasDraft: false,
      });
      const versions = await versionDocs(connection, FORM, r1.key);
      expect(versions).toHaveLength(2);
      expect(versions[1]).toMatchObject({
        version: 2,
        status: "published",
        fields: otherFields,
      });
      expect(await auditCount(connection, updateAudits)).toBe(auditsBefore);
      // 重跑看到的是現場另外發布過
      const rerun = await runSeed(app, r2);
      expect(rerun.conflict?.code).toBe("CURRENT_VERSION_DRIFT");
    });

    it("流程:比對之後、改名之前畫面發布了新版 → 名稱不被改", async () => {
      const r1 = workflowSeed("guard_meta_flow", "r1");
      await runSeeds(app, [r1]);
      const uiVersion = workflowSeed(r1.key, "ui", {
        steps: [managerStep("boss"), managerStep("ui_step")],
      });
      beforeWrite("update-metadata", () => publishWorkflowInUi(uiVersion, 1));

      const raced = await runSeeds(app, [
        workflowSeed(r1.key, "r2", {
          name: "宣告的新名字",
          steps: [managerStep("other")],
        }),
      ]);
      jest.restoreAllMocks();

      expect(raced.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
      expect(await definitionDoc(connection, WORKFLOW, r1.key)).toMatchObject({
        name: r1.name,
        currentVersion: 2,
      });
      const versions = await versionDocs(connection, WORKFLOW, r1.key);
      expect(
        versions.map(({ version, status }) => ({ version, status })),
      ).toEqual([
        { version: 1, status: "retired" },
        { version: 2, status: "published" },
      ]);
      expect(
        await auditCount(connection, {
          action: "workflow.update",
          "after.name": "宣告的新名字",
        }),
      ).toBe(0);
    });
  });

  describe("存檔與發布只針對這次安裝預配置的草稿", () => {
    it("表單存檔前,自己的草稿被刪掉、畫面另開了一份(revision 同為 0)→ 不存進別人的草稿", async () => {
      const seed = formSeed("guard_draft_save", "r1");
      let uiDraft: VersionRow | undefined;
      beforeWrite("save-draft", async () => {
        uiDraft = await replaceFormDraft(seed.key, 0);
      });

      const raced = await runSeeds(app, [seed]);
      jest.restoreAllMocks();

      expect(raced.results).toEqual([]);
      expect(raced.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
      const reserved = await installationOf(connection, seed);
      expect(uiDraft?.draftRevision).toBe(0);
      expect(uiDraft?.id).not.toBe(String(reserved?.draftId));
      // 別人的草稿原封不動(空白、revision 0),沒有存檔稽核
      expect(await formDraft(seed.key)).toMatchObject({
        id: uiDraft?.id,
        status: "DRAFT",
        draftRevision: 0,
        fields: [],
      });
      expect(
        await auditCount(connection, {
          action: "form-version.save-draft",
          "after.formKey": seed.key,
        }),
      ).toBe(0);
      // 重跑:那是別人的草稿,先報衝突
      const rerun = await runSeed(app, seed);
      expect(rerun.conflict?.code).toBe("UNEXPECTED_DRAFT");
      expect(await formDraft(seed.key)).toMatchObject({
        id: uiDraft?.id,
        draftRevision: 0,
        fields: [],
      });
    });

    it("表單發布前,自己存好的草稿被刪掉、畫面另開並存了一份(revision 同為 1)→ 不發布別人的草稿", async () => {
      const seed = formSeed("guard_draft_publish", "r1");
      const uiDefinition = definitionOf(otherFields);
      let uiDraft: VersionRow | undefined;
      beforeWrite("publish", async () => {
        const opened = await replaceFormDraft(seed.key, 1);
        uiDraft = await saveDefinition(
          api,
          app.root,
          seed.key,
          uiDefinition,
          opened.draftRevision,
        );
      });

      const raced = await runSeeds(app, [seed]);
      jest.restoreAllMocks();

      expect(raced.results).toEqual([]);
      expect(raced.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
      expect(uiDraft?.draftRevision).toBe(1);
      const versions = await versionDocs(connection, FORM, seed.key);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        version: null,
        status: "draft",
        draftRevision: 1,
        fields: uiDefinition.fields,
      });
      expect(await definitionDoc(connection, FORM, seed.key)).toMatchObject({
        currentVersion: null,
      });
      expect(
        await auditCount(connection, {
          action: "form-version.publish",
          "after.formKey": seed.key,
        }),
      ).toBe(0);
    });

    it("流程存檔與發布同樣指名草稿:被換掉的草稿不會被存、也不會被發布", async () => {
      const saveSeed = workflowSeed("guard_flow_save", "r1");
      const uiSteps = workflowSeed(saveSeed.key, "ui", {
        steps: [managerStep("ui_step")],
      });
      let replaced: WorkflowVersionRow | undefined;
      beforeWrite("save-draft", async () => {
        await ok(api, app.root, DELETE_WORKFLOW_DRAFT, {
          input: { workflowKey: saveSeed.key, expectedDraftRevision: 0 },
        });
        replaced = await openWorkflowDraft(saveSeed.key, null);
      });

      const saveRaced = await runSeeds(app, [saveSeed]);
      jest.restoreAllMocks();

      expect(saveRaced.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
      const [afterSave] = await versionDocs(connection, WORKFLOW, saveSeed.key);
      expect(String(afterSave?._id)).toBe(replaced?.id);
      expect(afterSave).toMatchObject({
        status: "draft",
        draftRevision: 0,
        steps: [],
      });

      const publishSeed = workflowSeed("guard_flow_publish", "r1");
      beforeWrite("publish", async () => {
        await ok(api, app.root, DELETE_WORKFLOW_DRAFT, {
          input: { workflowKey: publishSeed.key, expectedDraftRevision: 1 },
        });
        const opened = await openWorkflowDraft(publishSeed.key, null);
        await saveWorkflowInUi(
          { ...uiSteps, key: publishSeed.key },
          opened.draftRevision,
        );
      });

      const publishRaced = await runSeeds(app, [publishSeed]);
      jest.restoreAllMocks();

      expect(publishRaced.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
      const versions = await versionDocs(connection, WORKFLOW, publishSeed.key);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        version: null,
        status: "draft",
        draftRevision: 1,
      });
      expect(
        await definitionDoc(connection, WORKFLOW, publishSeed.key),
      ).toMatchObject({ currentVersion: null });
    });
  });

  describe("登記後中斷:能預檢的現場衝突先查,不先改 metadata", () => {
    it("登記後、任何寫入前中斷,期間畫面開了草稿:續跑(含整批)在預檢就衝突,名稱沒被改、同批其他宣告也不寫", async () => {
      const r1 = formSeed("guard_reserved", "r1");
      await runSeeds(app, [r1]);
      const r2 = formSeed(r1.key, "r2", {
        name: "宣告的新名字",
        fields: [field("title", "text"), field("memo", "text")],
      });
      failBefore("update-metadata");
      const interrupted = await runSeeds(app, [r2]);
      jest.restoreAllMocks();
      expect(interrupted.errors).toMatchObject([{ code: "APPLY_FAILED" }]);
      expect(await installationOf(connection, r2)).toMatchObject({
        status: "in-progress",
      });
      await ok(api, app.root, CREATE_DRAFT, {
        input: { formKey: r1.key, baseVersion: 1 },
      });
      const before = await persistedStateOf(connection, FORM, r1.key);
      const other = formSeed("guard_reserved_other", "r1");

      const batch = await runSeeds(app, [other, r2]);
      const single = await runSeed(app, r2);

      expect(batch.errors).toEqual([]);
      expect(batch.results).toHaveLength(1);
      expect(batch.results[0]).toMatchObject({
        key: r1.key,
        revision: "r2",
        conflict: { code: "UNEXPECTED_DRAFT" },
      });
      expect(single.conflict?.code).toBe("UNEXPECTED_DRAFT");
      // 名稱、草稿、版本、安裝紀錄、稽核筆數都沒變;同批的另一筆沒有被安裝
      expect(await persistedStateOf(connection, FORM, r1.key)).toEqual(before);
      const form = await getForm(api, app.root, r1.key);
      expect(form).toMatchObject({ name: r1.name, hasDraft: true });
      expect(await definitionDoc(connection, FORM, other.key)).toBeNull();
      expect(await installationsOf(connection, other.key)).toEqual([]);
    });
  });
});
