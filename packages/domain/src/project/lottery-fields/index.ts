/**
 * `@repo/domain/project/lottery-fields`:刮刮樂用到的欄位管理類別 key 與程式要認得的選項代碼
 * (專案規格第 13 章)。類別與預設選項由 `apps/db-migrator/seeds/project/field-categories.ts` 種下;
 * api 查選項、admin 帶預設值都用這裡的常數,不另寫字面值。排班不得 import 本主題。
 */

/** 刮刮樂的欄位管理類別 key(值固定,程式一律引用這裡的常數)。 */
export const LOTTERY_FIELD_CATEGORY_KEYS = {
  /** 撤銷售出原因(撤銷售出申請) */
  saleReversalReason: "lottery-sale-reversal-reason",
  /** 撤銷兌獎原因(撤銷兌獎:已結帳或別人登記) */
  redemptionRevokeReason: "lottery-redemption-revoke-reason",
  /** 手動標記原因(手動標記售出) */
  manualSaleReason: "lottery-manual-sale-reason",
  /** 現金更正原因(現金更正單) */
  cashCorrectionReason: "lottery-cash-correction-reason",
  /** 作廢原因(所有單據作廢) */
  voidReason: "lottery-void-reason",
  /** 結帳差額原因(結帳精靈、日結) */
  checkoutDiffReason: "lottery-checkout-diff-reason",
  /** 跳過盤點原因(結帳精靈、日結) */
  skipStocktakeReason: "lottery-skip-stocktake-reason",
  /** 出庫原因(出庫) */
  withdrawReason: "lottery-withdraw-reason",
  /** 遺失原因(確認遺失) */
  lostReason: "lottery-lost-reason",
  /** 尋回原因(尋回) */
  recoverReason: "lottery-recover-reason",
  /** 報廢原因(報廢) */
  scrapReason: "lottery-scrap-reason",
  /** 更正跳號原因(更正已標註的跳號) */
  skipCorrectionReason: "lottery-skip-correction-reason",
} as const;

/** 撤銷售出原因「客人退貨」:8.5 撤銷售出申請依這個代碼帶入。 */
export const SALE_REVERSAL_CUSTOMER_RETURN = "customer-return";

/** 手動標記原因「刷不到條碼」:手動標記售出的預設選項。 */
export const MANUAL_SALE_SCAN_FAILED = "scan-failed";

/** 手動標記原因「系統異常補登」。 */
export const MANUAL_SALE_SYSTEM_BACKFILL = "system-backfill";

/** 出庫原因「開班零用金」:開班視窗從小金庫領零用金時寫入(6.2、6.6)。 */
export const WITHDRAW_OPENING_FLOAT = "opening-float";
