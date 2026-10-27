/**
 * 經銷商管理的模組 key 與權限 key(正本 `docs/modules/project/dealers.md` 權限表;seed 正本
 * `apps/db-migrator/seeds/project/dealers.ts`,admin 不能 import db-migrator,STRUCT-01)。
 *
 * 本模組沒有 `view` 權限:進得去哪一頁看 `me.modules`;頁內按鈕看權限集,逐筆的 [編輯] 看 api 的 `abilities`。
 */
export const DEALERS_KEY = "dealers";
export const DEALERS_CONTACTS_KEY = `${DEALERS_KEY}.contacts`;

export const DEALERS_MODULE_KEYS = {
  list: DEALERS_KEY,
  viewPage: `${DEALERS_KEY}.view-page`,
  createPage: `${DEALERS_KEY}.create-page`,
  editPage: `${DEALERS_KEY}.edit-page`,
  contacts: DEALERS_CONTACTS_KEY,
  contactViewPage: `${DEALERS_CONTACTS_KEY}.view-page`,
  contactCreatePage: `${DEALERS_CONTACTS_KEY}.create-page`,
  contactEditPage: `${DEALERS_CONTACTS_KEY}.edit-page`,
} as const;

export const DEALERS_PERMISSIONS = {
  create: `${DEALERS_KEY}.create`,
  edit: `${DEALERS_KEY}.edit`,
  showLastPurchaseBaseDate: `${DEALERS_KEY}.show-last-purchase-base-date`,
  editLastPurchaseBaseDate: `${DEALERS_KEY}.edit-last-purchase-base-date`,
  showLastSelfPurchaseBaseDate: `${DEALERS_KEY}.show-last-self-purchase-base-date`,
  editLastSelfPurchaseBaseDate: `${DEALERS_KEY}.edit-last-self-purchase-base-date`,
  contactsCreate: `${DEALERS_CONTACTS_KEY}.create`,
  contactsEdit: `${DEALERS_CONTACTS_KEY}.edit`,
} as const;

/** 列表分頁(`?tab=`)。 */
export const DEALERS_TABS = {
  classA: "class-a",
  classB: "class-b",
  contacts: "contacts",
} as const;

/** 列表每頁筆數(api 上限 100)。 */
export const DEALERS_PAGE_SIZE = 20;

/** 距批購 N 天的兩級標籤(規格 5.2):超過 150 天警告、超過 180 天錯誤。 */
export const PURCHASE_WARNING_DAYS = 150;
export const PURCHASE_OVERDUE_DAYS = 180;

/** 乙類的共同銷售人超過幾位紅字(只警告)。 */
export const CO_SELLER_WARNING_OVER = 6;

/** 區塊收合記憶的頁面 id(`components/base/Section`)。 */
export const SECTION_PAGE_IDS = {
  dealerCreate: `${DEALERS_KEY}.create`,
  dealerEdit: `${DEALERS_KEY}.edit`,
  dealerDetail: `${DEALERS_KEY}.detail`,
  contactCreate: `${DEALERS_CONTACTS_KEY}.create`,
  contactEdit: `${DEALERS_CONTACTS_KEY}.edit`,
  contactDetail: `${DEALERS_CONTACTS_KEY}.detail`,
} as const;
