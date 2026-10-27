import {
  Field,
  GraphQLISODateTime,
  ID,
  InputType,
  Int,
  ObjectType,
} from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../data-scope/json-object.scalar";

/** 通知設定頁「側欄數字」區塊的一列:一個登記了側欄數字、這個租戶有開通的模組。 */
@ObjectType("SidebarBadgeSetting")
export class SidebarBadgeSettingModel {
  @Field({ description: "模組 key" })
  moduleKey!: string;

  @Field({ description: "模組名稱;模組不存在時退回模組 key" })
  moduleName!: string;

  @Field(() => String, {
    nullable: true,
    description:
      "「數什麼」的說明文字在 admin 訊息檔的 key(登記時給);沒有 = null",
  })
  descriptionKey!: string | null;

  @Field(() => String, {
    nullable: true,
    description: "程式預設要求的權限 key(登記的 requires);沒有 = null",
  })
  requires!: string | null;

  @Field(() => GraphQLJSONObject, {
    nullable: true,
    description:
      "租戶調整過的人員條件(綁了模組之後再看它);沒調整 = null,用程式預設",
  })
  audience!: Record<string, unknown> | null;

  @Field({ description: "true = 沒有調整,用程式預設" })
  isDefault!: boolean;

  @Field(() => GraphQLISODateTime, {
    nullable: true,
    description: "最後一次調整 / 還原的時間;從沒動過 = null",
  })
  updatedAt!: Date | null;

  @Field(() => ID, { nullable: true })
  updatedBy!: string | null;
}

/** 不分頁的清單(一個租戶的登記數有限,區塊一次列完;GQL-03 不分頁的清單)。 */
@ObjectType()
export class SidebarBadgeSettingsPayload {
  @Field(() => [SidebarBadgeSettingModel])
  items!: SidebarBadgeSettingModel[];

  @Field(() => Int)
  totalCount!: number;
}

@ObjectType()
export class SidebarBadgeSettingPayload {
  @Field(() => SidebarBadgeSettingModel)
  setting!: SidebarBadgeSettingModel;
}

/**
 * 改某個模組的側欄數字「誰看得到」:`audience` 是人員條件(`@repo/domain/audience` 的形狀;
 * 不能「所有人」、只有使用者 / 角色 / 權限,使用者 / 角色須屬本租戶)。
 */
@InputType()
export class UpdateSidebarBadgeSettingInput {
  @Field()
  moduleKey!: string;

  @Field(() => GraphQLJSONObject)
  audience!: Record<string, unknown>;
}

/** 還原預設(回到程式登記的預設)。 */
@InputType()
export class ResetSidebarBadgeSettingInput {
  @Field()
  moduleKey!: string;
}
