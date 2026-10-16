import { Field, ObjectType } from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../data-scope/json-object.scalar";

/** 我的個人偏好:每個登記過的 key 都有值(存過的值;沒存過 = 登記的預設值,可能是 `null` = 沒有設定)。 */
@ObjectType()
export class MyPreferencesPayload {
  @Field(() => GraphQLJSONObject)
  settings!: Record<string, unknown>;
}

/** 改完後的完整偏好(同 `myPreferences`)。 */
@ObjectType()
export class UpdateMyPreferencesPayload {
  @Field(() => GraphQLJSONObject)
  settings!: Record<string, unknown>;
}
