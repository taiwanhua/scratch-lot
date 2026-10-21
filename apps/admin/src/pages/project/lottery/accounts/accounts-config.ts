/**
 * 帳戶管理(`accounts`)前端的常數(權限表正本 `docs/modules/project/accounts.md`)。
 * 模組 key、權限 key、分頁值與 api / seed 同一份(`@repo/domain/project/lottery-accounts`)。
 */
export {
  ACCOUNTS_MODULE_KEYS,
  ACCOUNTS_PERMISSIONS,
  ACCOUNTS_TABS,
} from "@repo/domain/project/lottery-accounts";

/** i18n namespace(`packages/i18n/messages/<語系>/project/admin.json`)。 */
export const ACCOUNTS_I18N = "admin.lotteryAccounts";

/** 銀行帳戶列表的最小寬度(STYLE-11:六欄不折行)。 */
export const BANK_ACCOUNTS_TABLE_MIN_WIDTH = 820;

/** 交易清單的最小寬度。 */
export const TRANSACTIONS_TABLE_MIN_WIDTH = 900;

/** 現金流水的最小寬度。 */
export const CASH_TABLE_MIN_WIDTH = 760;

/** 待結清款項的最小寬度。 */
export const OUTSTANDING_TABLE_MIN_WIDTH = 940;

/** 金額顯示(千分位;負數帶負號)。 */
export const moneyText = (value: number): string =>
  value.toLocaleString("en-US");
