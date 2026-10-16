import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { AudienceService } from "./audience.service";

/**
 * 人員條件的判斷 / 列出(`AudienceService`),不帶 GraphQL 端點:只依賴資料層與 @Global 的權限解析,
 * 所以資料範圍、受管定義 CLI(`SeedRuntimeModule`)與之後的流程 / 通知都能直接匯入,
 * 不會連帶啟動角色管理、登入線(同 `FormsCoreModule` / `WorkflowsCoreModule` 的分法)。
 */
@Module({
  imports: [DatabaseModule],
  providers: [AudienceService],
  exports: [AudienceService],
})
export class AudienceCoreModule {}
