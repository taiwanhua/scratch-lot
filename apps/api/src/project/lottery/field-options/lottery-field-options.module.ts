import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { LotteryFieldOptionsResolver } from "./lottery-field-options.resolver";
import { LotteryFieldOptionsService } from "./lottery-field-options.service";

/**
 * 刮刮樂的欄位管理下拉選項(原因類別等,專案規格第 13 章):查詢端點 `lotteryFieldOptions` 與
 * 原因檢查 `LotteryFieldOptionsService.assertReason`(其他刮刮樂功能 import 本 module 使用)。
 */
@Module({
  imports: [DatabaseModule],
  providers: [LotteryFieldOptionsService, LotteryFieldOptionsResolver],
  exports: [LotteryFieldOptionsService],
})
export class LotteryFieldOptionsModule {}
