import type { QueryKey } from "@tanstack/react-query";

/**
 * 日結精靈(結帳確認申請新增頁,類型 = 日結)的帶入值(網址;`app/project/url-state-inventory.ts` 登記):
 * 分店 `org`、類型 `type=daily`(看板 [日結] 帶入;沒帶 = 交班精靈)。
 */
export const DAILY_CLOSE_PREFILL = { org: "org", type: "type" } as const;

/** `?type=` 的值:日結。 */
export const DAILY_CLOSE_TYPE_VALUE = "daily";

/** 看板頂部「上次日結」與審核中的日結(送出 / 核准後的 `board` 信號重抓)。 */
export const STORE_DAILY_CLOSE_STATUS_QUERY_KEY: QueryKey = [
  "LotteryDailyCloseStatus",
];

/** 日結精靈(各班結帳的審核狀態由 `board:<分店>` 即時更新)。 */
export const STORE_DAILY_CLOSE_WIZARD_QUERY_KEY: QueryKey = [
  "LotteryDailyCloseWizard",
];

/** 存銀行視窗(小金庫應有)。 */
export const STORE_BANK_DEPOSIT_FORM_QUERY_KEY: QueryKey = [
  "LotteryBankDepositForm",
];
