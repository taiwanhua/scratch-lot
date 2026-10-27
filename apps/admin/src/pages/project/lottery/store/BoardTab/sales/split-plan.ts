import type { SplitAssignment } from "@repo/domain/project/lottery";

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
