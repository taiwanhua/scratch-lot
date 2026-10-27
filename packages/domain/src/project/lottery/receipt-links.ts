import { ACCOUNTS_MODULE_KEYS } from "../lottery-accounts/keys";
import { PURCHASE_MODULE_KEY } from "./purchase";
import { STORE_MODULE_KEYS } from "./store";
import { TRANSFER_MODULE_KEY } from "./transfer";

/**
 * 58mm 單據底部 QR code 連到的頁面(專案規格第 12 章):模組 key。
 * 路由由 api 依模組樹組出(`lotteryReceiptLinks`),**不依印單的人的權限** —— 店員印投庫單時沒有帳戶管理,
 * 但掃 QR 的店長有;前端的 `me.modules` 已依權限過濾,不能用來組這個連結。
 */
export const RECEIPT_LINK_MODULE_KEYS = {
  /** 即時現金帳(帳戶管理;`?tab=cash&movementId=` 標亮那一筆):投庫單、出庫單、存款單 */
  cashLedger: ACCOUNTS_MODULE_KEYS.list,
  /** 店面管理的檢視頁:交班結帳單、日結單、退貨退款收據 */
  storeView: STORE_MODULE_KEYS.viewPage,
  /** 進貨單的檢視頁:進貨點收單 */
  purchaseView: `${PURCHASE_MODULE_KEY}.view-page`,
  /** 調貨單的檢視頁:調貨出貨單、調貨點收單、調貨付款收據 */
  transferView: `${TRANSFER_MODULE_KEY}.view-page`,
} as const;

export type ReceiptLinkKind = keyof typeof RECEIPT_LINK_MODULE_KEYS;
