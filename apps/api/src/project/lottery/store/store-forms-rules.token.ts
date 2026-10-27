/**
 * `StoreFormsRules` 的 DI token(`store.module.ts` 以 `useExisting` 提供)。掛接點的登記檔
 * (`store-forms-lifecycle.ts`,由 `database/database.module.ts` 組裝)只 import 這個 token 與型別,
 * 不 import 服務本身 —— 服務依賴的 repository / service 會繞回資料層的組裝入口(import 循環)。
 */
export const STORE_FORMS_RULES = Symbol("StoreFormsRules");
