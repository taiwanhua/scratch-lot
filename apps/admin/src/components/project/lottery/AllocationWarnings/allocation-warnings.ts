import { allocationExcessOf } from "@repo/domain/project/lottery";

/** 一個遊戲:分店的預計要給本數 / 已給 / 在途,與這張單要給的本數。 */
export interface AllocationWarningItem {
  key: string;
  /** 遊戲名稱(例「5164 發大財」) */
  label: string;
  plannedBooks: number | null;
  givenBooks: number;
  inTransitBooks: number;
  /** 這張單給這家店幾本(整本) */
  books: number;
}

/** 超過預計要給本數的那幾個遊戲(超過幾本);沒超過的不列。 */
export const allocationWarningsOf = (
  items: readonly AllocationWarningItem[],
): { key: string; label: string; excess: number }[] =>
  items.flatMap((item) => {
    const excess = allocationExcessOf(item);
    return excess > 0 ? [{ key: item.key, label: item.label, excess }] : [];
  });
