import type { Types } from "mongoose";

/**
 * 「在途」本數的來源登記(專案規格 8.1:在途 = 叫貨單在「待購買」+ 進貨單 / 調貨單已建立但還沒點收完成)。
 *
 * - 每個來源回答「這家分店每個遊戲在途幾本」(gameId 字串 → 本數;沒有的遊戲不必列)
 * - 叫貨單(待購買的副本列)由本票登記;進貨單(P18)、調貨單(P19)併回時各自登記
 * - 來源由該功能的 Nest provider 在 `onModuleInit` 登記(閉包拿自己注入的 repository),
 *   查詢釘在傳入的租戶上(收貨分店看得到在途,不論單據是誰建的);**草稿不算**
 */
export interface InTransitQuery {
  tenantId: Types.ObjectId;
  /** 哪一家分店(叫貨分店 / 進貨分店 / 收貨分店)。 */
  orgId: Types.ObjectId;
}

export type InTransitSource = (
  query: InTransitQuery,
) => Promise<ReadonlyMap<string, number>>;

const sources = new Map<string, InTransitSource>();

/**
 * 登記一個來源;`name` 全域唯一(重複 → 拋錯,app 起不來)。回傳撤銷登記的函式(測試收尾用)。
 */
export function registerInTransitSource(
  name: string,
  source: InTransitSource,
): () => void {
  if (sources.has(name)) {
    throw new Error(`在途來源 ${name} 已登記過`);
  }
  sources.set(name, source);
  return () => {
    sources.delete(name);
  };
}

/** 所有來源加總:gameId → 在途本數。 */
export async function inTransitBooksOf(
  query: InTransitQuery,
): Promise<Map<string, number>> {
  const results = await Promise.all(
    [...sources.values()].map((source) => source(query)),
  );
  const total = new Map<string, number>();
  for (const result of results) {
    for (const [gameId, books] of result) {
      total.set(gameId, (total.get(gameId) ?? 0) + books);
    }
  }
  return total;
}
