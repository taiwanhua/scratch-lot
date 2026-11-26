import type {
  MoveLotteryTicketsByCountMutationVariables,
  MoveLotteryTicketsMutationVariables,
  RecallLotteryTicketsMutationVariables,
  SellLotteryTicketsByCountMutationVariables,
  SellLotteryTicketsMutationVariables,
  SplitLotteryBookMutationVariables,
  UndoLotteryCountSaleMutationVariables,
  UndoLotteryTicketSaleMutationVariables,
} from "@repo/graphql";

import type { server } from "../../server";
import type { StoreBoard } from "./store-fixtures";

/** 店面銷售假 api 的型別(`storeSalesWorld` 在 `./store-sales-handlers`)。 */
export interface StoreSalesWorld {
  handlers: Parameters<typeof server.use>;
  inputs: {
    sell: SellLotteryTicketsMutationVariables["input"][];
    undo: UndoLotteryTicketSaleMutationVariables["input"][];
    split: SplitLotteryBookMutationVariables["input"][];
    move: MoveLotteryTicketsMutationVariables["input"][];
    recall: RecallLotteryTicketsMutationVariables["input"][];
    moveByCount: MoveLotteryTicketsByCountMutationVariables["input"][];
    countSale: SellLotteryTicketsByCountMutationVariables["input"][];
    undoCount: UndoLotteryCountSaleMutationVariables["input"][];
  };
}

export interface StoreSalesWorldOptions {
  /** 看板的狀態(`storeWorld(...).state`;售出 / 撤銷時跟著改) */
  board: StoreBoard;
  /** 下一次售出直接回「已於 hh:mm 售出」(同時兩人賣同一張的失敗方) */
  alreadySoldAt?: string;
  /** 這幾張是遺失(展開卡片選它 → [尋回]) */
  lostTicketIds?: readonly string[];
  /** 這幾張是已售·未對號(張數店;依張數賣時系統預設帶入的張號) */
  unmatchedSoldTicketIds?: readonly string[];
  /** 這幾張是期初已售(導入前已賣出;刷到擋下、提示用期初更正) */
  openingSoldTicketIds?: readonly string[];
  /** 這幾張被批售單 W-0001 鎖住(批售中) */
  wholesalingTicketIds?: readonly string[];
}
