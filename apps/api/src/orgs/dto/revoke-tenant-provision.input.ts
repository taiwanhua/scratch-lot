import { Field, ID, InputType } from "@nestjs/graphql";

/**
 * 撤銷開通(根組織專屬):把 `provisionTenant` 建出來的三樣反向抹掉 —
 * 租戶頂層組織、首任管理員(擁有者)、租戶管理員角色副本。
 *
 * 只給「開錯了、還沒有人用」的租戶用:前置檢查與刪除同一組
 * (`OrgsService.orgContentReasons`),不過就回 `PROVISION_NOT_REVOKABLE` 附 reasons。
 */
@InputType()
export class RevokeTenantProvisionInput {
  /** 要撤銷的租戶頂層組織;不是租戶頂層一律 `VALIDATION_FAILED`。 */
  @Field(() => ID)
  orgId!: string;
}
