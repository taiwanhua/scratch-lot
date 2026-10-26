import type { BookListRow } from "./BookGroupList";

/** 依遊戲分組的一組(還沒加組標題的進度與整組率)。 */
export interface GroupedBooks {
  key: string;
  title: string;
  rows: BookListRow[];
}

/**
 * 把一列一本的資料依遊戲分組(順序照第一次出現);調貨單的明細、出貨確認清單與點收共用。
 * `gameOf` 回這一列的遊戲(key + 組標題),`rowOf` 轉成清單的一本。
 */
export const groupBooksByGame = <T>(
  items: readonly T[],
  gameOf: (item: T) => { key: string; title: string },
  rowOf: (item: T) => BookListRow,
): GroupedBooks[] => {
  const groups = new Map<string, GroupedBooks>();
  for (const item of items) {
    const game = gameOf(item);
    const group = groups.get(game.key) ?? {
      key: game.key,
      title: game.title,
      rows: [],
    };
    group.rows.push(rowOf(item));
    groups.set(game.key, group);
  }
  return [...groups.values()];
};
