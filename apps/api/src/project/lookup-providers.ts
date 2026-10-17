import type { LookupProviderRegistration } from "../forms/lookup-provider-registration";

/**
 * 專案登記的 lookup 來源(`docs/modules/forms.md`「專案登記的來源」;STRUCT-12 api 的固定入口之一,
 * 只由 `database/database.module.ts` 組裝)。帶入、引用、lookup 選項都能選它們。
 *
 * 新增一個來源:先在 `project/database/registrations.ts` 登記資料表與 repository,再在這裡加一筆:
 *
 * ```ts
 * {
 *   declaration: {
 *     key: "lottery_game", // 前綴 = 資料表名第一段(lottery_games)
 *     name: "遊戲",
 *     permission: "lottery.view", // null = 在可見範圍內公開
 *     fields: { title: { type: "text", label: "遊戲名稱" }, bookAmount: { type: "number" } },
 *     filterFields: ["enabled"],
 *     labelField: "title",
 *   },
 *   repositoryToken: LotteryGamesRepository,
 * }
 * ```
 *
 * repository 必須是專案資料登記裡的(拿底座的 → 起不來);查詢由底座經 BaseRepository 組,不能自訂。
 */
export const PROJECT_LOOKUP_PROVIDERS: readonly LookupProviderRegistration[] =
  [];
