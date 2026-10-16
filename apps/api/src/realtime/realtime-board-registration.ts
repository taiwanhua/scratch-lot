/**
 * 專案登記的看板頻道(底座規格第 4 章「訂閱憑證」):看板頁屬於哪個模組、打開它要哪個檢視權限。
 *
 * 專案在固定入口 `src/project/realtime-boards.ts` 列出;清單只由 `database/database.module.ts` 組裝,
 * 以 `REALTIME_BOARDS` 提供給 `RealtimeTicketService`。換發時前端帶看板 key,資格只看**那個看板**登記的權限;
 * 底座本身沒有看板,清單為空(或 key 沒登記)時 `board:` 頻道一律不放進憑證。
 */
export interface RealtimeBoardRegistration {
  /** 看板 key(前端 `useRealtimeBoard(key, orgId)` 與 `realtimeTicket(board: { key })` 帶的值,全域唯一)。 */
  key: string;
  /** 看板所在模組(說明用;判斷只看 `permission`)。 */
  moduleKey: string;
  /** 打開看板頁要的檢視權限 key(含同層 wildcard,經 `holdsPermission` 判斷)。 */
  permission: string;
}

/** DI token:組裝好的看板頻道登記。 */
export const REALTIME_BOARDS = Symbol("REALTIME_BOARDS");
