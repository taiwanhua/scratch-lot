import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { FieldOptionColorsResolver } from "./field-option-colors.resolver";
import { FieldOptionColorsService } from "./field-option-colors.service";

/** 欄位選項顏色(S2 專案客製,規格 18.5)。稽核由 @Global 的 AuditModule 提供。 */
@Module({
  imports: [DatabaseModule],
  providers: [FieldOptionColorsService, FieldOptionColorsResolver],
})
export class FieldOptionColorsModule {}
