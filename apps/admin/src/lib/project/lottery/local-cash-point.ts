/**
 * 本機收銀點(專案規格 5.5、6.1):每台裝置在店面管理頂部設定,**存在這台瀏覽器**(不跟帳號走)。
 * 依分店分開記(同一台裝置換分店看時各自一個);瀏覽器不給存(私密瀏覽等)就當作沒設定。
 */
const keyOf = (orgId: string) => `lottery-store.local-cash-point.${orgId}`;

/** 這台裝置在這家店的本機收銀點 id;沒設定或讀不到 → null。 */
export const readLocalCashPoint = (orgId: string): string | null => {
  try {
    return globalThis.localStorage.getItem(keyOf(orgId));
  } catch {
    return null;
  }
};

/** 記下本機收銀點;瀏覽器不給存就略過(重新整理後要再設定一次)。 */
export const writeLocalCashPoint = (
  orgId: string,
  cashPointId: string,
): void => {
  try {
    globalThis.localStorage.setItem(keyOf(orgId), cashPointId);
  } catch {
    // 存不了:這次畫面照樣切換,只是不會記住
  }
};
