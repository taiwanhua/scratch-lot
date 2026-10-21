import { Field, ID, InputType, ObjectType } from "@nestjs/graphql";

/**
 * 「共用給」的一筆(資料共用,ADR-0014;存檔形狀是 `shareOrgs` 的元素)。
 * 可共用的模組在自己的 model 上回 `shareOrgs: [ShareOrg!]!`,不另定同型的 type。
 */
@ObjectType("ShareOrg")
export class ShareOrgModel {
  /** 共用給的組織(同租戶;可以是自己看不到的組織)。 */
  @Field(() => ID)
  orgId!: string;

  /** 是否連它的下層一起共用。 */
  @Field(() => Boolean)
  includeDescendants!: boolean;
}

/**
 * 「共用給」欄位的輸入:整份清單一次送(空清單 = 不共用)。
 * 每個組織都要與資料同租戶,否則 `VALIDATION_FAILED`(fields: ["shareOrgs"])。
 */
@InputType("ShareOrgInput")
export class ShareOrgInput {
  @Field(() => ID)
  orgId!: string;

  /** 缺席 = 不含下層。 */
  @Field(() => Boolean, { nullable: true })
  includeDescendants?: boolean | null;
}

/** 存檔形狀 → GraphQL 形狀(id 轉字串)。 */
export function toShareOrgModels(
  shareOrgs:
    | readonly { orgId: unknown; includeDescendants: boolean }[]
    | null
    | undefined,
): ShareOrgModel[] {
  return (shareOrgs ?? []).map((entry) => ({
    orgId: String(entry.orgId),
    includeDescendants: entry.includeDescendants,
  }));
}
