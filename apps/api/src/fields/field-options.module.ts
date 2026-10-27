import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { FieldOptionsService } from "./field-options.service";

/**
 * 業務功能用的欄位管理選項與原因檢查(`FieldOptionsService`)。獨立於欄位管理本身的 `FieldsModule`
 * (那個帶管理畫面的 resolver 與 `OrgsModule`),任何業務模組 import 這個即可。
 */
@Module({
  imports: [DatabaseModule],
  providers: [FieldOptionsService],
  exports: [FieldOptionsService],
})
export class FieldOptionsModule {}
