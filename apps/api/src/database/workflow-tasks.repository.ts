/* eslint-disable @repo/no-raw-model-query -- 此檔即 workflow_tasks 的唯一合法出口:不掛 tenantScope,改由本檔每個方法強制帶 tenantId(fail-closed);到期條件:無 */
import type { Model, Types, UpdateQuery } from "mongoose";

import type { FindOptions } from "./base.repository";
import { OPERATOR_LOCAL_KEY, type OperatorContext } from "./operator-context";
import type { BaseFields } from "./plugins/base-fields.plugin";
import {
  WORKFLOW_TASKS_COLLECTION,
  type WorkflowTask,
} from "./schemas/workflow-task.schema";
import { assertTenantBoundary } from "./tenant-boundary";
import { currentSession } from "./transaction";

/** 已落庫的一筆任務(含基礎欄位,ADR-0007)。 */
export type WorkflowTaskRecord = WorkflowTask &
  BaseFields & { _id: Types.ObjectId };

/** 新建一筆任務的內容(`tenantId` 由方法參數給)。 */
export type NewWorkflowTask = Omit<
  WorkflowTask,
  | "tenantId"
  | "editVersion"
  | "previousAssigneeIds"
  | "decidedAt"
  | "comment"
  | "assignedAt"
  | "overdueLevel"
  | "overdueDueAt"
> &
  Partial<
    Pick<
      WorkflowTask,
      | "previousAssigneeIds"
      | "decidedAt"
      | "comment"
      | "assignedAt"
      | "overdueLevel"
      | "overdueDueAt"
    >
  >;

/**
 * `workflow_tasks` 的存取層(`docs/data-model.md`「workflow_tasks」)。
 *
 * 任務是實例派任計畫的投影,審核者不一定在申請人組織的可見範圍內,所以**不掛可見範圍插件**;
 * 邊界是 `tenantId`:每個讀寫方法第一個參數就是 `tenantId`,沒給或不是 ObjectId 一律拋錯。
 * 誰能看哪些任務(`assigneeId = 我`、曾持有)由呼叫端的條件決定,這一層只保證不跨租戶。
 */
export class WorkflowTasksRepository {
  constructor(private readonly model: Model<WorkflowTask>) {}

  async findMany(
    tenantId: Types.ObjectId | null | undefined,
    filter: Record<string, unknown>,
    options: Pick<FindOptions, "sort" | "skip" | "limit"> = {},
  ): Promise<WorkflowTaskRecord[]> {
    return this.model
      .find(conditionOf(tenantId, filter), null, {
        ...(options.sort ? { sort: options.sort } : {}),
        ...(options.skip === undefined ? {} : { skip: options.skip }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      })
      .lean<WorkflowTaskRecord[]>()
      .session(currentSession() ?? null)
      .exec();
  }

  async findOne(
    tenantId: Types.ObjectId | null | undefined,
    filter: Record<string, unknown>,
  ): Promise<WorkflowTaskRecord | null> {
    return this.model
      .findOne(conditionOf(tenantId, filter))
      .lean<WorkflowTaskRecord>()
      .session(currentSession() ?? null)
      .exec();
  }

  count(
    tenantId: Types.ObjectId | null | undefined,
    filter: Record<string, unknown>,
  ): Promise<number> {
    return this.model
      .countDocuments(conditionOf(tenantId, filter))
      .session(currentSession() ?? null)
      .exec();
  }

  /**
   * 依計畫建任務;同一 `(instanceId, taskKey)` 已存在時由唯一索引拒絕(duplicate key,E11000)。
   * 推進在交易內先查再建(TX-04)。E11000 不是暫時性錯誤,driver 不會自動重跑:撞到時錯誤往外拋、
   * 整個交易回復並回報(並發的寫入通常先以寫入衝突重跑,重讀後就查得到已建的任務)。
   */
  async create(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null | undefined,
    task: NewWorkflowTask,
  ): Promise<WorkflowTaskRecord> {
    const document = new this.model({
      ...task,
      tenantId: assertTenantBoundary(tenantId, WORKFLOW_TASKS_COLLECTION),
      previousAssigneeIds: task.previousAssigneeIds ?? [],
      decidedAt: task.decidedAt ?? null,
      comment: task.comment ?? null,
      assignedAt: task.assignedAt ?? null,
      overdueLevel: task.overdueLevel ?? 0,
      overdueDueAt: task.overdueDueAt ?? null,
      editVersion: 0,
    });
    document.$locals[OPERATOR_LOCAL_KEY] = operator;
    await document.save({ session: currentSession() ?? null });
    return document.toObject<WorkflowTaskRecord>();
  }

  /**
   * 條件更新(投影同步:條件含 `(instanceId, taskKey)` 與讀到的狀態);回更新後的列,沒有符合者回 null。
   * `tenantId` / `instanceId` / `taskKey` 不可經此改動。
   */
  async updateOne(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null | undefined,
    filter: Record<string, unknown>,
    update: UpdateQuery<WorkflowTask>,
  ): Promise<WorkflowTaskRecord | null> {
    assertImmutablePaths(update);
    const set = (update.$set ?? {}) as Record<string, unknown>;
    return this.model
      .findOneAndUpdate(
        conditionOf(tenantId, filter),
        { ...update, $set: { ...set, updatedBy: operator.actorId } },
        { returnDocument: "after", runValidators: true },
      )
      .lean<WorkflowTaskRecord>()
      .session(currentSession() ?? null)
      .exec();
  }
}

const IMMUTABLE_PATHS: ReadonlySet<string> = new Set([
  "tenantId",
  "instanceId",
  "taskKey",
  "stepKey",
]);

function assertImmutablePaths(update: UpdateQuery<WorkflowTask>): void {
  // 沒有運算子的整份取代式 update 會把識別欄位與邊界一起蓋掉,一律拒絕
  const replaced = Object.keys(update).filter((key) => !key.startsWith("$"));
  if (replaced.length > 0) {
    throw new Error(
      `workflow_tasks 只收運算子式 update(收到 ${replaced.join(", ")})`,
    );
  }
  const touched = Object.values(update).flatMap((part: unknown) =>
    part !== null && typeof part === "object" ? Object.keys(part) : [],
  );
  const hit = touched.find((path) => IMMUTABLE_PATHS.has(path));
  if (hit !== undefined) {
    throw new Error(`workflow_tasks.${hit} 建立後不可改`);
  }
}

function conditionOf(
  tenantId: Types.ObjectId | null | undefined,
  filter: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...filter,
    tenantId: assertTenantBoundary(tenantId, WORKFLOW_TASKS_COLLECTION),
    deletedAt: null,
  };
}
