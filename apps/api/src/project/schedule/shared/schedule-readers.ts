import type { OperatorContext } from "../../../database/operator-context";

/**
 * 讀使用者名稱用的上下文(畫休、代改通知、排班表共用):`users` 不掛租戶過濾,範圍在此無作用,
 * 只為讓 BaseRepository 收得到上下文;條件由呼叫端釘死在明列的 id 上。
 */
export const NAMES_READER: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: [],
  managedOrgIds: [],
  memberOrgIds: [],
  roleIds: [],
  memberTenants: [],
};
