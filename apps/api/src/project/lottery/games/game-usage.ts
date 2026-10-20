import type { Types } from "mongoose";

/**
 * 「這個遊戲被引用了嗎」的登記(專案規格 5.1):
 *
 * - 有任何一個 checker 回 true → 遊戲**有庫存**:代號、面額、張數鎖定,不能刪除(只能停售)
 * - 每個引用遊戲的功能登記一個:P15(本 `lottery_books`)、P17(叫貨單)、P18(進貨單)
 *
 * checker 由該功能的 Nest provider 在 `onModuleInit` 登記(閉包拿自己注入的 repository),
 * 只回答「有沒有」,查詢要釘在傳入的 `tenantId` 上(遊戲是整個租戶共用的主檔)。
 * 根組織建的遊戲 `tenantId` 為 null。
 */
export type GameUsageChecker = (
  tenantId: Types.ObjectId | null,
  gameId: Types.ObjectId,
) => Promise<boolean>;

const checkers = new Map<string, GameUsageChecker>();

/**
 * 登記一個 checker;`name` 全域唯一(重複 → 拋錯,app 起不來)。
 * 回傳撤銷登記的函式(測試收尾用)。
 */
export function registerGameUsageChecker(
  name: string,
  checker: GameUsageChecker,
): () => void {
  if (checkers.has(name)) {
    throw new Error(`遊戲引用檢查 ${name} 已登記過`);
  }
  checkers.set(name, checker);
  return () => {
    checkers.delete(name);
  };
}

/** 任一 checker 回 true 即「有庫存」;沒有任何登記時一律 false。 */
export async function isGameInUse(
  tenantId: Types.ObjectId | null,
  gameId: Types.ObjectId,
): Promise<boolean> {
  const results = await Promise.all(
    [...checkers.values()].map((checker) => checker(tenantId, gameId)),
  );
  return results.includes(true);
}
