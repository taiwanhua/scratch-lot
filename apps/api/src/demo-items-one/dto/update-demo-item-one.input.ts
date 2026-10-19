import { Field, ID, InputType } from "@nestjs/graphql";

import { DemoItemOneStatusEnum } from "../models/demo-item-one.model";
import { DemoItemOneAttachmentInput } from "./demo-item-one-attachment.input";

/**
 * 編輯示範項目(需 `demo.sub.sample-one.edit`)。
 *
 * 缺席 / `null` 語意(GQL-06,逐欄同 `updateOrg.logoPath` 的先例):
 * **缺席 = 不動、`null` = 清空**(落庫 `$unset`);`name` 與 `status` 沒有「清空」可言,
 * 送 `null` 視同缺席。前端的 mutation 只放使用者碰過的欄位。
 *
 * `internalNote` 是欄位級權限欄:**只要欄位出現**(含 `null` 的清空)就需要
 * `demo.sub.sample-one.edit-internal-note`,否則 `FORBIDDEN`(reason `FIELD_FORBIDDEN`)。
 */
@InputType()
export class UpdateDemoItemOneInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => String, { nullable: true })
  category?: string | null;

  @Field(() => DemoItemOneStatusEnum, { nullable: true })
  status?: DemoItemOneStatusEnum | null;

  @Field(() => String, { nullable: true })
  note?: string | null;

  @Field(() => String, { nullable: true })
  internalNote?: string | null;

  @Field(() => ID, { nullable: true })
  coverPath?: string | null;

  /** 附件:缺席 = 不動、`null` = 清空(路徑與中繼資料四欄一起 `$unset`)、有值 = 換檔。 */
  @Field(() => DemoItemOneAttachmentInput, { nullable: true })
  attachment?: DemoItemOneAttachmentInput | null;
}
