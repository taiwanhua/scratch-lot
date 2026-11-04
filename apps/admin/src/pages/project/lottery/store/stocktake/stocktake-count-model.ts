import { useState } from "react";

import {
  type StocktakeDiffAction,
  type StocktakeDraft,
  stocktakeNavOf,
} from "@repo/domain/project/lottery";

import {
  type SheetBook,
  type SheetCountGroup,
  type StocktakeReview,
  type StocktakeSheet,
  type StocktakeState,
  bookKeyOf,
  countGroupKeyOf,
  diffKeyOf,
  figuresOf,
  groupKeyOf,
  lineKeyOf,
  stateOfDraft,
} from "./stocktake-model";

/**
 * 張數盤點(張數店規格 8.1、8.2、13.1)的畫面規則:一組的狀態、差異、盤點頁的項目順序、接續帶回的進度、
 * 差異核對底部的張數。`stocktake-model.ts` 放兩種盤點共用的盤點內容。
 */

/**
 * 張數盤點一組(畫面狀態;張數店規格 8.1、8.2、13.1):開始數的時間、實際剩幾張(按 [確定] 前 = null,
 * 數之前不顯示系統數字)、[重數] 前的每次輸入、差異的處理([算售出] 已寫的張數與 id、[待查] 幾張、[標記異常])。
 */
export interface GroupCount {
  countedAt: string;
  presentCount: number | null;
  recounts: number[];
  saleCount: number;
  saleRefIds: string[];
  investigateCount: number;
  flagged: boolean;
  /** 按 [確定] 那一刻畫面上的系統數字(只顯示用,不送;接續後沒有 = 用現在的) */
  systemShown?: number;
}

/** 一組現在的處理(還沒數 = 預設)。 */
export const emptyGroupCount = (countedAt: string): GroupCount => ({
  countedAt,
  presentCount: null,
  recounts: [],
  saleCount: 0,
  saleRefIds: [],
  investigateCount: 0,
  flagged: false,
});

/** 張數盤點一組的差異(按 [確定] 後,以畫面讀到的系統數字;送出時伺服器以開始數那一刻比對)。 */
export const groupDiffOf = (
  group: Pick<SheetCountGroup, "unsoldCount">,
  count: GroupCount | undefined,
): number | null =>
  count?.presentCount == null
    ? null
    : count.presentCount - (count.systemShown ?? group.unsoldCount);

/** 盤點內容裡每一本 / 每一組開始盤的時間(接續後畫面以它們當開始時間)。 */
export const viewedAtOfDraft = (
  draft: StocktakeDraft,
): Partial<Record<string, string>> => {
  const result: Partial<Record<string, string>> = {};
  for (const line of draft.lines) {
    result[lineKeyOf(line.bookId, line.cashPointId)] = line.countedAt;
  }
  for (const line of draft.countLines ?? []) {
    result[groupKeyOf(line.cashPointId, line.gameId)] = line.countedAt;
  }
  return result;
};

/** 差異核對底部的待查 / 標記異常張數(逐張的處理 + 張數盤點的組)。 */
export const reviewTotalsOf = (
  review: StocktakeReview | null,
  state: StocktakeState,
): { investigated: number; flagged: number } => {
  const lines = review?.lines ?? [];
  const actionCount = (action: StocktakeDiffAction) =>
    lines.reduce(
      (sum, line) =>
        sum +
        line.diffs.filter(
          (diff) =>
            state.diffs[
              diffKeyOf(lineKeyOf(line.bookId, line.cashPointId), diff.ticketNo)
            ]?.action === action,
        ).length,
      0,
    );
  const countLines = review?.countLines ?? [];
  return {
    investigated:
      actionCount("investigate") +
      countLines.reduce(
        (sum, line) =>
          sum +
          (state.groups[groupKeyOf(line.cashPointId, line.gameId)]
            ?.investigateCount ?? 0),
        0,
      ),
    flagged:
      actionCount("flag") +
      countLines.reduce(
        (sum, line) =>
          sum +
          (line.kind === "over" &&
          state.groups[groupKeyOf(line.cashPointId, line.gameId)]?.flagged ===
            true
            ? line.diffCount
            : 0),
        0,
      ),
  };
};

/** 盤點頁的項目:張數盤點的組(依收銀點、遊戲)→ 本(檯面的本 / 拆過在庫存的本);選中的那一項。 */
export const stocktakeItemsOf = (
  sheet: Pick<StocktakeSheet, "books" | "countGroups"> | null,
  selectedKey: string | null,
) => {
  const books: readonly SheetBook[] = sheet?.books ?? [];
  const countGroups: readonly SheetCountGroup[] = sheet?.countGroups ?? [];
  const itemKeys = [
    ...countGroups.map((group) => countGroupKeyOf(group)),
    ...books.map((book) => bookKeyOf(book)),
  ];
  const currentKey =
    selectedKey !== null && itemKeys.includes(selectedKey)
      ? selectedKey
      : (itemKeys.at(0) ?? null);
  return {
    books,
    countGroups,
    itemKeys,
    currentKey,
    current: books.find((book) => bookKeyOf(book) === currentKey),
    currentGroup: countGroups.find(
      (group) => countGroupKeyOf(group) === currentKey,
    ),
  };
};

/** 這一項已數(本:有盤點;組:按了 [確定])。 */
export const isItemCounted = (
  state: StocktakeState | null,
  key: string,
): boolean =>
  state !== null &&
  (state.counts[key] !== undefined || state.groups[key]?.presentCount != null);

/** 盤點頁上方「差異 N 張」:逐張的差異 + 每組差幾張。 */
export const diffTotalOf = (
  books: readonly SheetBook[],
  countGroups: readonly SheetCountGroup[],
  state: StocktakeState,
): number =>
  books.reduce(
    (sum, book) =>
      sum + figuresOf(book, state.counts[bookKeyOf(book)]).diffNos.length,
    0,
  ) +
  countGroups.reduce(
    (sum, group) =>
      sum +
      Math.abs(groupDiffOf(group, state.groups[countGroupKeyOf(group)]) ?? 0),
    0,
  );

/** [繼續] 帶回的進度 → 畫面狀態與每一項開始盤的時間;讀不懂 = null。 */
export const resumedOf = (
  draft: StocktakeDraft | null,
  sheet: StocktakeSheet,
): {
  state: StocktakeState;
  viewedAt: Partial<Record<string, string>>;
} | null =>
  draft === null
    ? null
    : { state: stateOfDraft(draft, sheet), viewedAt: viewedAtOfDraft(draft) };

/**
 * 盤點頁的 [上一本] [下一本](張數店規格 13.3;`stocktakeNavOf`):上一項的 key(第一項 = null,按鈕停用)、
 * 下一項的 key(下一個還沒盤的;全部盤完 = null → [盤完,前往差異核對])、已盤幾項。
 */
export const stocktakeNavKeysOf = (
  itemKeys: readonly string[],
  currentKey: string | null,
  isCounted: (key: string) => boolean,
): { prevKey: string | null; nextKey: string | null; counted: number } => {
  const index = currentKey === null ? -1 : itemKeys.indexOf(currentKey);
  const counted = itemKeys.filter((key) => isCounted(key));
  const nav = stocktakeNavOf(
    itemKeys,
    index,
    new Set(counted.filter((key) => key !== currentKey)),
  );
  return {
    prevKey: nav.prev === null ? null : (itemKeys.at(nav.prev) ?? null),
    nextKey:
      nav.next.kind === "review" ? null : (itemKeys.at(nav.next.index) ?? null),
    counted: counted.length,
  };
};

/** 盤點頁的查詢條件:補點編號另帶 `purpose`(張數店規格 9.3;一般盤點不帶,和以前一樣)。 */
export const sheetInputOf = (
  orgId: string,
  cashPointId: string | null,
  purpose: "normal" | "renumber",
) => ({
  orgId,
  cashPointId,
  ...(purpose === "renumber" && { purpose }),
});

/** 值換了就呼叫一次 `reset`(畫面計算時調整 state,同 React 的「依前一次 render 調整 state」)。 */
export const useResetOnChange = (value: string, reset: () => void): void => {
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    reset();
  }
};

/**
 * 補點編號還沒盤的(張數店規格 9.3 第 1 點、16.8 RN3):還沒盤的本 + 還沒回答在 / 不在的未拆的本;
 * 一般盤點 = 0(沒盤完也可以前往差異核對)。
 */
export const renumberLeftOf = (
  isRenumber: boolean,
  uncountedItems: number,
  unopenedBooks: readonly { bookId: string }[],
  unopened: Partial<Record<string, boolean>>,
): number =>
  isRenumber
    ? uncountedItems +
      unopenedBooks.filter((book) => unopened[book.bookId] == null).length
    : 0;

/** 盤點頁的狀態要的輸入(`useStocktakeFlow`)。 */
export interface StocktakeFlowInput {
  orgId: string;
  scopeCashPointId: string | null;
  initialDraft: StocktakeDraft | null;
  /** 補點編號(張數店與轉換中的全店編號盤點;張數店規格 9.3);不給 = 一般盤點 */
  purpose?: "normal" | "renumber";
}

/** 盤點步驟底部的說明:補點編號 = 還有幾本沒盤;一般盤點 = 盤點期間照常銷售。 */
export const countFooterOf = (
  isRenumber: boolean,
  left: number,
): [key: string, values?: { count: number }] =>
  isRenumber ? ["renumber.footer", { count: left }] : ["page.footer"];

/** 能不能前往差異核對:至少盤了一項;補點編號要全部盤完。 */
export const canReviewOf = (counted: number, renumberLeft: number): boolean =>
  counted > 0 && renumberLeft === 0;
