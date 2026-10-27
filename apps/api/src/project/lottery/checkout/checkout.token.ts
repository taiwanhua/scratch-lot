/**
 * `CheckoutService` 的 DI token(`checkout.module.ts` 以 `useExisting` 提供)。掛接點的登記檔
 * (`checkout-lifecycle.ts`,由 `database/database.module.ts` 組裝)只 import 這個 token 與型別,
 * 不 import 服務本身(同 `stocktake.token.ts` 的理由:避免 import 循環)。
 */
export const CHECKOUT_SERVICE = Symbol("CheckoutService");
