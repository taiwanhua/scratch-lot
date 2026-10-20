/**
 * 專案裡**允許出現提升上下文(可見範圍或管理範圍寫成 `"all"`)的檔案**(相對 `apps/api/src/`;
 * 規則與底座清單見 `database/elevated-contexts.ts`)。`database/elevated-contexts.test.ts` 掃整個 src,
 * 出現在兩份清單以外的檔案就失敗。
 *
 * 能改用登記過的出口(`existsInTenant` / `findRefsInTenant` / `systemTenantReader` / 資料共用宣告)
 * 就不要加在這裡;值寫一句「為什麼不能照可見範圍」。
 */
export const PROJECT_ELEVATED_CONTEXT_FILES: Readonly<Record<string, string>> =
  {
    "project/lottery/dealers/dealer-reminders.service.ts":
      "排程讀整個租戶的經銷商(以 tenantId 釘住);待改用 systemTenantReader",
    "project/lottery/dealers/dealers-access.ts":
      "租戶內唯一 / 對應分店占用檢查;待改用 existsInTenant / findRefsInTenant",
    "project/lottery/dealers/purchase-dates.ts":
      "內部讀寫已以 _id + tenantId 釘住的那一筆;待改用登記過的出口",
    "project/schedule/shared/schedule-org.ts":
      "排班讀上層鏈的範本 / 行事曆(scheduleReadContext)與排程的系統讀寫(scheduleSystemReader);待改用上層沿用到下層與 systemTenantReader",
    "project/lottery/master-data-tenant.ts":
      "租戶共用主檔掛在租戶頂層;待改用資料共用宣告",
  };
