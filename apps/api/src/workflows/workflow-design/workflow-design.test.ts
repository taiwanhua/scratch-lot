import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import { AuditService } from "../../audit/audit.service";
import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../auth/test-support/fixtures";
import {
  ASSIGN,
  CREATE_FORM,
  call,
  createDraft,
  definitionOf,
  field,
  ok,
  publishDefinition,
} from "../../forms/test-support/form-fixtures";
import {
  ASSIGN_WORKFLOW,
  BIND,
  CREATE_WORKFLOW,
  CREATE_WORKFLOW_DRAFT,
  type DefinitionShape,
  FORK_WORKFLOW,
  FORM_BINDING,
  FORM_KEY,
  FORM_WORKFLOW_OPTIONS,
  PUBLISH_WORKFLOW,
  type Person,
  RETIRE_WORKFLOW,
  REVOKE_WORKFLOW,
  SUBMIT_SUBMISSION,
  VALIDATE_WORKFLOW,
  WORKFLOW,
  WORKFLOWS,
  WORKFLOW_MODULE,
  WORKFLOW_TEST_TIMEOUT_MS,
  WORKFLOW_VERSION,
  type WorkflowRow,
  type WorkflowVersionRow,
  type World,
  audienceRow,
  audienceSource,
  bindForm,
  currentInstance,
  decideOn,
  errorCode,
  errorReason,
  pendingTaskOf,
  person,
  publishWorkflow,
  reviewStep,
  roleSource,
  saveWorkflowDraft,
  setupWorld,
  submitExisting,
  submitLeave,
  useWorkflow,
  usersSource,
  usersStep,
} from "../test-support/workflow-fixtures";
import { WorkflowPublishHooks } from "./workflow-publish.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

interface IssueResult {
  errors?: { extensions?: Record<string, unknown> }[];
}

function issueCodes(result: IssueResult, key: "code" | "problem"): string[] {
  const issues = result.errors?.[0]?.extensions?.issues;
  return Array.isArray(issues)
    ? issues.map((issue: Record<string, unknown>) => String(issue[key]))
    : [];
}

/**
 * 流程設計與綁定(真 Mongo):共用 / 客製、fork、四步發布(與表單共用的生命週期)、
 * 定義檢查器、綁定時檢查四種來源、綁定唯一性、分派 / 收回 / 退役對進行中實例的影響、送出時檢查。
 */
describe("流程設計與綁定", () => {
  let api: AuthTestApp;
  let world: World;
  let sequence = 0;

  function nextKey(prefix: string): string {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  }

  function staff(index: number): Person {
    const found = world.staff[index];
    if (!found) {
      throw new Error(`staff[${String(index)}] 不存在`);
    }
    return found;
  }

  /** root 建一張共用表單(示範表單模組)、發布、分派給租戶。 */
  async function sharedForm(
    key: string,
    fields = [field("title", "text"), field("days", "number")],
  ): Promise<void> {
    await ok(api, world.root, CREATE_FORM, {
      input: { key, moduleKey: WORKFLOW_MODULE, name: `表單 ${key}` },
    });
    await publishDefinition(api, world.root, key, definitionOf(fields), null);
    await ok(api, world.root, ASSIGN, {
      input: { formKey: key, tenantOrgIds: [String(world.tenant)] },
    });
  }

  /** root 建共用流程並發布(回發布結果或錯誤)。 */
  async function publishShared(
    key: string,
    definition: DefinitionShape,
  ): Promise<IssueResult> {
    await ok(api, world.root, CREATE_WORKFLOW, {
      input: { key, name: `共用 ${key}` },
    });
    const draft = await ok<{
      createWorkflowVersionDraft: { workflowVersion: WorkflowVersionRow };
    }>(api, world.root, CREATE_WORKFLOW_DRAFT, {
      input: { workflowKey: key, baseVersion: null },
    });
    const saved = await saveWorkflowDraft(
      world,
      key,
      definition,
      draft.createWorkflowVersionDraft.workflowVersion.draftRevision,
      world.root,
    );
    return call(api, world.root, PUBLISH_WORKFLOW, {
      input: {
        workflowKey: key,
        expectedDraftRevision: saved.draftRevision,
        changelog: "共用發布",
      },
    });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_design", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 4);
  });

  afterAll(async () => {
    await api.close();
  });

  describe("共用 / 客製與發布", () => {
    it("共用流程的審核者條件用使用者 / 角色 → 發布被擋(AUDIENCE_IN_SHARED)", async () => {
      const users = await publishShared(nextKey("shared_users"), {
        steps: [usersStep("one", [staff(0)])],
      });
      expect(errorCode(users)).toBe("VALIDATION_FAILED");
      expect(issueCodes(users, "code")).toEqual(["AUDIENCE_IN_SHARED"]);
      const role = await publishShared(nextKey("shared_role"), {
        steps: [reviewStep("hr", roleSource(world.hrRoleId))],
      });
      expect(issueCodes(role, "code")).toEqual(["AUDIENCE_IN_SHARED"]);
    });

    it("共用流程發布版含角色條件(舊資料)→ 租戶不能直接綁(AUDIENCE_IN_SHARED);fork 後角色屬本租戶 → 可發布、可綁、派給該角色", async () => {
      const sharedKey = nextKey("shared_role");
      const published = await publishShared(sharedKey, {
        steps: [
          reviewStep("boss", { kind: "manager", level: 1 }),
          reviewStep(
            "hr",
            audienceSource(
              audienceRow("permission", ["hr.approve"]),
              audienceRow("org", { kind: "dynamic", ref: "tenant" }),
            ),
          ),
        ],
      });
      expect(published.errors).toBeUndefined();
      // 規則改版前發布的版本:直接改落盤的定義,模擬「共用流程含角色條件」
      await world.connection
        .collection("workflow_versions")
        .updateOne(
          { workflowKey: sharedKey, version: 1 },
          { $set: { "steps.1.assignee": roleSource(world.hrRoleId) } },
        );
      await ok(api, world.root, ASSIGN_WORKFLOW, {
        input: { workflowKey: sharedKey, tenantOrgIds: [String(world.tenant)] },
      });
      const options = await ok<{
        formWorkflowOptions: {
          items: {
            workflowKey: string;
            canBind: boolean;
            issues: { problem: string }[];
          }[];
        };
      }>(api, world.admin.token, FORM_WORKFLOW_OPTIONS, { formKey: FORM_KEY });
      const option = options.formWorkflowOptions.items.find(
        (item) => item.workflowKey === sharedKey,
      );
      expect(option?.canBind).toBe(false);
      expect(option?.issues.map((issue) => issue.problem)).toEqual([
        "AUDIENCE_IN_SHARED",
      ]);
      const bound = await call(api, world.admin.token, BIND, {
        input: { formKey: FORM_KEY, workflowKey: sharedKey },
      });
      expect(errorCode(bound)).toBe("VALIDATION_FAILED");
      expect(issueCodes(bound, "problem")).toEqual(["AUDIENCE_IN_SHARED"]);
      // fork:客製流程可以用本租戶的角色
      const forkKey = nextKey("tenant_role");
      const forked = await ok<{ forkWorkflow: { workflow: WorkflowRow } }>(
        api,
        world.admin.token,
        FORK_WORKFLOW,
        {
          input: {
            sourceKey: sharedKey,
            sourceVersion: 1,
            key: forkKey,
            name: "病假審核(本租戶)",
          },
        },
      );
      expect(forked.forkWorkflow.workflow).toMatchObject({
        isShared: false,
        hasDraft: true,
        forkedFrom: { workflowKey: sharedKey, version: 1 },
      });
      const draft = await ok<{
        workflowVersion: { workflowVersion: WorkflowVersionRow };
      }>(api, world.admin.token, WORKFLOW_VERSION, { workflowKey: forkKey });
      await ok(api, world.admin.token, PUBLISH_WORKFLOW, {
        input: {
          workflowKey: forkKey,
          expectedDraftRevision:
            draft.workflowVersion.workflowVersion.draftRevision,
          changelog: "本租戶人資",
        },
      });
      await bindForm(world, forkKey);
      const submitted = await submitLeave(world);
      await decideOn(world, world.manager, submitted.id, "APPROVE");
      await pendingTaskOf(world, world.hr[0], submitted.id);
    });

    it("清單:root 看共用、租戶看客製 + 分派來且已發布的共用;boundForms 反查本租戶的綁定", async () => {
      const key = nextKey("listed");
      await useWorkflow(world, key, { steps: [usersStep("one", [staff(0)])] });
      const tenantView = await ok<{ workflows: { items: WorkflowRow[] } }>(
        api,
        world.admin.token,
        WORKFLOWS,
        { input: { pageSize: 100 } },
      );
      const mine = tenantView.workflows.items.find((item) => item.key === key);
      expect(mine?.boundForms).toEqual([{ formKey: FORM_KEY }]);
      expect(mine?.isShared).toBe(false);
      const rootView = await ok<{ workflows: { items: WorkflowRow[] } }>(
        api,
        world.root,
        WORKFLOWS,
        { input: { pageSize: 100 } },
      );
      expect(rootView.workflows.items.some((item) => item.key === key)).toBe(
        false,
      );
      expect(rootView.workflows.items.every((item) => item.isShared)).toBe(
        true,
      );
    });

    it("檢查器:結構錯誤(迴圈)在 validateWorkflowVersion 回報;存草稿照收", async () => {
      const key = nextKey("cyclic");
      await ok(api, world.admin.token, CREATE_WORKFLOW, {
        input: { key, name: "迴圈" },
      });
      const result = await ok<{
        validateWorkflowVersion: { errors: { code: string }[] };
      }>(api, world.admin.token, VALIDATE_WORKFLOW, {
        input: {
          workflowKey: key,
          definition: {
            steps: [usersStep("a", [staff(0)]), usersStep("b", [staff(1)])],
            edges: [
              { from: "a", to: "b" },
              { from: "b", to: "a" },
            ],
          },
        },
      });
      expect(
        result.validateWorkflowVersion.errors.map((issue) => issue.code),
      ).toContain("CYCLE");
    });

    it.each([
      ["搶鎖配版號之後(寫稽核時)", "audit"],
      ["這一版改 published 時", "publish-version"],
      ["前一版改 retired 時", "retire-previous"],
      ["最後一筆(currentVersion)", "current-version"],
    ] as const)(
      "發布在%s失敗 → 版本與 currentVersion 都回到發布前(一個交易);草稿還在,再發布一次就成功",
      async (_label, checkpoint) => {
        const key = nextKey(`tx_${checkpoint.replaceAll("-", "_")}`);
        await publishWorkflow(world, key, {
          steps: [usersStep("one", [staff(0)])],
        });
        await ok(api, world.admin.token, CREATE_WORKFLOW_DRAFT, {
          input: { workflowKey: key, baseVersion: 1 },
        });
        const draft = await ok<{
          workflowVersion: { workflowVersion: WorkflowVersionRow };
        }>(api, world.admin.token, WORKFLOW_VERSION, { workflowKey: key });
        const input = {
          input: {
            workflowKey: key,
            expectedDraftRevision:
              draft.workflowVersion.workflowVersion.draftRevision,
            changelog: "第二版",
          },
        };
        const versionsBefore = await world.connection
          .collection("workflow_versions")
          .find({ workflowKey: key })
          .project({ _id: 1, version: 1, status: 1, draftRevision: 1 })
          .sort({ _id: 1 })
          .toArray();
        const spy =
          checkpoint === "audit"
            ? jest
                .spyOn(api.app.get(AuditService), "record")
                .mockRejectedValueOnce(new Error("模擬中斷"))
            : jest
                .spyOn(api.app.get(WorkflowPublishHooks), "reached")
                .mockImplementation((reached) =>
                  reached === checkpoint
                    ? Promise.reject(new Error("模擬中斷"))
                    : Promise.resolve(),
                );
        try {
          const failed = await call(
            api,
            world.admin.token,
            PUBLISH_WORKFLOW,
            input,
          );
          expect(failed.errors).toBeDefined();
        } finally {
          spy.mockRestore();
        }
        const versionsAfter = await world.connection
          .collection("workflow_versions")
          .find({ workflowKey: key })
          .project({ _id: 1, version: 1, status: 1, draftRevision: 1 })
          .sort({ _id: 1 })
          .toArray();
        expect(versionsAfter).toEqual(versionsBefore);
        const state = await ok<{ workflow: { workflow: WorkflowRow } }>(
          api,
          world.admin.token,
          WORKFLOW,
          { key },
        );
        expect(state.workflow.workflow).toMatchObject({
          currentVersion: 1,
          hasDraft: true,
        });
        expect(
          await world.connection.collection("audit_logs").countDocuments({
            action: "workflow-version.publish",
            "after.workflowKey": key,
            "after.version": 2,
          }),
        ).toBe(0);

        const published = await ok<{
          publishWorkflowVersion: { workflowVersion: WorkflowVersionRow };
        }>(api, world.admin.token, PUBLISH_WORKFLOW, input);
        expect(published.publishWorkflowVersion.workflowVersion).toMatchObject({
          version: 2,
          status: "PUBLISHED",
        });
      },
    );

    it("退役第二步(currentVersion → null)失敗 → 版本與 currentVersion 都回到退役前(一個交易)", async () => {
      const key = nextKey("tx_retire");
      await publishWorkflow(world, key, {
        steps: [usersStep("one", [staff(0)])],
      });
      const spy = jest
        .spyOn(api.app.get(WorkflowPublishHooks), "reached")
        .mockImplementation((reached) =>
          reached === "retire-current"
            ? Promise.reject(new Error("模擬中斷"))
            : Promise.resolve(),
        );
      try {
        const failed = await call(api, world.admin.token, RETIRE_WORKFLOW, {
          input: { workflowKey: key },
        });
        expect(failed.errors).toBeDefined();
      } finally {
        spy.mockRestore();
      }
      const version = await world.connection
        .collection("workflow_versions")
        .findOne<{ status: string }>({ workflowKey: key, version: 1 });
      expect(version?.status).toBe("published");
      const state = await ok<{ workflow: { workflow: WorkflowRow } }>(
        api,
        world.admin.token,
        WORKFLOW,
        { key },
      );
      expect(state.workflow.workflow.currentVersion).toBe(1);
    });
  });

  describe("綁定", () => {
    it("綁定時檢查:field 來源屬別張表單 / 欄位不在目前版本、users 不在本租戶 → 擋;manager 與正確的 field 可綁", async () => {
      const otherForm = nextKey("other_form");
      await sharedForm(otherForm, [
        field("title", "text"),
        field("approver", "reference", {
          source: { provider: "user", labelField: "name" },
        }),
      ]);
      const mismatch = nextKey("field_mismatch");
      await publishWorkflow(world, mismatch, {
        steps: [
          reviewStep("pick", {
            kind: "field",
            formKey: otherForm,
            fieldKey: "approver",
          }),
        ],
      });
      const mismatchBind = await call(api, world.admin.token, BIND, {
        input: { formKey: FORM_KEY, workflowKey: mismatch },
      });
      expect(issueCodes(mismatchBind, "problem")).toEqual([
        "FIELD_FORM_MISMATCH",
      ]);
      // 欄位在表單改版後不在了
      const changing = nextKey("changing_form");
      await sharedForm(changing, [
        field("title", "text"),
        field("approver", "reference", {
          source: { provider: "user", labelField: "name" },
        }),
      ]);
      const missing = nextKey("field_missing");
      await publishWorkflow(world, missing, {
        steps: [
          reviewStep("pick", {
            kind: "field",
            formKey: changing,
            fieldKey: "approver",
          }),
        ],
      });
      await publishDefinition(
        api,
        world.root,
        changing,
        definitionOf([field("title", "text")]),
        1,
      );
      const missingBind = await call(api, world.admin.token, BIND, {
        input: { formKey: changing, workflowKey: missing },
      });
      expect(issueCodes(missingBind, "problem")).toEqual(["FIELD_MISSING"]);
      // 欄位改成指到組織(不是 reference(user)):綁定擋 FIELD_NOT_USER_REFERENCE
      const orgRef = nextKey("org_ref_form");
      await sharedForm(orgRef, [
        field("title", "text"),
        field("approver", "reference", {
          source: { provider: "user", labelField: "name" },
        }),
      ]);
      const notUser = nextKey("field_not_user");
      await publishWorkflow(world, notUser, {
        steps: [
          reviewStep("pick", {
            kind: "field",
            formKey: orgRef,
            fieldKey: "approver",
          }),
        ],
      });
      await publishDefinition(
        api,
        world.root,
        orgRef,
        definitionOf([
          field("title", "text"),
          field("approver", "reference", {
            source: { provider: "org", labelField: "name" },
          }),
        ]),
        1,
      );
      const notUserBind = await call(api, world.admin.token, BIND, {
        input: { formKey: orgRef, workflowKey: notUser },
      });
      expect(issueCodes(notUserBind, "problem")).toEqual([
        "FIELD_NOT_USER_REFERENCE",
      ]);
      // users 不在本租戶(別的租戶的人):發布只是警告,綁定擋下
      const outsiderTenant = await createOrg(world.connection, {
        name: "別的租戶",
      });
      const outsider = await createUser(world.connection, {
        account: nextKey("outsider"),
        password: world.applicant.account,
        orgIds: [outsiderTenant],
      });
      const outsiderKey = nextKey("users_outside");
      await publishWorkflow(world, outsiderKey, {
        steps: [reviewStep("pick", usersSource([outsider]))],
      });
      const outsiderBind = await call(api, world.admin.token, BIND, {
        input: { formKey: FORM_KEY, workflowKey: outsiderKey },
      });
      expect(issueCodes(outsiderBind, "problem")).toEqual([
        "USER_NOT_IN_TENANT",
      ]);
      // manager 與正確的 field 來源
      const good = nextKey("field_ok");
      await publishWorkflow(world, good, {
        steps: [
          reviewStep("boss", { kind: "manager", level: 1 }),
          reviewStep("pick", {
            kind: "field",
            formKey: FORM_KEY,
            fieldKey: "approver",
          }),
        ],
      });
      await bindForm(world, good);
      // 引用欄的來源要申請人讀得到:同部門的同事
      const colleague = await person(
        api,
        world.connection,
        world.kitchen,
        world.tenant,
      );
      const submitted = await submitLeave(world, {
        title: "指定審核者",
        days: 2,
        approver: { id: String(colleague.userId), label: null },
      });
      await decideOn(world, world.manager, submitted.id, "APPROVE");
      await pendingTaskOf(world, colleague, submitted.id);
    });

    it("同租戶多張表單綁同一流程可以;同一張表單綁第二個流程 = 換指向(唯一鍵只有一筆)", async () => {
      const second = nextKey("second_form");
      await sharedForm(second);
      const key = nextKey("shared_by_two");
      await publishWorkflow(world, key, {
        steps: [usersStep("one", [staff(0)])],
      });
      await bindForm(world, key, FORM_KEY);
      await bindForm(world, key, second);
      const other = nextKey("replacement");
      await publishWorkflow(world, other, {
        steps: [usersStep("one", [staff(1)])],
      });
      const rebound = await ok<{
        bindFormWorkflow: {
          form: { workflowBinding: { workflowKey: string } | null };
        };
      }>(api, world.admin.token, BIND, {
        input: { formKey: second, workflowKey: other },
      });
      expect(rebound.bindFormWorkflow.form.workflowBinding?.workflowKey).toBe(
        other,
      );
      const links = await world.connection
        .collection("business_relationships")
        .countDocuments({ type: "org_form_workflow", tenantId: world.tenant });
      expect(links).toBe(2);
      const audits = await world.connection
        .collection("audit_logs")
        .countDocuments({ action: "form.bind-workflow" });
      expect(audits).toBeGreaterThanOrEqual(3);
    });
  });

  describe("改版 / 退役 / 收回對進行中實例與新送出的影響", () => {
    it("流程退役 → 進行中實例照走;新送出擋「流程尚未發布」", async () => {
      const key = nextKey("retire_me");
      await useWorkflow(world, key, {
        steps: [usersStep("one", [staff(0)]), usersStep("two", [staff(1)])],
      });
      const running = await submitLeave(world);
      await ok(api, world.admin.token, RETIRE_WORKFLOW, {
        input: { workflowKey: key },
      });
      await decideOn(world, staff(0), running.id, "APPROVE");
      await decideOn(world, staff(1), running.id, "APPROVE");
      const instance = await currentInstance(world, running.id);
      expect(instance.status).toBe("APPROVED");
      const draft = await createDraft(api, world.applicant.token, FORM_KEY, {
        title: "退役後",
        days: 2,
      });
      const blocked = await call(
        api,
        world.applicant.token,
        SUBMIT_SUBMISSION,
        {
          input: { id: draft.id, expectedEditVersion: draft.editVersion },
        },
      );
      expect(errorReason(blocked)).toBe("WORKFLOW_UNPUBLISHED");
    });

    it("共用流程收回分派 → 進行中實例照走;綁定顯示已失效,新送出一律擋「流程已移除」", async () => {
      const sharedKey = nextKey("shared_revoke");
      const published = await publishShared(sharedKey, {
        steps: [reviewStep("boss", { kind: "manager", level: 1 })],
      });
      expect(published.errors).toBeUndefined();
      await ok(api, world.root, ASSIGN_WORKFLOW, {
        input: { workflowKey: sharedKey, tenantOrgIds: [String(world.tenant)] },
      });
      await bindForm(world, sharedKey);
      const running = await submitLeave(world);
      await ok(api, world.root, REVOKE_WORKFLOW, {
        input: { workflowKey: sharedKey, tenantOrgId: String(world.tenant) },
      });
      const form = await ok<{
        form: { form: { workflowBinding: { isValid: boolean } | null } };
      }>(api, world.admin.token, FORM_BINDING, { key: FORM_KEY });
      expect(form.form.form.workflowBinding?.isValid).toBe(false);
      await decideOn(world, world.manager, running.id, "APPROVE");
      const revokedInstance = await currentInstance(world, running.id);
      expect(revokedInstance.status).toBe("APPROVED");
      const draft = await createDraft(api, world.applicant.token, FORM_KEY, {
        title: "收回後",
        days: 2,
      });
      const blocked = await call(
        api,
        world.applicant.token,
        SUBMIT_SUBMISSION,
        {
          input: { id: draft.id, expectedEditVersion: draft.editVersion },
        },
      );
      expect(errorReason(blocked)).toBe("WORKFLOW_REMOVED");
    });

    it("表單改版刪掉跳過條件用的欄位:舊版草稿仍有該欄位 → 通過;新版草稿沒有 → 擋(流程設定有誤)", async () => {
      const formKey = nextKey("skip_form");
      await sharedForm(formKey);
      const key = nextKey("skip_flow");
      await publishWorkflow(world, key, {
        steps: [
          usersStep("one", [staff(0)], {
            skipWhen: { "<=": [{ var: "days" }, 1] },
          }),
        ],
      });
      await bindForm(world, key, formKey);
      const oldDraft = await createDraft(api, world.applicant.token, formKey, {
        title: "舊版",
        days: 3,
      });
      await publishDefinition(
        api,
        world.root,
        formKey,
        definitionOf([field("title", "text")]),
        1,
      );
      const newDraft = await createDraft(api, world.applicant.token, formKey, {
        title: "新版",
      });
      const blocked = await call(
        api,
        world.applicant.token,
        SUBMIT_SUBMISSION,
        {
          input: { id: newDraft.id, expectedEditVersion: newDraft.editVersion },
        },
      );
      expect(errorReason(blocked)).toBe("WORKFLOW_MISCONFIGURED");
      const passed = await submitExisting(world, oldDraft);
      expect(passed.status).toBe("REVIEWING");
    });
  });

  it("(submissionId, revision)、(instanceId, taskKey) 唯一", async () => {
    await useWorkflow(world, nextKey("unique"), {
      steps: [usersStep("one", [staff(0)])],
    });
    const submitted = await submitLeave(world);
    const instance = await currentInstance(world, submitted.id);
    const instances = world.connection.collection("workflow_instances");
    const original = await instances.findOne({
      _id: new Types.ObjectId(instance.id),
    });
    await expect(
      instances.insertOne({ ...original, _id: new Types.ObjectId() }),
    ).rejects.toThrow(/duplicate key/);
    const tasks = world.connection.collection("workflow_tasks");
    const task = await tasks.findOne({
      instanceId: new Types.ObjectId(instance.id),
    });
    await expect(
      tasks.insertOne({ ...task, _id: new Types.ObjectId() }),
    ).rejects.toThrow(/duplicate key/);
  });
});
