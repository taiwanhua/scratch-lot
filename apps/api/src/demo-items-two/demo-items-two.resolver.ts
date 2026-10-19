import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { RequirePermission } from "../permission/require-permission.decorator";
import { DemoItemsTwoService } from "./demo-items-two.service";
import { CreateDemoItemTwoInput } from "./dto/create-demo-item-two.input";
import { DeleteDemoItemTwoInput } from "./dto/delete-demo-item-two.input";
import { DemoItemsTwoInput } from "./dto/demo-items-two.input";
import { SetDemoItemTwoEnabledInput } from "./dto/set-demo-item-two-enabled.input";
import { UpdateDemoItemTwoInput } from "./dto/update-demo-item-two.input";
import {
  DeleteDemoItemTwoPayload,
  DemoItemTwoPayload,
  DemoItemsTwoPayload,
} from "./models/demo-item-two-payloads.model";
import { DemoItemTwoModel } from "./models/demo-item-two.model";

/**
 * 示範模組2 的 GraphQL 端點(形式 GQL-02 / GQL-03、錯誤 GQL-04)。
 * resolver 只做「守門 + 轉呼叫」,規則全在 service(STRUCT-01);
 * 每個 key 對應 `docs/modules/demo.sample-two.md` 權限表的同一行。
 *
 * **六個端點只用到四個權限 key**:`setDemoItemTwoEnabled` 與 `updateDemoItemTwo` 同守 `edit`
 * ——「權限與端點不必一一對應」本身就是示範(同理示範模組1 的 `delete` 沒有自己的頁)。
 */
@Resolver(() => DemoItemTwoModel)
export class DemoItemsTwoResolver {
  constructor(private readonly service: DemoItemsTwoService) {}

  @RequirePermission("demo.sample-two.view")
  @Query(() => DemoItemsTwoPayload, { name: "demoItemsTwo" })
  demoItemsTwo(
    @Args("input") input: DemoItemsTwoInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemsTwoPayload> {
    return this.service.list(operator, input);
  }

  @RequirePermission("demo.sample-two.view")
  @Query(() => DemoItemTwoPayload, { name: "demoItemTwo" })
  async demoItemTwo(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemTwoPayload> {
    return { item: await this.service.findOne(operator, id) };
  }

  @RequirePermission("demo.sample-two.create")
  @Mutation(() => DemoItemTwoPayload)
  async createDemoItemTwo(
    @Args("input") input: CreateDemoItemTwoInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemTwoPayload> {
    return { item: await this.service.create(operator, input) };
  }

  @RequirePermission("demo.sample-two.edit")
  @Mutation(() => DemoItemTwoPayload)
  async updateDemoItemTwo(
    @Args("input") input: UpdateDemoItemTwoInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemTwoPayload> {
    return { item: await this.service.update(operator, input) };
  }

  @RequirePermission("demo.sample-two.delete")
  @Mutation(() => DeleteDemoItemTwoPayload)
  deleteDemoItemTwo(
    @Args("input") input: DeleteDemoItemTwoInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteDemoItemTwoPayload> {
    return this.service.remove(operator, input);
  }

  @RequirePermission("demo.sample-two.edit")
  @Mutation(() => DemoItemTwoPayload)
  async setDemoItemTwoEnabled(
    @Args("input") input: SetDemoItemTwoEnabledInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemTwoPayload> {
    return { item: await this.service.setEnabled(operator, input) };
  }
}
