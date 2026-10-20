/** 某家店某個月每一天的「未對應排班的打卡」張數(`YYYY-MM-DD` → 張數;沒有的日子不列)。 */
export type UnmatchedPunchCounts = ReadonlyMap<string, number>;

const NONE: UnmatchedPunchCounts = new Map();

/**
 * 介面 `unmatchedPunchCounts(orgId, month)`(規格 14.5「未對應排班的打卡」:月檢視那天格子加 ⏲):
 * 月檢視的顯示位置已經接好,資料由打卡功能(出勤紀錄 / 打卡)實作;實作前一律回空,畫面不顯示 ⏲。
 * 實作時只改這支(改成讀 api 的 hook),月檢視不必動。
 */
export const useUnmatchedPunchCounts: (
  orgId: string,
  month: string,
) => UnmatchedPunchCounts = () => NONE;
