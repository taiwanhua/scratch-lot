/**
 * `@repo/domain/audience` 的出口檔(bunchee 由 `exports` 名反推本檔;GEN-01 的 packages 邊界例外)。
 * 人員條件(「選出一群人」的唯一格式):資料範圍的套用對象、流程審核者、知會、逾時通知、通知收件人共用。
 *
 * - `types.ts`:`Audience` 型別、欄位 / 比較方式 / 組織範圍 / 組織來源的詞彙、每個使用處的 `AudienceOptions`
 * - `schema.ts`:依使用處產生的 zod schema 與 `validateAudience`(錯誤附路徑)
 */
export * from "./schema";
export * from "./types";
