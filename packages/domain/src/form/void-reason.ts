/**
 * 欄位管理「原因」類別共通的「其他」選項值:選它時說明必填(底座 `FieldOptionsService.assertReason`;
 * 補印原因的 `REPRINT_REASON_OTHER` 同值)。
 */
export const REASON_OPTION_OTHER = "other";

/**
 * 作廢原因(表單設定 `voidReasonCategoryKey` 指到的欄位管理類別)的「其他」= `REASON_OPTION_OTHER`。
 */
export const VOID_REASON_OTHER = REASON_OPTION_OTHER;

/**
 * 底座內建的「作廢原因」欄位管理類別 key(`apps/db-migrator/seeds/base/field-categories.ts` 種下;
 * 選項:輸入錯誤 / 重複建立 / 交易取消 / 其他)。各模組的表單要共用同一組作廢原因時,`voidReasonCategoryKey` 指到它;
 * 要另一組原因就自己宣告類別。
 */
export const VOID_REASON_CATEGORY_KEY = "void-reason";
