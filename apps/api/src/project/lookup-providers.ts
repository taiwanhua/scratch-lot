import type { LookupProviderRegistration } from "../forms/lookup-provider-registration";
import { LotteryDealersRepository } from "./database/lottery-dealers/lottery-dealers.repository";
import { LotteryGamesRepository } from "./database/lottery-games/lottery-games.repository";

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
export const PROJECT_LOOKUP_PROVIDERS: readonly LookupProviderRegistration[] = [
  {
    // 遊戲(專案規格 5.1;`docs/modules/project/master-data.md`「lookup 來源」)。
    // 「只列販售中」由使用它的表單定義帶固定條件 `filter: { status: "on_sale" }`:底座不讓專案改寫查詢,
    // 而依值取回(已存單據的現名解析)仍要讀得到後來停售的遊戲
    declaration: {
      key: "lottery_game",
      name: "遊戲",
      permission: null,
      fields: {
        name: { type: "text", label: "遊戲名稱" },
        gameCode: { type: "text", label: "遊戲代號" },
        unitPrice: { type: "number", label: "單張金額" },
        ticketsPerBook: { type: "number", label: "整本張數" },
        bookPrice: { type: "number", label: "整本金額" },
        defaultRate: { type: "number", label: "預設批購金額率" },
      },
      filterFields: ["status"],
      labelField: "name",
      keywordFields: ["name", "gameCode"],
    },
    repositoryToken: LotteryGamesRepository,
  },
  {
    // 經銷商(專案規格 5.2;`docs/modules/project/dealers.md`「lookup 來源」):名稱、證號、類型;
    // 可篩 status(active / suspended / terminated)、type(a / b)。範圍照可見範圍
    declaration: {
      key: "lottery_dealer",
      name: "經銷商",
      permission: null,
      fields: {
        name: { type: "text", label: "姓名" },
        licenseNo: { type: "text", label: "證號" },
        type: { type: "text", label: "類型" },
      },
      filterFields: ["status", "type"],
      labelField: "name",
      keywordFields: ["name", "licenseNo"],
    },
    repositoryToken: LotteryDealersRepository,
  },
];
