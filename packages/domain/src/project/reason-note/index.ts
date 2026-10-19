/**
 * `@repo/domain/project/reason-note`:欄位管理原因類別的共用規則(專案規格第 13 章)。
 * 刮刮樂與排班都用,所以不放 `lottery-*` / `schedule-*` 主題(排班不得 import 刮刮樂)。
 */

/** 每個原因類別的「其他」選項代碼(`seeds/project/field-categories.ts` 一律用這個 value)。 */
export const REASON_OTHER_VALUE = "other";

/** 選「其他」時說明必填,全系統一致;沒選(`null`)不算。 */
export function requiresReasonNote(value: string | null): boolean {
  return value === REASON_OTHER_VALUE;
}
