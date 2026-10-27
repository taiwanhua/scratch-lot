import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { ok } from "../../forms/test-support/form-fixtures";
import {
  LIFECYCLE_BLOCKED_CODE,
  lifecycleProbe,
  resetLifecycleProbe,
} from "../test-support/lifecycle-fixture";
import {
  CREATE_WORKFLOW,
  type DefinitionShape,
  type Person,
  SAVE_SUBMISSION,
  VALIDATE_WORKFLOW,
  WORKFLOW_TEST_TIMEOUT_MS,
  type WfSubmissionRow,
  type World,
  decideOn,
  rawInstances,
  rawSubmissionDoc,
  reviewStep,
  setManagers,
  setupWorld,
  submission,
  submitExisting,
  submitLeave,
  taskStatuses,
  useWorkflow,
  usersStep,
} from "../test-support/workflow-fixtures";

/** 只替換掛接點的固定入口:病假表單登記全部守門與事後動作(行為由探針切換)。 */
jest.mock("../../project/form-lifecycles", () => ({
  PROJECT_FORM_LIFECYCLES: jest.requireActual<{
    LIFECYCLE_FIXTURE_REGISTRATIONS: unknown;
  }>("../test-support/lifecycle-fixture").LIFECYCLE_FIXTURE_REGISTRATIONS,
}));

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

interface RawStep {
  stepKey: string;
  status: string;
  plan: { taskKey: string; assigneeId: unknown }[];
  decisions: { taskKey: string; userId: unknown; decision: string }[];
}

interface RawEvent {
  kind: string;
  stepKey: string | null;
  taskKey: string | null;
  userId: unknown;
  reason: string | null;
  code?: string | null;
}

interface RawInstance {
  _id: unknown;
  status: string;
  steps: RawStep[];
  history: RawEvent[];
}

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

function guardsCalled(): string[] {
  return lifecycleProbe.guards.map((one) => one.guard);
}

function stepIn(instance: RawInstance, stepKey: string): RawStep {
  const step = instance.steps.find((one) => one.stepKey === stepKey);
  if (!step) {
    throw new Error(`實例沒有關卡 ${stepKey}`);
  }
  return step;
}

function eventsOf(instance: RawInstance, kind: string): RawEvent[] {
  return instance.history.filter((event) => event.kind === kind);
}

/**
 * 每一關指定組織跳過與自動通過(真 Mongo):
 * 申請人在「台北店 → 廚房部」(租戶「流程租戶」底下);staff 都在租戶頂層。
 */
describe("每一關指定組織跳過與自動通過", () => {
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

  async function bindNew(definition: DefinitionShape): Promise<void> {
    sequence += 1;
    await useWorkflow(world, `skip_auto_${String(sequence)}`, definition);
  }

  /** 這筆提交目前(最新修訂)的實例原始文件。 */
  async function latestInstance(submissionId: string): Promise<RawInstance> {
    const instances = await rawInstances(world.connection, submissionId);
    const latest = instances.at(-1);
    if (!latest) {
      throw new Error(`提交 ${submissionId} 沒有實例`);
    }
    return latest as unknown as RawInstance;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_skip_auto", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 3);
  });

  beforeEach(() => {
    resetLifecycleProbe();
  });

  afterAll(async () => {
    await api.close();
  });

  describe("申請人屬於這些組織", () => {
    it("送出時修訂 ctx 快照記下所屬組織(全部)與租戶", async () => {
      await bindNew({ steps: [usersStep("first", [staff(0)])] });
      const submitted = await submitLeave(world);
      const raw = (await rawSubmissionDoc(world.connection, submitted.id)) as {
        revisions: { ctx: { orgIds: unknown[]; tenantId: unknown } }[];
      } | null;
      const ctx = raw?.revisions.at(-1)?.ctx;
      expect(ctx?.orgIds.map(String)).toEqual([String(world.kitchen)]);
      expect(String(ctx?.tenantId)).toBe(String(world.tenant));
    });

    it("申請人屬於指定組織(含下層勾選)→ 跳過,stepPassed(skipped: true),沒有呼叫 beforeApprove;時間軸記「申請人屬於指定的組織」", async () => {
      await bindNew({
        steps: [
          usersStep("first", [staff(0)], {
            skipOrgs: {
              orgIds: [String(world.store)],
              includeDescendants: true,
            },
          }),
          usersStep("second", [staff(1)]),
        ],
      });
      const submitted = await submitLeave(world);
      const instance = await latestInstance(submitted.id);
      expect(stepIn(instance, "first").status).toBe("skipped");
      expect(stepIn(instance, "second").status).toBe("active");
      expect(eventsOf(instance, "step_skipped")).toEqual([
        expect.objectContaining({ stepKey: "first", reason: "skip_orgs" }),
      ]);
      expect(events()).toEqual(["submitted", "stepPassed:first:skipped"]);
      expect(guardsCalled()).not.toContain("beforeApprove");
    });

    it("沒勾含下層:申請人在指定組織的下層 → 不跳過", async () => {
      await bindNew({
        steps: [
          usersStep("first", [staff(0)], {
            skipOrgs: {
              orgIds: [String(world.store)],
              includeDescendants: false,
            },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      const instance = await latestInstance(submitted.id);
      expect(stepIn(instance, "first").status).toBe("active");
      expect(eventsOf(instance, "step_skipped")).toEqual([]);
    });

    it("「租戶」特殊值含下層 → 租戶裡任何人送出都跳過", async () => {
      await bindNew({
        steps: [
          usersStep("first", [staff(0)], {
            skipOrgs: { orgIds: ["tenant"], includeDescendants: true },
          }),
          usersStep("second", [staff(1)]),
        ],
      });
      const submitted = await submitLeave(world);
      const instance = await latestInstance(submitted.id);
      expect(stepIn(instance, "first").status).toBe("skipped");
    });

    it("兩項都勾、只有公式成立 → 跳過,時間軸記「符合條件」", async () => {
      await bindNew({
        steps: [
          usersStep("first", [staff(0)], {
            skipOrgs: {
              orgIds: [String(world.store)],
              includeDescendants: false,
            },
            skipWhen: { "<=": [{ var: "days" }, 1] },
          }),
          usersStep("second", [staff(1)]),
        ],
      });
      const submitted = await submitLeave(world, { title: "一天", days: 1 });
      const instance = await latestInstance(submitted.id);
      expect(stepIn(instance, "first").status).toBe("skipped");
      expect(eventsOf(instance, "step_skipped")).toEqual([
        expect.objectContaining({ stepKey: "first", reason: "skip_condition" }),
      ]);
    });

    it("公式可用 ctx.user.orgIds(申請人所屬的組織全部)", async () => {
      await bindNew({
        steps: [
          usersStep("first", [staff(0)], {
            skipWhen: {
              in: [String(world.kitchen), { var: "ctx.user.orgIds" }],
            },
          }),
          usersStep("second", [staff(1)]),
        ],
      });
      const submitted = await submitLeave(world);
      const instance = await latestInstance(submitted.id);
      expect(stepIn(instance, "first").status).toBe("skipped");
    });

    it("共用流程指定特定組織 → 驗證錯誤 SKIP_ORGS_IN_SHARED;只選租戶可以", async () => {
      sequence += 1;
      const key = `skip_auto_shared_${String(sequence)}`;
      await ok(api, world.root, CREATE_WORKFLOW, {
        input: { key, name: `共用 ${key}` },
      });
      const validate = (orgIds: string[]) =>
        ok<{
          validateWorkflowVersion: { errors: { code: string }[] };
        }>(api, world.root, VALIDATE_WORKFLOW, {
          input: {
            workflowKey: key,
            definition: {
              steps: [
                {
                  key: "first",
                  name: "主管",
                  assignee: { kind: "manager", level: 1 },
                  mode: "any",
                  skipOrgs: { orgIds, includeDescendants: true },
                },
              ],
            },
          },
        });
      const specific = await validate([String(world.store)]);
      expect(
        specific.validateWorkflowVersion.errors.map((one) => one.code),
      ).toEqual(["SKIP_ORGS_IN_SHARED"]);
      const tenantOnly = await validate(["tenant"]);
      expect(tenantOnly.validateWorkflowVersion.errors).toEqual([]);
    });
  });

  describe("自動通過", () => {
    it("申請人是這一關的審核者、開了自動通過 → 記成申請人核准(經 beforeApprove,本人身分),時間軸記原因", async () => {
      await bindNew({
        steps: [
          usersStep("first", [world.applicant], {
            autoApprove: { applicant: true },
          }),
          usersStep("second", [staff(0)]),
        ],
      });
      const submitted = await submitLeave(world);
      const instance = await latestInstance(submitted.id);
      const first = stepIn(instance, "first");
      expect(first.status).toBe("completed");
      expect(first.decisions).toEqual([
        expect.objectContaining({ taskKey: "first-1", decision: "approved" }),
      ]);
      expect(String(first.decisions[0]?.userId)).toBe(
        String(world.applicant.userId),
      );
      expect(eventsOf(instance, "approved")).toEqual([
        expect.objectContaining({
          stepKey: "first",
          taskKey: "first-1",
          reason: "auto_applicant",
        }),
      ]);
      const approveGuards = lifecycleProbe.guards.filter(
        (one) => one.guard === "beforeApprove",
      );
      expect(approveGuards).toHaveLength(1);
      expect(approveGuards[0]?.context.stepKey).toBe("first");
      expect(String(approveGuards[0]?.context.operator.actorId)).toBe(
        String(world.applicant.userId),
      );
      expect(events()).toEqual(["submitted", "stepPassed:first"]);
      const statuses = await taskStatuses(
        world.connection,
        String(instance._id),
      );
      expect(statuses["first-1"]).toBe("approved");
      expect(stepIn(instance, "second").status).toBe("active");
    });

    it("預設(剔除申請人):申請人是唯一審核者 → 照舊剔除、該關阻擋", async () => {
      await bindNew({
        steps: [usersStep("first", [world.applicant])],
      });
      const submitted = await submitLeave(world);
      const instance = await latestInstance(submitted.id);
      expect(stepIn(instance, "first").plan).toEqual([]);
      expect(instance.status).toBe("blocked");
      expect(guardsCalled()).not.toContain("beforeApprove");
    });

    it("申請人的自動通過被守門擋下 → 送出照常成功;照一般規則剔除申請人、派給其他審核者;時間軸記原因與錯誤碼", async () => {
      await bindNew({
        steps: [
          usersStep("first", [world.applicant, staff(0)], {
            autoApprove: { applicant: true },
          }),
        ],
      });
      lifecycleProbe.blockOn = "beforeApprove";
      const submitted = await submitLeave(world);
      expect(submitted.status).toBe("REVIEWING");
      const instance = await latestInstance(submitted.id);
      const first = stepIn(instance, "first");
      expect(first.status).toBe("active");
      expect(first.plan.map((item) => String(item.assigneeId))).toEqual([
        String(staff(0).userId),
      ]);
      expect(first.decisions).toEqual([]);
      expect(eventsOf(instance, "approved")).toEqual([]);
      expect(eventsOf(instance, "auto_approve_blocked")).toEqual([
        expect.objectContaining({
          stepKey: "first",
          reason: "auto_applicant",
          code: LIFECYCLE_BLOCKED_CODE,
        }),
      ]);
      expect(
        String(eventsOf(instance, "auto_approve_blocked")[0]?.userId),
      ).toBe(String(world.applicant.userId));
      expect(events()).toEqual(["submitted"]);
      const statuses = await taskStatuses(
        world.connection,
        String(instance._id),
      );
      expect(statuses).toEqual({ "first-1": "pending" });
    });

    it("只有申請人、自動通過被守門擋下 → 剔除後沒人,該關阻擋(流程管理者新增審核者)", async () => {
      await bindNew({
        steps: [
          usersStep("first", [world.applicant], {
            autoApprove: { applicant: true },
          }),
        ],
      });
      lifecycleProbe.blockOn = "beforeApprove";
      const submitted = await submitLeave(world);
      expect(submitted.status).toBe("REVIEWING");
      const instance = await latestInstance(submitted.id);
      expect(stepIn(instance, "first").plan).toEqual([]);
      expect(instance.status).toBe("blocked");
      expect(instance.history.slice(-2).map((event) => event.kind)).toEqual([
        "auto_approve_blocked",
        "blocked",
      ]);
      const row = await submission(world, world.applicant, submitted.id);
      expect(row.blocked).toBe(true);
    });

    it("審核者已在這一輪更早的關卡核准過 → 多人會簽只記他那一票,其他人照常審核", async () => {
      await bindNew({
        steps: [
          usersStep("first", [staff(0)]),
          usersStep("second", [staff(0), staff(1)], {
            mode: "all",
            autoApprove: { priorApprover: true },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      resetLifecycleProbe();
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      const instance = await latestInstance(submitted.id);
      const second = stepIn(instance, "second");
      expect(second.status).toBe("active");
      expect(second.decisions.map((one) => String(one.userId))).toEqual([
        String(staff(0).userId),
      ]);
      expect(
        eventsOf(instance, "approved").filter(
          (event) => event.stepKey === "second",
        ),
      ).toEqual([expect.objectContaining({ reason: "auto_prior_approver" })]);
      // 人按的核准 + 自動通過各跑一次 beforeApprove
      expect(guardsCalled()).toEqual(["beforeApprove", "beforeApprove"]);
      const statuses = await taskStatuses(
        world.connection,
        String(instance._id),
      );
      expect(statuses).toMatchObject({
        "second-1": "approved",
        "second-2": "pending",
      });
      await decideOn(world, staff(1), submitted.id, "APPROVE");
      const done = await submission(world, world.applicant, submitted.id);
      expect(done.status).toBe("COMPLETED");
    });

    it("退回後重新送出 → 新一輪重算,上一輪的核准不算", async () => {
      await bindNew({
        steps: [
          usersStep("first", [staff(0)], {
            skipWhen: { "<=": [{ var: "days" }, 1] },
          }),
          usersStep("second", [staff(1)]),
          usersStep("third", [staff(0)], {
            autoApprove: { priorApprover: true },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      await decideOn(world, staff(1), submitted.id, "RETURN");
      const returned = await submission(world, world.applicant, submitted.id);
      expect(returned.status).toBe("RETURNED");
      const saved = await ok<{
        saveFormDraft: { submission: WfSubmissionRow };
      }>(api, world.applicant.token, SAVE_SUBMISSION, {
        input: {
          id: submitted.id,
          expectedEditVersion: returned.editVersion,
          values: { title: "改成一天", days: 1 },
        },
      });
      await submitExisting(world, saved.saveFormDraft.submission);
      // 新一輪:第一關被跳過,staff(0) 在這一輪沒有核准過
      await decideOn(world, staff(1), submitted.id, "APPROVE");
      const instance = await latestInstance(submitted.id);
      expect(stepIn(instance, "first").status).toBe("skipped");
      const third = stepIn(instance, "third");
      expect(third.status).toBe("active");
      expect(third.decisions).toEqual([]);
    });

    it("這一關沒有開啟(預設)→ 照常審核", async () => {
      await bindNew({
        steps: [
          usersStep("first", [staff(0)]),
          usersStep("second", [staff(0)]),
        ],
      });
      const submitted = await submitLeave(world);
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      const instance = await latestInstance(submitted.id);
      const second = stepIn(instance, "second");
      expect(second.status).toBe("active");
      expect(second.decisions).toEqual([]);
    });
  });

  describe("申請人也是審核者時:照常審核", () => {
    it("申請人是唯一審核者 → 不剔除、不阻擋,派給申請人一張待審任務;他自己核准(經 beforeApprove)後完成", async () => {
      await bindNew({
        steps: [
          usersStep("first", [world.applicant], {
            autoApprove: { applicant: "review" },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      const instance = await latestInstance(submitted.id);
      const first = stepIn(instance, "first");
      expect(instance.status).toBe("running");
      expect(first.status).toBe("active");
      expect(first.plan.map((item) => String(item.assigneeId))).toEqual([
        String(world.applicant.userId),
      ]);
      expect(first.decisions).toEqual([]);
      // 進關不跑自動通過的守門
      expect(guardsCalled()).not.toContain("beforeApprove");
      expect(
        await taskStatuses(world.connection, String(instance._id)),
      ).toEqual({ "first-1": "pending" });

      await decideOn(world, world.applicant, submitted.id, "APPROVE");
      const done = await submission(world, world.applicant, submitted.id);
      expect(done.status).toBe("COMPLETED");
      const approveGuards = lifecycleProbe.guards.filter(
        (one) => one.guard === "beforeApprove",
      );
      expect(approveGuards).toHaveLength(1);
      expect(String(approveGuards[0]?.context.operator.actorId)).toBe(
        String(world.applicant.userId),
      );
      const approved = eventsOf(await latestInstance(submitted.id), "approved");
      expect(approved).toEqual([
        expect.objectContaining({ stepKey: "first", reason: null }),
      ]);
    });

    it("會簽(all):申請人與其他審核者各一張,申請人只算一票,兩人都核准才完成", async () => {
      await bindNew({
        steps: [
          usersStep("first", [world.applicant, staff(0)], {
            mode: "all",
            autoApprove: { applicant: "review" },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      await decideOn(world, world.applicant, submitted.id, "APPROVE");
      const half = await latestInstance(submitted.id);
      expect(stepIn(half, "first").status).toBe("active");
      expect(await taskStatuses(world.connection, String(half._id))).toEqual({
        "first-1": "approved",
        "first-2": "pending",
      });
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      const done = await submission(world, world.applicant, submitted.id);
      expect(done.status).toBe("COMPLETED");
    });

    it("「已在前關核准過」被守門擋下 → 申請人仍留著一張待審任務(不剔除、不阻擋),時間軸記擋下原因", async () => {
      await bindNew({
        steps: [
          usersStep("first", [world.applicant], {
            autoApprove: { applicant: "review" },
          }),
          usersStep("second", [world.applicant], {
            autoApprove: { applicant: "review", priorApprover: true },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      // 第一關申請人自己核准;進第二關時「已核准過」的自動通過被守門擋下
      lifecycleProbe.blockOn = "beforeApprove";
      lifecycleProbe.blockWhen = (context) => context.stepKey === "second";
      await decideOn(world, world.applicant, submitted.id, "APPROVE");
      const instance = await latestInstance(submitted.id);
      const second = stepIn(instance, "second");
      expect(instance.status).toBe("running");
      expect(second.status).toBe("active");
      expect(second.plan.map((item) => String(item.assigneeId))).toEqual([
        String(world.applicant.userId),
      ]);
      expect(second.decisions).toEqual([]);
      expect(eventsOf(instance, "auto_approve_blocked")).toEqual([
        expect.objectContaining({
          stepKey: "second",
          reason: "auto_prior_approver",
          code: LIFECYCLE_BLOCKED_CODE,
        }),
      ]);
      expect(
        await taskStatuses(world.connection, String(instance._id)),
      ).toMatchObject({ "second-1": "pending" });
    });

    it("申請人退回自己的單後重新送出 → 新一輪照樣派給申請人自己審", async () => {
      await bindNew({
        steps: [
          usersStep("first", [world.applicant], {
            autoApprove: { applicant: "review" },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      await decideOn(world, world.applicant, submitted.id, "RETURN");
      const returned = await submission(world, world.applicant, submitted.id);
      expect(returned.status).toBe("RETURNED");
      const saved = await ok<{
        saveFormDraft: { submission: WfSubmissionRow };
      }>(api, world.applicant.token, SAVE_SUBMISSION, {
        input: {
          id: submitted.id,
          expectedEditVersion: returned.editVersion,
          values: { title: "改過了", days: 3 },
        },
      });
      await submitExisting(world, saved.saveFormDraft.submission);
      const instance = await latestInstance(submitted.id);
      const first = stepIn(instance, "first");
      expect(instance.status).toBe("running");
      expect(first.status).toBe("active");
      expect(first.plan.map((item) => String(item.assigneeId))).toEqual([
        String(world.applicant.userId),
      ]);
      await decideOn(world, world.applicant, submitted.id, "APPROVE");
      const done = await submission(world, world.applicant, submitted.id);
      expect(done.status).toBe("COMPLETED");
    });

    it("主管來源:主管本人送出 → 照舊往上一層找(照常審核不影響主管解析)", async () => {
      await setManagers(api, world.kitchen, [world.applicant.userId]);
      await bindNew({
        steps: [
          reviewStep(
            "first",
            { kind: "manager", level: 1 },
            { autoApprove: { applicant: "review" } },
          ),
        ],
      });
      const submitted = await submitLeave(world);
      const instance = await latestInstance(submitted.id);
      expect(
        stepIn(instance, "first").plan.map((item) => String(item.assigneeId)),
      ).toEqual([String(world.manager.userId)]);
    });
  });
});
