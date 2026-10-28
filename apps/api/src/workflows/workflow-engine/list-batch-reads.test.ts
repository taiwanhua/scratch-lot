import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import {
  type DbCommandCount,
  countDbCommands,
  describeDbCommands,
} from "../../database/test-support/db-commands";
import {
  ASSIGN,
  CREATE_FORM,
  FORMS,
  ok,
} from "../../forms/test-support/form-fixtures";
import {
  ASSIGN_WORKFLOW,
  BLOCKED_INSTANCES,
  CREATE_WORKFLOW,
  MY_APPLICATIONS,
  MY_TASKS,
  type Person,
  type TaskRow,
  WORKFLOWS,
  WORKFLOW_MODULE,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  currentInstance,
  pendingTaskOf,
  setupWorld,
  submitLeave,
  useWorkflow,
  usersStep,
} from "../test-support/workflow-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const BATCH_APPROVE = /* GraphQL */ `
  mutation BatchApproveTasks($input: BatchApproveTasksInput!) {
    batchApproveTasks(input: $input) {
      results {
        taskId
        ok
      }
    }
  }
`;

/**
 * 批次核准每張的指令數上限(每張各自一個交易:讀任務 / 實例 / 提交 / 定義、守門、寫決定、稽核、
 * 推進各輪重讀實例與任務、通知)。量測時每張 32 次,留 3 次餘裕給正常的小改動;
 * 逐列 N+1(例:每輪重讀定義、每張重建上下文)會超過。
 */
const BATCH_APPROVE_COMMANDS_PER_TASK = 35;

/** 1 列與一整頁的指令數要相同;不同時把兩邊的分項列出來(找出逐列查的那個集合)。 */
function sameCommandsProblem(
  label: string,
  one: DbCommandCount<unknown>,
  many: DbCommandCount<unknown>,
): string | null {
  return one.total === many.total
    ? null
    : `${label}:1 列 ${String(one.total)} 次、整頁 ${String(many.total)} 次\n--- 1 列\n${describeDbCommands(one.byCommand)}\n--- 整頁\n${describeDbCommands(many.byCommand)}`;
}

/**
 * 列表 / 頁面讀取不逐列查(TX-07):阻擋清單(含「需要推進」的識別)、我的申請、待我審核、
 * 表單與流程設計的列表(root 視角含分派),1 列與一整頁的資料庫指令數相同。
 * 批次核准(每張各自交易,不合併)只量每張的成本。
 */
describe("列表整頁批次讀(TX-07)", () => {
  let api: AuthTestApp;
  let world: World;
  let reviewer: Person;

  function staff(index: number): Person {
    const found = world.staff[index];
    if (!found) {
      throw new Error(`staff[${String(index)}] 不存在`);
    }
    return found;
  }

  /** 送出一張單,把它的任務投影弄亂(判斷表會要求同步任務 = 需要推進)。 */
  async function brokenSubmission(): Promise<void> {
    const submitted = await submitLeave(world);
    const instance = await currentInstance(world, submitted.id);
    await world.connection
      .collection("workflow_tasks")
      .updateOne(
        { instanceId: new Types.ObjectId(instance.id) },
        { $set: { status: "cancelled" } },
      );
  }

  /** 送出 count 張單,回各自在審核者手上的任務。 */
  async function pendingTasks(count: number): Promise<TaskRow[]> {
    const tasks: TaskRow[] = [];
    for (let index = 0; index < count; index += 1) {
      const submitted = await submitLeave(world);
      tasks.push(await pendingTaskOf(world, reviewer, submitted.id));
    }
    return tasks;
  }

  function needsAdvance(): Promise<
    DbCommandCount<{ blockedInstances: { items: unknown[] } }>
  > {
    return countDbCommands(() =>
      ok<{ blockedInstances: { items: unknown[] } }>(
        api,
        world.admin.token,
        BLOCKED_INSTANCES,
        { input: { filter: "NEEDS_ADVANCE", pageSize: 100 } },
      ),
    );
  }

  function myApplications(): Promise<
    DbCommandCount<{ myApplications: { items: unknown[] } }>
  > {
    return countDbCommands(() =>
      ok<{ myApplications: { items: unknown[] } }>(
        api,
        world.applicant.token,
        MY_APPLICATIONS,
        { input: { pageSize: 100 } },
      ),
    );
  }

  function myTasks(): Promise<
    DbCommandCount<{ myTasks: { items: unknown[] } }>
  > {
    return countDbCommands(() =>
      ok<{ myTasks: { items: unknown[] } }>(api, reviewer.token, MY_TASKS, {
        input: { pageSize: 100 },
      }),
    );
  }

  function approve(
    tasks: readonly TaskRow[],
  ): Promise<
    DbCommandCount<{ batchApproveTasks: { results: { ok: boolean }[] } }>
  > {
    return countDbCommands(() =>
      ok<{ batchApproveTasks: { results: { ok: boolean }[] } }>(
        api,
        reviewer.token,
        BATCH_APPROVE,
        { input: { taskIds: tasks.map((task) => task.id) } },
      ),
    );
  }

  function listOf(
    token: string,
    document: string,
    pageSize: number,
    filter: Record<string, unknown> = {},
  ): Promise<DbCommandCount<Record<string, { items: unknown[] }>>> {
    return countDbCommands(() =>
      ok<Record<string, { items: unknown[] }>>(api, token, document, {
        input: { ...filter, pageSize },
      }),
    );
  }

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_list_batch_reads", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 2);
    reviewer = staff(0);
    await useWorkflow(world, "list_batch_reads", {
      steps: [usersStep("one", [reviewer])],
    });
  });

  afterAll(async () => {
    await api.close();
  });

  it("阻擋清單「需要推進」與我的申請:1 列與 6 列指令數相同", async () => {
    await brokenSubmission();
    // 暖身(登入、權限等第一次讀取的快取)
    await needsAdvance();
    await myApplications();
    const oneAdvance = await needsAdvance();
    const oneApplication = await myApplications();
    for (let index = 0; index < 5; index += 1) {
      await brokenSubmission();
    }
    const sixAdvance = await needsAdvance();
    const sixApplications = await myApplications();
    expect(oneAdvance.result.blockedInstances.items).toHaveLength(1);
    expect(sixAdvance.result.blockedInstances.items).toHaveLength(6);
    expect(sixApplications.result.myApplications.items).toHaveLength(6);
    expect(
      [
        sameCommandsProblem("需要推進", oneAdvance, sixAdvance),
        sameCommandsProblem("我的申請", oneApplication, sixApplications),
      ].filter((problem) => problem !== null),
    ).toEqual([]);
  });

  it("待我審核:1 列與 6 列指令數相同;批次核准每張不超過上限", async () => {
    const first = await pendingTasks(1);
    await myTasks();
    const oneList = await myTasks();
    const oneApprove = await approve(first);
    const six = await pendingTasks(6);
    const sixList = await myTasks();
    const sixApprove = await approve(six);
    expect(sixList.result.myTasks.items).toHaveLength(6);
    expect(
      sixApprove.result.batchApproveTasks.results.every((row) => row.ok),
    ).toBe(true);
    expect(sameCommandsProblem("待我審核", oneList, sixList)).toBeNull();
    // 每張各自一個交易(Q4 已定:不合併),所以只看每張的增量
    expect((sixApprove.total - oneApprove.total) / 5).toBeLessThanOrEqual(
      BATCH_APPROVE_COMMANDS_PER_TASK,
    );
  });

  it("表單 / 流程設計列表(root 視角含分派、租戶視角含綁定表單):1 列與多列指令數相同", async () => {
    for (let index = 0; index < 3; index += 1) {
      const key = `list_batch_form_${String(index)}`;
      await ok(api, world.root, CREATE_FORM, {
        input: { key, moduleKey: WORKFLOW_MODULE, name: `列表表單 ${key}` },
      });
      await ok(api, world.root, ASSIGN, {
        input: { formKey: key, tenantOrgIds: [String(world.tenant)] },
      });
      await useWorkflow(world, `list_batch_extra_${String(index)}`, {
        steps: [usersStep("one", [reviewer])],
      });
      const sharedKey = `list_batch_shared_${String(index)}`;
      await ok(api, world.root, CREATE_WORKFLOW, {
        input: { key: sharedKey, name: `共用 ${sharedKey}` },
      });
      await ok(api, world.root, ASSIGN_WORKFLOW, {
        input: { workflowKey: sharedKey, tenantOrgIds: [String(world.tenant)] },
      });
    }
    await listOf(world.root, FORMS, 1);
    await listOf(world.root, WORKFLOWS, 1);
    await listOf(world.admin.token, WORKFLOWS, 1);
    const oneForm = await listOf(world.root, FORMS, 1);
    const manyForms = await listOf(world.root, FORMS, 100);
    const oneWorkflow = await listOf(world.root, WORKFLOWS, 1);
    const manyWorkflows = await listOf(world.root, WORKFLOWS, 100);
    // 1 列取有綁表單的那個(最後一個 useWorkflow 把病假表單綁到它),與整頁讀到的集合相同
    const oneTenantWorkflow = await listOf(world.admin.token, WORKFLOWS, 1, {
      keyword: "list_batch_extra_2",
    });
    const manyTenantWorkflows = await listOf(world.admin.token, WORKFLOWS, 100);
    expect(manyForms.result.forms?.items.length).toBeGreaterThan(1);
    expect(manyWorkflows.result.workflows?.items.length).toBeGreaterThan(1);
    expect(manyTenantWorkflows.result.workflows?.items.length).toBeGreaterThan(
      1,
    );
    expect(
      [
        sameCommandsProblem("表單列表(root)", oneForm, manyForms),
        sameCommandsProblem("流程列表(root)", oneWorkflow, manyWorkflows),
        sameCommandsProblem(
          "流程列表(租戶)",
          oneTenantWorkflow,
          manyTenantWorkflows,
        ),
      ].filter((problem) => problem !== null),
    ).toEqual([]);
  });

  it("需要推進:審核關卡仍待處理(進關前中斷,判斷表列 5)也列進來", async () => {
    const submitted = await submitLeave(world);
    const instance = await currentInstance(world, submitted.id);
    // 進關前中斷:關卡還在 activeStepKeys,但仍是 pending、還沒有計畫
    await world.connection
      .collection("workflow_instances")
      .updateOne(
        { _id: new Types.ObjectId(instance.id) },
        { $set: { "steps.$[one].status": "pending", "steps.$[one].plan": [] } },
        { arrayFilters: [{ "one.stepKey": "one" }] },
      );
    const listed = await needsAdvance();
    expect(
      listed.result.blockedInstances.items.map(
        (item) => (item as { id: string }).id,
      ),
    ).toContain(instance.id);
  });
});
