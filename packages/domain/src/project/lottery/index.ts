/**
 * `@repo/domain/project/lottery` 的出口檔(bunchee 由 `exports` 名反推本檔)。
 * 刮刮樂的張數核心(專案規格 6.3、7.1、7.2、7.6;正本 `docs/modules/project/inventory.md`「資料與帳本」):
 *
 * - `ticket-code.ts`:編號解析(背面編號 / 正面編號 / 正面條碼)、本號補 0、本編號 / 張編號、張號區段
 * - `ticket-events.ts`:張的狀態、位置、鎖定與張數事件類型
 * - `book-stats.ts`:本的即時計算(待標註、剩餘、持有、未拆 / 檯面中 / 售完)與已給本數
 * - `portable-lookups.ts`:可以跟著受管表單交付的 lookup 來源(種子組裝與 api 匯出共用)
 * - `purchase.ts`:進貨單的表單代號 / 欄位 key、明細列、批購金額、應付、點收刷條碼的比對與進度
 * - `transfer.ts`:調貨單的表單代號 / 欄位 key、權限、明細列、金額、張號區段、收付按鈕先填值與核准前檢查
 * - `requisition.ts`:叫貨單的表單代號 / 欄位 key、新遊戲、銷售欄、排序、預估批購金額、超過預計要給本數
 * - `inventory.ts`:庫存管理的模組 key、權限 key、分頁與更正跳號的規則
 */
export * from "./book-stats";
export * from "./inventory";
export * from "./portable-lookups";
export * from "./purchase";
export * from "./requisition";
export * from "./ticket-code";
export * from "./ticket-events";
export * from "./transfer";
