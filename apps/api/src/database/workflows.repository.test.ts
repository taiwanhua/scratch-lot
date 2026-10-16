import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, type Model, Types } from "mongoose";

import { BaseRepository } from "./base.repository";
import type { OperatorContext } from "./operator-context";
import { TenantScopeError } from "./plugins/tenant-scope.plugin";
import {
  FormSubmission,
  FormSubmissionSchema,
} from "./schemas/form-submission.schema";
import {
  WorkflowInstance,
  WorkflowInstanceSchema,
} from "./schemas/workflow-instance.schema";
import {
  WorkflowTask,
  WorkflowTaskSchema,
} from "./schemas/workflow-task.schema";
import {
  WorkflowVersion,
  WorkflowVersionSchema,
} from "./schemas/workflow-version.schema";
import { Workflow, WorkflowSchema } from "./schemas/workflow.schema";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "./test-support/mongo-connection";
import {
  type NewWorkflowTask,
  WorkflowTasksRepository,
} from "./workflow-tasks.repository";
import { WorkflowsRepository } from "./workflows.repository";

/** 呼叫端「忘了給邊界」的樣子(與明給 null 的「查共用」區分)。 */
const NO_BOUNDARY = Reflect.get({}, "tenantId") as Types.ObjectId | undefined;

/** 驗證失敗時回 `status` 欄的錯誤,通過回 null。 */
async function statusErrorOf(document: {
  validate: () => Promise<void>;
}): Promise<unknown> {
  try {
    await document.validate();
    return null;
  } catch (error) {
    return (error as { errors?: Record<string, unknown> }).errors?.status;
  }
}

interface IndexInfo {
  key: Record<string, number>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
}

function operatorAt(orgId: Types.ObjectId): OperatorContext {
  return {
    actorId: new Types.ObjectId(),
    currentOrgId: orgId,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: [orgId],
    roleIds: [],
  };
}

async function indexesOf(
  connection: Connection,
  modelName: string,
): Promise<IndexInfo[]> {
  return (await connection
    .model(modelName)
    .collection.listIndexes()
    .toArray()) as IndexInfo[];
}

function hasIndex(
  indexes: IndexInfo[],
  key: Record<string, number>,
  unique?: boolean,
): boolean {
  const target = JSON.stringify(key);
  return indexes.some(
    (index) =>
      JSON.stringify(index.key) === target &&
      (unique === undefined || (index.unique ?? false) === unique),
  );
}

/**
 * 6b 的四張新表(對真 MongoDB):索引、`workflows` / `workflow_tasks` 的 `tenantId` 邊界(fail-closed)、
 * `form_submissions` 的 6b 欄位預設值。
 */
describe("workflows / workflow_versions / workflow_instances / workflow_tasks", () => {
  let database: TestDatabase;
  let workflowModel: Model<Workflow>;
  let taskModel: Model<WorkflowTask>;
  let instanceModel: Model<WorkflowInstance>;
  let workflows: WorkflowsRepository;
  let tasks: WorkflowTasksRepository;

  const tenantA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();
  const asRoot = operatorAt(new Types.ObjectId());
  const asA = operatorAt(tenantA);

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-workflows");
    const { connection } = database;
    workflowModel = connection.model<Workflow>(Workflow.name, WorkflowSchema);
    taskModel = connection.model<WorkflowTask>(
      WorkflowTask.name,
      WorkflowTaskSchema,
    );
    instanceModel = connection.model<WorkflowInstance>(
      WorkflowInstance.name,
      WorkflowInstanceSchema,
    );
    const versionModel = connection.model<WorkflowVersion>(
      WorkflowVersion.name,
      WorkflowVersionSchema,
    );
    const submissionModel = connection.model<FormSubmission>(
      FormSubmission.name,
      FormSubmissionSchema,
    );
    for (const model of [
      workflowModel,
      taskModel,
      instanceModel,
      versionModel,
      submissionModel,
    ] as Model<unknown>[]) {
      await model.syncIndexes();
    }
    workflows = new WorkflowsRepository(workflowModel);
    tasks = new WorkflowTasksRepository(taskModel);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  describe("索引", () => {
    it("workflows:unique(key)", async () => {
      const indexes = await indexesOf(database.connection, Workflow.name);
      expect(hasIndex(indexes, { key: 1 }, true)).toBe(true);
    });

    it("workflow_versions:版號唯一(部分)+ 草稿 / 發布中各最多一筆", async () => {
      const indexes = await indexesOf(
        database.connection,
        WorkflowVersion.name,
      );
      expect(hasIndex(indexes, { workflowKey: 1, version: 1 }, true)).toBe(
        true,
      );
      const partials = indexes
        .filter((index) => index.unique === true)
        .map((index) => index.partialFilterExpression);
      expect(partials).toEqual(
        expect.arrayContaining([{ status: "draft" }, { status: "publishing" }]),
      );
    });

    it("workflow_instances:unique(submissionId, revision)+(tenantId, status)+ 模組資料索引", async () => {
      const indexes = await indexesOf(
        database.connection,
        WorkflowInstance.name,
      );
      expect(hasIndex(indexes, { submissionId: 1, revision: 1 }, true)).toBe(
        true,
      );
      expect(hasIndex(indexes, { tenantId: 1, status: 1 })).toBe(true);
      expect(
        hasIndex(indexes, { tenantId: 1, moduleKey: 1, createdAt: 1 }),
      ).toBe(true);
    });

    it("workflow_tasks:unique(instanceId, taskKey)+(assigneeId, status)+(tenantId, moduleKey, status)+(previousAssigneeIds)", async () => {
      const indexes = await indexesOf(database.connection, WorkflowTask.name);
      expect(hasIndex(indexes, { instanceId: 1, taskKey: 1 }, true)).toBe(true);
      expect(hasIndex(indexes, { assigneeId: 1, status: 1 })).toBe(true);
      expect(hasIndex(indexes, { tenantId: 1, moduleKey: 1, status: 1 })).toBe(
        true,
      );
      expect(hasIndex(indexes, { previousAssigneeIds: 1 })).toBe(true);
    });

    it("workflow_instances:同一筆提交同一個修訂號只能有一個實例", async () => {
      const base = {
        submissionId: new Types.ObjectId(),
        revision: 1,
        orgId: tenantA,
        tenantId: tenantA,
        moduleKey: "demo.form",
        formKey: "sick_leave",
        formVersion: 1,
        workflowKey: "leave_review",
        workflowVersion: 1,
        status: "running" as const,
      };
      await instanceModel.create(base);
      await expect(instanceModel.create(base)).rejects.toMatchObject({
        code: 11_000,
      });
      await instanceModel.create({ ...base, revision: 2 });
    });
  });

  it("form_submissions 的 6b 欄位預設:沒走過流程、不阻擋、未作廢;status 收七值", async () => {
    const model = database.connection.model<FormSubmission>(
      FormSubmission.name,
    );
    const document = new model({
      orgId: tenantA,
      moduleKey: "demo.form",
      formKey: "sick_leave",
      version: 1,
      status: "reviewing",
      clientRequestId: "req-1",
    });
    await expect(statusErrorOf(document)).resolves.toBeNull();
    expect(document.toObject()).toMatchObject({
      currentInstanceId: null,
      blocked: false,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      replacedById: null,
    });
    for (const status of [
      "draft",
      "reviewing",
      "returned",
      "withdrawn",
      "completed",
      "rejected",
      "voided",
    ]) {
      document.status = status as FormSubmission["status"];
      await expect(statusErrorOf(document)).resolves.toBeNull();
    }
    document.status = "approved" as FormSubmission["status"];
    await expect(statusErrorOf(document)).resolves.toBeDefined();
    await expect(statusErrorOf(document)).resolves.not.toBeNull();
  });

  describe("WorkflowsRepository(tenantId 邊界)", () => {
    it("root 以 null 建共用流程、租戶以自己的 tenantId 建客製流程;ownerOrgId = tenantId", async () => {
      const shared = await workflows.create(asRoot, null, {
        key: "leave_review",
        name: "病假審核",
      });
      expect(shared).toMatchObject({ ownerOrgId: null, tenantId: null });
      const custom = await workflows.create(asA, tenantA, {
        key: "leave_review_a",
        name: "病假審核(A)",
        forkedFrom: { workflowKey: "leave_review", version: 1 },
      });
      expect(String(custom.tenantId)).toBe(String(tenantA));
      expect(String(custom.ownerOrgId)).toBe(String(tenantA));
      await workflows.create(asRoot, tenantB, {
        key: "leave_review_b",
        name: "病假審核(B)",
      });
    });

    it("邊界內才查得到:租戶查不到別租戶的客製,也查不到未分派的共用", async () => {
      await expect(
        workflows.findOne(tenantA, { key: "leave_review_b" }),
      ).resolves.toBeNull();
      await expect(
        workflows.findOne(tenantA, { key: "leave_review" }),
      ).resolves.toBeNull();
      const sharedOnes = await workflows.findMany(null);
      expect(sharedOnes.map((workflow) => workflow.key)).toEqual([
        "leave_review",
      ]);
    });

    it("findVisibleToTenant = 自己的客製 + 分派來的共用", async () => {
      const shared = await workflows.findOne(null, { key: "leave_review" });
      const none = await workflows.findVisibleToTenant(tenantA, []);
      expect(none.map((workflow) => workflow.key)).toEqual(["leave_review_a"]);
      const visible = await workflows.findVisibleToTenant(tenantA, [
        shared?._id ?? new Types.ObjectId(),
      ]);
      expect(visible.map((workflow) => workflow.key)).toEqual([
        "leave_review",
        "leave_review_a",
      ]);
    });

    it("key 全域唯一(跨租戶也不能撞)", async () => {
      await expect(
        workflows.create(asA, tenantA, { key: "leave_review", name: "x" }),
      ).rejects.toMatchObject({ code: 11_000 });
    });

    it("update 只動邊界內那一筆;currentVersion 可做 CAS", async () => {
      const moved = await workflows.update(
        asA,
        tenantA,
        { key: "leave_review_a" },
        { currentVersion: 1 },
        { currentVersion: null },
      );
      expect(moved?.currentVersion).toBe(1);
      const stale = await workflows.update(
        asA,
        tenantA,
        { key: "leave_review_a" },
        { currentVersion: 2 },
        { currentVersion: null },
      );
      expect(stale).toBeNull();
      await expect(
        workflows.update(
          asA,
          tenantA,
          { key: "leave_review_b" },
          { name: "x" },
        ),
      ).resolves.toBeNull();
    });

    it("沒給邊界(undefined)一律拋錯;明給 null 才是查共用", async () => {
      await expect(workflows.findMany(NO_BOUNDARY)).rejects.toBeInstanceOf(
        TenantScopeError,
      );
      await expect(
        workflows.findOne(NO_BOUNDARY, { key: "leave_review" }),
      ).rejects.toBeInstanceOf(TenantScopeError);
      await expect(
        workflows.create(asRoot, NO_BOUNDARY, { key: "x_flow", name: "x" }),
      ).rejects.toBeInstanceOf(TenantScopeError);
      await expect(
        workflows.findVisibleToTenant(null, []),
      ).rejects.toBeInstanceOf(TenantScopeError);
    });

    it("不能拿去建 BaseRepository", () => {
      expect(() => new BaseRepository(workflowModel as never)).toThrow(
        /WorkflowsRepository/,
      );
    });
  });

  describe("WorkflowTasksRepository(tenantId 邊界)", () => {
    const instanceId = new Types.ObjectId();
    const reviewer = new Types.ObjectId();
    const task = (taskKey: string): NewWorkflowTask => ({
      instanceId,
      stepKey: "boss",
      taskKey,
      submissionId: new Types.ObjectId(),
      revision: 1,
      moduleKey: "demo.form",
      formKey: "sick_leave",
      assigneeId: reviewer,
      status: "pending",
    });

    it("依計畫建任務;同一 (instanceId, taskKey) 重建被唯一鍵擋下", async () => {
      const created = await tasks.create(asA, tenantA, task("boss-1"));
      expect(created).toMatchObject({
        previousAssigneeIds: [],
        decidedAt: null,
        comment: null,
        editVersion: 0,
      });
      await expect(
        tasks.create(asA, tenantA, task("boss-1")),
      ).rejects.toMatchObject({ code: 11_000 });
    });

    it("待我審核:以 assigneeId 查,只在自己的租戶內", async () => {
      await expect(
        tasks.findMany(tenantA, { assigneeId: reviewer, status: "pending" }),
      ).resolves.toHaveLength(1);
      await expect(
        tasks.findMany(tenantB, { assigneeId: reviewer }),
      ).resolves.toEqual([]);
      // filter 裡偷塞別的 tenantId 也蓋不過邊界
      await expect(tasks.count(tenantB, { tenantId: tenantA })).resolves.toBe(
        0,
      );
    });

    it("投影同步是條件更新(讀到的狀態還在才寫);邊界與識別欄位不可改", async () => {
      const synced = await tasks.updateOne(
        asA,
        tenantA,
        { instanceId, taskKey: "boss-1", status: "pending" },
        { $set: { status: "approved", decidedAt: new Date() } },
      );
      expect(synced?.status).toBe("approved");
      await expect(
        tasks.updateOne(
          asA,
          tenantA,
          { instanceId, taskKey: "boss-1", status: "pending" },
          { $set: { status: "cancelled" } },
        ),
      ).resolves.toBeNull();
      await expect(
        tasks.updateOne(
          asA,
          tenantA,
          { instanceId, taskKey: "boss-1" },
          { $set: { tenantId: tenantB } },
        ),
      ).rejects.toThrow(/不可改/);
      await expect(
        tasks.updateOne(
          asA,
          tenantA,
          { instanceId, taskKey: "boss-1" },
          {
            status: "late",
          },
        ),
      ).rejects.toThrow(/運算子式/);
    });

    it("沒帶 tenantId 的讀寫一律拋 TenantScopeError", async () => {
      await expect(tasks.findMany(null, {})).rejects.toBeInstanceOf(
        TenantScopeError,
      );
      await expect(tasks.findOne(undefined, {})).rejects.toBeInstanceOf(
        TenantScopeError,
      );
      await expect(
        tasks.create(asA, null, task("boss-2")),
      ).rejects.toBeInstanceOf(TenantScopeError);
      await expect(
        tasks.updateOne(asA, undefined, {}, { $set: { status: "late" } }),
      ).rejects.toBeInstanceOf(TenantScopeError);
    });

    it("不能拿去建 BaseRepository", () => {
      expect(() => new BaseRepository(taskModel as never)).toThrow(
        /WorkflowTasksRepository/,
      );
    });
  });
});
