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
  // 輸出報表:選的報表、條件(期間、分店、其他條件)、預覽(開著沒、第幾個工作表)
  reports: ["report", "conditions", "preview"],
  // 班表管理:頁內分頁 `tab`;排班人員篩選 `joined`;規則 / 行事曆 / 畫休總覽的分店 `org`;
  // 行事曆 / 畫休總覽的月份 `month`;畫休總覽的篩選 `dayOffFilter`;
  // 支援需求單的篩選 `support`、右側打開的那一筆 `detail`、詳情看的修訂 `revision`
  "schedule.my": ["tab"],
  "schedule.settings": ["tab", "joined", "org"],
  "schedule.manage": [
    "tab",
    "org",
    "month",
    "dayOffFilter",
    "support",
    "detail",
    "revision",
    "view",
  ],
  "schedule.attendance": ["tab"],
  // 帳戶管理:分頁、即時現金帳的篩選(分店、日期、類型、收銀點)、58mm 流水單據 QR 帶的那一筆;
  // 銀行帳戶詳情:交易清單的篩選(期間、類型)
  accounts: ["tab", "cash", "movementId"],
  "accounts.view-page": ["transactions"],
  // 叫貨、採購單:頁內分頁 `tab`、叫貨單列表的篩選 `requisitions`;新增頁的篩選只在畫面上(不進網址)
  "purchasing.requisition": ["tab", "requisitions"],
  "purchasing.requisition.create-page": [],
  // 進貨單:列表的篩選 `purchases`;新增頁從採購清單帶入的叫貨單單號 `requisition` 與分店 `branch`;
  // 檢視頁看舊修訂 `revision`(表單引擎的詳情零件)
  "purchasing.purchase": ["purchases"],
  "purchasing.purchase.create-page": ["requisition", "branch"],
  "purchasing.purchase.view-page": ["revision"],
  // 庫存管理:頁內分頁 `tab`、庫存分頁的篩選 `stock`(分店、遊戲、狀態、批購日、本號);
  // 本的詳情:查刮刮樂帶來的張號 `ticket`(打開時標亮)
  inventory: ["tab", "stock"],
  "inventory.book-page": ["ticket"],
};
