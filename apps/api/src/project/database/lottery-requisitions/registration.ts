import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_REQUISITION_LINES_COLLECTION,
  LotteryRequisitionLine,
  LotteryRequisitionLineSchema,
} from "./lottery-requisition-line.schema";
import { LotteryRequisitionLinesRepository } from "./lottery-requisition-lines.repository";

/** 叫貨明細副本的資料登記:一張模組資料表、一個 BaseRepository、一項組織歸屬檢查。 */
export const LOTTERY_REQUISITIONS_REGISTRATION: DatabaseRegistration = {
  key: "lottery-requisitions",
  models: [
    {
      name: LotteryRequisitionLine.name,
      collection: LOTTERY_REQUISITION_LINES_COLLECTION,
      schema: LotteryRequisitionLineSchema,
    },
  ],
  repositories: [
    {
      modelName: LotteryRequisitionLine.name,
      provider: LotteryRequisitionLinesRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "lottery-requisition-lines",
      modelName: LotteryRequisitionLine.name,
      repository: LotteryRequisitionLinesRepository,
      ownerField: "orgId",
    },
  ],
};
