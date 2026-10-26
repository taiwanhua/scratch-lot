import mongoose from "mongoose";

/** 一段動作送出的資料庫指令數(總數與「集合.方法」分項)。 */
export interface DbCommandCount<T> {
  result: T;
  total: number;
  byCommand: Map<string, number>;
}

/**
 * 數 `run` 期間經 Mongoose 送出的資料庫指令(防退化測試用,TX-06:交易內逐筆讀寫會讓指令數隨筆數成長,
 * 本機往返幾乎是 0 毫秒,計時抓不到,所以數指令、不計時)。以 Mongoose 的 `debug` 掛勾計數:
 * 經 model 與 `connection.collection(...)` 的操作都會算到;同一個行程裡別的非同步工作若同時送出指令也會算進來。
 */
export async function countDbCommands<T>(
  run: () => Promise<T>,
): Promise<DbCommandCount<T>> {
  const byCommand = new Map<string, number>();
  // 結束時還原原本的設定(開發者自己開的 debug 不被蓋掉)
  const previous: unknown = mongoose.get("debug");
  mongoose.set("debug", (collection: string, method: string) => {
    const key = `${collection}.${method}`;
    byCommand.set(key, (byCommand.get(key) ?? 0) + 1);
  });
  try {
    const result = await run();
    const total = [...byCommand.values()].reduce((sum, n) => sum + n, 0);
    return { result, total, byCommand };
  } finally {
    mongoose.set(
      "debug",
      previous as Parameters<typeof mongoose.set<"debug">>[1],
    );
  }
}

/** 失敗訊息用:指令數由多到少列出。 */
export function describeDbCommands(byCommand: Map<string, number>): string {
  return [...byCommand.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([key, count]) => `  ${key}: ${String(count)}`)
    .join("\n");
}

/** 指令數超過上限 → 拋錯,訊息列出分項(哪個集合的哪個方法被叫了幾次,方便找出逐筆讀寫)。 */
export function expectDbCommandsAtMost(
  counted: Pick<DbCommandCount<unknown>, "total" | "byCommand">,
  limit: number,
  label: string,
): void {
  if (counted.total > limit) {
    throw new Error(
      `${label}:資料庫指令 ${String(counted.total)} 次,超過上限 ${String(limit)}\n${describeDbCommands(counted.byCommand)}`,
    );
  }
}
