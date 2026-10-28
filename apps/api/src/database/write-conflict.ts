// 資料層的批次寫入核對筆數不符時丟的錯誤(GraphQLError,同 `share-orgs.ts` / `org-reassign.ts` 在資料層丟使用者錯誤的理由):
// 檢查放在 BaseRepository,每個呼叫端都繞不過;交易因此整個回復。
import { GraphQLError } from "graphql";

/**
 * 寫入筆數與預期不符(有幾筆不存在 / 已刪除 / 範圍外 / 已被別人改了):`CONFLICT`(`EDIT_VERSION_MISMATCH`,
 * 與其他樂觀鎖同一個 reason;前端照「已被別人更新」處理)。
 */
export function writeCountConflictError(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "CONFLICT", reason: "EDIT_VERSION_MISMATCH" },
  });
}
