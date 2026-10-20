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
    "project/schedule/shared/schedule-org.ts":
      "排班讀上層鏈的範本 / 行事曆(scheduleReadContext)與排程的系統讀寫(scheduleSystemReader);待改用上層沿用到下層與 systemTenantReader",
  };
