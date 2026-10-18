import { Field, ID, InputType } from "@nestjs/graphql";

/**
 * 編輯組織:名稱、描述、商標,以及租戶頂層的短碼(`slug`,只有根組織的操作者能改)。
 * 擁有者(`ownerUserId`)與可見範圍開關(`settings.visibility`)是租戶作業的欄位,
 * **刻意不在這個 input 裡** — 拿 `system.org-manager.edit` 也動不到這兩者。
 * 未給的欄位不動;明確給 null 代表清空(描述 / 商標)。
 */
@InputType()
export class UpdateOrgInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => String, { nullable: true })
  description?: string | null;

  /** `createUploadUrl` 發出的物件路徑;非本 API 簽出來的路徑一律 `VALIDATION_FAILED`(ADR-0010)。 */
  @Field(() => String, { nullable: true })
  logoPath?: string | null;

  /**
   * 租戶短碼:**只有租戶頂層有**、**只有根組織的操作者能改**(其餘 `FORBIDDEN`);
   * 未給或 null = 不動(短碼不可清空)。格式不符 / 不是租戶頂層 / 已被用 → `VALIDATION_FAILED`
   * (`extensions.fields = ["slug"]`)。
   */
  @Field(() => String, { nullable: true })
  slug?: string | null;
}
