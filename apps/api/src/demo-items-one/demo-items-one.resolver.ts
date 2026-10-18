import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { RequirePermission } from "../permission/require-permission.decorator";
import { SAMPLE_ONE_PERMISSIONS } from "./demo-item-one-mapper";
import { DemoItemsOneService } from "./demo-items-one.service";
import { CreateDemoItemOneInput } from "./dto/create-demo-item-one.input";
import { DeleteDemoItemOneInput } from "./dto/delete-demo-item-one.input";
import { DemoItemsOneInput } from "./dto/demo-items-one.input";
import { SetDemoItemOneEnabledInput } from "./dto/set-demo-item-one-enabled.input";
import { UpdateDemoItemOneInput } from "./dto/update-demo-item-one.input";
import {
  DeleteDemoItemOnePayload,
  DemoItemOneAttachmentUrlPayload,
  DemoItemOneHistoryPayload,
  DemoItemOnePayload,
  DemoItemsOnePayload,
} from "./models/demo-item-one-payloads.model";
import { DemoItemOneModel } from "./models/demo-item-one.model";

/**
 * 示範模組1 的 GraphQL 端點(形式 GQL-02 / GQL-03、錯誤 GQL-04)。
 * resolver 只做「守門 + 轉呼叫」,規則全在 service(STRUCT-01);
 * 每個 key 對應 `docs/modules/demo.sub.sample-one.md` 權限表的同一行。
 *
 * **欄位級與頁面自有權限不在這裡守**:`show-internal-note` 是投影(service 決定放不放這個欄位)、
 * `edit-internal-note` 是寫入守門(service 依 input 有沒有那個欄位判斷),
 * 兩者都不是「整個端點能不能用」,所以不能寫成 `@RequirePermission`(ADR-0004)。
 */
@Resolver(() => DemoItemOneModel)
export class DemoItemsOneResolver {
  constructor(private readonly service: DemoItemsOneService) {}

  @RequirePermission(SAMPLE_ONE_PERMISSIONS.view)
  @Query(() => DemoItemsOnePayload, { name: "demoItemsOne" })
  demoItemsOne(
    @Args("input") input: DemoItemsOneInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemsOnePayload> {
    return this.service.list(operator, input);
  }

  @RequirePermission(SAMPLE_ONE_PERMISSIONS.view)
  @Query(() => DemoItemOnePayload, { name: "demoItemOne" })
  async demoItemOne(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemOnePayload> {
    return { item: await this.service.findOne(operator, id) };
  }

  /** 變更歷程區塊(編輯頁自有權限,ADR-0004);與「能不能編輯」互相獨立。 */
  @RequirePermission(SAMPLE_ONE_PERMISSIONS.showHistory)
  @Query(() => DemoItemOneHistoryPayload, { name: "demoItemOneHistory" })
  demoItemOneHistory(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemOneHistoryPayload> {
    return this.service.history(operator, id);
  }

  /**
   * 私有附件的下載網址(ADR-0010);看得到這筆資料的人才拿得到(`view`)。
   * 名稱帶模組前綴(GQL-02;由 `attachmentDownloadUrl` 改名,舊名不保留)。
   */
  @RequirePermission(SAMPLE_ONE_PERMISSIONS.view)
  @Query(() => DemoItemOneAttachmentUrlPayload, {
    name: "demoItemOneAttachmentUrl",
  })
  demoItemOneAttachmentUrl(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemOneAttachmentUrlPayload> {
    return this.service.attachmentUrl(operator, id);
  }

  @RequirePermission(SAMPLE_ONE_PERMISSIONS.create)
  @Mutation(() => DemoItemOnePayload)
  async createDemoItemOne(
    @Args("input") input: CreateDemoItemOneInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemOnePayload> {
    return { item: await this.service.create(operator, input) };
  }

  @RequirePermission(SAMPLE_ONE_PERMISSIONS.edit)
  @Mutation(() => DemoItemOnePayload)
  async updateDemoItemOne(
    @Args("input") input: UpdateDemoItemOneInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemOnePayload> {
    return { item: await this.service.update(operator, input) };
  }

  @RequirePermission(SAMPLE_ONE_PERMISSIONS.delete)
  @Mutation(() => DeleteDemoItemOnePayload)
  deleteDemoItemOne(
    @Args("input") input: DeleteDemoItemOneInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteDemoItemOnePayload> {
    return this.service.remove(operator, input);
  }

  @RequirePermission(SAMPLE_ONE_PERMISSIONS.edit)
  @Mutation(() => DemoItemOnePayload)
  async setDemoItemOneEnabled(
    @Args("input") input: SetDemoItemOneEnabledInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DemoItemOnePayload> {
    return { item: await this.service.setEnabled(operator, input) };
  }
}
