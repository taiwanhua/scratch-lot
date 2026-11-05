export {
  CASH_CORRECTION_FORM_KEY,
  SALE_REVERSAL_FORM_KEY,
  STORE_KEY,
} from "@repo/domain/project/lottery";

/**
 * 撤銷售出申請新增頁的帶入值(網址;`app/project/url-state-inventory.ts` 登記):分店 `org`、
 * 看板撤銷確認視窗 [送撤銷售出申請] 帶入的那一張 `ticket`(張 id);
 * 全店重刷「記已售但還在」帶入重刷刷到的位置 `place`(收銀點 id,庫存 = `stock`)與原因 `reason`(盤點錯誤;
 * 張數店規格 7.3 第 4 點、13.2);依張數撤銷不符條件時帶入「遊戲 + 張數」列:遊戲 `game`、收銀點 `point`、張數 `count`。
 */
export const SALE_REVERSAL_PREFILL = {
  org: "org",
  ticket: "ticket",
  place: "place",
  reason: "reason",
  game: "game",
  point: "point",
  count: "count",
} as const;

/** `place` 帶庫存時的值(重刷在庫存刷到)。 */
export const SALE_REVERSAL_STOCK_PLACE = "stock";

/** 新增頁刷條碼的掃描用途(B10;宣告了就不會跳快速銷售)。 */
export const SALE_REVERSAL_SCAN_PURPOSE = "store-sale-reversal";

/** 新增頁的網址:`<新增頁路由>/<formKey>?…`。 */
export const storeFormCreateHref = (
  createRoute: string,
  formKey: string,
  params: Readonly<Record<string, string>> = {},
): string => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== ""),
  ).toString();
  const query = search === "" ? "" : `?${search}`;
  return `${createRoute}/${formKey}${query}`;
};
