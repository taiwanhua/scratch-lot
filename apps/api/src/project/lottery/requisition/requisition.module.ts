import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../../database/database.module";
import { LotteryTicketsModule } from "../tickets/tickets.module";
import { RequisitionQueryService } from "./requisition-query.service";
import { RequisitionReference } from "./requisition-reference";
import { RequisitionRegistrations } from "./requisition-registrations";
import { RequisitionResolver } from "./requisition.resolver";

/**
 * 叫貨單(`purchasing.requisition`,專案規格 8.1;正本 `docs/modules/project/purchasing.md`):
 * 新增頁的遊戲清單、採購清單、衍生狀態的讀取;遊戲引用檢查與在途來源的登記;
 * 匯出引用介面 `RequisitionReference` 給進貨單(P18)、調貨單(P19)。
 * 表單的掛接點登記在 `project/form-lifecycles.ts`(`requisition-lifecycle.ts`)。
 */
@Module({
  imports: [DatabaseModule, LotteryTicketsModule],
  providers: [
    RequisitionQueryService,
    RequisitionResolver,
    RequisitionRegistrations,
    RequisitionReference,
  ],
  exports: [RequisitionReference],
})
export class LotteryRequisitionModule {}
