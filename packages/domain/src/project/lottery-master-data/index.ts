/**
 * `@repo/domain/project/lottery-master-data` 的出口檔(bunchee 由 `exports` 名反推本檔)。
 * 檔案管理(`master-data`)的遊戲與收銀點規則(專案規格 5.1、5.5):
 *
 * - `denominations.ts`:面額 / 整本張數對照表(只有這一份)
 * - `games.ts`:遊戲與收銀點欄位的上下限、遊戲狀態、整本金額
 * - `keys.ts`:模組 key 與權限 key
 */
export * from "./denominations";
export * from "./games";
export * from "./keys";
