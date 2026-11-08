/**
 * `@repo/domain/project/org-setting-chain` 的出口檔(bunchee 由 `exports` 名反推本檔)。
 *
 * 「沿組織樹往上找」的設定生效值(共用;排班規則 `schedule_settings` 與刮刮樂設定 `lottery_settings` 兩邊用,
 * 張數店規格 5.5「生效值解析搬成共用函式兩邊用」):一列 = 某組織對某個 key 的**自訂**;沒有列 = 沿用。
 * 生效值 = 組織鏈(自己 → 上層 → … → 最上層組織)上第一個有自訂的組織的那一列;整條鏈都沒有 → 程式預設。
 * 兩邊都可以 import(不帶 `lottery-` / `schedule-` 前綴)。
 */

/** 一列自訂至少要有的欄位(orgId 以字串比對)。 */
export interface ChainSettingRow {
  orgId: string;
  key: string;
}

/** 生效值從哪裡來:本層自訂 / 沿用某個上層 / 程式預設。 */
export type ChainSettingSource = "own" | "inherited" | "default";

/** 在鏈上找到的那一處:找到的值、所在組織、來源(`chain[0]` = 自己 → own,其他 → inherited)。 */
export interface ChainHit<T> {
  value: T;
  orgId: string;
  source: Exclude<ChainSettingSource, "default">;
}

/** 依組織分組(同一組織的列保持原順序)。 */
export function rowsByOrg<Row extends ChainSettingRow>(
  rows: readonly Row[],
): Map<string, Row[]> {
  const byOrg = new Map<string, Row[]>();
  for (const row of rows) {
    byOrg.set(row.orgId, [...(byOrg.get(row.orgId) ?? []), row]);
  }
  return byOrg;
}

/**
 * 沿鏈找第一個 `pick` 有結果的組織;都沒有 → null(呼叫端用程式預設)。
 * `pick` 決定「這個組織算不算有自訂」:一般設定 = 有這個 key 的列;排班的自動排班條件 = 有任何一條條件的列。
 */
export function firstOnChain<T>(
  chain: readonly string[],
  pick: (orgId: string) => T | undefined,
): ChainHit<T> | null {
  for (const [index, orgId] of chain.entries()) {
    const value = pick(orgId);
    if (value !== undefined) {
      return { value, orgId, source: index === 0 ? "own" : "inherited" };
    }
  }
  return null;
}

/** 一個 key 在這條鏈上的自訂列(第一個有這個 key 的組織);都沒有 → null。 */
export function chainRowOf<Row extends ChainSettingRow>(
  chain: readonly string[],
  byOrg: ReadonlyMap<string, readonly Row[]>,
  key: string,
): ChainHit<Row> | null {
  return firstOnChain(chain, (orgId) =>
    byOrg.get(orgId)?.find((row) => row.key === key),
  );
}
