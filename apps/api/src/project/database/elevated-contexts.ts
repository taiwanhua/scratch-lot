/**
 * 專案裡**允許出現提升上下文(可見範圍或管理範圍寫成 `"all"`)的檔案**(相對 `apps/api/src/`;
 * 規則與底座清單見 `database/elevated-contexts.ts`)。`database/elevated-contexts.test.ts` 掃整個 src,
 * 出現在兩份清單以外的檔案就失敗。
 *
 * 能改用登記過的出口(`existsInTenant` / `findRefsInTenant` / `tenantBoundaryContext` / 資料共用宣告)
 * 就不要加在這裡;值寫一句「為什麼不能照可見範圍」。
 */
export const PROJECT_ELEVATED_CONTEXT_FILES: Readonly<Record<string, string>> =
  {
    "project/lottery/requisition/requisition-reference.ts":
      "引用介面只帶叫貨單 id:只讀 tenantId 一欄找出所屬租戶,條件釘在明列 id;之後改用該租戶的租戶邊界上下文",
  };
