import type { LotteryAllocationCellFieldsFragment } from "@repo/graphql";

/** 格子的文字所需的字典(元件傳入,保持這個檔不依賴 React)。 */
export interface AllocationTextLabels {
  /** 「+{count} 張」 */
  extraTickets: (count: number) => string;
  /** 沒有設定預計時顯示的字(「—」) */
  none: string;
}

/**
 * 已給:整本 N 本 + 零碎 N 張(規格 7.6;零碎張數不湊成一本)。
 * 例:3 本 → 「3」;3 本 + 30 張 → 「3 +30 張」;0 本 + 20 張 → 「+20 張」;都沒有 → 「0」。
 */
export const givenText = (
  cell:
    | Pick<
        LotteryAllocationCellFieldsFragment,
        "givenBooks" | "givenExtraTickets"
      >
    | undefined,
  labels: AllocationTextLabels,
): string => {
  const books = cell?.givenBooks ?? 0;
  const extra = cell?.givenExtraTickets ?? 0;
  if (extra === 0) {
    return String(books);
  }
  const extraText = labels.extraTickets(extra);
  return books === 0 ? extraText : `${String(books)} ${extraText}`;
};

/** 「已給 / 預計」(預計沒有設定 → 「—」)。 */
export const cellText = (
  cell: LotteryAllocationCellFieldsFragment | undefined,
  labels: AllocationTextLabels,
): string => {
  const planned =
    cell?.plannedBooks == null ? labels.none : String(cell.plannedBooks);
  return `${givenText(cell, labels)} / ${planned}`;
};

/** 已給超過預計(整本數比預計多,或一樣多還有零碎張數)→ 警告色(只警告)。 */
export const isOverPlanned = (
  cell: LotteryAllocationCellFieldsFragment | undefined,
): boolean => {
  if (cell?.plannedBooks == null) {
    return false;
  }
  return (
    cell.givenBooks > cell.plannedBooks ||
    (cell.givenBooks === cell.plannedBooks && cell.givenExtraTickets > 0)
  );
};
