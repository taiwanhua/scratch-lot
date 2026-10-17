import { Field, ID, InputType } from "@nestjs/graphql";

import { GraphQLJSONObject } from "../json-object.scalar";
import { DataScopeCombineOpEnum } from "../models/data-scope.model";

/**
 * 儲存某資料目標的規則(ADR-0008;**整份覆蓋** — 送出的就是之後生效的全部)。
 * `rules` 為空陣列 = 這個目標沒有任何規則,查詢只剩租戶保底(等於「刪規則」)。
 */
@InputType()
export class DataScopeRuleEntryInput {
  /**
   * 套用對象 = 人員條件(JSON;`{ mode: "all" }` 或 `{ mode: "match", filter }`,形狀正本
   * `@repo/domain/audience`)。不合法 → `RULE_INVALID` + `reason AUDIENCE_INVALID`,
   * `path` 指到出錯的條件列(如 `rules[0].audience.filter.children[1].field`)。
   */
  @Field(() => GraphQLJSONObject)
  audience!: Record<string, unknown>;

  /**
   * 巢狀條件樹(JSON;形狀與存進 `data_scope_rules` 的完全一致,見 `data-scope-rule.ts`)。
   * 欄位 / 運算子 / 值來源三者的相符檢查在 service,錯誤以 `RULE_INVALID` 附 `path` 回報。
   */
  @Field(() => GraphQLJSONObject)
  filter!: Record<string, unknown>;
}

@InputType()
export class SaveDataScopeRuleInput {
  /** 資料目標的 id(`DataScopeTarget.id`,一個模組一個);不在 `data_scope_targets` → `NOT_FOUND`。 */
  @Field(() => ID)
  targetId!: string;

  @Field(() => DataScopeCombineOpEnum, {
    defaultValue: DataScopeCombineOpEnum.OR,
  })
  combineOp!: DataScopeCombineOpEnum;

  @Field(() => [DataScopeRuleEntryInput])
  rules!: DataScopeRuleEntryInput[];
}
