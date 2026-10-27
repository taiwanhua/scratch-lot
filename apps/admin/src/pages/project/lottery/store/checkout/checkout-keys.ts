import type { QueryKey } from "@tanstack/react-query";

export { CHECKOUT_CONFIRM_FORM_KEY } from "@repo/domain/project/lottery";

/**
 * 交班精靈(結帳確認申請新增頁)的帶入值(網址;`app/project/url-state-inventory.ts` 登記):
 * 分店 `org`、看板 [交班結帳] 帶入的那一班 `shift`(班次 id)。
 */
export const CHECKOUT_PREFILL = { org: "org", shift: "shift" } as const;

/** 交班精靈的 query key 前綴(看板的 `board` 信號也重抓它:補登兌獎後應有現金與兌獎清單跟著變)。 */
export const STORE_CHECKOUT_WIZARD_QUERY_KEY: QueryKey = [
  "LotteryCheckoutWizard",
];

/** 班次結帳歷史紀錄分頁的 query key 前綴(同上:送出 / 核准後重抓)。 */
export const STORE_CHECKOUTS_QUERY_KEY: QueryKey = ["LotteryCheckouts"];

/** 精靈的四步(規格 6.9:① 盤點 → ② 兌獎 → ③ 抽屜 → ④ 確認)。 */
export const CHECKOUT_STEPS = [
  "stocktake",
  "redemption",
  "drawer",
  "confirm",
] as const;
export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];
