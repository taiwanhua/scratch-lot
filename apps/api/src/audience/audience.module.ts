import { Module } from "@nestjs/common";

import { RolesModule } from "../roles/roles.module";
import { AudienceCoreModule } from "./audience-core.module";
import { AudienceResolver } from "./audience.resolver";

/**
 * 人員條件的 API 功能(格式正本 `@repo/domain/audience`):
 * `audiencePermissionOptions` 給 AudiencePicker 的權限樹(沿用 `RolesModule` 匯出的權限矩陣顯示樹)。
 * 判斷 / 列出的 `AudienceService` 在 `AudienceCoreModule`,使用處匯入那一個。
 */
@Module({
  imports: [AudienceCoreModule, RolesModule],
  providers: [AudienceResolver],
  exports: [AudienceCoreModule],
})
export class AudienceModule {}
