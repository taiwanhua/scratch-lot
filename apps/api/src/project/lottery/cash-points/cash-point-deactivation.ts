import type { Types } from "mongoose";

/**
 * 「這個收銀點現在能不能停用」的登記(專案規格 5.5:有開著的班或檯面上還有張數時不能停用)。
 *
 * - 有任何一個 guard 回 true → 擋下停用(`VALIDATION_FAILED`,欄位 `enabled`,
 *   `reason = CASH_POINT_IN_USE`)
 * - 由店面管理(P21)登記;本模組不知道班次與檯面
 *
 * guard 由該功能的 Nest provider 在 `onModuleInit` 登記(閉包拿自己注入的 repository),
 * 查詢釘在傳入的 `tenantId` 上。
 */
export type CashPointDeactivationGuard = (
  tenantId: Types.ObjectId | null,
  cashPointId: Types.ObjectId,
) => Promise<boolean>;

const guards = new Map<string, CashPointDeactivationGuard>();

/** 登記一個 guard;`name` 全域唯一(重複 → 拋錯)。回傳撤銷登記的函式(測試收尾用)。 */
export function registerCashPointDeactivationGuard(
  name: string,
  guard: CashPointDeactivationGuard,
): () => void {
  if (guards.has(name)) {
    throw new Error(`收銀點停用守門 ${name} 已登記過`);
  }
  guards.set(name, guard);
  return () => {
    guards.delete(name);
  };
}

/** 任一 guard 回 true 即不能停用;沒有任何登記時一律 false。 */
export async function isCashPointDeactivationBlocked(
  tenantId: Types.ObjectId | null,
  cashPointId: Types.ObjectId,
): Promise<boolean> {
  const results = await Promise.all(
    [...guards.values()].map((guard) => guard(tenantId, cashPointId)),
  );
  return results.includes(true);
}
