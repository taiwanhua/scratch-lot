import { Field, InputType } from "@nestjs/graphql";

/**
 * 開通租戶(ADR-0009 四步 + 擁有者 + 啟用信;根組織專屬)。
 * 表單欄位正本:docs/modules/org-manager.md「開通租戶」— 租戶名稱、首任管理員的帳號與 Email、
 * 商標(選填)、開放模組勾選。首任管理員**不設初始密碼**,由啟用信自行設定(根組織不經手租戶密碼)。
 */
@InputType()
export class ProvisionTenantInput {
  /** 租戶名稱 = 租戶頂層組織的名稱。 */
  @Field(() => String)
  name!: string;

  /**
   * 租戶短碼(`orgs.slug`):`^[a-z][a-z0-9_]{1,19}$`、全域唯一;格式不符或已被用 →
   * `VALIDATION_FAILED`(`extensions.fields = ["slug"]`)。客製表單 key 的預設後綴。
   */
  @Field(() => String)
  slug!: string;

  /** 首任管理員帳號(前端預設帶入 Email、可改);在 `users` 內唯一(ADR-0003)。 */
  @Field(() => String)
  adminAccount!: string;

  /** 首任管理員 Email(啟用信寄到這裡);在 `users` 內唯一。 */
  @Field(() => String)
  adminEmail!: string;

  /** `createUploadUrl` 發出的物件路徑;非本 API 簽出來的路徑一律 `VALIDATION_FAILED`(ADR-0010)。 */
  @Field(() => String, { nullable: true })
  logoPath?: string | null;

  /**
   * 開放給這個租戶的模組 key:必須落在 `tenantModuleOptions` 內(= 租戶管理員模板綁的模組),
   * 否則 `VALIDATION_FAILED` — 根組織專屬模組不在選項內,勾了就是被這一條擋下。
   * 至少要勾一個(一個模組都沒有的租戶管理員進不了任何頁面)。
   */
  @Field(() => [String])
  moduleKeys!: string[];

  /**
   * 開通成**示範機構**(`orgs.isDemo = true`;只有示範指令會送,`docs/deployment.md`「示範資料(demo)」)。
   * 標記只在開通時設定,之後沒有端點改得了它。預設 false = 一般租戶。
   */
  @Field(() => Boolean, { nullable: true, defaultValue: false })
  demo?: boolean | null;

  /**
   * 示範機構首任管理員的密碼(示範指令從終端機或 Secret 取得後送來,只存雜湊、不進稽核)。
   * **只有 `demo: true` 可以給,而且必填**:一般租戶的首任管理員仍由啟用信自行設定,根組織不經手租戶密碼;
   * 示範機構不寄啟用信、首登不強改(開通腳本接著就要以這位管理員登入)。違反 → `VALIDATION_FAILED`
   * (`extensions.fields = ["adminInitialPassword"]`);密碼不合規則同 `createUser`。
   */
  @Field(() => String, { nullable: true })
  adminInitialPassword?: string | null;
}
