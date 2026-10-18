import { Parent, ResolveField, Resolver } from "@nestjs/graphql";

import { MeOrg } from "../auth/models/me.model";
import { StorageService } from "./storage.service";

/**
 * `me.currentOrg.logoUrl`:側欄顯示當前組織商標用。
 * 以 field resolver 掛在登入線1 的 `MeOrg` 上(先例:`permission/me-modules.resolver.ts`),
 * 登入線的 resolver 不動;`logoPath` 由 `me` 帶出來(ADR-0010:DB 存路徑不存 URL,看時現簽)。
 * 只在客戶端有問 `logoUrl` 時才簽 — 簽名在 Cloud Run 上是一次 IAM signBlob 呼叫,不白簽。
 * `me.orgs` 與 `me.currentOrg` 同型別,所以所屬組織清單也拿得到商標(側欄切換組織用得上)。
 */
@Resolver(() => MeOrg)
export class MeOrgLogoResolver {
  constructor(private readonly storage: StorageService) {}

  /** 短效簽名讀取網址(TTL `GCS_SIGNED_URL_TTL`,預設 1h);沒有商標時為 null。 */
  @ResolveField(() => String, { nullable: true })
  logoUrl(@Parent() org: MeOrg): Promise<string | null> {
    return this.storage.readUrlOf(org.logoPath);
  }
}
