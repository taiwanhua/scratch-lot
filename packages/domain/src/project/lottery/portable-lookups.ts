import type { PortableLookupProvider } from "../../seed/portable-definition";
import { GAME_STATUS } from "../lottery-master-data/games";

/**
 * 刮刮樂可以跟著受管表單交付的 lookup 來源(`@repo/domain/seed` 的 `PortableCatalog.lookupProviders`):
 * 來源 key → 允許的固定條件與值。db-migrator 的種子組裝(`seeds/project/registry.ts`)與 api 的 lookup 登記
 * (`apps/api/src/project/lookup-providers.ts` 的 `portable`,匯出 seed 時進可攜性目錄)讀同一份。
 *
 * - `lottery_game`:只收「只列販售中」(叫貨單、進貨單的明細;專案規格 5.1)
 * - `lottery_dealer`:只收「甲類」「營業中」(進貨單的批購甲類;規格 8.2)
 * - `lottery_dealer_contact`:只收「啟用」「受託人」(進貨單的批購受託人;規格 8.2)
 * - `lottery_bank_account`:只收「使用中」(進貨單的扣款帳戶;規格 8.2)
 * - `lottery_book`:只收「正常」(調貨單明細的本;規格 8.4。「在出貨店、未被鎖定」是連動 / 數字條件,不可攜,
 *   由替換新增頁的選本與送出前檢查負責)
 * - `lottery_redemption`:只收「店內持有」(進貨單勾選的兌獎紀錄;規格 8.2。「只列進貨分店的」是連動條件,
 *   不可攜,由替換新增頁的清單與送出前檢查負責)
 * - `lottery_shift`:沒有固定條件(撤銷售出申請的退款班次、現金更正單的位置 / 歸屬班次;規格 8.5、8.8。
 *   「本店的班」是連動條件,不可攜,由送出前檢查負責)
 */
export const LOTTERY_PORTABLE_LOOKUP_PROVIDERS = {
  lottery_game: { filters: { status: [GAME_STATUS.onSale] } },
  lottery_dealer: { filters: { type: ["a"], status: ["active"] } },
  lottery_dealer_contact: {
    filters: { status: ["active"], roles: ["trustee"] },
  },
  lottery_bank_account: { filters: { status: ["active"] } },
  lottery_book: { filters: { status: ["normal"] } },
  lottery_redemption: { filters: { status: ["in_store"] } },
  lottery_shift: { filters: {} },
} as const satisfies Readonly<Record<string, PortableLookupProvider>>;
