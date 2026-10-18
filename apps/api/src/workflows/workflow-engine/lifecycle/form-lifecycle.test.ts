import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { getConnectionToken } from "@nestjs/mongoose";
import { type Connection, Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { UsersRepository } from "../../../database/database.module";
import { TransactionService } from "../../../database/transaction";
import {
  DELETE_SUBMISSION,
  SUBMIT,
  UPDATE_SUBMISSION,
  call,
  codeOf,
  createDraft,
  createSubmitted,
  extensionsOf,
  ok,
} from "../../../forms/test-support/form-fixtures";
import { WORKFLOW_RESULT } from "../../../notifications/base-notification-types";
import {
  LIFECYCLE_BLOCKED_CODE,
  lifecycleProbe,
  resetLifecycleProbe,
} from "../../test-support/lifecycle-fixture";
import {
  DECIDE,
  type DecisionName,
  FORM_KEY,
  type Person,
  SUBMIT_SUBMISSION,
  VOID,
  WITHDRAW,
  WORKFLOW_TEST_TIMEOUT_MS,
  type WfSubmissionRow,
  type World,
  decideOn,
  joinStep,
  pendingTaskOf,
  rawInstances,
  rawSubmissionDoc,
  rawTasks,
  retryAdvance,
  setupWorld,
  submission,
  submitLeave,
  useWorkflow,
  usersStep,
} from "../../test-support/workflow-fixtures";
import type { FormGuardName } from "./form-lifecycle-registration";

/** 只替換掛接點的固定入口:病假表單登記全部守門與事後動作(行為由探針切換)。 */
jest.mock("../../../project/form-lifecycles", () => ({
  PROJECT_FORM_LIFECYCLES: jest.requireActual<{
    LIFECYCLE_FIXTURE_REGISTRATIONS: unknown;
  }>("../../test-support/lifecycle-fixture").LIFECYCLE_FIXTURE_REGISTRATIONS,
}));

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

/** 事後動作代表專案寫入的 collection(以動作交易的 session 寫)。 */
const PROJECT_WRITES = "lifecycle_project_writes";

/** 事後動作的紀錄:`事件[:關卡[:skipped]]`。 */
function events(): string[] {
  return lifecycleProbe.effects.map((call) => {
    if (call.stepKey === null) {
      return call.event;
    }
    const suffix = call.skipped ? ":skipped" : "";
    return `${call.event}:${call.stepKey}${suffix}`;
  });
}

function expectBlocked(result: {
  errors?: { extensions?: Record<string, unknown> }[];
}): void {
  expect(codeOf(result as never)).toBe("FORBIDDEN");
  expect(extensionsOf(result as never).reason).toBe(LIFECYCLE_BLOCKED_CODE);
}

function blockOn(name: FormGuardName): void {
  lifecycleProbe.blockOn = name;
}

/**
 * 表單 / 流程的掛接點(真 Mongo):守門擋下時沒有任何寫入、事後動作拋錯時整個動作回復、
 * 跳過的關卡觸發 `stepPassed(skipped)`、沒綁流程的送出依序觸發 `submitted` → `completed`。
 */
describe("表單 / 流程的掛接點", () => {
  let api: AuthTestApp;
  let world: World;
  let sequence = 0;

  function staff(index: number): Person {
    const found = world.staff[index];
    if (!found) {
      throw new Error(`staff[${String(index)}] 不存在`);
    }
    return found;
  }

  function auditCount(id: string, action?: string): Promise<number> {
    return api.connection.collection("audit_logs").countDocuments({
      targetId: new Types.ObjectId(id),
      ...(action === undefined ? {} : { action }),
    });
  }

  function projectWrites(id: string): Promise<number> {
    return api.connection
      .collection(PROJECT_WRITES)
      .countDocuments({ submissionId: new Types.ObjectId(id) });
  }

  /** 事後動作以動作交易的 session 寫一筆專案資料;`failOn` 的事件寫完後拋錯。 */
  function writeOnEffect(failOn: string | null = null): void {
    lifecycleProbe.onEffect = async (context) => {
      // 用 app 自己的連線(session 只能用在開它的那個 client 上)
      await api.app
        .get<Connection>(getConnectionToken())
        .collection(PROJECT_WRITES)
        .insertOne(
          { submissionId: context.submissionId, event: context.event },
          { session: context.session },
        );
      if (context.event === failOn) {
        throw new Error(`injected failure in ${failOn}`);
      }
    };
  }

  /** 送出到第一關(天數 3);清掉送出時的紀錄。 */
  async function atFirstStep(): Promise<WfSubmissionRow> {
    const submitted = await submitLeave(world, { title: "三天", days: 3 });
    resetLifecycleProbe();
    return submitted;
  }

  /** 走完兩關的已完成單;清掉過程的紀錄。 */
  async function completedOne(): Promise<WfSubmissionRow> {
    const submitted = await atFirstStep();
    await decideOn(world, staff(0), submitted.id, "APPROVE");
    await decideOn(world, staff(1), submitted.id, "APPROVE");
    resetLifecycleProbe();
    return submission(world, world.applicant, submitted.id);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("form_lifecycle", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 2);
  });

  beforeEach(() => {
    resetLifecycleProbe();
  });

  afterAll(async () => {
    await api.close();
  });

  describe("沒綁流程", () => {
    it("送出 → 守門 beforeSubmit 拿到這一版的值,事後動作依序 submitted、completed(系統身分)", async () => {
      const done = await createSubmitted(api, world.applicant.token, FORM_KEY, {
        title: "不走流程",
        days: 2,
      });
      expect(done.status).toBe("COMPLETED");
      expect(lifecycleProbe.guards.map((one) => one.guard)).toEqual([
        "beforeSubmit",
      ]);
      const [guarded] = lifecycleProbe.guards;
      expect(guarded?.context.values).toMatchObject({ title: "不走流程" });
      expect(
        guarded?.context.operator.actorId?.equals(world.applicant.userId),
      ).toBe(true);
      expect(lifecycleProbe.effects).toEqual([
        {
          event: "submitted",
          submissionId: done.id,
          revision: 1,
          stepKey: null,
          skipped: false,
        },
        {
          event: "completed",
          submissionId: done.id,
          revision: 1,
          stepKey: null,
          skipped: false,
        },
      ]);
      const operator = lifecycleProbe.effectContexts[0]?.operator;
      expect(operator?.actorId).toBeNull();
      expect(operator?.roleIds).toEqual([]);
      expect(operator?.currentOrgId?.equals(world.kitchen)).toBe(true);
      expect(
        Array.isArray(operator?.visibleOrgIds) &&
          operator.visibleOrgIds.some((id) => id.equals(world.kitchen)),
      ).toBe(true);
    });

    it("beforeSubmit 擋下 → FORBIDDEN + 專案錯誤碼;仍是草稿,沒有事後動作、沒有稽核", async () => {
      const draft = await createDraft(api, world.applicant.token, FORM_KEY, {
        title: "擋下",
        days: 1,
      });
      blockOn("beforeSubmit");
      writeOnEffect();
      const result = await call(api, world.applicant.token, SUBMIT, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      expectBlocked(result);
      expect(await rawSubmissionDoc(api.connection, draft.id)).toMatchObject({
        status: "draft",
        revision: 0,
        editVersion: draft.editVersion,
      });
      expect(lifecycleProbe.effects).toEqual([]);
      expect(await auditCount(draft.id, "submission.submit")).toBe(0);
      expect(await projectWrites(draft.id)).toBe(0);
    });

    it("beforeEditCompleted 擋下(收到新的值)→ 值、修訂與 editVersion 都不變", async () => {
      const done = await createSubmitted(api, world.applicant.token, FORM_KEY, {
        title: "原本",
        days: 1,
      });
      resetLifecycleProbe();
      blockOn("beforeEditCompleted");
      const result = await call(api, world.applicant.token, UPDATE_SUBMISSION, {
        input: {
          id: done.id,
          expectedEditVersion: done.editVersion,
          expectedRevision: done.revision,
          values: { title: "改過", days: 2 },
        },
      });
      expectBlocked(result);
      expect(lifecycleProbe.guards[0]?.context.values).toMatchObject({
        title: "改過",
      });
      const raw = await rawSubmissionDoc(api.connection, done.id);
      expect(raw).toMatchObject({
        revision: done.revision,
        editVersion: done.editVersion,
      });
      expect((raw?.values as { title: string }).title).toBe("原本");
      expect(await auditCount(done.id, "submission.update")).toBe(0);
    });

    it("beforeDelete 擋下 → 沒有被刪", async () => {
      const done = await createSubmitted(api, world.applicant.token, FORM_KEY, {
        title: "要刪",
        days: 1,
      });
      blockOn("beforeDelete");
      const result = await call(api, world.applicant.token, DELETE_SUBMISSION, {
        input: { id: done.id },
      });
      expectBlocked(result);
      const raw = await rawSubmissionDoc(api.connection, done.id);
      expect(raw?.deletedAt).toBeNull();
      expect(await auditCount(done.id, "submission.delete")).toBe(0);
    });

    it("事後動作 completed 拋錯 → 仍是草稿,submitted 寫的專案資料一起回復", async () => {
      const draft = await createDraft(api, world.applicant.token, FORM_KEY, {
        title: "完成時失敗",
        days: 1,
      });
      writeOnEffect("completed");
      const result = await call(api, world.applicant.token, SUBMIT, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      expect(result.errors).toBeDefined();
      expect(events()).toEqual(["submitted", "completed"]);
      expect(await rawSubmissionDoc(api.connection, draft.id)).toMatchObject({
        status: "draft",
        revision: 0,
        editVersion: draft.editVersion,
      });
      expect(await projectWrites(draft.id)).toBe(0);
      expect(await auditCount(draft.id, "submission.submit")).toBe(0);
    });

    it("事後動作內 notify() 寫入通知;之後的事後動作拋錯 → 整個動作回復,那筆通知也一起消失", async () => {
      /** submitted 時通知申請人;`failOn` 的事件在通知之後拋錯。 */
      const notifyOnSubmitted = (dedupeKey: string, failOn: string | null) => {
        lifecycleProbe.onEffect = async (context) => {
          if (context.event === "submitted") {
            await context.notify({
              type: WORKFLOW_RESULT,
              tenantId: context.tenantId,
              orgId: context.orgId,
              recipients: { kind: "users", userIds: [world.applicant.userId] },
              params: { subject: "病假單", result: "approved" },
              dedupeKey,
            });
          }
          if (context.event === failOn) {
            throw new Error(`injected failure in ${failOn}`);
          }
        };
      };
      const notificationsOf = (dedupeKey: string) =>
        api.connection
          .collection("notifications")
          .countDocuments({ dedupeKey });

      // 對照:動作成功 → 通知留下
      sequence += 1;
      const keptKey = `lifecycle-notify-kept:${String(sequence)}`;
      notifyOnSubmitted(keptKey, null);
      await createSubmitted(api, world.applicant.token, FORM_KEY, {
        title: "通知留下",
        days: 1,
      });
      expect(await notificationsOf(keptKey)).toBe(1);

      // completed 拋錯 → 送出回復,submitted 寫的通知一起消失
      resetLifecycleProbe();
      sequence += 1;
      const rolledBackKey = `lifecycle-notify-rollback:${String(sequence)}`;
      const draft = await createDraft(api, world.applicant.token, FORM_KEY, {
        title: "通知回復",
        days: 1,
      });
      notifyOnSubmitted(rolledBackKey, "completed");
      const result = await call(api, world.applicant.token, SUBMIT, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      expect(result.errors).toBeDefined();
      expect(events()).toEqual(["submitted", "completed"]);
      expect(await rawSubmissionDoc(api.connection, draft.id)).toMatchObject({
        status: "draft",
      });
      expect(await notificationsOf(rolledBackKey)).toBe(0);
    });

    it("handler 的 get 只拿得到 inject 宣告的 provider;沒宣告的 → 拋錯", async () => {
      const seen: string[] = [];
      lifecycleProbe.onEffect = (context) => {
        if (context.event === "submitted") {
          seen.push(
            context.get(TransactionService) === api.app.get(TransactionService)
              ? "declared"
              : "other",
          );
          try {
            context.get(UsersRepository);
            seen.push("undeclared returned");
          } catch (error) {
            seen.push(error instanceof Error ? error.message : "thrown");
          }
        }
        return Promise.resolve();
      };
      await createSubmitted(api, world.applicant.token, FORM_KEY, {
        title: "取 provider",
        days: 1,
      });
      expect(seen).toEqual([
        "declared",
        expect.stringContaining("沒有在 inject 宣告 UsersRepository"),
      ]);
    });

    it("守門回不合格的錯誤碼 → 程式錯誤(不是 FORBIDDEN),仍是草稿", async () => {
      const draft = await createDraft(api, world.applicant.token, FORM_KEY, {
        title: "壞的碼",
        days: 1,
      });
      blockOn("beforeSubmit");
      lifecycleProbe.blockCode = "bad-code";
      const result = await call(api, world.applicant.token, SUBMIT, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      expect(result.errors).toBeDefined();
      expect(codeOf(result)).not.toBe("FORBIDDEN");
      expect(result.errors?.[0]?.message).toContain("bad-code");
      expect(await rawSubmissionDoc(api.connection, draft.id)).toMatchObject({
        status: "draft",
        editVersion: draft.editVersion,
      });
    });
  });

  describe("綁流程(第一關天數 ≤ 1 跳過 → 第二關)", () => {
    beforeAll(async () => {
      sequence += 1;
      await useWorkflow(world, `lifecycle_${String(sequence)}`, {
        steps: [
          usersStep("first", [staff(0)], {
            skipWhen: { "<=": [{ var: "days" }, 1] },
          }),
          usersStep("second", [staff(1)]),
        ],
      });
    });

    it("送出 → submitted;逐關核准 → stepPassed 每關一次,最後 completed;作廢 → voided", async () => {
      const submitted = await submitLeave(world, { title: "三天", days: 3 });
      expect(events()).toEqual(["submitted"]);
      expect(lifecycleProbe.effects[0]?.revision).toBe(1);
      resetLifecycleProbe();
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      expect(lifecycleProbe.guards.map((one) => one.guard)).toEqual([
        "beforeApprove",
      ]);
      expect(lifecycleProbe.guards[0]?.context.stepKey).toBe("first");
      expect(events()).toEqual(["stepPassed:first"]);
      resetLifecycleProbe();
      await decideOn(world, staff(1), submitted.id, "APPROVE");
      expect(events()).toEqual(["stepPassed:second", "completed"]);
      resetLifecycleProbe();
      const approved = await submission(world, world.applicant, submitted.id);
      await ok(api, world.applicant.token, VOID, {
        input: {
          id: submitted.id,
          expectedEditVersion: approved.editVersion,
          reason: "重來",
        },
      });
      expect(lifecycleProbe.guards.map((one) => one.guard)).toEqual([
        "beforeVoid",
      ]);
      expect(events()).toEqual(["voided"]);
    });

    it("第一關被既有跳過條件跳過 → stepPassed(skipped: true)", async () => {
      const submitted = await submitLeave(world, { title: "一天", days: 1 });
      expect(lifecycleProbe.effects).toEqual([
        {
          event: "submitted",
          submissionId: submitted.id,
          revision: 1,
          stepKey: null,
          skipped: false,
        },
        {
          event: "stepPassed",
          submissionId: submitted.id,
          revision: 1,
          stepKey: "first",
          skipped: true,
        },
      ]);
    });

    it("beforeSubmit 擋下 → 沒有實例,仍是草稿", async () => {
      const draft = await createDraft(api, world.applicant.token, FORM_KEY, {
        title: "送審擋下",
        days: 3,
      });
      blockOn("beforeSubmit");
      const result = await call(api, world.applicant.token, SUBMIT_SUBMISSION, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      expectBlocked(result);
      expect(await rawInstances(api.connection, draft.id)).toEqual([]);
      expect(await rawSubmissionDoc(api.connection, draft.id)).toMatchObject({
        status: "draft",
        editVersion: draft.editVersion,
      });
      expect(lifecycleProbe.effects).toEqual([]);
    });

    const decisions: [FormGuardName, DecisionName][] = [
      ["beforeApprove", "APPROVE"],
      ["beforeReject", "REJECT"],
      ["beforeReturn", "RETURN"],
    ];
    it.each(decisions)(
      "%s 擋下 → 決定沒有寫入(實例、任務、提交、稽核都不變)",
      async (guard, decision) => {
        const submitted = await atFirstStep();
        const task = await pendingTaskOf(world, staff(0), submitted.id);
        const [before] = await rawInstances(api.connection, submitted.id);
        blockOn(guard);
        const result = await call(api, staff(0).token, DECIDE, {
          input: {
            taskId: task.id,
            expectedEditVersion: task.editVersion,
            decision,
            comment: decision === "APPROVE" ? null : "理由",
          },
        });
        expectBlocked(result);
        expect(lifecycleProbe.guards[0]?.context.stepKey).toBe("first");
        const [after] = await rawInstances(api.connection, submitted.id);
        expect(after?.editVersion).toBe(before?.editVersion);
        expect(after?.history).toEqual(before?.history);
        const tasks = await rawTasks(api.connection, String(after?._id));
        expect(tasks.map((one) => [one.status, one.editVersion])).toEqual([
          ["pending", task.editVersion],
        ]);
        const raw = await rawSubmissionDoc(api.connection, submitted.id);
        expect(raw?.status).toBe("reviewing");
        expect(await auditCount(task.id, "task.decide")).toBe(0);
        expect(lifecycleProbe.effects).toEqual([]);
      },
    );

    it("beforeWithdraw 擋下 → 仍在審核中", async () => {
      const submitted = await atFirstStep();
      blockOn("beforeWithdraw");
      const result = await call(api, world.applicant.token, WITHDRAW, {
        input: { id: submitted.id, expectedEditVersion: submitted.editVersion },
      });
      expectBlocked(result);
      const [instance] = await rawInstances(api.connection, submitted.id);
      expect(instance?.status).toBe("running");
      expect(
        await rawSubmissionDoc(api.connection, submitted.id),
      ).toMatchObject({
        status: "reviewing",
        editVersion: submitted.editVersion,
      });
      expect(await auditCount(submitted.id, "submission.withdraw")).toBe(0);
    });

    it("beforeVoid 擋下 → 仍是已完成", async () => {
      const approved = await completedOne();
      blockOn("beforeVoid");
      const result = await call(api, world.applicant.token, VOID, {
        input: {
          id: approved.id,
          expectedEditVersion: approved.editVersion,
          reason: "作廢",
        },
      });
      expectBlocked(result);
      expect(await rawSubmissionDoc(api.connection, approved.id)).toMatchObject(
        { status: "completed", voidedAt: null },
      );
      expect(lifecycleProbe.effects).toEqual([]);
    });

    it("駁回 → rejected、退回 → returned(帶做決定的關卡);撤回 → withdrawn", async () => {
      const rejected = await atFirstStep();
      await decideOn(world, staff(0), rejected.id, "REJECT");
      expect(events()).toEqual(["rejected:first"]);

      const returned = await atFirstStep();
      await decideOn(world, staff(0), returned.id, "RETURN");
      expect(events()).toEqual(["returned:first"]);

      const withdrawn = await atFirstStep();
      await ok(api, world.applicant.token, WITHDRAW, {
        input: { id: withdrawn.id, expectedEditVersion: withdrawn.editVersion },
      });
      expect(lifecycleProbe.guards.map((one) => one.guard)).toEqual([
        "beforeWithdraw",
      ]);
      expect(events()).toEqual(["withdrawn"]);
    });

    it("事後動作拋錯 → 狀態、任務、實例、專案寫入全部回復", async () => {
      const submitted = await atFirstStep();
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      const task = await pendingTaskOf(world, staff(1), submitted.id);
      const [before] = await rawInstances(api.connection, submitted.id);
      const tasksBefore = await rawTasks(api.connection, String(before?._id));
      const writesBefore = await projectWrites(submitted.id);
      resetLifecycleProbe();
      // stepPassed 寫一筆專案資料,completed 拋錯
      writeOnEffect("completed");
      const result = await call(api, staff(1).token, DECIDE, {
        input: {
          taskId: task.id,
          expectedEditVersion: task.editVersion,
          decision: "APPROVE",
          comment: null,
        },
      });
      expect(result.errors).toBeDefined();
      expect(events()).toEqual(["stepPassed:second", "completed"]);
      const [after] = await rawInstances(api.connection, submitted.id);
      expect(after).toMatchObject({
        status: before?.status,
        editVersion: before?.editVersion,
        activeStepKeys: ["second"],
        finishedAt: null,
      });
      expect(after?.steps).toEqual(before?.steps);
      expect(await rawTasks(api.connection, String(after?._id))).toEqual(
        tasksBefore,
      );
      expect(
        await rawSubmissionDoc(api.connection, submitted.id),
      ).toMatchObject({ status: "reviewing" });
      expect(await projectWrites(submitted.id)).toBe(writesBefore);
      expect(await auditCount(task.id, "task.decide")).toBe(0);
    });

    it("重試推進觸發的事後動作用系統身分(不是按重試的人)", async () => {
      const submitted = await atFirstStep();
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      const task = await pendingTaskOf(world, staff(1), submitted.id);
      // 第二關的核准已寫進實例、但還沒推進(模擬推進中斷),由重試推進接續
      const at = new Date();
      await api.connection.collection("workflow_instances").updateOne(
        { submissionId: new Types.ObjectId(submitted.id) },
        {
          $push: {
            "steps.$[s].decisions": {
              taskKey: task.taskKey,
              userId: staff(1).userId,
              decision: "approved",
              comment: null,
              at,
            },
            history: {
              at,
              kind: "approved",
              stepKey: "second",
              taskKey: task.taskKey,
              userId: staff(1).userId,
              comment: null,
            },
          },
          $inc: { editVersion: 1 },
        } as never,
        { arrayFilters: [{ "s.stepKey": "second" }] },
      );
      resetLifecycleProbe();
      const [instance] = await rawInstances(api.connection, submitted.id);
      await retryAdvance(world, String(instance?._id));
      expect(events()).toEqual(["stepPassed:second", "completed"]);
      for (const context of lifecycleProbe.effectContexts) {
        expect(context.operator.actorId).toBeNull();
        expect(context.operator.roleIds).toEqual([]);
        expect(context.operator.currentOrgId?.equals(world.kitchen)).toBe(true);
      }
    });
  });

  describe("分流 / 匯合", () => {
    beforeAll(async () => {
      sequence += 1;
      await useWorkflow(world, `lifecycle_join_${String(sequence)}`, {
        steps: [
          usersStep("init", [staff(0)]),
          usersStep("left", [staff(1)], {
            skipWhen: { "<=": [{ var: "days" }, 1] },
          }),
          usersStep("right", [staff(1)], {
            skipWhen: { "<=": [{ var: "days" }, 1] },
          }),
          joinStep("merge"),
        ],
        edges: [
          { from: "init", to: "left" },
          { from: "init", to: "right" },
          { from: "left", to: "merge" },
          { from: "right", to: "merge" },
        ],
      });
    });

    it("匯合節點完成不觸發 stepPassed;分支跳過照常觸發", async () => {
      const submitted = await submitLeave(world, { title: "一天", days: 1 });
      resetLifecycleProbe();
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      expect(events()).toEqual([
        "stepPassed:init",
        "stepPassed:left:skipped",
        "stepPassed:right:skipped",
        "completed",
      ]);
      const [instance] = await rawInstances(api.connection, submitted.id);
      const merge = (
        instance?.steps as { stepKey: string; status: string }[] | undefined
      )?.find((step) => step.stepKey === "merge");
      expect(merge?.status).toBe("completed");
    });
  });
});
