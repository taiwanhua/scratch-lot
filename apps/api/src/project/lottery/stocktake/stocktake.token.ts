/**
 * `StocktakeService` 的 DI token(`stocktake.module.ts` 以 `useExisting` 提供)。掛接點的登記檔
 * (`stocktake-lifecycle.ts`,由 `database/database.module.ts` 組裝)只 import 這個 token 與型別,
 * 不 import 服務本身 —— 服務依賴的 repository / service 會繞回資料層的組裝入口(import 循環)。
 * 交班 / 日結的結帳確認申請(P26 / P27)在自己的掛接點以同一個 token 取 `submitStocktakeDraft` 等入口。
 */
export const STOCKTAKE_SERVICE = Symbol("StocktakeService");
