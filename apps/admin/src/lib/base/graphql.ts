/** GraphQL endpoint(DATA-05:走環境變數,fallback 才是 localhost)。只在組裝根讀取 — 測試不 import 本檔。 */
export const GRAPHQL_ENDPOINT =
  (import.meta.env.VITE_GRAPHQL_ENDPOINT as string | undefined) ??
  "http://localhost:5001/graphql";
