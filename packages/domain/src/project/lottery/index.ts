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
 * - `redemption.ts`:兌獎的狀態、上限、撤銷方式、抽屜應有 / 事後更正淨額、進貨單的兌獎合計
 * - `store.ts`:店面管理的模組 key、權限 key、分頁、看板頻道、剩很少的門檻與期初零用金的規則
 * - `store-sales.ts`:店面的刷到時怎麼處理、當下撤銷的條件、拆本精靈的檢查
 * - `store-forms.ts`:撤銷售出申請、現金更正單的表單代號 / 欄位 key、存值解析與送出前檢查
 * - `stocktake.ts`:盤點的類型 / 狀態、盤點內容、與盤點那一刻比對的差異、送出前的檢查
 * - `checkout.ts`:交班結帳的表單代號 / 欄位 key、結帳內容、面額表、應有 / 實點 / 差額與交接的檢查
 * - `daily-close.ts`:日結的結帳內容、精靈步驟、小金庫應有的各項、存入銀行的檢查、涵蓋計算期間沒有日結的日子
 */
export * from "./book-stats";
export * from "./checkout";
export * from "./daily-close";
export * from "./inventory";
export * from "./portable-lookups";
export * from "./purchase";
export * from "./receipt-links";
export * from "./redemption";
export * from "./requisition";
export * from "./store";
export * from "./store-forms";
export * from "./stocktake";
export * from "./store-sales";
export * from "./ticket-code";
export * from "./ticket-events";
export * from "./transfer";
