import {
  afterAll,
  afterEach,
  beforeAll,
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
  WORKFLOW_OVERDUE,
  WORKFLOW_TASK_CREATED,
} from "../../notifications/base-notification-types";
import { interruptAt } from "../test-support/hooks-fixture";
import {
  type Person,
  REASSIGN,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  currentInstance,
  errorReason,
  pendingTaskOf,
  person,
  rawInstances,
  rawTasks,
  retryAdvance,
  setupWorld,
  submitLeave,
  tasksOf,
  useWorkflow,
  usersStep,
} from "../test-support/workflow-fixtures";
import { WorkflowOverdueService } from "./workflow-overdue.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const CREATE_DELEGATION = /* GraphQL */ `
  mutation CreateMyDelegation($input: CreateMyDelegationInput!) {
    createMyDelegation(input: $input) {
      delegation {
        id
      }
    }
  }
`;

const SET_USER_ENABLED = /* GraphQL */ `
  mutation SetUserEnabled($input: SetUserEnabledInput!) {
    setUserEnabled(input: $input) {
      user {
        id
      }
    }
  }
`;

interface RawNotification {
  recipientId: Types.ObjectId;
  dedupeKey: string;
}

interface RawTask {
  _id: Types.ObjectId;
  assigneeId: Types.ObjectId;
  assignedAt: Date | null;
}

interface RawHistoryEvent {
  kind: string;
  taskKey: string | null;
  userId: Types.ObjectId | null;
}

/**
 * 改派通知新承辦人(底座規格第 5 章 `workflow.task-created`;真 Mongo):改派不換 `taskKey`,
 * 推進以「任務 + 承辦人」的 `task_created` 標記判斷是否已通知 → 改派後的承辦人收一則「待你審核」,
 * 原承辦人不另外通知。改派的寫入只有 `reassignTask`(阻擋清單的處置);下面依觸發情境各一條。
 */
describe("改派通知新承辦人", () => {
  let api: AuthTestApp;
  let world: World;
  let sequence = 0;

  async function bindNew(steps: Parameters<typeof usersStep>[]): Promise<void> {
    sequence += 1;
    await useWorkflow(world, `reassign_notify_${String(sequence)}`, {
      steps: steps.map((args) => usersStep(...args)),
    });
  }

  async function fresh(): Promise<Person> {
    return person(api, world.connection, world.tenant, world.tenant);
  }

  async function latestInstance(
    submissionId: string,
  ): Promise<Record<string, unknown>> {
    const instances = await rawInstances(world.connection, submissionId);
    const latest = instances.at(-1);
    if (!latest) {
      throw new Error(`提交 ${submissionId} 沒有實例`);
    }
    return latest;
  }

  async function instanceIdOf(submissionId: string): Promise<string> {
    const instance = await latestInstance(submissionId);
    return String(instance._id);
  }

  /** 某人在這個實例收到的「待你審核」。 */
  function taskNotices(
    who: Person,
    instanceId: string,
  ): Promise<RawNotification[]> {
    return world.connection
      .collection("notifications")
      .find({
        type: WORKFLOW_TASK_CREATED,
        recipientId: who.userId,
        refId: instanceId,
      })
      .toArray() as unknown as Promise<RawNotification[]>;
  }

  /** 實例歷程的 `task_created` 標記:`taskKey` → 承辦人 id 們(依時間)。 */
  async function announcedOf(submissionId: string): Promise<string[]> {
    const instance = await latestInstance(submissionId);
    const history = instance.history as RawHistoryEvent[];
    return history
      .filter((event) => event.kind === "task_created")
      .map((event) => `${String(event.taskKey)}:${String(event.userId)}`);
  }

  async function reassign(taskId: string, to: Person): Promise<void> {
    await ok(api, world.admin.token, REASSIGN, {
      input: { taskId, toUserId: String(to.userId) },
    });
  }

  async function onlyTaskId(instanceId: string): Promise<string> {
    const [task] = await rawTasks(world.connection, instanceId);
    if (!task) {
      throw new Error(`實例 ${instanceId} 沒有任務`);
    }
    return String(task._id);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_reassign_notify", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  });

  it("進行中的任務改派 → 新承辦人收一則「待你審核」(同一個 dedupeKey 格式);原承辦人不另外通知", async () => {
    const [first, next] = [await fresh(), await fresh()];
    await bindNew([["first", [first]]]);
    const submitted = await submitLeave(world);
    const instanceId = await instanceIdOf(submitted.id);
    expect(await taskNotices(first, instanceId)).toHaveLength(1);

    const task = await pendingTaskOf(world, first, submitted.id);
    await reassign(task.id, next);

    const received = await taskNotices(next, instanceId);
    expect(received.map((one) => one.dedupeKey)).toEqual([
      `${WORKFLOW_TASK_CREATED}:${instanceId}:first-1`,
    ]);
    expect(await taskNotices(first, instanceId)).toHaveLength(1);
    expect(await announcedOf(submitted.id)).toEqual([
      `first-1:${String(first.userId)}`,
      `first-1:${String(next.userId)}`,
    ]);
    await pendingTaskOf(world, next, submitted.id);
  });

  it("阻擋處理改派(承辦人停用 → 關卡阻擋 → 改派)→ 新承辦人收一則,實例恢復進行", async () => {
    const [gone, next] = [await fresh(), await fresh()];
    await bindNew([["first", [gone], { mode: "all" }]]);
    const submitted = await submitLeave(world);
    const instanceId = await instanceIdOf(submitted.id);
    await ok(api, world.root, SET_USER_ENABLED, {
      input: { id: String(gone.userId), enabled: false },
    });
    const blocked = await currentInstance(world, submitted.id);
    expect(blocked.status).toBe("BLOCKED");

    await reassign(await onlyTaskId(instanceId), next);

    const resumed = await currentInstance(world, submitted.id);
    expect(resumed.status).toBe("RUNNING");
    expect(await taskNotices(next, instanceId)).toHaveLength(1);
    expect(await taskNotices(gone, instanceId)).toHaveLength(1);
  });

  it("代理人承接的任務被改派 → 新承辦人收一則;代理人與被代理者都不另外通知", async () => {
    const [original, deputy, next] = [
      await fresh(),
      await fresh(),
      await fresh(),
    ];
    const now = Date.now();
    await ok(api, original.token, CREATE_DELEGATION, {
      input: {
        delegateUserId: String(deputy.userId),
        startAt: new Date(now - HOUR_MS).toISOString(),
        endAt: new Date(now + 24 * HOUR_MS).toISOString(),
      },
    });
    await bindNew([["first", [original]]]);
    const submitted = await submitLeave(world);
    const instanceId = await instanceIdOf(submitted.id);
    expect(await taskNotices(deputy, instanceId)).toHaveLength(1);

    const task = await pendingTaskOf(world, deputy, submitted.id);
    await reassign(task.id, next);

    expect(await taskNotices(next, instanceId)).toHaveLength(1);
    expect(await taskNotices(deputy, instanceId)).toHaveLength(1);
    expect(await taskNotices(original, instanceId)).toEqual([]);
  });

  it("改派給有代理設定的人 → 改派不套用代理(3.7 / 3.8):任務與通知都給他本人,代理人不收", async () => {
    const [first, chosen, chosenDeputy] = [
      await fresh(),
      await fresh(),
      await fresh(),
    ];
    await bindNew([["first", [first]]]);
    const submitted = await submitLeave(world);
    const instanceId = await instanceIdOf(submitted.id);
    const now = Date.now();
    await ok(api, chosen.token, CREATE_DELEGATION, {
      input: {
        delegateUserId: String(chosenDeputy.userId),
        startAt: new Date(now - HOUR_MS).toISOString(),
        endAt: new Date(now + 24 * HOUR_MS).toISOString(),
      },
    });

    await reassign(await onlyTaskId(instanceId), chosen);

    await pendingTaskOf(world, chosen, submitted.id);
    const deputyTasks = await tasksOf(world, chosenDeputy);
    expect(
      deputyTasks.filter((one) => one.submissionId === submitted.id),
    ).toEqual([]);
    expect(await taskNotices(chosen, instanceId)).toHaveLength(1);
    expect(await taskNotices(chosenDeputy, instanceId)).toEqual([]);
  });

  it("逾時第 2 級通知對象收到後改派 → 新承辦人收一則「待你審核」,並從第 1 級重新計時", async () => {
    const [slow, next] = [await fresh(), await fresh()];
    await bindNew([
      [
        "first",
        [slow],
        {
          overdue: {
            reviewerAfterHours: 1,
            audienceAfterHours: 2,
            audience: DEFAULT_OVERDUE_AUDIENCE,
          },
        },
      ],
    ]);
    const submitted = await submitLeave(world);
    const instanceId = await instanceIdOf(submitted.id);
    const [original] = (await rawTasks(
      world.connection,
      instanceId,
    )) as unknown as RawTask[];
    const assignedAt = original?.assignedAt ?? new Date();
    await api.app
      .get(WorkflowOverdueService)
      .sweep(new Date(assignedAt.getTime() + 2 * HOUR_MS + MINUTE_MS), [
        world.tenant,
      ]);
    const escalated = await world.connection
      .collection("notifications")
      .countDocuments({
        type: WORKFLOW_OVERDUE,
        recipientId: world.admin.userId,
        refId: instanceId,
      });
    expect(escalated).toBe(1);

    await reassign(String(original?._id), next);

    expect(await taskNotices(next, instanceId)).toHaveLength(1);
    const [reassigned] = (await rawTasks(
      world.connection,
      instanceId,
    )) as unknown as (RawTask & { overdueLevel: number })[];
    expect(String(reassigned?.assigneeId)).toBe(String(next.userId));
    expect(reassigned?.overdueLevel).toBe(0);
  });

  it("改派兩次給不同人 → 各收一則;再改派回已通知過的人 → 不重複", async () => {
    const [first, second, third] = [
      await fresh(),
      await fresh(),
      await fresh(),
    ];
    await bindNew([["first", [first]]]);
    const submitted = await submitLeave(world);
    const instanceId = await instanceIdOf(submitted.id);
    const taskId = await onlyTaskId(instanceId);

    await reassign(taskId, second);
    await reassign(taskId, third);
    for (const who of [first, second, third]) {
      expect(await taskNotices(who, instanceId)).toHaveLength(1);
    }

    await reassign(taskId, first);
    for (const who of [first, second, third]) {
      expect(await taskNotices(who, instanceId)).toHaveLength(1);
    }
    expect(await announcedOf(submitted.id)).toEqual([
      `first-1:${String(first.userId)}`,
      `first-1:${String(second.userId)}`,
      `first-1:${String(third.userId)}`,
    ]);
    await pendingTaskOf(world, first, submitted.id);
  });

  it("同一個改派重送(ALREADY_IN_STEP)、重試推進 → 不重複通知", async () => {
    const [first, next] = [await fresh(), await fresh()];
    await bindNew([["first", [first]]]);
    const submitted = await submitLeave(world);
    const instanceId = await instanceIdOf(submitted.id);
    const taskId = await onlyTaskId(instanceId);

    await reassign(taskId, next);
    const again = await call(api, world.admin.token, REASSIGN, {
      input: { taskId, toUserId: String(next.userId) },
    });
    expect(errorReason(again)).toBe("ALREADY_IN_STEP");
    await retryAdvance(world, instanceId);

    expect(await taskNotices(next, instanceId)).toHaveLength(1);
    expect(await announcedOf(submitted.id)).toHaveLength(2);
  });

  it("通知與改派同一個交易:寫完通知、記標記前中斷 → 改派與通知一起回復;再改派一次只收一則", async () => {
    const [first, next] = [await fresh(), await fresh()];
    await bindNew([["first", [first]]]);
    const submitted = await submitLeave(world);
    const instanceId = await instanceIdOf(submitted.id);
    const taskId = await onlyTaskId(instanceId);

    const restore = interruptAt(api, "action:appendHistoryOnce");
    try {
      const failed = await call(api, world.admin.token, REASSIGN, {
        input: { taskId, toUserId: String(next.userId) },
      });
      expect(failed.errors).toBeDefined();
    } finally {
      restore();
    }
    expect(await taskNotices(next, instanceId)).toEqual([]);
    await pendingTaskOf(world, first, submitted.id);

    await reassign(taskId, next);
    expect(await taskNotices(next, instanceId)).toHaveLength(1);
  });
});
