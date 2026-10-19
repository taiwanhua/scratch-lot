import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Logger } from "@nestjs/common";
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
import { NotificationService } from "../../notifications/notification.service";
import { ScheduledJobRegistry } from "../../scheduled-jobs/scheduled-job-registry";
import { interruptAt } from "../test-support/hooks-fixture";
import {
  CREATE_WORKFLOW,
  CREATE_WORKFLOW_DRAFT,
  DECIDE,
  type DefinitionShape,
  FORK_WORKFLOW,
  FORM_KEY,
  PUBLISH_WORKFLOW,
  type Person,
  REASSIGN,
  SAVE_SUBMISSION,
  SUBMISSION,
  VALIDATE_WORKFLOW,
  VOID,
  WITHDRAW,
  WORKFLOW_INSTANCE,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  audienceRow,
  audienceSource,
  decideOn,
  instanceOf,
  pendingTaskOf,
  person,
  publishWorkflow,
  rawInstances,
  rawTasks,
  saveWorkflowDraft,
  setupWorld,
  submission,
  submitExisting,
  submitLeave,
  tasksOf,
  useWorkflow,
  usersSource,
  usersStep,
} from "../test-support/workflow-fixtures";
import { WORKFLOW_REASSIGN_PERMISSION } from "../workflow-keys";
import {
  OVERDUE_RETRY_DELAY_MS,
  WORKFLOW_OVERDUE_JOB_KEY,
  WorkflowOverdueService,
} from "./workflow-overdue.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const CREATE_DELEGATION = /* GraphQL */ `
  mutation OverdueCreateMyDelegation($input: CreateMyDelegationInput!) {
    createMyDelegation(input: $input) {
      delegation {
        id
      }
    }
  }
`;

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

/** 有沒有一筆 warn log 含這段文字。 */
function warnedWith(
  warn: { mock: { calls: unknown[][] } },
  text: string,
): boolean {
  return warn.mock.calls.some((args) => String(args[0]).includes(text));
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
 * 逾時提醒與知會(真 Mongo):
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

  /** 本人設定代理(起 = 一小時前,迄 = 一天後)。 */
  async function delegate(from: Person, to: Person): Promise<void> {
    const now = Date.now();
    await ok(api, from.token, CREATE_DELEGATION, {
      input: {
        delegateUserId: String(to.userId),
        startAt: new Date(now - HOUR_MS).toISOString(),
        endAt: new Date(now + 24 * HOUR_MS).toISOString(),
      },
    });
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

  // spy(例如 `Logger.prototype.warn`)斷言失敗時也不漏到後面的測試
  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  });

  describe("逾時提醒", () => {
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

    it("代理人承接的任務超過 N → 承辦人(代理人)與被代理者都收第 1 級;超過 M → 通知對象照收、剔除承辦人,被代理者在名單內照收一則", async () => {
      const original = await fresh();
      const deputy = await fresh();
      const watcher = await fresh();
      await delegate(original, deputy);
      await bindNew({
        steps: [
          usersStep("first", [original], {
            overdue: {
              reviewerAfterHours: 1,
              audienceAfterHours: 2,
              audience: usersAudience([original, deputy, watcher]),
            },
          }),
        ],
      });
      const submitted = await submitLeave(world);
      const instanceId = await latestInstanceId(submitted.id);
      const task = await onlyTask(instanceId);
      expect(String(task.assigneeId)).toBe(String(deputy.userId));

      await sweepAfter(task, 1);
      expect(await notices(WORKFLOW_OVERDUE, deputy, instanceId)).toHaveLength(
        1,
      );
      expect(
        await notices(WORKFLOW_OVERDUE, original, instanceId),
      ).toHaveLength(1);
      expect(await notices(WORKFLOW_OVERDUE, watcher, instanceId)).toEqual([]);

      await sweepAfter(task, 2);
      // 第 2 級:承辦人(代理人)剔除;被代理者在通知對象裡 → 另收第 2 級一則
      expect(await notices(WORKFLOW_OVERDUE, deputy, instanceId)).toHaveLength(
        1,
      );
      expect(
        await notices(WORKFLOW_OVERDUE, original, instanceId),
      ).toHaveLength(2);
      expect(await notices(WORKFLOW_OVERDUE, watcher, instanceId)).toHaveLength(
        1,
      );
    });

    it("多位被代理者委託同一位代理人(合併成一張任務)→ 第 1 級代理人與每位被代理者各一則", async () => {
      const first = await fresh();
      const second = await fresh();
      const deputy = await fresh();
      await delegate(first, deputy);
      await delegate(second, deputy);
      await bindNew({
        steps: [
          usersStep("first", [first, second], {
            mode: "all",
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
      const tasks = await tasksOfInstance(instanceId);
      expect(tasks).toHaveLength(1);
      const [task] = tasks as [RawTask];

      await sweepAfter(task, 1);
      for (const who of [deputy, first, second]) {
        expect(await notices(WORKFLOW_OVERDUE, who, instanceId)).toHaveLength(
          1,
        );
      }
    });

    it("代理承接的任務改派後(被代理者清空)→ 只提醒新承辦人", async () => {
      const original = await fresh();
      const deputy = await fresh();
      const other = await fresh();
      await delegate(original, deputy);
      await bindNew({
        steps: [
          usersStep("first", [original], {
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
      const pending = await pendingTaskOf(world, deputy, submitted.id);
      await ok(api, world.admin.token, REASSIGN, {
        input: { taskId: pending.id, toUserId: String(other.userId) },
      });
      const reassigned = await onlyTask(instanceId);

      await sweepAfter(reassigned, 1);
      expect(await notices(WORKFLOW_OVERDUE, other, instanceId)).toHaveLength(
        1,
      );
      expect(await notices(WORKFLOW_OVERDUE, original, instanceId)).toEqual([]);
      expect(await notices(WORKFLOW_OVERDUE, deputy, instanceId)).toEqual([]);
    });

    it("第 2 級算不到通知對象 → 不通知、記 warn(只有承辦人本人符合 / 條件沒人符合)", async () => {
      const gone = await fresh();
      await world.connection
        .collection("users")
        .updateOne({ _id: gone.userId }, { $set: { enabled: false } });
      for (const { audienceOf, reason } of [
        {
          audienceOf: (reviewer: Person) => usersAudience([reviewer]),
          reason: "符合的只有承辦人本人",
        },
        {
          audienceOf: () => usersAudience([gone]),
          reason: "人員條件沒有人符合",
        },
      ]) {
        const reviewer = await fresh();
        await bindNew({
          steps: [
            usersStep("first", [reviewer], {
              overdue: {
                reviewerAfterHours: 1,
                audienceAfterHours: 2,
                audience: audienceOf(reviewer),
              },
            }),
          ],
        });
        const submitted = await submitLeave(world);
        const instanceId = await latestInstanceId(submitted.id);
        const task = await onlyTask(instanceId);
        const warn = jest.spyOn(Logger.prototype, "warn");
        try {
          await sweepAfter(task, 2);
          expect(warnedWith(warn, reason)).toBe(true);
        } finally {
          warn.mockRestore();
        }
        // 第 1 級照發;第 2 級沒有人收
        const sent = await world.connection
          .collection("notifications")
          .find({ type: WORKFLOW_OVERDUE, refId: instanceId })
          .toArray();
        expect(sent.map((one) => String(one.recipientId))).toEqual([
          String(reviewer.userId),
        ]);
        const after = await onlyTask(instanceId);
        expect(after.overdueLevel).toBe(2);
      }
    });

    it("一張任務提醒失敗 → 只回復那一張、到期時點延一個排程週期;一個租戶整批出錯不中斷其他租戶", async () => {
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
      const now = new Date(
        (task.assignedAt?.getTime() ?? 0) + HOUR_MS + MINUTE_MS,
      );
      const service = api.app.get(WorkflowOverdueService);

      const spy = jest
        .spyOn(api.app.get(NotificationService), "notify")
        .mockRejectedValueOnce(new Error("模擬通知失敗"));
      // 第一個租戶 id 讀任務就會失敗(不是 ObjectId 的邊界)→ 只記 log,後面的租戶照跑
      await service.sweep(now, [
        "not-a-tenant" as unknown as Types.ObjectId,
        world.tenant,
      ]);
      spy.mockRestore();

      const deferred = await onlyTask(instanceId);
      expect(deferred.overdueLevel).toBe(0);
      expect(deferred.overdueDueAt?.getTime()).toBe(
        now.getTime() + OVERDUE_RETRY_DELAY_MS,
      );
      expect(await notices(WORKFLOW_OVERDUE, reviewer, instanceId)).toEqual([]);

      // 同一個時點不再撈到它;延後的時點到了再試就成功
      await service.sweep(now, [world.tenant]);
      expect(await notices(WORKFLOW_OVERDUE, reviewer, instanceId)).toEqual([]);
      await service.sweep(new Date(now.getTime() + OVERDUE_RETRY_DELAY_MS), [
        world.tenant,
      ]);
      expect(
        await notices(WORKFLOW_OVERDUE, reviewer, instanceId),
      ).toHaveLength(1);
      const reminded = await onlyTask(instanceId);
      expect(reminded.overdueLevel).toBe(1);
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

  describe("知會", () => {
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

    it("設定了知會的關卡被跳過(申請人屬於這些組織)→ 知會", async () => {
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

    it("只設在關卡的知會對象:單據完成 / 作廢 / 駁回都不收(要收就加進整個流程的知會對象)", async () => {
      const first = await fresh();
      const second = await fresh();
      const watcher = await fresh();
      await bindNew({
        steps: [
          usersStep("first", [first], { cc: usersSource([watcher]) }),
          usersStep("second", [second]),
        ],
      });
      const onlyStepPassed = async (instanceId: string) => {
        const sent = await notices(WORKFLOW_CC, watcher, instanceId);
        expect(sent).toHaveLength(1);
        expect(sent[0]?.body).toContain("「first」關卡已通過");
      };

      // 完成後再作廢
      const completed = await submitLeave(world);
      const completedInstance = await latestInstanceId(completed.id);
      await decideOn(world, first, completed.id, "APPROVE");
      await decideOn(world, second, completed.id, "APPROVE");
      const approved = await submission(world, world.applicant, completed.id);
      expect(approved.status).toBe("COMPLETED");
      await ok(api, world.applicant.token, VOID, {
        input: {
          id: completed.id,
          expectedEditVersion: approved.editVersion,
          reason: "重開",
        },
      });
      await onlyStepPassed(completedInstance);

      // 第一關通過、第二關駁回
      const rejected = await submitLeave(world);
      const rejectedInstance = await latestInstanceId(rejected.id);
      await decideOn(world, first, rejected.id, "APPROVE");
      await decideOn(world, second, rejected.id, "REJECT");
      await onlyStepPassed(rejectedInstance);
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

    it("退回、撤回不知會(關卡與整個流程都設了知會)", async () => {
      const reviewer = await fresh();
      const watcher = await fresh();
      await bindNew({
        steps: [usersStep("first", [reviewer], { cc: usersSource([watcher]) })],
        cc: usersSource([watcher]),
      });
      const returned = await submitLeave(world);
      const returnedInstance = await latestInstanceId(returned.id);
      await decideOn(world, reviewer, returned.id, "RETURN");
      expect(await notices(WORKFLOW_CC, watcher, returnedInstance)).toEqual([]);

      const withdrawn = await submitLeave(world);
      const withdrawnInstance = await latestInstanceId(withdrawn.id);
      await ok(api, world.applicant.token, WITHDRAW, {
        input: { id: withdrawn.id, expectedEditVersion: withdrawn.editVersion },
      });
      expect(await notices(WORKFLOW_CC, watcher, withdrawnInstance)).toEqual(
        [],
      );
      const unreadable = await call(api, watcher.token, SUBMISSION, {
        id: withdrawn.id,
      });
      expect(unreadable.errors?.[0]).toBeDefined();
    });

    it("知會對象只讀得到被知會的修訂:同一張單退回再送出後的新修訂讀不到", async () => {
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
      await decideOn(world, first, submitted.id, "APPROVE");
      await decideOn(world, second, submitted.id, "RETURN");
      const returned = await submission(world, world.applicant, submitted.id);
      const saved = await ok<{
        saveFormDraft: { submission: { id: string; editVersion: number } };
      }>(api, world.applicant.token, SAVE_SUBMISSION, {
        input: {
          id: submitted.id,
          expectedEditVersion: returned.editVersion,
          values: { title: "改成兩天", days: 2 },
        },
      });
      const resubmitted = await submitExisting(
        world,
        saved.saveFormDraft.submission,
      );
      expect(resubmitted.revision).toBe(submitted.revision + 1);

      // 省略修訂 = 他讀得到的最新一個(被知會的那個),新修訂擋下
      const visible = await submission(world, watcher, submitted.id);
      expect(visible.viewedRevision).toBe(submitted.revision);
      const newer = await call(api, watcher.token, SUBMISSION, {
        id: submitted.id,
        revision: resubmitted.revision,
      });
      expect(newer.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
      const instanceId = await latestInstanceId(submitted.id);
      const newerInstance = await call(api, watcher.token, WORKFLOW_INSTANCE, {
        id: instanceId,
      });
      expect(newerInstance.errors?.[0]).toBeDefined();
    });

    it("退回後重送是新實例、從第一關重審:再通過該關時關卡知會對象再收到一次", async () => {
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
      const firstInstance = await latestInstanceId(submitted.id);
      await decideOn(world, first, submitted.id, "APPROVE");
      await decideOn(world, second, submitted.id, "RETURN");
      expect(await notices(WORKFLOW_CC, watcher, firstInstance)).toHaveLength(
        1,
      );

      const returned = await submission(world, world.applicant, submitted.id);
      const saved = await ok<{
        saveFormDraft: { submission: { id: string; editVersion: number } };
      }>(api, world.applicant.token, SAVE_SUBMISSION, {
        input: {
          id: submitted.id,
          expectedEditVersion: returned.editVersion,
          values: { title: "改成兩天", days: 2 },
        },
      });
      await submitExisting(world, saved.saveFormDraft.submission);
      const secondInstance = await latestInstanceId(submitted.id);
      expect(secondInstance).not.toBe(firstInstance);
      await decideOn(world, first, submitted.id, "APPROVE");

      expect(await notices(WORKFLOW_CC, watcher, secondInstance)).toHaveLength(
        1,
      );
      expect(await notices(WORKFLOW_CC, watcher, firstInstance)).toHaveLength(
        1,
      );
    });

    it("算不到知會對象 → 不知會、動作照常,記 warn(表單欄位沒填 / 表單的組織欄位沒填 / 條件沒人符合 / 找不到主管 / 欄位來源指向別張表單)", async () => {
      const reviewer = await fresh();
      const gone = await fresh();
      await world.connection
        .collection("users")
        .updateOne({ _id: gone.userId }, { $set: { enabled: false } });
      const cases: {
        cc: Record<string, unknown>;
        reason: string;
        otherForm?: true;
      }[] = [
        {
          cc: { kind: "field", formKey: FORM_KEY, fieldKey: "approver" },
          reason: "表單欄位 approver 沒填",
        },
        {
          cc: audienceSource(
            audienceRow("org", { kind: "dynamic", ref: "form-field:branch" }),
          ),
          reason: "人員條件用的表單組織欄位 branch 沒填",
        },
        { cc: usersSource([gone]), reason: "人員條件沒有人符合" },
        {
          cc: { kind: "manager", level: 5 },
          reason: "找不到第 5 組主管",
        },
        {
          cc: { kind: "field", formKey: FORM_KEY, fieldKey: "approver" },
          reason: "知會對象欄位屬於表單 other_form",
          otherForm: true,
        },
      ];
      for (const { cc, reason, otherForm } of cases) {
        sequence += 1;
        const key = `overdue_cc_${String(sequence)}`;
        await useWorkflow(world, key, {
          steps: [usersStep("first", [reviewer], { cc })],
        });
        if (otherForm) {
          // 檢查器擋得到別張表單;直接改已發布的版本,模擬送出時不檢查的情況
          await world.connection
            .collection("workflow_versions")
            .updateOne(
              { workflowKey: key, status: "published" },
              { $set: { "steps.0.cc.formKey": "other_form" } },
            );
        }
        const submitted = await submitLeave(world);
        const instanceId = await latestInstanceId(submitted.id);
        const warn = jest.spyOn(Logger.prototype, "warn");
        try {
          await decideOn(world, reviewer, submitted.id, "APPROVE");
          expect(warnedWith(warn, reason)).toBe(true);
        } finally {
          warn.mockRestore();
        }
        const sent = await world.connection
          .collection("notifications")
          .countDocuments({ type: WORKFLOW_CC, refId: instanceId });
        expect(sent).toBe(0);
        const row = await submission(world, world.applicant, submitted.id);
        expect(row.status).toBe("COMPLETED");
      }
    });

    it("以某版為基底建流程(fork):逾時提醒、關卡知會、整個流程的知會都帶過去", async () => {
      sequence += 1;
      const key = `overdue_cc_${String(sequence)}`;
      const overdue = {
        reviewerAfterHours: 2,
        audienceAfterHours: 6,
        audience: DEFAULT_OVERDUE_AUDIENCE,
      };
      const stepCc = { kind: "manager", level: 1 };
      const flowCc = usersSource([world.manager]);
      await publishWorkflow(world, key, {
        steps: [usersStep("first", [world.manager], { overdue, cc: stepCc })],
        cc: flowCc,
      });
      await ok(api, world.admin.token, FORK_WORKFLOW, {
        input: {
          sourceKey: key,
          sourceVersion: 1,
          key: `${key}_fork`,
          name: "fork",
        },
      });
      const draft = await world.connection
        .collection("workflow_versions")
        .findOne({ workflowKey: `${key}_fork`, status: "draft" });
      expect(draft?.cc).toEqual(flowCc);
      expect(draft?.steps).toEqual([
        expect.objectContaining({ overdue, cc: stepCc }),
      ]);
    });
  });
});
