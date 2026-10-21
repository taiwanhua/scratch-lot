import { unmatchedCountsByDate } from "@/lib/project/schedule-attendance";

import { useRoster } from "../roster-context";

/** 某家店某個月每一天的「未對應排班的打卡」張數(`YYYY-MM-DD` → 張數;沒有的日子不列)。 */
export type UnmatchedPunchCounts = ReadonlyMap<string, number>;

/**
 * `unmatchedPunchCounts(orgId, month)`(規格 14.5「未對應排班的打卡」:月檢視那天格子加 ⏲):
 * 讀排班表資料裡的未對應排班的卡(api 的 `unmatchedPunches`,這家店、讀取範圍內),依日期算張數。
 * 參數保留給呼叫端對照(排班表頁殼一次只讀一家店一個月)。
 */
export const useUnmatchedPunchCounts = (
  orgId: string,
  month: string,
): UnmatchedPunchCounts => {
  const { data } = useRoster();
  if (data.orgId !== orgId || data.month !== month) {
    return new Map();
  }
  return unmatchedCountsByDate(data.unmatchedPunches);
};
