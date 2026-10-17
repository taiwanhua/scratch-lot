import { useMe } from "./useMe";

/**
 * 讀者當前組織的**租戶時區**(IANA;api `me.currentOrg.timezone`,沒設 = `Asia/Taipei`)。
 * 表單引擎的日期 / 日期時間欄在填寫、草稿、詳情、修訂紀錄、設計器預覽都以它輸入與顯示;
 * 已送出修訂的 `ctx.timezone` 只用於重算顯示 / 唯讀條件,不決定顯示。
 * 還沒載到為 null(呼叫端退回預設時區)。
 */
export const useTenantTimezone = (): string | null =>
  useMe().data?.me.currentOrg?.timezone ?? null;
