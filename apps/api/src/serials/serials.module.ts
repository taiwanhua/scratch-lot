import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { SerialService } from "./serial.service";

/**
 * 單號(`SerialService`):要給號的功能模組(表單執行、專案的單據)匯入本 module 注入使用。
 * 沒有 resolver,不登記在 `base/api-modules.ts`。
 */
@Module({
  imports: [DatabaseModule],
  providers: [SerialService],
  exports: [SerialService],
})
export class SerialsModule {}
