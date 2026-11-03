import {
  type SplitActualCountProblem,
  type SplitAssignment,
  splitNeedsActualCount,
  splitSkipCountOf,
} from "@repo/domain/project/lottery";

/** 拆本 ② 的畫面狀態(放在精靈裡,步驟之間不寫資料庫)。 */
export interface SplitPlaceState {
  mode: "all" | "split";
  /** 全部放到哪個收銀點 */
  allTo: string;
  /** 分放時每一張分到哪個收銀點(張號 → 收銀點 id) */
  assigned: Partial<Record<string, string>>;
  /** 分放時格子裡選的張 */
  selected: string[];
}

/** 這一步要的分配:全部放到一個收銀點,或每個收銀點各自分到的張。 */
export const splitAssignmentsOf = (
  usable: readonly string[],
  points: readonly { id: string }[],
  state: SplitPlaceState,
): SplitAssignment[] =>
  state.mode === "all"
    ? [{ cashPointId: state.allTo, ticketNos: [...usable] }]
    : points.map((point) => ({
        cashPointId: point.id,
        ticketNos: usable.filter((no) => state.assigned[no] === point.id),
      }));

/** 把選的張分給某個收銀點(已分過的改分)。 */
export const assignTo = (
  state: SplitPlaceState,
  pointId: string,
): SplitPlaceState => {
  const assigned = { ...state.assigned };
  for (const no of state.selected) {
    assigned[no] = pointId;
  }
  return { ...state, assigned, selected: [] };
};

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
