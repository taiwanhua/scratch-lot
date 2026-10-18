import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { StorageModule } from "../storage/storage.module";
import { DemoCategoryService } from "./demo-category.service";
import { DemoItemsOneResolver } from "./demo-items-one.resolver";
import { DemoItemsOneService } from "./demo-items-one.service";

/**
 * 示範模組1(`demo.sub.sample-one`;技術文件 `docs/modules/demo.sub.sample-one.md`)。
 * 需要資料層與檔案儲存(封面公開 / 附件私有,ADR-0010);
 * 稽核與權限解析分別由 @Global 的 AuditModule / PermissionModule 提供。
 */
@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [DemoCategoryService, DemoItemsOneService, DemoItemsOneResolver],
  exports: [DemoItemsOneService],
})
export class DemoItemsOneModule {}
