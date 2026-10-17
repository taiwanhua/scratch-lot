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
export const PROJECT_REALTIME_BOARDS: readonly RealtimeBoardRegistration[] = [];
