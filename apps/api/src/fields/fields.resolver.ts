import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { RequirePermission } from "../permission/require-permission.decorator";
import { CreateFieldInput } from "./dto/create-field.input";
import { SetFieldColorInput } from "./dto/set-field-color.input";
import { SetFieldEnabledInput } from "./dto/set-field-enabled.input";
import { UpdateFieldInput } from "./dto/update-field.input";
import { FieldsService } from "./fields.service";
import { FieldPayload, FieldsPayload } from "./models/field-payloads.model";
import { FieldModel } from "./models/field.model";

/**
 * 欄位管理的 GraphQL 端點(形式 GQL-02 / GQL-03、錯誤 GQL-04)。
 * resolver 只做「守門 + 轉呼叫」,合併範圍與種子保護全在 service(STRUCT-01);
 * 每個 key 對應 field-manager.md 權限表的同一行。類別清單與類別作業在 `field-categories.resolver.ts`。
 */
@Resolver(() => FieldModel)
export class FieldsResolver {
  constructor(private readonly service: FieldsService) {}

  @RequirePermission("system.field-manager.view")
  @Query(() => FieldsPayload, { name: "fields" })
  fields(
    @Args("categoryId", { type: () => ID }) categoryId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FieldsPayload> {
    return this.service.listFields(operator, categoryId);
  }

  @RequirePermission("system.field-manager.create")
  @Mutation(() => FieldPayload)
  async createField(
    @Args("input") input: CreateFieldInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FieldPayload> {
    return { field: await this.service.create(operator, input) };
  }

  @RequirePermission("system.field-manager.edit")
  @Mutation(() => FieldPayload)
  async updateField(
    @Args("input") input: UpdateFieldInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FieldPayload> {
    return { field: await this.service.update(operator, input) };
  }

  @RequirePermission("system.field-manager.toggle-enabled")
  @Mutation(() => FieldPayload)
  async setFieldEnabled(
    @Args("input") input: SetFieldEnabledInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FieldPayload> {
    return { field: await this.service.setEnabled(operator, input) };
  }

  /** 顏色在欄位管理頁的選項表上,綁 `edit`;誰能改同停用 / 啟用(service 檢查)。 */
  @RequirePermission("system.field-manager.edit")
  @Mutation(() => FieldPayload)
  async setFieldColor(
    @Args("input") input: SetFieldColorInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<FieldPayload> {
    return { field: await this.service.setColor(operator, input) };
  }
}
