import {
  Field,
  GraphQLISODateTime,
  ID,
  InputType,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { ScheduleChangeReasonInput } from "../roster/dto/schedule-roster.input";
import { ScheduleAutoRunConditionInput } from "../rules/dto/schedule-rule.input";

// ---- 輸入 ----

/** 套用範本(規格 14.4):種類、選的範本 / 週範本、套用到的日子。 */
@InputType()
export class ApplyScheduleTemplatesInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  /** `YYYY-MM`(套用到的日子都要在這個月) */
  @Field(() => String)
  month!: string;

  /** `template` 人力需求範本(可多選)/ `week-template` 人力需求週範本(單選) */
  @Field(() => String)
  kind!: string;

  @Field(() => [ID], { nullable: true })
  templateIds?: string[] | null;

  @Field(() => ID, { nullable: true })
  weekTemplateId?: string | null;

  /** 套用到的日子 `YYYY-MM-DD` */
  @Field(() => [String])
  dates!: string[];

  /** 已發布的月份必填 */
  @Field(() => ScheduleChangeReasonInput, { nullable: true })
  changeReason?: ScheduleChangeReasonInput | null;
}

/** 自動排班 / 清除自動排入的人的範圍:某家店某個月裡的 `from`–`to`(含頭尾)。 */
@InputType()
export class ScheduleAutoRunRangeInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => String)
  month!: string;

  @Field(() => String)
  from!: string;

  @Field(() => String)
  to!: string;
}

@InputType()
export class RunScheduleAutoRunInput extends ScheduleAutoRunRangeInput {
  /** `fill-empty` 只填空位 / `redo-auto` 重排自動排入的人 / `redo-all` 全部重排 */
  @Field(() => String)
  mode!: string;

  /** 這次的條件(預設 = 這家店的生效設定;畫面可以改勾選與順序,只用在這一次) */
  @Field(() => [ScheduleAutoRunConditionInput])
  conditions!: ScheduleAutoRunConditionInput[];

  /** 先以預設人力需求週範本補上人力需求 */
  @Field(() => Boolean, { nullable: true })
  fillWeekTemplate?: boolean | null;
}

// ---- 輸出 ----

@ObjectType("ApplyScheduleTemplatesPayload")
export class ApplyScheduleTemplatesPayload {
  /** 產生的人力需求筆數 */
  @Field(() => Int)
  createdCount!: number;

  /** 略過的相同時段(人力需求範本) */
  @Field(() => Int)
  skippedSlots!: number;

  /** 補上的天數 / 已有人力需求而略過的天數(人力需求週範本) */
  @Field(() => Int)
  filledDays!: number;

  @Field(() => Int)
  skippedDays!: number;
}

/** 套用範本抽屜的週範本選項(這家店組織鏈上看得到、啟用中的)。 */
@ObjectType("ScheduleApplyWeekTemplate")
export class ScheduleApplyWeekTemplateModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  /** 7 格(0 = 星期日),每格是人力需求範本 id */
  @Field(() => [[ID]])
  days!: string[][];
}

/** 最近一次自動排班的摘要(檢核面板最上方)。 */
@ObjectType("ScheduleAutoRunSummary")
export class ScheduleAutoRunSummaryModel {
  @Field(() => ID)
  id!: string;

  @Field(() => GraphQLISODateTime)
  at!: Date;

  @Field(() => String, { nullable: true })
  byName!: string | null;

  @Field(() => String)
  from!: string;

  @Field(() => String)
  to!: string;

  /** 填入的人次 */
  @Field(() => Int)
  filledCount!: number;

  /** 排不滿的執行任務筆數 */
  @Field(() => Int)
  unfilledCount!: number;

  /** 補上的人力需求筆數 / 天數 */
  @Field(() => Int)
  addedDemandCount!: number;

  @Field(() => Int)
  addedDemandDays!: number;
}

/** 這家店自動排班條件的生效設定(勾選 = enabled;依排序)。 */
@ObjectType("ScheduleAutoRunConditionSetting")
export class ScheduleAutoRunConditionModel {
  @Field(() => String)
  key!: string;

  @Field(() => Boolean)
  enabled!: boolean;
}

@ObjectType("ScheduleAutoRunStatusPayload")
export class ScheduleAutoRunStatusPayload {
  /** 有 `schedule.manage.auto-run` */
  @Field(() => Boolean)
  canAutoRun!: boolean;

  /** 自動排班執行中(別人按的;10 分鐘逾時自動解除) */
  @Field(() => Boolean)
  running!: boolean;

  @Field(() => ScheduleAutoRunSummaryModel, { nullable: true })
  latest!: ScheduleAutoRunSummaryModel | null;

  @Field(() => [ScheduleApplyWeekTemplateModel])
  weekTemplates!: ScheduleApplyWeekTemplateModel[];

  /** [自動排班] 對話框條件的預設值(這家店的生效設定,整組繼承;依排序) */
  @Field(() => [ScheduleAutoRunConditionModel])
  conditions!: ScheduleAutoRunConditionModel[];
}

@ObjectType("ScheduleAutoRunPreviewPayload")
export class ScheduleAutoRunPreviewPayload {
  /** 範圍內(店休以外)的人力需求筆數 */
  @Field(() => Int)
  demandCount!: number;

  /** 這家店的預設人力需求週範本(可以補上時;沒設定 / 停用 / 看不到 = null) */
  @Field(() => ScheduleApplyWeekTemplateModel, { nullable: true })
  weekTemplate!: ScheduleApplyWeekTemplateModel | null;

  /** 週範本可以補上的天數(範圍內、不是店休、還沒有任何人力需求、那天的格子有範本) */
  @Field(() => Int)
  fillableDays!: number;

  /** 範圍內手動 / 自動排入的人次(「全部重排」確認、「清除自動排入的人」用) */
  @Field(() => Int)
  manualCount!: number;

  @Field(() => Int)
  autoCount!: number;
}

@ObjectType("ClearScheduleAutoAssignmentsPayload")
export class ClearScheduleAutoAssignmentsPayload {
  @Field(() => Int)
  removedCount!: number;

  /** 移除後沒有任何執行任務、一起刪掉的排班 */
  @Field(() => [ID])
  deletedEntryIds!: string[];
}
