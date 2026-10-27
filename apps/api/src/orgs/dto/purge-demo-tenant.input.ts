import { Field, InputType } from "@nestjs/graphql";

/**
 * 清空示範機構(根組織專屬;demo 指令 `--mode=purge` / `rebuild`):以租戶短碼找根組織底下的租戶頂層,
 * 必須標「示範」才清空(短碼由專案的示範資料決定,demo 指令帶入)。
 */
@InputType()
export class PurgeDemoTenantInput {
  /** 示範機構的租戶短碼。 */
  @Field(() => String)
  slug!: string;
}
