/**
 * 租戶邊界上下文(`tenantBoundaryContext`)呼叫端登記的用途分類(登記表的值;新增呼叫端前先確認屬於其中一種)。
 * 單獨一檔:專案入口 `project/database/tenant-boundary-callers.ts` 要引用這個型別,
 * 但不能 import `tenant-boundary-context`(那會被當成呼叫端)。
 */
export type TenantBoundaryContextPurpose =
  "反查" | "以人為準的資料" | "例外寫入" | "排程" | "系統重算";
