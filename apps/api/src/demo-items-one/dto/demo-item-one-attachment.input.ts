import { Field, ID, InputType, Int } from "@nestjs/graphql";

/**
 * 附件:上傳票的物件路徑 + 前端選檔時就知道的原始檔名 / 大小 / 檔型。
 *
 * - `path`:`createUploadUrl`(purpose `DEMO_ATTACHMENT`)回的 `objectPath`;
 *   **只有它過 `isOwnedUploadPath`**(是不是本 API 簽出來的路徑)。
 * - `name` / `size` / `contentType`:前端的 `File.name` / `File.size` / `File.type`,
 *   原樣存、原樣回。api 只驗形狀(檔名非空且不超過 255 字、大小在 `DEMO_ATTACHMENT` 上限內、
 *   檔型在白名單內),不驗「與 bucket 裡那個物件是否一致」—— 它們是顯示用的中繼資料。
 *
 * 四個欄位都必填:沒有「只換檔名」這回事,換檔就整組一起送。
 */
@InputType()
export class DemoItemOneAttachmentInput {
  @Field(() => ID)
  path!: string;

  @Field(() => String)
  name!: string;

  @Field(() => Int)
  size!: number;

  @Field(() => String)
  contentType!: string;
}
