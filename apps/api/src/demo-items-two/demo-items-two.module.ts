import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { DemoItemsTwoResolver } from "./demo-items-two.resolver";
import { DemoItemsTwoService } from "./demo-items-two.service";

/**
 * 示範模組2(`demo.sample-two`):示範家族的對照組。
 * 只需要資料層;稽核與權限解析分別由 @Global 的 AuditModule / PermissionModule 提供。
 */
@Module({
  imports: [DatabaseModule],
  providers: [DemoItemsTwoService, DemoItemsTwoResolver],
  exports: [DemoItemsTwoService],
})
export class DemoItemsTwoModule {}
