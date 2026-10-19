import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { RequirePermission } from "../permission/require-permission.decorator";
import { DataScopeService } from "./data-scope.service";
import { SaveDataScopeRuleInput } from "./dto/save-data-scope-rule.input";
import {
  DataScopeRulePayload,
  DataScopeTargetModel,
  DataScopeTargetsPayload,
  SaveDataScopeRulePayload,
} from "./models/data-scope.model";

/**
 * 資料範圍的 GraphQL 端點(形式 GQL-02 / GQL-03、錯誤 GQL-04)。
 * resolver 只做「守門 + 轉呼叫」,規則與範圍全在 service(STRUCT-01);
 * 每個 key 對應 `docs/modules/data-scope.md` 權限表的同一行。
 * 模組本身是**根組織專屬**(`isRootOnly`),站在租戶裡即使持有權限也被 service 擋下(`FORBIDDEN`)。
 */
@Resolver(() => DataScopeTargetModel)
export class DataScopeResolver {
  constructor(private readonly service: DataScopeService) {}

  @RequirePermission("system.data-scope.view")
  @Query(() => DataScopeTargetsPayload, { name: "dataScopeTargets" })
  async dataScopeTargets(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DataScopeTargetsPayload> {
    return { targets: await this.service.listTargets(operator) };
  }

  /** `rule` 為 `null` = 這個目標尚無規則(查詢只受租戶保底;ADR-0008)。 */
  @RequirePermission("system.data-scope.view")
  @Query(() => DataScopeRulePayload, { name: "dataScopeRule" })
  async dataScopeRule(
    @Args("targetId", { type: () => ID }) targetId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DataScopeRulePayload> {
    return { rule: await this.service.findRule(operator, targetId) };
  }

  /** 整份覆蓋;不合法 → `RULE_INVALID`(附 `path` 與 `reason`)。 */
  @RequirePermission("system.data-scope.edit")
  @Mutation(() => SaveDataScopeRulePayload)
  async saveDataScopeRule(
    @Args("input") input: SaveDataScopeRuleInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SaveDataScopeRulePayload> {
    return { rule: await this.service.saveRule(operator, input) };
  }
}
