/**
 * 庫存管理(`inventory`)的模組 key、權限 key、分頁與規則(專案規格 3.1、3.2、7.3、7.4、7.6;
 * 權限表正本 `docs/modules/project/inventory.md`)。seed 宣告、api 守門、admin 判斷都引用這裡,不另寫字面值。
 */
export const INVENTORY_KEY = "inventory";

/** 模組樹:列表頁(分頁 庫存 | 待查·遺失 | 預計要給本數)+ 本的詳情隱藏頁。 */
export const INVENTORY_MODULE_KEYS = {
  list: INVENTORY_KEY,
  bookPage: `${INVENTORY_KEY}.book-page`,
} as const;

/**
 * 個別權限(wildcard 由 seed 自動產生)。本模組沒有 `view`:讀取看模組有沒有綁;
 * 預計要給本數沒有 `edit-allocations` 時唯讀(庫存管理、遊戲詳情、乙類詳情三處一致)。
 */
export const INVENTORY_PERMISSIONS = {
  markSkipped: `${INVENTORY_KEY}.mark-skipped`,
  recover: `${INVENTORY_KEY}.recover`,
  scrap: `${INVENTORY_KEY}.scrap`,
  showCost: `${INVENTORY_KEY}.show-cost`,
  editAllocations: `${INVENTORY_KEY}.edit-allocations`,
} as const;

/** 頁內分頁的值(`?tab=`)。 */
export const INVENTORY_TABS = {
  stock: "stock",
  investigations: "investigations",
  allocations: "allocations",
} as const;

/** 查刮刮樂的掃描用途(`useScanner` 宣告,規格 18.3)。 */
export const INVENTORY_LOOKUP_SCAN_PURPOSE = "inventory-lookup";

/**
 * 庫存分頁的狀態篩選:本的顯示狀態(`bookDisplayStateOf`;已撤銷的本不列,所以沒有這個選項)+ 有待標註。
 * i18n `bookStates.*` 同一組值。
 */
export const INVENTORY_BOOK_FILTER_STATES = [
  "unopened",
  "on_counter",
  "in_stock",
  "in_transit",
  "investigating",
  "lost",
  "scrapped",
  "sold_out",
  "pending_skip",
] as const;
export type InventoryBookFilterState =
  (typeof INVENTORY_BOOK_FILTER_STATES)[number];

/**
 * 更正跳號後的跳號張數要等於「待標註張數」= 迄號 − 標準張數(拆本時要標的張數;規格 7.1、7.3)。
 * 例:迄號 102、標準 100 → 2 張。
 */
export function requiredSkipCountOf(
  lastTicketNo: number,
  standardTickets: number,
): number {
  return Math.max(0, lastTicketNo - standardTickets);
}
