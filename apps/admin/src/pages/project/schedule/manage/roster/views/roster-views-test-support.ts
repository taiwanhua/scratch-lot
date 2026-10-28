/**
 * 排班表月 / 週 / 日檢視的測試工具(測試資料,不是測試檔):固定在 2026-11(夾具 1–7 日有資料;
 * 11/1 是星期日,第一週 = 11/1–11/7)。
 */

/** 排班作業 → 排班表的網址;`params` 例 `view=week&date=2026-11-04`。 */
export const rosterPath = (params: string): string =>
  `/schedule/manage?tab=roster&month=2026-11&${params}`;

/** 目前網址的查詢參數。 */
export const searchParam = (key: string): string | null =>
  new URLSearchParams(globalThis.location.search).get(key);
