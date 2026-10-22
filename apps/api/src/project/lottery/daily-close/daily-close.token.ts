/**
 * `DailyCloseService` 的 DI token(`daily-close.module.ts` 以 `useExisting` 提供)。結帳確認申請的掛接點
 * (`checkout/checkout-lifecycle.ts`)只 import token 與型別,依類型分派到交班 / 日結(同 `checkout.token.ts`)。
 */
export const DAILY_CLOSE_SERVICE = Symbol("DailyCloseService");
