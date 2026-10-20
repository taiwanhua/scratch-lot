import type { UrlStateInventory } from "../module-page-registry";

/**
 * 專案頁面的網址狀態盤點(REACT-14 入口清單;底座的在 `app/base/url-state-inventory.ts`,不必動)。
 * 登記 `module-pages.ts` 的每一個固定頁、每個表單模組客製過的頁,以及 `page-replacements.ts` 換掉的底座頁
 * (換掉之後的頁放進網址的 key 以這裡為準):頁面 key → 這一頁以 `useUrlState` 放進網址的 key。
 */
export const projectUrlStateInventory: UrlStateInventory = {
  // 欄位管理換成帶「顏色」欄的客製頁:網址狀態與底座頁相同(選中的類別、編輯中的選項)
  "system.field-manager": ["detail", "edit"],
  // 檔案管理:分頁、遊戲篩選、收銀點頁碼、編輯中的收銀點;遊戲詳情的分頁
  "master-data": ["tab", "games", "cashPoints", "edit"],
  "master-data.games.view-page": ["tab"],
  "master-data.games.create-page": [],
  "master-data.games.edit-page": [],
  // 經銷商管理:列表的分頁與篩選(三個分頁共用 `list`)、詳情頁的分頁;新增 / 編輯頁沒有
  dealers: ["tab", "list"],
  "dealers.view-page": ["tab"],
  "dealers.create-page": [],
  "dealers.edit-page": [],
  "dealers.contacts.view-page": [],
  "dealers.contacts.create-page": [],
  "dealers.contacts.edit-page": [],
};
