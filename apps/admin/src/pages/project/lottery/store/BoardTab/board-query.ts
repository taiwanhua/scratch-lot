import type { QueryKey } from "@tanstack/react-query";

/**
 * 看板資料的 query key 前綴(所有分店的看板;`useLotteryStoreBoardQuery` 的 key 是 `['LotteryStoreBoard', 變數]`):
 * 開班、投庫、出庫、改對應排班後重抓;即時信號 `board` 也 invalidate 這一個(`app/project/realtime-signals.ts`)。
 */
export const STORE_BOARD_QUERY_KEY: QueryKey = ["LotteryStoreBoard"];
