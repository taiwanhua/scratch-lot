import { Field, InputType } from "@nestjs/graphql";

import { ShareOrgInput } from "../../sharing/share-org.model";

/**
 * 新增示範項目(權限 `demo.sample-two.create`)。
 *
 * `orgId` 不由呼叫端給 —— 一律是操作者的**當前組織**(BaseRepository 自動寫入,ADR-0005);
 * `enabled` 不由呼叫端給 —— 新資料一律啟用,要停用走 `setDemoItemTwoEnabled`。
 */
@InputType()
export class CreateDemoItemTwoInput {
  /** 名稱(必填,去頭尾空白後不得為空 → `VALIDATION_FAILED`,fields: ["name"])。 */
  @Field(() => String)
  name!: string;

  /** 備註;缺席 / null 都是「沒有備註」(建立時兩者無差別,GQL-06)。 */
  @Field(() => String, { nullable: true })
  note?: string | null;

  /**
   * 共用給(ADR-0014);缺席 / null = 用預設(不共用)。要有 `demo.sample-two.edit` 才能給非空清單
   * (沒有 → `FORBIDDEN`);組織不在同租戶 → `VALIDATION_FAILED`(fields: ["shareOrgs"])。
   */
  @Field(() => [ShareOrgInput], { nullable: true })
  shareOrgs?: ShareOrgInput[] | null;
}
