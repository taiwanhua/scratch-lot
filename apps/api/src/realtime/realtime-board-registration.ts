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

/** 看板登記不合契約(key 重複或空白):組裝時拋出,app 起不來。 */
export class RealtimeBoardRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealtimeBoardRegistrationError";
  }
}

/**
 * 驗證並凍結專案的看板登記(由 `database/database.module.ts` 組裝時呼叫):key 必須非空且全域唯一 ——
 * 換發時以 key 找登記,重複會讓資格判斷看錯權限。
 */
export function composeRealtimeBoards(
  boards: readonly RealtimeBoardRegistration[],
): readonly RealtimeBoardRegistration[] {
  const seen = new Set<string>();
  for (const board of boards) {
    if (board.key.trim() === "" || board.permission.trim() === "") {
      throw new RealtimeBoardRegistrationError(
        `看板登記的 key / permission 不可空白(模組 ${board.moduleKey})`,
      );
    }
    if (seen.has(board.key)) {
      throw new RealtimeBoardRegistrationError(
        `看板 key「${board.key}」重複登記`,
      );
    }
    seen.add(board.key);
  }
  return Object.freeze([...boards]);
}
