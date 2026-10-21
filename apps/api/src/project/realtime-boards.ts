import {
  STORE_BOARD_KEY,
  STORE_KEY,
  STORE_PERMISSIONS,
} from "@repo/domain/project/lottery";

import type { RealtimeBoardRegistration } from "../realtime/realtime-board-registration";

/**
 * 專案的看板頻道登記(STRUCT-12 api 的固定入口之一,只由 `database/database.module.ts` 組裝)。
 *
 * 看板頁打開某家店時,前端用 `realtimeTicket(board: { key, orgId })` 換發含 `board:<那家店>` 的訂閱憑證;
 * API 只在操作者持有**該 key 那一筆**的 `permission`、且那家店在操作者的可見範圍內時才放進去。
 *
 * ```ts
 * { key: "store-board", moduleKey: "store-board", permission: "store-board.view" }
 * ```
 */
export const PROJECT_REALTIME_BOARDS: readonly RealtimeBoardRegistration[] = [
  // 店面管理的看板(規格 6.1):看得到看板 = `store.view` 且那家店在可見範圍內;日結精靈訂閱同一個頻道
  {
    key: STORE_BOARD_KEY,
    moduleKey: STORE_KEY,
    permission: STORE_PERMISSIONS.view,
  },
];
