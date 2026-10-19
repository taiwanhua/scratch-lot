import { Field, ID, InputType } from "@nestjs/graphql";

import { DemoItemOneStatusEnum } from "../models/demo-item-one.model";
import { DemoItemOneAttachmentInput } from "./demo-item-one-attachment.input";

/**
 * 新增示範項目(需 `demo.sub.sample-one.create`)。
 *
 * 缺席 / `null` 語意(GQL-06):**新增沒有「不動」可言**,兩者同義 = 不設這個欄位。
 * 例外只有 `internalNote`:**只要欄位出現**(含 `null`)就算「要寫內部備註」,
 * 沒有 `edit-internal-note` 即 `FORBIDDEN`(reason `FIELD_FORBIDDEN`)。
 * 組織不由前端給 —— 一律寫入操作者的**當前組織**(ADR-0005,BaseRepository 自動填)。
 */
@InputType()
export class CreateDemoItemOneInput {
  @Field(() => String)
  name!: string;

  /** 欄位管理「示範分類」的選項 value;必須在操作者的合併範圍內且 enabled。 */
  @Field(() => String, { nullable: true })
  category?: string | null;

  /** 缺席 = 用 schema 預設的「草稿」(`DRAFT`)。 */
  @Field(() => DemoItemOneStatusEnum, { nullable: true })
  status?: DemoItemOneStatusEnum | null;

  @Field(() => String, { nullable: true })
  note?: string | null;

  /** 欄位級權限:需 `demo.sub.sample-one.edit-internal-note`。 */
  @Field(() => String, { nullable: true })
  internalNote?: string | null;

  /** 封面的物件路徑(`createUploadUrl` 以 purpose `DEMO_COVER` 取得,公開 bucket)。 */
  @Field(() => ID, { nullable: true })
  coverPath?: string | null;

  /**
   * 附件(私有 bucket):`createUploadUrl` 以 purpose `DEMO_ATTACHMENT` 取得的路徑 +
   * 原始檔名 / 大小 / 檔型(形狀見 `DemoItemOneAttachmentInput`)。缺席 / `null` = 不設。
   */
  @Field(() => DemoItemOneAttachmentInput, { nullable: true })
  attachment?: DemoItemOneAttachmentInput | null;
}
