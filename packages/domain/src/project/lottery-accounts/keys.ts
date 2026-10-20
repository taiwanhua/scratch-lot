/**
 * 帳戶管理(`accounts`)的模組 key 與權限 key(專案規格 3.1、3.2;權限表正本
 * `docs/modules/project/accounts.md`)。seed 宣告、api 守門、admin 判斷都引用這裡,不另寫字面值。
 */
export const ACCOUNTS_KEY = "accounts";

/** 模組樹:一頁(分頁 銀行帳戶 | 即時現金帳 | 待結清款項 | 關帳)+ 銀行帳戶詳情隱藏頁。 */
export const ACCOUNTS_MODULE_KEYS = {
  list: ACCOUNTS_KEY,
  bankAccountViewPage: `${ACCOUNTS_KEY}.view-page`,
} as const;

/** 個別權限(wildcard 由 seed 自動產生);分頁不是模組節點,以三條 `view-*` 權限決定出不出現。 */
export const ACCOUNTS_PERMISSIONS = {
  viewBankAccounts: `${ACCOUNTS_KEY}.view-bank-accounts`,
  createBankAccount: `${ACCOUNTS_KEY}.create-bank-account`,
  editBankAccount: `${ACCOUNTS_KEY}.edit-bank-account`,
  recordBankTransaction: `${ACCOUNTS_KEY}.record-bank-transaction`,
  reverseBankTransaction: `${ACCOUNTS_KEY}.reverse-bank-transaction`,
  viewCash: `${ACCOUNTS_KEY}.view-cash`,
  viewOutstanding: `${ACCOUNTS_KEY}.view-outstanding`,
  closePeriod: `${ACCOUNTS_KEY}.close-period`,
} as const;

/** 頁內分頁的值(`?tab=`);關帳分頁由關帳功能追加。 */
export const ACCOUNTS_TABS = {
  bankAccounts: "bank-accounts",
  cash: "cash",
  outstanding: "outstanding",
  close: "close",
} as const;
