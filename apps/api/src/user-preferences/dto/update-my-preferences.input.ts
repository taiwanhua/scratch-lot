import { Field, InputType } from "@nestjs/graphql";

import { GraphQLJSONObject } from "../../data-scope/json-object.scalar";

/**
 * 只放要改的 key:沒出現的 key 不動;值 `null` = 拿掉、回到預設。
 * 任何一個 key 沒登記或值不合型別,整筆不寫(`VALIDATION_FAILED` + `reason` / `key`)。
 */
@InputType()
export class UpdateMyPreferencesInput {
  @Field(() => GraphQLJSONObject)
  settings!: Record<string, unknown>;
}
