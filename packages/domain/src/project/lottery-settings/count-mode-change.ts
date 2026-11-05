import {
  COUNT_MODE,
  type CountMode,
  type CountModeSetting,
  type StoreBusy,
  countModeOf,
} from "../lottery/count-mode";

/**
 * 改「盤點制度」設定時,各分店怎麼變、哪些擋下(張數店規格第 4 節、9.1、9.2、13.1「刮刮樂設定頁」)。
 * 在分店改、或在上層改預設都一樣:先算出生效設定會變的分店(沿用的那些),每家店各自判斷。
 */

/** 一家分店改設定前後的狀況(呼叫端查好的)。 */
export interface CountModeChangeStore {
  orgId: string;
  /** 改之前的生效設定 */
  before: CountModeSetting;
  /** 改之後的生效設定 */
  after: CountModeSetting;
  /** 分店實際的盤點制度(沒有筆或 mode 空 = 編號) */
  current: CountMode;
  /** 這家店還有幾張未對號 */
  unmatchedCount: number;
  /** 檯面上還有待標註的本(幾本) */
  pendingSkipBooks: number;
  /** 進行中的盤點、全店重刷或補點編號(`storeBusyOf`);沒有 = null */
  busy: StoreBusy | null;
}

/**
 * 擋下的原因:
 * - `pending_skip`:改成張數,但檯面上還有待標註的本(要先到看板標完跳號;9.1,原因同 7.5)
 * - `busy`:有登記盤點中、全店重刷或補點編號還沒結束(兩個方向都擋;9.1)
 */
export type CountModeChangeProblem = "pending_skip" | "busy";

/** 會跟著改的一家分店:實際制度從哪種到哪種,與擋下的原因(沒有 = 可以改)。 */
export interface CountModeChangeOutcome {
  orgId: string;
  from: CountMode;
  to: CountMode;
  problems: CountModeChangeProblem[];
}

/** 一家分店這次改動的問題(不會跟著改的分店沒有問題)。 */
export function countModeChangeProblemsOf(
  store: CountModeChangeStore,
): CountModeChangeProblem[] {
  if (store.before === store.after) {
    return [];
  }
  const problems: CountModeChangeProblem[] = [];
  if (
    store.after === COUNT_MODE.count &&
    store.current === COUNT_MODE.numbered &&
    store.pendingSkipBooks > 0
  ) {
    problems.push("pending_skip");
  }
  if (store.busy !== null) {
    problems.push("busy");
  }
  return problems;
}

/**
 * 這次改動會跟著改的分店(生效設定有變的,依呼叫端給的順序):實際制度照 `countModeOf`
 * (改張數 = 當下生效;改編號 = 還有未對號就進轉換中、沒有就直接編號),附上擋下的原因。
 * 任何一家有問題,這次就整筆不能存(上層改預設時也一樣;13.1)。
 */
export function countModeChangeOutcomesOf(
  stores: readonly CountModeChangeStore[],
): CountModeChangeOutcome[] {
  return stores
    .filter((store) => store.before !== store.after)
    .map((store) => ({
      orgId: store.orgId,
      from: store.current,
      to: countModeOf(store.after, store.unmatchedCount, store.current),
      problems: countModeChangeProblemsOf(store),
    }));
}

/** [取消轉換] 只有轉換中的店可以按(9.2);回到張數。 */
export function canCancelConversion(current: CountMode): boolean {
  return current === COUNT_MODE.converting;
}
