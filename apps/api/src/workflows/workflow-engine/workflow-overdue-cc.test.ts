import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Types } from "mongoose";

import { DEFAULT_OVERDUE_AUDIENCE } from "@repo/domain/workflow";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { call, ok } from "../../forms/test-support/form-fixtures";
import {
  WORKFLOW_CC,
  WORKFLOW_OVERDUE,
} from "../../notifications/base-notification-types";
import { ScheduledJobRegistry } from "../../scheduled-jobs/scheduled-job-registry";
import { interruptAt } from "../test-support/hooks-fixture";
import {
  CREATE_WORKFLOW,
  CREATE_WORKFLOW_DRAFT,
  DECIDE,
  type DefinitionShape,
  PUBLISH_WORKFLOW,
  type Person,
  REASSIGN,
  SUBMISSION,
  VALIDATE_WORKFLOW,
  VOID,
  WORKFLOW_INSTANCE,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  audienceRow,
  decideOn,
  instanceOf,
  pendingTaskOf,
  person,
  rawInstances,
  rawTasks,
  saveWorkflowDraft,
  setupWorld,
  submission,
  submitLeave,
  tasksOf,
  useWorkflow,
  usersSource,
  usersStep,
} from "../test-support/workflow-fixtures";
import { WORKFLOW_REASSIGN_PERMISSION } from "../workflow-keys";
import {
  WORKFLOW_OVERDUE_JOB_KEY,
  WorkflowOverdueService,
} from "./workflow-overdue.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

interface RawTask {
  _id: Types.ObjectId;
  taskKey: string;
  status: string;
  assigneeId: Types.ObjectId;
  assignedAt: Date | null;
  overdueLevel: number;
  overdueDueAt: Date | null;
}

interface RawNotification {
  recipientId: Types.ObjectId;
  type: string;
  body: string;
  refId: string | null;
  dedupeKey: string;
}

/** 只用人員條件的使用者列(逾時提醒的通知對象)。 */
function usersAudience(people: readonly Person[]): Record<string, unknown> {
  return {
    mode: "match",
    filter: {
      op: "AND",
      children: [
        audienceRow(
          "user",
          people.map((one) => one.userId),
        ),
      ],
    },
  };
}

/**
 * 逾時提醒(《底座規格》3.8 B16)與知會(3.9 B17)(真 Mongo):
 * 逾時提醒的排程以 `WorkflowOverdueService.sweep(now, 租戶)` 直接呼叫,時點由測試給(日曆小時);
 * 知會跟著推進 / 作廢的同一個交易。
 */
describe("逾時提醒與知會", () => {
  let api: AuthTestApp;
  let world: World;
  let sequence = 0;

  async function bindNew(definition: DefinitionShape): Promise<void> {
    sequence += 1;
    await useWorkflow(world, `overdue_cc_${String(sequence)}`, definition);
  }

  async function fresh(): Promise<Person> {
    return person(api, world.connection, world.tenant, world.tenant);
  }

  async function latestInstance(
    submissionId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const instances = await rawInstances(world.connection, submissionId);
    return instances.at(-1);
  }

  async function latestInstanceId(submissionId: string): Promise<string> {
    const instance = await latestInstance(submissionId);
    return String(instance?._id);
  }

  async function tasksOfInstance(instanceId: string): Promise<RawTask[]> {
    return (await rawTasks(
      world.connection,
      instanceId,
    )) as unknown as RawTask[];
  }

  async function onlyTask(instanceId: string): Promise<RawTask> {
    const [task] = await tasksOfInstance(instanceId);
    if (!task) {
      throw new Error(`實例 ${instanceId} 沒有任務`);
    }
    return task;
  }

  function notices(
    type: string,
    who: Person,
    instanceId: string,
  ): Promise<RawNotification[]> {
    return world.connection
      .collection("notifications")
      .find({ type, recipientId: who.userId, refId: instanceId })
      .toArray() as unknown as Promise<RawNotification[]>;
  }

  /** 以任務的指派時點 + `hours` 小時(再多 1 分鐘)跑一次排程。 */
  async function sweepAfter(task: RawTask, hours: number): Promise<void> {
    const assignedAt = task.assignedAt ?? new Date();
    await api.app
      .get(WorkflowOverdueService)
      .sweep(new Date(assignedAt.getTime() + hours * HOUR_MS + MINUTE_MS), [
        world.tenant,
      ]);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_overdue_cc", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 1);
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  });

  describe("逾時提醒(B16)", () => {
    it("登記為每 15 分鐘的排程工作;預設通知對象是持有阻擋清單改派權限的人", () => {
      const job = api.app
        .get(ScheduledJobRegistry)
        .jobs()
        .find((one) => one.key === WORKFLOW_OVERDUE_JOB_KEY);
      expect(job?.every).toBe("15m");
      expect(DEFAULT_OVERDUE_AUDIENCE).toEqual({
        mode: "match",
        filter: {
          field: "permission",
          cond: "in",
          value: { kind: "static", values: [WORKFLOW_REASSIGN_PERMISSION] },
        },
      });
    });

    it("超過 N 小時未處理 → 通知目前的審核者一次;再跑不重複;任務與實例狀態不變(夜間、假日照算日曆小時)", async () => {
      const reviewer = await fresh();
      await bindNew({
        steps: [
          usersStep("first", [reviewer], {
            overdue: {
              reviewerAfterHours: 1,
              audienceAfterHours: 3,
              audience: DEFAULT_OVERDUE_AUDIENCE,
            },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);
      const task = await onlyTask(instanceId);
      expect(task.assignedAt).not.toBeNull();
      expect(task.overdueDueAt?.getTime()).toBe(
        (task.assignedAt?.getTime() ?? 0) + HOUR_MS,
      );
      const before = await latestInstance(submitted.id);

      // 還沒到 N
      await api.app
        .get(WorkflowOverdueService)
        .sweep(new Date((task.assignedAt?.getTime() ?? 0) + 30 * MINUTE_MS), [
          world.tenant,
        ]);
      expect(await notices(WORKFLOW_OVERDUE, reviewer, instanceId)).toEqual([]);

      await sweepAfter(task, 1);
      await sweepAfter(task, 1);
      const sent = await notices(WORKFLOW_OVERDUE, reviewer, instanceId);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.body).toContain("已超過 1 小時未處理");
      // 審核者級別只通知,通知對象(管理員)還沒收到
      expect(await notices(WORKFLOW_OVERDUE, world.admin, instanceId)).toEqual(
        [],
      );

      const after = await onlyTask(instanceId);
      expect(after.status).toBe("pending");
      expect(after.overdueLevel).toBe(1);
      expect(after.overdueDueAt?.getTime()).toBe(
        (task.assignedAt?.getTime() ?? 0) + 3 * HOUR_MS,
      );
      const instance = await latestInstance(submitted.id);
      expect(instance?.status).toBe(before?.status);
      expect(instance?.editVersion).toBe(before?.editVersion);
      const row = await submission(world, world.applicant, submitted.id);
      expect(row.status).toBe("REVIEWING");
    });

    it("超過 M 小時未處理 → 通知「通知對象」一次;審核者不再重複收到(即使他也在通知對象裡)", async () => {
      const reviewer = await fresh();
      const watcher = await fresh();
      await bindNew({
        steps: [
          usersStep("first", [reviewer], {
            overdue: {
              reviewerAfterHours: 2,
              audienceAfterHours: 4,
              audience: usersAudience([reviewer, watcher]),
            },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);
      const task = await onlyTask(instanceId);

      await sweepAfter(task, 2);
      await sweepAfter(task, 4);
      await sweepAfter(task, 6);

      expect(
        await notices(WORKFLOW_OVERDUE, reviewer, instanceId),
      ).toHaveLength(1);
      const escalated = await notices(WORKFLOW_OVERDUE, watcher, instanceId);
      expect(escalated).toHaveLength(1);
      expect(escalated[0]?.body).toContain("已超過 4 小時未處理");
      const after = await onlyTask(instanceId);
      expect(after.overdueLevel).toBe(2);
      expect(after.overdueDueAt).toBeNull();
      expect(after.status).toBe("pending");
    });

    it("排程晚到、一次就超過 M → 審核者與通知對象各收一次;預設通知對象(流程管理者)收得到", async () => {
      const reviewer = await fresh();
      await bindNew({
        steps: [
          usersStep("first", [reviewer], {
            overdue: {
              reviewerAfterHours: 1,
              audienceAfterHours: 2,
              audience: DEFAULT_OVERDUE_AUDIENCE,
            },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);
      await sweepAfter(await onlyTask(instanceId), 30);

      expect(
        await notices(WORKFLOW_OVERDUE, reviewer, instanceId),
      ).toHaveLength(1);
      expect(
        await notices(WORKFLOW_OVERDUE, world.admin, instanceId),
      ).toHaveLength(1);
    });

    it("任務改派 → 新的承辦人重新計時", async () => {
      const reviewer = await fresh();
      const other = await fresh();
      await bindNew({
        steps: [
          usersStep("first", [reviewer], {
            overdue: {
              reviewerAfterHours: 1,
              audienceAfterHours: 5,
              audience: DEFAULT_OVERDUE_AUDIENCE,
            },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);
      const original = await onlyTask(instanceId);
      await sweepAfter(original, 1);
      expect(
        await notices(WORKFLOW_OVERDUE, reviewer, instanceId),
      ).toHaveLength(1);

      const task = await pendingTaskOf(world, reviewer, submitted.id);
      await ok(api, world.admin.token, REASSIGN, {
        input: { taskId: task.id, toUserId: String(other.userId) },
      });
      const reassigned = await onlyTask(instanceId);
      expect(String(reassigned.assigneeId)).toBe(String(other.userId));
      expect(reassigned.overdueLevel).toBe(0);
      expect(reassigned.assignedAt?.getTime()).toBeGreaterThan(
        original.assignedAt?.getTime() ?? 0,
      );

      // 改派之後還沒滿 1 小時:不通知新的承辦人
      await api.app
        .get(WorkflowOverdueService)
        .sweep(
          new Date((reassigned.assignedAt?.getTime() ?? 0) + 30 * MINUTE_MS),
          [world.tenant],
        );
      expect(await notices(WORKFLOW_OVERDUE, other, instanceId)).toEqual([]);

      await sweepAfter(reassigned, 1);
      expect(await notices(WORKFLOW_OVERDUE, other, instanceId)).toHaveLength(
        1,
      );
      expect(
        await notices(WORKFLOW_OVERDUE, reviewer, instanceId),
      ).toHaveLength(1);
    });

    it("任務在排程跑之前已處理 → 不通知", async () => {
      const reviewer = await fresh();
      await bindNew({
        steps: [
          usersStep("first", [reviewer], {
            overdue: {
              reviewerAfterHours: 1,
              audienceAfterHours: 2,
              audience: DEFAULT_OVERDUE_AUDIENCE,
            },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);
      const task = await onlyTask(instanceId);
      await decideOn(world, reviewer, submitted.id, "APPROVE");

      await sweepAfter(task, 10);
      expect(await notices(WORKFLOW_OVERDUE, reviewer, instanceId)).toEqual([]);
      expect(await notices(WORKFLOW_OVERDUE, world.admin, instanceId)).toEqual(
        [],
      );
    });

    it("這一關沒有開啟(預設)→ 不檢查、不通知", async () => {
      const reviewer = await fresh();
      await bindNew({ steps: [usersStep("first", [reviewer])] });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);
      const task = await onlyTask(instanceId);
      expect(task.overdueDueAt).toBeNull();

      await sweepAfter(task, 1000);
      expect(await notices(WORKFLOW_OVERDUE, reviewer, instanceId)).toEqual([]);
    });

    it("設定 M ≤ N → 檢查器擋下(OVERDUE_INVALID,不能發布)", async () => {
      sequence += 1;
      const key = `overdue_cc_${String(sequence)}`;
      await ok(api, world.admin.token, CREATE_WORKFLOW, {
        input: { key, name: `流程 ${key}` },
      });
      const data = await ok<{
        validateWorkflowVersion: {
          errors: { code: string; stepKey: string }[];
        };
      }>(api, world.admin.token, VALIDATE_WORKFLOW, {
        input: {
          workflowKey: key,
          definition: {
            steps: [
              usersStep("first", [world.manager], {
                overdue: {
                  reviewerAfterHours: 4,
                  audienceAfterHours: 4,
                  audience: DEFAULT_OVERDUE_AUDIENCE,
                },
              }),
            ],
          },
        },
      });
      expect(data.validateWorkflowVersion.errors).toEqual([
        { code: "OVERDUE_INVALID", stepKey: "first" },
      ]);
    });
  });

  describe("知會(B17)", () => {
    it("設定了知會的關卡整關通過 → 知會對象收到通知、讀得到該修訂(唯讀)、不能操作", async () => {
      const first = await fresh();
      const second = await fresh();
      const watcher = await fresh();
      await bindNew({
        steps: [
          usersStep("first", [first], { cc: usersSource([watcher]) }),
          usersStep("second", [second]),
        ],
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);

      // 還沒通過:知會對象讀不到
      const early = await call(api, watcher.token, SUBMISSION, {
        id: submitted.id,
      });
      expect(early.errors?.[0]).toBeDefined();
      expect(await notices(WORKFLOW_CC, watcher, instanceId)).toEqual([]);

      await decideOn(world, first, submitted.id, "APPROVE");

      const sent = await notices(WORKFLOW_CC, watcher, instanceId);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.body).toContain("「first」關卡已通過");

      // 讀得到該修訂,但所有操作都不行
      const row = await submission(world, watcher, submitted.id);
      expect(row.revision).toBe(submitted.revision);
      expect(row.abilities).toEqual({
        canEdit: false,
        canDelete: false,
        canWithdraw: false,
        canVoid: false,
        canCopy: false,
      });
      const instance = await instanceOf(world, watcher, instanceId);
      expect(instance.myTasks).toEqual([]);
      expect(instance.abilities.canWithdraw).toBe(false);
      expect(await tasksOf(world, watcher)).toEqual([]);

      // 拿別人的任務來決定 → 擋下
      const secondTask = await pendingTaskOf(world, second, submitted.id);
      const denied = await call(api, watcher.token, DECIDE, {
        input: {
          taskId: secondTask.id,
          expectedEditVersion: secondTask.editVersion,
          decision: "APPROVE",
          comment: null,
        },
      });
      expect(denied.errors?.[0]).toBeDefined();
      const tasks = await tasksOfInstance(instanceId);
      expect(
        tasks.find((task) => task.taskKey === secondTask.taskKey)?.status,
      ).toBe("pending");
    });

    it("設定了知會的關卡被跳過(B4)→ 知會", async () => {
      const first = await fresh();
      const second = await fresh();
      const watcher = await fresh();
      await bindNew({
        steps: [
          usersStep("first", [first], {
            skipWhen: { "<=": [{ var: "days" }, 5] },
            cc: usersSource([watcher]),
          }),
          usersStep("second", [second]),
        ],
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);

      const sent = await notices(WORKFLOW_CC, watcher, instanceId);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.body).toContain("「first」關卡已跳過");
      const row = await submission(world, watcher, submitted.id);
      expect(row.id).toBe(submitted.id);
    });

    it("單據完成(整個流程設定了知會)→ 知會;作廢 → 再知會一次", async () => {
      const reviewer = await fresh();
      const watcher = await fresh();
      await bindNew({
        steps: [usersStep("first", [reviewer])],
        cc: usersSource([watcher]),
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);
      await decideOn(world, reviewer, submitted.id, "APPROVE");

      const completed = await notices(WORKFLOW_CC, watcher, instanceId);
      expect(completed).toHaveLength(1);
      expect(completed[0]?.body).toContain("已完成");

      const approved = await submission(world, world.applicant, submitted.id);
      await ok(api, world.applicant.token, VOID, {
        input: {
          id: submitted.id,
          expectedEditVersion: approved.editVersion,
          reason: "重開",
        },
      });
      const all = await notices(WORKFLOW_CC, watcher, instanceId);
      expect(all).toHaveLength(2);
      expect(all.map((one) => one.body).join("\n")).toContain("已作廢");
    });

    it("單據被駁回 → 整個流程的知會對象收到", async () => {
      const reviewer = await fresh();
      const watcher = await fresh();
      await bindNew({
        steps: [usersStep("first", [reviewer])],
        cc: usersSource([watcher]),
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);
      await decideOn(world, reviewer, submitted.id, "REJECT");

      const sent = await notices(WORKFLOW_CC, watcher, instanceId);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.body).toContain("已駁回");
      const row = await submission(world, watcher, submitted.id);
      expect(row.id).toBe(submitted.id);
    });

    it("動作回復 → 沒有知會通知、也讀不到;重做一次才知會", async () => {
      const first = await fresh();
      const second = await fresh();
      const watcher = await fresh();
      await bindNew({
        steps: [
          usersStep("first", [first], { cc: usersSource([watcher]) }),
          usersStep("second", [second]),
        ],
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);
      const task = await pendingTaskOf(world, first, submitted.id);

      // 第一關通過之後、建第二關任務時中斷 → 整個決定回復
      const restore = interruptAt(api, "action:createTask");
      const failed = await call(api, first.token, DECIDE, {
        input: {
          taskId: task.id,
          expectedEditVersion: task.editVersion,
          decision: "APPROVE",
          comment: null,
        },
      });
      restore();
      expect(failed.errors?.[0]).toBeDefined();
      expect(await notices(WORKFLOW_CC, watcher, instanceId)).toEqual([]);
      const raw = await latestInstance(submitted.id);
      expect(raw?.ccRecipientIds).toEqual([]);
      const denied = await call(api, watcher.token, WORKFLOW_INSTANCE, {
        id: instanceId,
      });
      expect(denied.errors?.[0]).toBeDefined();

      await decideOn(world, first, submitted.id, "APPROVE");
      expect(await notices(WORKFLOW_CC, watcher, instanceId)).toHaveLength(1);
      const copied = await latestInstance(submitted.id);
      expect(copied?.ccRecipientIds).toEqual([watcher.userId]);
    });

    it("關卡與整個流程都設了同一位知會對象 → 兩個時機各一則(dedupeKey = 類型 + 實例 + 時機)", async () => {
      const reviewer = await fresh();
      const watcher = await fresh();
      await bindNew({
        steps: [usersStep("first", [reviewer], { cc: usersSource([watcher]) })],
        cc: usersSource([watcher]),
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);
      await decideOn(world, reviewer, submitted.id, "APPROVE");

      // 關卡通過一則 + 單據完成一則,各自一次
      const sent = await notices(WORKFLOW_CC, watcher, instanceId);
      expect(
        sent.map((one) => one.dedupeKey).toSorted((a, b) => a.localeCompare(b)),
      ).toEqual([
        `${WORKFLOW_CC}:${instanceId}:completed`,
        `${WORKFLOW_CC}:${instanceId}:step:first`,
      ]);
    });

    it("整個流程的知會對象存在版本上:存草稿缺席 = 不動、null = 清掉;發布後保留", async () => {
      sequence += 1;
      const key = `overdue_cc_${String(sequence)}`;
      const steps = [usersStep("first", [world.manager])];
      const cc = usersSource([world.manager]);
      await ok(api, world.admin.token, CREATE_WORKFLOW, {
        input: { key, name: `流程 ${key}` },
      });
      const draft = await ok<{
        createWorkflowVersionDraft: {
          workflowVersion: { draftRevision: number };
        };
      }>(api, world.admin.token, CREATE_WORKFLOW_DRAFT, {
        input: { workflowKey: key, baseVersion: null },
      });
      const storedCc = async (): Promise<unknown> => {
        const draftRow = await world.connection
          .collection("workflow_versions")
          .findOne({ workflowKey: key, status: "draft" });
        return draftRow?.cc;
      };
      let saved = await saveWorkflowDraft(
        world,
        key,
        { steps, cc },
        draft.createWorkflowVersionDraft.workflowVersion.draftRevision,
      );
      expect(await storedCc()).toEqual(cc);
      saved = await saveWorkflowDraft(
        world,
        key,
        { steps },
        saved.draftRevision,
      );
      expect(await storedCc()).toEqual(cc);
      saved = await saveWorkflowDraft(
        world,
        key,
        { steps, cc: null },
        saved.draftRevision,
      );
      expect(await storedCc()).toBeNull();
      await saveWorkflowDraft(world, key, { steps, cc }, saved.draftRevision);
      await ok(api, world.admin.token, PUBLISH_WORKFLOW, {
        input: {
          workflowKey: key,
          expectedDraftRevision: saved.draftRevision + 1,
          changelog: "測試發布",
        },
      });
      const published = await world.connection
        .collection("workflow_versions")
        .findOne({ workflowKey: key, status: "published" });
      expect(published?.cc).toEqual(cc);
    });
  });
});
