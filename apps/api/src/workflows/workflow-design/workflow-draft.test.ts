import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import {
  ASSIGN,
  CREATE_FORM,
  call,
  definitionOf,
  field,
  ok,
  publishDefinition,
} from "../../forms/test-support/form-fixtures";
import {
  ASSIGN_WORKFLOW,
  CREATE_WORKFLOW,
  CREATE_WORKFLOW_DRAFT,
  DELETE_WORKFLOW_DRAFT,
  FORK_WORKFLOW,
  FORM_KEY,
  PUBLISH_WORKFLOW,
  WORKFLOW_MODULE,
  WORKFLOW_TEST_TIMEOUT_MS,
  WORKFLOW_VERSION,
  type WorkflowRow,
  type WorkflowVersionRow,
  type World,
  errorCode,
  errorReason,
  person,
  publishWorkflow,
  reviewStep,
  saveWorkflowDraft,
  setupWorld,
} from "../test-support/workflow-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

interface VersionResult {
  workflowVersion: {
    workflowVersion: WorkflowVersionRow;
    validation: { errors: { code: string; stepKey: string | null }[] } | null;
  };
}

interface IssueResult {
  errors?: { extensions?: Record<string, unknown> }[];
}

function issueCodes(result: IssueResult): string[] {
  const issues = result.errors?.[0]?.extensions?.issues;
  return Array.isArray(issues)
    ? issues.map((issue: Record<string, unknown>) => String(issue.code))
    : [];
}

/** 跳過條件引用「天數」:病假表單有這一欄,`OTHER_FORM` 沒有。 */
const SKIP_SHORT = { "<=": [{ var: "days" }, 1] };
const OTHER_FORM = "other_form";

function managerStep(key: string, overrides: Record<string, unknown> = {}) {
  return reviewStep(key, { kind: "manager", level: 1 }, overrides);
}

/**
 * 流程草稿的補票(真 Mongo):刪除草稿(樂觀鎖、發布中不可、稽核、刪完可再開)、
 * 設計器「檢查用表單」`checkFormKey` 的存取、檢查器與發布檢查用它、發布快照保留、開草稿與 fork 帶過去。
 */
describe("流程草稿:刪除與檢查用表單", () => {
  let api: AuthTestApp;
  let world: World;
  let sequence = 0;

  function nextKey(prefix: string): string {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  }

  async function createWithDraft(key: string): Promise<WorkflowVersionRow> {
    await ok(api, world.admin.token, CREATE_WORKFLOW, {
      input: { key, name: `流程 ${key}` },
    });
    const draft = await ok<{
      createWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
    }>(api, world.admin.token, CREATE_WORKFLOW_DRAFT, {
      input: { workflowKey: key, baseVersion: null },
    });
    return draft.createWorkflowVersionDraft.workflowVersion;
  }

  async function readDraft(
    key: string,
  ): Promise<VersionResult["workflowVersion"]> {
    const result = await ok<VersionResult>(
      api,
      world.admin.token,
      WORKFLOW_VERSION,
      { workflowKey: key },
    );
    return result.workflowVersion;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_draft", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 0);
    // 第二張共用表單:只有標題,沒有「天數」
    await ok(api, world.root, CREATE_FORM, {
      input: { key: OTHER_FORM, moduleKey: WORKFLOW_MODULE, name: "其他表單" },
    });
    await publishDefinition(
      api,
      world.root,
      OTHER_FORM,
      definitionOf([field("title", "text")]),
      null,
    );
    await ok(api, world.root, ASSIGN, {
      input: { formKey: OTHER_FORM, tenantOrgIds: [String(world.tenant)] },
    });
  });

  afterAll(async () => {
    await api.close();
  });

  describe("deleteWorkflowVersionDraft", () => {
    it("修訂號不符 → DRAFT_REVISION_MISMATCH;相符 → 硬刪、hasDraft = false、稽核記整份定義,之後可再開草稿", async () => {
      const key = nextKey("delete_draft");
      await publishWorkflow(world, key, { steps: [managerStep("boss")] });
      const draft = await ok<{
        createWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
      }>(api, world.admin.token, CREATE_WORKFLOW_DRAFT, {
        input: { workflowKey: key, baseVersion: 1 },
      });
      const draftRow = draft.createWorkflowVersionDraft.workflowVersion;
      const saved = await saveWorkflowDraft(
        world,
        key,
        { steps: [managerStep("boss"), managerStep("boss2")] },
        draftRow.draftRevision,
      );

      const stale = await call(api, world.admin.token, DELETE_WORKFLOW_DRAFT, {
        input: {
          workflowKey: key,
          expectedDraftRevision: draftRow.draftRevision,
        },
      });
      expect(errorCode(stale)).toBe("CONFLICT");
      expect(errorReason(stale)).toBe("DRAFT_REVISION_MISMATCH");

      const deleted = await ok<{
        deleteWorkflowVersionDraft: { workflow: WorkflowRow };
      }>(api, world.admin.token, DELETE_WORKFLOW_DRAFT, {
        input: { workflowKey: key, expectedDraftRevision: saved.draftRevision },
      });
      expect(deleted.deleteWorkflowVersionDraft.workflow).toMatchObject({
        hasDraft: false,
        currentVersion: 1,
      });
      const missing = await call(api, world.admin.token, WORKFLOW_VERSION, {
        workflowKey: key,
      });
      expect(errorCode(missing)).toBe("NOT_FOUND");
      // 已發布的版本不受影響
      const published = await ok<VersionResult>(
        api,
        world.admin.token,
        WORKFLOW_VERSION,
        { workflowKey: key, version: 1 },
      );
      expect(published.workflowVersion.workflowVersion.status).toBe(
        "PUBLISHED",
      );
      // 硬刪:文件整筆不在(連已刪除的都查不到)
      const raw = await api.connection
        .collection("workflow_versions")
        .findOne({ _id: new Types.ObjectId(draftRow.id) });
      expect(raw).toBeNull();
      const audit = await api.connection.collection("audit_logs").findOne({
        action: "workflow-version.delete-draft",
        targetId: new Types.ObjectId(draftRow.id),
      });
      expect(audit?.before).toMatchObject({
        workflowKey: key,
        draftRevision: saved.draftRevision,
        baseVersion: 1,
        steps: [{ key: "boss" }, { key: "boss2" }],
        edges: null,
        checkFormKey: null,
      });

      const again = await call(api, world.admin.token, DELETE_WORKFLOW_DRAFT, {
        input: { workflowKey: key, expectedDraftRevision: saved.draftRevision },
      });
      expect(errorReason(again)).toBe("DRAFT_MISSING");
      // 「一個流程至多一份草稿」的索引已讓出:可再開草稿
      const reopened = await call(
        api,
        world.admin.token,
        CREATE_WORKFLOW_DRAFT,
        { input: { workflowKey: key, baseVersion: 1 } },
      );
      expect(reopened.errors).toBeUndefined();
    });
  });

  describe("deleteWorkflowVersionDraft:租戶邊界", () => {
    it("租戶刪分派來的共用流程草稿 → NOT_WORKFLOW_OWNER,草稿還在", async () => {
      const key = nextKey("shared_draft");
      await ok(api, world.root, CREATE_WORKFLOW, {
        input: { key, name: `共用 ${key}` },
      });
      const first = await ok<{
        createWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
      }>(api, world.root, CREATE_WORKFLOW_DRAFT, {
        input: { workflowKey: key, baseVersion: null },
      });
      const saved = await saveWorkflowDraft(
        world,
        key,
        { steps: [managerStep("boss")] },
        first.createWorkflowVersionDraft.workflowVersion.draftRevision,
        world.root,
      );
      await ok(api, world.root, PUBLISH_WORKFLOW, {
        input: {
          workflowKey: key,
          expectedDraftRevision: saved.draftRevision,
          changelog: "共用第一版",
        },
      });
      await ok(api, world.root, ASSIGN_WORKFLOW, {
        input: { workflowKey: key, tenantOrgIds: [String(world.tenant)] },
      });
      const draft = await ok<{
        createWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
      }>(api, world.root, CREATE_WORKFLOW_DRAFT, {
        input: { workflowKey: key, baseVersion: 1 },
      });
      const revision =
        draft.createWorkflowVersionDraft.workflowVersion.draftRevision;

      const blocked = await call(
        api,
        world.admin.token,
        DELETE_WORKFLOW_DRAFT,
        {
          input: { workflowKey: key, expectedDraftRevision: revision },
        },
      );

      expect(errorCode(blocked)).toBe("FORBIDDEN");
      expect(errorReason(blocked)).toBe("NOT_WORKFLOW_OWNER");
      const still = await ok<VersionResult>(api, world.root, WORKFLOW_VERSION, {
        workflowKey: key,
      });
      expect(still.workflowVersion.workflowVersion.draftRevision).toBe(
        revision,
      );
    });

    it("另一個租戶刪本租戶客製流程的草稿 → 被擋(看不到),草稿還在", async () => {
      const key = nextKey("custom_draft");
      const draft = await createWithDraft(key);
      const otherTenant = await createOrg(api.connection, { name: "別的租戶" });
      const otherAdmin = await person(
        api,
        api.connection,
        otherTenant,
        otherTenant,
        {
          moduleKeys: ["system", "system.workflows"],
          permissionKeys: ["system.workflows.*"],
        },
      );

      const blocked = await call(api, otherAdmin.token, DELETE_WORKFLOW_DRAFT, {
        input: { workflowKey: key, expectedDraftRevision: draft.draftRevision },
      });

      expect(blocked.errors).toBeDefined();
      expect(["NOT_FOUND", "FORBIDDEN"]).toContain(errorCode(blocked));
      const still = await readDraft(key);
      expect(still.workflowVersion.draftRevision).toBe(draft.draftRevision);
    });
  });

  describe("checkFormKey", () => {
    it("存草稿一併存;缺席不動、null 清掉;草稿的檢查結果對它驗跳過條件", async () => {
      const key = nextKey("check_form");
      const draft = await createWithDraft(key);
      expect(draft.checkFormKey).toBeNull();
      const withOther = await saveWorkflowDraft(
        world,
        key,
        {
          steps: [managerStep("boss", { skipWhen: SKIP_SHORT })],
          checkFormKey: OTHER_FORM,
        },
        draft.draftRevision,
      );
      expect(withOther.checkFormKey).toBe(OTHER_FORM);
      const read = await readDraft(key);
      expect(read.workflowVersion.checkFormKey).toBe(OTHER_FORM);
      expect(read.validation?.errors).toEqual([
        { code: "SKIP_UNKNOWN_FIELD", stepKey: "boss" },
      ]);

      // 缺席 = 不動
      const kept = await saveWorkflowDraft(
        world,
        key,
        { steps: [managerStep("boss", { skipWhen: SKIP_SHORT })] },
        withOther.draftRevision,
      );
      expect(kept.checkFormKey).toBe(OTHER_FORM);
      // 換成有「天數」的表單 → 檢查通過
      const switched = await saveWorkflowDraft(
        world,
        key,
        {
          steps: [managerStep("boss", { skipWhen: SKIP_SHORT })],
          checkFormKey: FORM_KEY,
        },
        kept.draftRevision,
      );
      expect(switched.checkFormKey).toBe(FORM_KEY);
      const passed = await readDraft(key);
      expect(passed.validation?.errors).toEqual([]);
      // null = 清掉
      const cleared = await saveWorkflowDraft(
        world,
        key,
        { steps: [managerStep("boss")], checkFormKey: null },
        switched.draftRevision,
      );
      expect(cleared.checkFormKey).toBeNull();
    });

    it("檢查用表單對不到(不存在)→ CHECK_FORM_UNAVAILABLE 擋發布,不冒出 SKIP_UNKNOWN_FIELD", async () => {
      const key = nextKey("check_missing");
      const draft = await createWithDraft(key);
      const saved = await saveWorkflowDraft(
        world,
        key,
        {
          steps: [managerStep("boss", { skipWhen: SKIP_SHORT })],
          checkFormKey: "no_such_form",
        },
        draft.draftRevision,
      );
      const read = await readDraft(key);
      expect(read.validation?.errors.map((issue) => issue.code)).toEqual([
        "CHECK_FORM_UNAVAILABLE",
      ]);
      const blocked = await call(api, world.admin.token, PUBLISH_WORKFLOW, {
        input: {
          workflowKey: key,
          expectedDraftRevision: saved.draftRevision,
          changelog: "對不到",
        },
      });
      expect(errorCode(blocked)).toBe("VALIDATION_FAILED");
      expect(issueCodes(blocked)).toEqual(["CHECK_FORM_UNAVAILABLE"]);
    });

    it("發布檢查用它:對不上的檢查用表單擋發布;發布快照保留;以此版開草稿與 fork 都帶過去", async () => {
      const key = nextKey("check_publish");
      const draft = await createWithDraft(key);
      const blockedDraft = await saveWorkflowDraft(
        world,
        key,
        {
          steps: [managerStep("boss", { skipWhen: SKIP_SHORT })],
          checkFormKey: OTHER_FORM,
        },
        draft.draftRevision,
      );
      const blocked = await call(api, world.admin.token, PUBLISH_WORKFLOW, {
        input: {
          workflowKey: key,
          expectedDraftRevision: blockedDraft.draftRevision,
          changelog: "對不上",
        },
      });
      expect(errorCode(blocked)).toBe("VALIDATION_FAILED");
      expect(issueCodes(blocked)).toContain("SKIP_UNKNOWN_FIELD");

      const fixed = await saveWorkflowDraft(
        world,
        key,
        {
          steps: [managerStep("boss", { skipWhen: SKIP_SHORT })],
          checkFormKey: FORM_KEY,
        },
        blockedDraft.draftRevision,
      );
      const published = await ok<{
        publishWorkflowVersion: { workflowVersion: WorkflowVersionRow };
      }>(api, world.admin.token, PUBLISH_WORKFLOW, {
        input: {
          workflowKey: key,
          expectedDraftRevision: fixed.draftRevision,
          changelog: "第一版",
        },
      });
      expect(published.publishWorkflowVersion.workflowVersion).toMatchObject({
        version: 1,
        checkFormKey: FORM_KEY,
      });
      const snapshot = await ok<VersionResult>(
        api,
        world.admin.token,
        WORKFLOW_VERSION,
        { workflowKey: key, version: 1 },
      );
      expect(snapshot.workflowVersion.workflowVersion.checkFormKey).toBe(
        FORM_KEY,
      );

      const next = await ok<{
        createWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
      }>(api, world.admin.token, CREATE_WORKFLOW_DRAFT, {
        input: { workflowKey: key, baseVersion: 1 },
      });
      expect(next.createWorkflowVersionDraft.workflowVersion.checkFormKey).toBe(
        FORM_KEY,
      );

      const forkKey = nextKey("check_fork");
      await ok(api, world.admin.token, FORK_WORKFLOW, {
        input: { sourceKey: key, sourceVersion: 1, key: forkKey, name: "副本" },
      });
      const forked = await readDraft(forkKey);
      expect(forked.workflowVersion.checkFormKey).toBe(FORM_KEY);
    });
  });
});
