import { Field, ID, InputType, Int } from "@nestjs/graphql";

/** 清單分頁預設值(治理模組的表格;上限防呆用,不做設定)。 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * 角色清單的查詢條件。範圍固定 =「擁有組織在操作者**管理範圍**內」
 * (CONTEXT.md「管理範圍」、ADR-0005 的分工表);`ownerOrgId` 是在那個範圍**之內**
 * 再收窄的篩選條件,不是放寬範圍的手段。
 */
@InputType()
export class RolesInput {
  /**
   * 擁有組織篩選:**只比對擁有組織本身,不含子樹** —
   * 角色的管轄邊界就是它的擁有組織,「這個組織底下的角色」在語意上就是擁有組織等於它的那些。
   * 缺席 / `null` = 不篩(整個管理範圍);管理範圍外的組織 id 回空清單(不透露該組織存在)。
   */
  @Field(() => ID, { nullable: true })
  ownerOrgId?: string;

  /** 第幾頁,1 起算。 */
  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;

  /** 關鍵字:比對名稱 / 描述(不分大小寫的部分比對)。 */
  @Field(() => String, { nullable: true })
  keyword?: string;
}
