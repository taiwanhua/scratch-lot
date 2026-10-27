import type { ComponentType } from "react";

import { CreatePurchaseAction } from "../purchase/CreatePurchaseAction";
import { CreateTransferAction } from "../transfer/CreateTransferAction";
import type { PurchaseList } from "./purchase-list-sheet";

/** 一張待購買的叫貨單(採購清單下半部的一列)。 */
export type PendingRequisition = PurchaseList["requisitions"][number];

/**
 * 採購清單上每張叫貨單的動作(規格 8.1:[建立進貨單](帶入)、[從其他分店調貨](開調貨單並引用))。
 * 由進貨單、調貨單的功能各自追加一列(按鈕元件自己判斷權限、自己導頁);沒有任何動作時不顯示動作欄。
 */
export interface PendingRequisitionAction {
  key: string;
  Action: ComponentType<{ requisition: PendingRequisition }>;
}

/** 進貨單 [建立進貨單]、調貨單 [從其他分店調貨]。 */
export const PENDING_REQUISITION_ACTIONS: readonly PendingRequisitionAction[] =
  [
    { key: "create-purchase", Action: CreatePurchaseAction },
    { key: "create-transfer", Action: CreateTransferAction },
  ];
