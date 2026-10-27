import { Field, ID, Int, ObjectType } from "@nestjs/graphql";

/** 建立範本的組織(列表的「建立於」)。 */
@ObjectType("ScheduleOwnerOrg")
export class ScheduleOwnerOrgModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

/** 一筆執行任務 = 職責 + 任務內容。 */
@ObjectType("ScheduleTemplateTask")
export class ScheduleTemplateTaskModel {
  @Field(() => ID)
  taskId!: string;

  /** `leader` 負責人 / `helper` 協同 */
  @Field(() => String)
  role!: string;

  /** 任務內容(欄位管理「執行任務」的選項 value) */
  @Field(() => String)
  taskKey!: string;
}

/** 人力需求範本。 */
@ObjectType("ScheduleDemandTemplate")
export class ScheduleDemandTemplateModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  shortName!: string;

  /** `HH:mm` */
  @Field(() => String)
  startTime!: string;

  /** `HH:mm`(比開始早 = 跨午夜) */
  @Field(() => String)
  endTime!: string;

  /** 崗位(欄位管理「崗位」的選項 value) */
  @Field(() => String)
  positionKey!: string;

  @Field(() => [ScheduleTemplateTaskModel])
  tasks!: ScheduleTemplateTaskModel[];

  /** 標籤色票代號;null = 不設定 */
  @Field(() => String, { nullable: true })
  paletteKey!: string | null;

  @Field(() => ScheduleOwnerOrgModel)
  ownerOrg!: ScheduleOwnerOrgModel;

  /** 這位操作者能不能改 / 刪(建立它的那一層 + `edit-templates`) */
  @Field(() => Boolean)
  canEdit!: boolean;
}

@ObjectType("ScheduleDemandTemplatesPayload")
export class ScheduleDemandTemplatesPayload {
  @Field(() => [ScheduleDemandTemplateModel])
  items!: ScheduleDemandTemplateModel[];

  @Field(() => Int)
  totalCount!: number;

  /** 能不能新增(`edit-templates`;新增的範本屬於當前組織) */
  @Field(() => Boolean)
  canCreate!: boolean;
}

@ObjectType("ScheduleDemandTemplatePayload")
export class ScheduleDemandTemplatePayload {
  @Field(() => ScheduleDemandTemplateModel)
  item!: ScheduleDemandTemplateModel;
}

/** 人力需求週範本。 */
@ObjectType("ScheduleDemandWeekTemplate")
export class ScheduleDemandWeekTemplateModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  /** 7 格(0 = 星期日 … 6 = 星期六),每格是人力需求範本 id;已刪除的範本不列 */
  @Field(() => [[ID]])
  days!: string[][];

  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => ScheduleOwnerOrgModel)
  ownerOrg!: ScheduleOwnerOrgModel;

  @Field(() => Boolean)
  canEdit!: boolean;
}

@ObjectType("ScheduleDemandWeekTemplatesPayload")
export class ScheduleDemandWeekTemplatesPayload {
  @Field(() => [ScheduleDemandWeekTemplateModel])
  items!: ScheduleDemandWeekTemplateModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Boolean)
  canCreate!: boolean;
}

@ObjectType("ScheduleDemandWeekTemplatePayload")
export class ScheduleDemandWeekTemplatePayload {
  @Field(() => ScheduleDemandWeekTemplateModel)
  item!: ScheduleDemandWeekTemplateModel;
}

@ObjectType("DeleteScheduleTemplatePayload")
export class DeleteScheduleTemplatePayload {
  @Field(() => ID)
  id!: string;
}
