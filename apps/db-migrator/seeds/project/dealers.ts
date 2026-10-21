import type { ModuleSeedDeclaration } from "../base/module-declaration";

/** 經銷商管理的模組 key(api 的同名常數在 `apps/api/src/project/lottery/dealers/dealer-keys.ts`)。 */
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

/**
 * 經銷商管理(專案規格 3.1、3.2、5.2–5.4;正本 `docs/modules/project/dealers.md`):
 * 一頁三個分頁(甲類 | 乙類 | 關係人)。甲類 / 乙類用 `dealers` 本身的權限;關係人分頁是權限容器
 * `dealers.contacts`(兼分頁的進入條件,綁了才看得到)。新增 / 編輯 / 詳情都是隱藏頁。
 * 本模組沒有 `view` 權限(規格 3.2):讀取看模組有沒有綁。不宣告資料範圍目標。
 */
export const dealersModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: DEALERS_KEY,
      name: "經銷商管理",
      sidebarType: "link",
      parentKey: null,
      order: 60,
      route: "dealers",
      icon: "people",
      description: "甲類、乙類經銷商與關係人",
    },
    {
      key: DEALERS_MODULE_KEYS.viewPage,
      name: "經銷商詳情",
      sidebarType: "hidden",
      parentKey: DEALERS_KEY,
      order: 1,
      route: "view-page",
    },
    {
      key: DEALERS_MODULE_KEYS.createPage,
      name: "新增經銷商",
      sidebarType: "hidden",
      parentKey: DEALERS_KEY,
      order: 2,
      route: "create-page",
    },
    {
      key: DEALERS_MODULE_KEYS.editPage,
      name: "編輯經銷商",
      sidebarType: "hidden",
      parentKey: DEALERS_KEY,
      order: 3,
      route: "edit-page",
    },
    {
      key: DEALERS_CONTACTS_KEY,
      name: "關係人",
      sidebarType: "hidden",
      parentKey: DEALERS_KEY,
      order: 4,
      description: "關係人分頁(權限容器)",
    },
    {
      key: DEALERS_MODULE_KEYS.contactViewPage,
      name: "關係人詳情",
      sidebarType: "hidden",
      parentKey: DEALERS_CONTACTS_KEY,
      order: 1,
      route: "contact-view-page",
    },
    {
      key: DEALERS_MODULE_KEYS.contactCreatePage,
      name: "新增關係人",
      sidebarType: "hidden",
      parentKey: DEALERS_CONTACTS_KEY,
      order: 2,
      route: "contact-create-page",
    },
    {
      key: DEALERS_MODULE_KEYS.contactEditPage,
      name: "編輯關係人",
      sidebarType: "hidden",
      parentKey: DEALERS_CONTACTS_KEY,
      order: 3,
      route: "contact-edit-page",
    },
  ],
  permissions: [
    {
      key: DEALERS_PERMISSIONS.create,
      moduleKey: DEALERS_KEY,
      name: "新增經銷商",
      description: "[+ 新增經銷商] + 新增 API",
    },
    {
      key: DEALERS_PERMISSIONS.edit,
      moduleKey: DEALERS_KEY,
      name: "編輯經銷商",
      description: "[編輯](含解約、關聯)、[登記見簽] + 編輯 API",
    },
    {
      key: DEALERS_PERMISSIONS.showLastPurchaseBaseDate,
      moduleKey: DEALERS_KEY,
      name: "最近一次批購基準日可見",
      description: "甲類的最近一次批購基準日(欄位級)",
    },
    {
      key: DEALERS_PERMISSIONS.editLastPurchaseBaseDate,
      moduleKey: DEALERS_KEY,
      name: "最近一次批購基準日可改",
      description: "甲類的最近一次批購基準日(欄位級);無此權限硬送寫入 → API 拒",
    },
    {
      key: DEALERS_PERMISSIONS.showLastSelfPurchaseBaseDate,
      moduleKey: DEALERS_KEY,
      name: "最近一次本人批購基準日可見",
      description: "甲類的最近一次本人批購基準日(欄位級)",
    },
    {
      key: DEALERS_PERMISSIONS.editLastSelfPurchaseBaseDate,
      moduleKey: DEALERS_KEY,
      name: "最近一次本人批購基準日可改",
      description:
        "甲類的最近一次本人批購基準日(欄位級);無此權限硬送寫入 → API 拒",
    },
    {
      key: DEALERS_PERMISSIONS.contactsCreate,
      moduleKey: DEALERS_CONTACTS_KEY,
      name: "新增關係人",
      description: "關係人分頁的 [+ 新增關係人] + 新增 API",
    },
    {
      key: DEALERS_PERMISSIONS.contactsEdit,
      moduleKey: DEALERS_CONTACTS_KEY,
      name: "編輯關係人",
      description: "[編輯](含停用、身分)+ 編輯 API",
    },
  ],
};
