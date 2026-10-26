import { useState } from "react";

import {
  type AddBookResult,
  type GroupRates,
  type PurchaseGame,
  type ScannedBook,
  addScannedBook,
  pruneGroupRates,
  removeBook,
  setBookRate,
  setGroupRate,
} from "./purchase-form";

interface BooksState {
  books: ScannedBook[];
  groupRates: GroupRates;
}

const EMPTY: BooksState = { books: [], groupRates: new Map() };

const NO_LOCKED: ReadonlySet<string> = new Set();

/**
 * 進貨單新增頁已刷的本與各遊戲的整組批購金額率(同一份狀態):改整組 → 那個遊戲每一本都套用,
 * 之後再刷進同遊戲的新本沿用這個率;改單本不動整組率;某遊戲的本刪光、或換進貨分店(\`reset\`)時清掉整組率。
 * 編輯頁:`initial` = 帶入的本;`locked` = 鎖住的列(已點收),不能改率、不能移除,改整組也不動它們。
 */
export const usePurchaseBooks = (
  initial: readonly ScannedBook[] = [],
  locked: ReadonlySet<string> = NO_LOCKED,
) => {
  const [state, setState] = useState<BooksState>(() =>
    initial.length === 0
      ? EMPTY
      : { books: [...initial], groupRates: new Map() },
  );
  return {
    books: state.books,
    groupRates: state.groupRates,
    /** 刷一筆條碼;加進去了才更新狀態,結果交給呼叫端顯示提示。 */
    add: (
      raw: string,
      games: readonly PurchaseGame[],
      fallbackGameId: string | null,
    ): AddBookResult => {
      const result = addScannedBook(
        state.books,
        raw,
        games,
        fallbackGameId,
        () => crypto.randomUUID(),
        state.groupRates,
      );
      if (result.kind === "added") {
        setState((current) => ({ ...current, books: result.books }));
      }
      return result;
    },
    setRate: (rowId: string, rate: number) => {
      if (locked.has(rowId)) {
        return;
      }
      setState((current) => ({
        ...current,
        books: setBookRate(current.books, rowId, rate),
      }));
    },
    setGroupRate: (gameId: string, rate: number) => {
      setState((current) => ({
        books: setGroupRate(current.books, gameId, rate, locked),
        groupRates: new Map(current.groupRates).set(gameId, rate),
      }));
    },
    remove: (rowId: string) => {
      if (locked.has(rowId)) {
        return;
      }
      setState((current) => {
        const books = removeBook(current.books, rowId);
        return {
          books,
          groupRates: pruneGroupRates(current.groupRates, books),
        };
      });
    },
    reset: () => {
      setState(EMPTY);
    },
  };
};
