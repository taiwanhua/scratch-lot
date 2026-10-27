import { Module } from "@nestjs/common";

import { FieldOptionsModule } from "../../../fields/field-options.module";
import { LotteryFieldOptionsResolver } from "./lottery-field-options.resolver";

/**
 * 刮刮樂的欄位管理下拉選項(原因類別等,專案規格第 13 章):查詢端點 `lotteryFieldOptions`。
 * 讀選項與原因檢查用底座的 `FieldOptionsService`(`optionsOf` / `assertReason`,類別白名單
 * `LOTTERY_FIELD_CATEGORIES`);其他刮刮樂功能 import 本 module 即可注入 `FieldOptionsService`。
 */
@Module({
  imports: [FieldOptionsModule],
  providers: [LotteryFieldOptionsResolver],
  exports: [FieldOptionsModule],
})
export class LotteryFieldOptionsModule {}
