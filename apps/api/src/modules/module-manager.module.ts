import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { OrgsModule } from "../orgs/orgs.module";
import { ModuleManagerResolver } from "./module-manager.resolver";
import { ModuleManagerService } from "./module-manager.service";

/**
 * 模組與權限(`system.module-manager`,根組織專屬;`docs/modules/module-manager.md`):
 * 全樹查詢 + 模組 / 權限的 `enabled` 切換+ 模組側欄圖示的更換。
 *
 * 治理面,與 `permission/`(解析「我能用什麼」)刻意分開 — 兩邊對同一份資料的讀法相反
 * (一邊把 `enabled` 當過濾條件,一邊當可寫狀態),合在一起只會長出旗標參數。
 *
 * import `OrgsModule` 是為了 `OwnerProtectionService.isRootOperator`:「根組織專屬」的判斷點
 * 全站只有那一個(租戶作業、擁有者保護、租戶頂層保護都用它),不在此另寫一套。
 * AuditService 由 @Global 的 AuditModule 提供,不必在此 import。
 */
@Module({
  imports: [DatabaseModule, OrgsModule],
  providers: [ModuleManagerService, ModuleManagerResolver],
})
export class ModuleManagerModule {}
