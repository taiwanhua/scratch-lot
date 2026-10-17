import { Field, ID, InputType, Int, registerEnumType } from "@nestjs/graphql";

import { WorkflowDecisionEnum } from "../../models/workflow-instance.model";

/** 清單分頁預設值(與其他清單同一組)。 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** 審核者對任務做決定;駁回 / 退回的 `comment` 必填,退回要該關允許。 */
@InputType()
export class DecideTaskInput {
  @Field(() => ID)
  taskId!: string;

  /** 任務的 `editVersion`(只擋同一個人兩個分頁重複送)。 */
  @Field(() => Int)
  expectedEditVersion!: number;

  @Field(() => WorkflowDecisionEnum)
  decision!: WorkflowDecisionEnum;

  /** 理由;缺席 / `null` / 空白 = 沒有(駁回 / 退回時必填)。 */
  @Field(() => String, { nullable: true })
  comment?: string | null;
}

/** 流程管理者把任務改派給另一個人(`taskKey` 不變)。 */
@InputType()
export class ReassignTaskInput {
  @Field(() => ID)
  taskId!: string;

  @Field(() => ID)
  toUserId!: string;
}

/** 流程管理者對「解析為空」而阻擋的關卡新增審核者。 */
@InputType()
export class AddStepAssigneeInput {
  @Field(() => ID)
  instanceId!: string;

  @Field(() => String)
  stepKey!: string;

  @Field(() => ID)
  userId!: string;
}

@InputType()
export class RetryAdvanceInstanceInput {
  @Field(() => ID)
  instanceId!: string;
}

/** 阻擋清單的篩選。 */
export enum BlockedInstancesFilter {
  /** 實例 `blocked`(有關卡解析為空、或承辦人失效)。 */
  BLOCKED = "blocked",
  /** 判斷表還有事可做(投影不同步、資料被改過…)。 */
  NEEDS_ADVANCE = "needsAdvance",
}

registerEnumType(BlockedInstancesFilter, {
  name: "BlockedInstancesFilter",
  description: "阻擋清單篩選:阻擋 / 需要推進",
});

@InputType()
export class BlockedInstancesInput {
  @Field(() => BlockedInstancesFilter)
  filter!: BlockedInstancesFilter;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/** 批次核准一次最多幾筆(底座規格 3.10 B18;前端勾選上限同值)。 */
export const BATCH_APPROVE_LIMIT = 50;

/** 審核者一次核准多個任務(每一筆一個交易);只支援核准。 */
@InputType()
export class BatchApproveTasksInput {
  /** 要核准的任務;重複的只算一次,1 到 50 筆。 */
  @Field(() => [ID], {
    description: `要核准的任務,1 到 ${String(BATCH_APPROVE_LIMIT)} 筆(重複的只算一次)`,
  })
  taskIds!: string[];

  /** 共同意見;缺席 / `null` / 空白 = 沒有。 */
  @Field(() => String, { nullable: true })
  comment?: string | null;
}
