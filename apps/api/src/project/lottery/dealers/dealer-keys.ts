/**
 * 經銷商管理的模組 key 與權限 key(權限表正本 `docs/modules/project/dealers.md`;seed 正本
 * `apps/db-migrator/seeds/project/dealers.ts`,api 不能 import db-migrator,兩邊各寫一份、由測試對齊)。
 */
export const DEALERS_KEY = "dealers";
export const DEALERS_CONTACTS_KEY = `${DEALERS_KEY}.contacts`;

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

/** 稽核的 targetType 與動作名(模組文件「稽核」節)。 */
export const AUDIT_TARGETS = {
  dealer: "lottery_dealer",
  contact: "lottery_dealer_contact",
  signin: "lottery_dealer_signin",
  relationship: "lottery_relationship",
} as const;

export const AUDIT_ACTIONS = {
  dealerCreate: "lottery-dealer.create",
  dealerEdit: "lottery-dealer.edit",
  contactCreate: "lottery-dealer-contact.create",
  contactEdit: "lottery-dealer-contact.edit",
  signinCreate: "lottery-dealer-signin.create",
  signinEdit: "lottery-dealer-signin.edit",
  relationshipCreate: "lottery-relationship.create",
  relationshipDelete: "lottery-relationship.delete",
} as const;

/** 稽核裡的欄位級權限欄位一律以此取代內容(module-scaffold「欄位級權限欄的四件事」第 3 件)。 */
export const REDACTED = "[redacted]";

/** 甲類的代理人、受託人、介紹人上限;乙類不能有受託人(規格 5.4)。 */
export const CONTACT_LIMITS = {
  a: { agent: 2, trustee: 2, introducer: 1 },
  b: { agent: 2, trustee: 0, introducer: 1 },
} as const;

/** 乙類的共同銷售人超過幾位時只警告(規格 5.2)。 */
export const CO_SELLER_WARNING_OVER = 6;

/** 證照到期前幾天起算「即將到期」(警告色、側欄計數)。 */
export const LICENSE_EXPIRING_DAYS = 30;

/** 批購日的兩級標籤:超過 150 天警告、超過 180 天錯誤(錯誤那一級算進側欄計數)。 */
export const PURCHASE_WARNING_DAYS = 150;
export const PURCHASE_OVERDUE_DAYS = 180;
