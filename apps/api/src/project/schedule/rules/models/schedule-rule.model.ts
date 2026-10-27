import { Field, ID, Int, ObjectType, registerEnumType } from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../../../data-scope/json-object.scalar";

export enum ScheduleRuleSourceEnum {
  /** 本層自訂 */
  OWN = "own",
  /** 沿用某個上層組織的設定 */
  INHERITED = "inherited",
  /** 整條鏈都沒設,用程式預設 */
  DEFAULT = "default",
}

registerEnumType(ScheduleRuleSourceEnum, {
  name: "ScheduleRuleSource",
  description: "規則生效值的來源:本層自訂 / 沿用上層 / 程式預設",
});

/** 一條規則的一份設定(生效值或上層值)。 */
@ObjectType("ScheduleRuleSetting")
export class ScheduleRuleSettingModel {
  @Field(() => Boolean)
  enabled!: boolean;

  /** 值(形狀依定義的 `valueType`,見 `docs/modules/project/schedule.md`「規則」) */
  @Field(() => GraphQLJSONObject)
  value!: Record<string, unknown>;

  /** `limit` / `reminder`;沒有等級的規則為 null */
  @Field(() => String, { nullable: true })
  level!: string | null;

  @Field(() => Int)
  order!: number;

  @Field(() => ScheduleRuleSourceEnum)
  source!: ScheduleRuleSourceEnum;

  /**
   * 生效值所在的組織名稱。程式預設、或那個組織操作者看不到時為 null
   * (畫面寫「沿用上層設定」,不露出看不到的組織名稱)。
   */
  @Field(() => String, { nullable: true })
  sourceOrgName!: string | null;
}

/** 規則頁的一列(依定義清單的順序)。 */
@ObjectType("ScheduleRule")
export class ScheduleRuleModel {
  @Field(() => ID)
  key!: string;

  /** `rule` / `autoRun`(自動排班條件,整組繼承) */
  @Field(() => String)
  group!: string;

  /** `amount` / `dayRange` / `weekTemplate` / `grace` / `breakTiers` / `defaultTasks` / `none` */
  @Field(() => String)
  valueType!: string;

  /** `day` / `person` / `hour` / `minute`;沒有單位為 null */
  @Field(() => String, { nullable: true })
  unit!: string | null;

  /** 這條規則有沒有等級(限制 / 提醒) */
  @Field(() => Boolean)
  hasLevel!: boolean;

  @Field(() => ScheduleRuleSettingModel)
  effective!: ScheduleRuleSettingModel;

  /** 本層自訂時,上層的生效值(「上層:8 天」);沒有自訂為 null */
  @Field(() => ScheduleRuleSettingModel, { nullable: true })
  parent!: ScheduleRuleSettingModel | null;
}

/** 規則頁:某個組織的整份規則。 */
@ObjectType("ScheduleRulesPayload")
export class ScheduleRulesPayload {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 這個組織是最上層組織(它的規則是各分店沿用的預設值) */
  @Field(() => Boolean)
  isTenantTop!: boolean;

  /** 操作者能不能改這個組織的規則(最上層組織看 `edit-default-rules`、其他看 `edit-org-rules`) */
  @Field(() => Boolean)
  canEdit!: boolean;

  @Field(() => [ScheduleRuleModel])
  items!: ScheduleRuleModel[];
}

/** 自訂 / 還原後回傳整份規則(一條自訂會影響自動排班條件整組的顯示)。 */
@ObjectType("ScheduleRuleMutationPayload")
export class ScheduleRuleMutationPayload {
  @Field(() => ScheduleRulesPayload)
  rules!: ScheduleRulesPayload;
}
