import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { call, codeOf, ok } from "../../forms/test-support/form-fixtures";
import { interruptAt } from "../test-support/hooks-fixture";
import {
  LIFECYCLE_BLOCKED_CODE,
  lifecycleProbe,
  resetLifecycleProbe,
} from "../test-support/lifecycle-fixture";
import {
  type Person,
  REASSIGN,
  type TaskRow,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  decide,
  pendingTaskOf,
  rawInstances,
  setupWorld,
  submission,
  submitLeave,
  useWorkflow,
  usersStep,
} from "../test-support/workflow-fixtures";

/** 只替換掛接點的固定入口:病假表單登記全部守門(行為由探針切換)。 */
jest.mock("../../project/form-lifecycles", () => ({
  PROJECT_FORM_LIFECYCLES: jest.requireActual<{
    LIFECYCLE_FIXTURE_REGISTRATIONS: unknown;
  }>("../test-support/lifecycle-fixture").LIFECYCLE_FIXTURE_REGISTRATIONS,
}));

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const BATCH_APPROVE = /* GraphQL */ `
  mutation BatchApproveTasks($input: BatchApproveTasksInput!) {
    batchApproveTasks(input: $input) {
      results {
        taskId
        ok
        reason
        projectReason
      }
    }
  }
`;

/** 陣列的第 index 個;沒有就丟錯(取代非空斷言)。 */
function nth<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) {
    throw new Error(`第 ${String(index)} 個不存在`);
  }
  return found;
}

interface BatchResult {
  taskId: string;
  ok: boolean;
  reason: string | null;
  projectReason: string | null;
}

/**
 * 批次核准(真 Mongo):每一筆一個交易、各自經 `beforeApprove`;
 * 被擋下 / 已不在手上 / 交易失敗的那一筆逐筆回報,不影響其他筆。
 */
describe("批次核准 batchApproveTasks", () => {
  let api: AuthTestApp;
  let world: World;
  let reviewer: Person;

  async function batchApprove(
    taskIds: string[],
    comment: string | null = null,
  ): Promise<BatchResult[]> {
    const data = await ok<{
      batchApproveTasks: { results: BatchResult[] };
    }>(api, reviewer.token, BATCH_APPROVE, { input: { taskIds, comment } });
    return data.batchApproveTasks.results;
  }

  /** 送出 n 張單(標題依序),回各自在審核者手上的任務。 */
  async function pendingTasks(titles: string[]): Promise<TaskRow[]> {
    const tasks: TaskRow[] = [];
    for (const title of titles) {
      const submitted = await submitLeave(world, { title, days: 2 });
      tasks.push(await pendingTaskOf(world, reviewer, submitted.id));
    }
    resetLifecycleProbe();
    return tasks;
  }

  async function statusOf(task: TaskRow): Promise<string> {
    const row = await submission(world, world.applicant, task.submissionId);
    return row.status;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("batch_approve", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 2);
    reviewer = nth(world.staff, 0);
    await useWorkflow(world, "batch_approve", {
      steps: [usersStep("only", [reviewer])],
    });
  });

  beforeEach(() => {
    resetLifecycleProbe();
  });

  afterAll(async () => {
    await api.close();
  });

  it("5 筆中 2 筆被 beforeApprove 擋下 → 3 筆完成、2 筆列出專案錯誤碼;每一筆都經守門", async () => {
    const tasks = await pendingTasks(["甲", "乙-擋", "丙", "丁-擋", "戊"]);
    lifecycleProbe.blockOn = "beforeApprove";
    lifecycleProbe.blockWhen = (context) =>
      String(context.values.title).endsWith("-擋");

    const results = await batchApprove(
      tasks.map((task) => task.id),
      "  同意  ",
    );

    expect(results).toEqual(
      tasks.map((task, index) =>
        index === 1 || index === 3
          ? {
              taskId: task.id,
              ok: false,
              reason: "BLOCKED",
              projectReason: LIFECYCLE_BLOCKED_CODE,
            }
          : { taskId: task.id, ok: true, reason: null, projectReason: null },
      ),
    );
    expect(
      lifecycleProbe.guards.filter((one) => one.guard === "beforeApprove"),
    ).toHaveLength(5);
    expect(await Promise.all(tasks.map((task) => statusOf(task)))).toEqual([
      "COMPLETED",
      "REVIEWING",
      "COMPLETED",
      "REVIEWING",
      "COMPLETED",
    ]);
    // 共同意見(去頭尾空白)寫進每一筆的決定
    const [instance] = await rawInstances(
      api.connection,
      nth(tasks, 0).submissionId,
    );
    const history = instance?.history as { kind: string; comment: unknown }[];
    expect(history.find((event) => event.kind === "approved")?.comment).toBe(
      "同意",
    );
    // 被擋下的仍在審核者手上,可以之後再核准
    const blocked = await pendingTaskOf(
      world,
      reviewer,
      nth(tasks, 1).submissionId,
    );
    expect(blocked.id).toBe(nth(tasks, 1).id);
  });

  it("其中一筆的交易失敗 → 那一筆回復(仍待處理),其他筆照常完成", async () => {
    const tasks = await pendingTasks(["一", "二", "三"]);
    // 第二筆寫入決定之後中斷:那一筆的整個交易回復
    const restore = interruptAt(api, "decide:accepted", 2);
    let results: BatchResult[];
    try {
      results = await batchApprove(tasks.map((task) => task.id));
    } finally {
      restore();
    }

    expect(results.map((one) => [one.ok, one.reason])).toEqual([
      [true, null],
      [false, "FAILED"],
      [true, null],
    ]);
    expect(await Promise.all(tasks.map((task) => statusOf(task)))).toEqual([
      "COMPLETED",
      "REVIEWING",
      "COMPLETED",
    ]);
    const [instance] = await rawInstances(
      api.connection,
      nth(tasks, 1).submissionId,
    );
    expect(
      (instance?.history as { kind: string }[]).some(
        (event) => event.kind === "approved",
      ),
    ).toBe(false);
  });

  it("勾選後已被處理、被改派走的任務、不存在或不合法的 id → 「這件已不在你手上」,其他筆照常", async () => {
    const tasks = await pendingTasks(["已處理", "照常", "改派走"]);
    await decide(world, reviewer, nth(tasks, 0), "APPROVE");
    // 流程管理者把第三張改派給別人
    await ok(api, world.admin.token, REASSIGN, {
      input: {
        taskId: nth(tasks, 2).id,
        toUserId: String(nth(world.staff, 1).userId),
      },
    });
    const missing = String(new Types.ObjectId());

    const results = await batchApprove([
      nth(tasks, 0).id,
      missing,
      nth(tasks, 1).id,
      nth(tasks, 2).id,
      "not-an-id",
    ]);

    expect(results).toEqual([
      {
        taskId: nth(tasks, 0).id,
        ok: false,
        reason: "NOT_YOURS",
        projectReason: null,
      },
      { taskId: missing, ok: false, reason: "NOT_YOURS", projectReason: null },
      { taskId: nth(tasks, 1).id, ok: true, reason: null, projectReason: null },
      {
        taskId: nth(tasks, 2).id,
        ok: false,
        reason: "NOT_YOURS",
        projectReason: null,
      },
      {
        taskId: "not-an-id",
        ok: false,
        reason: "NOT_YOURS",
        projectReason: null,
      },
    ]);
    expect(await statusOf(nth(tasks, 2))).toBe("REVIEWING");
  });

  it("別人的任務 → 不在你手上(不能替別人核准)", async () => {
    const task = nth(await pendingTasks(["別人的"]), 0);
    const other = nth(world.staff, 1);
    const data = await ok<{
      batchApproveTasks: { results: BatchResult[] };
    }>(api, other.token, BATCH_APPROVE, { input: { taskIds: [task.id] } });
    expect(data.batchApproveTasks.results[0]?.reason).toBe("NOT_YOURS");
    expect(await statusOf(task)).toBe("REVIEWING");
  });

  it("重複的任務只算一次;0 筆或超過 50 筆 → VALIDATION_FAILED、整批不做", async () => {
    const task = nth(await pendingTasks(["重複"]), 0);
    const results = await batchApprove([task.id, task.id]);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);

    const empty = await call(api, reviewer.token, BATCH_APPROVE, {
      input: { taskIds: [] },
    });
    expect(codeOf(empty)).toBe("VALIDATION_FAILED");
    const tooMany = await call(api, reviewer.token, BATCH_APPROVE, {
      input: {
        taskIds: Array.from({ length: 51 }, () => String(new Types.ObjectId())),
      },
    });
    expect(codeOf(tooMany)).toBe("VALIDATION_FAILED");
  });
});
