import {
  type SplitActualCountProblem,
  splitNeedsActualCount,
  splitSkipCountOf,
} from "@repo/domain/project/lottery";

/** 拆本 ① 的狀態:這次要標幾張跳號、能不能下一步、有沒有 ① 這一步、手上張數對不上的原因。 */
export interface SplitSkipPlan {
  /** 張數店與轉換中、不是原封不動的本:要先問手上實際張數 */
  askCount: boolean;
  /** 這次要標幾張跳號 */
  pending: number;
  /** 手上張數沒問題(不用問、或問了而且對得上) */
  countReady: boolean;
  hasSkipStep: boolean;
  problem: SplitActualCountProblem | null;
  /** 輸入的實際張數(不是整數 = null) */
  actualCount: number | null;
}

/**
 * 拆本 ① 要標幾張跳號(張數店規格 7.5):原封不動 = 待標註;張數店與轉換中不是原封不動的本 = 手上比系統少幾張
 * (還沒輸入或對不上 = 0、不能下一步);編號店其他本 = 0(沒有 ①)。
 */
export const splitSkipPlanOf = (
  countMode: string,
  card: {
    unopened: boolean;
    pendingSkipCount: number;
    pendingSkipTotal: number;
  },
  systemCount: number,
  actualText: string,
): SplitSkipPlan => {
  const askCount = splitNeedsActualCount(countMode, card.unopened);
  if (!askCount) {
    return {
      askCount,
      pending: card.pendingSkipCount,
      countReady: true,
      hasSkipStep: card.pendingSkipCount > 0,
      problem: null,
      actualCount: null,
    };
  }
  const trimmed = actualText.trim();
  const actualCount = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const counted =
    actualCount === null
      ? null
      : splitSkipCountOf(systemCount, actualCount, card.pendingSkipTotal);
  return {
    askCount,
    pending: counted?.ok === true ? counted.skipCount : 0,
    countReady: counted?.ok === true,
    hasSkipStep: true,
    problem: counted === null || counted.ok ? null : counted.problem,
    actualCount,
  };
};
