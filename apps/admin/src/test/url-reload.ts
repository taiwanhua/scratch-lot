/**
 * 測試用:「重新整理」= 卸載後以目前的網址(路徑 + `useUrlState` 寫進去的查詢字串)重新渲染。
 * 回傳目前的查詢字串(含 `?`),交給各頁 render helper 的 `search` / `path`。
 */
export const currentSearch = (): string => globalThis.location.search;

/** 網址上某一個 key 的值(`useUrlState` 寫的原字串;物件是 JSON)。 */
export const urlParam = (key: string): string | null =>
  new URLSearchParams(globalThis.location.search).get(key);

/** 網址上某一個 key 的 JSON 值;沒有這個 key 回 null。 */
export const urlJson = (key: string): unknown => {
  const raw = urlParam(key);
  return raw === null ? null : (JSON.parse(raw) as unknown);
};
