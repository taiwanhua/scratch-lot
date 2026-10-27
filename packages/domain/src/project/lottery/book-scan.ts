/** 刷到的碼要比對的本:遊戲 + 本號(本號 7 位;格式不對 = null,不會對到)。 */
export interface ScanBookFacts {
  gameId: string;
  /** 遊戲代號;不知道 = undefined(背面編號就對不到) */
  gameCode: string | undefined;
  bookNo: string | null;
}

/** 刷到的碼解出來的部分(正面的碼沒有遊戲代號 = null)。 */
export interface BookScanKey {
  gameCode: string | null;
  bookNo: string;
}

/**
 * 刷到的碼對到哪些項目(進貨點收、調貨點收、調貨新增頁共用;專案規格 8.2、8.4):
 *
 * - `matched`:對到同一款遊戲的項目(調貨單同一本可能有好幾列選張,由呼叫端再看張號)
 * - `ambiguous_game`:正面的碼(沒有遊戲代號)對到**好幾款遊戲同本號**,也沒選遊戲 → 不自動配第一筆,
 *   請刷背面編號或選遊戲(`gameIds` = 對到的遊戲,順序照項目出現)
 * - `none`:一個都沒對到
 */
export type BookScanMatch<T> =
  | { kind: "matched"; items: T[] }
  | { kind: "ambiguous_game"; gameIds: string[] }
  | { kind: "none" };

/**
 * 背面編號有遊戲代號:遊戲代號 + 本號都要對;正面的碼沒有遊戲代號:用本號對,
 * 有選遊戲(`pickedGameId`)就只看那款遊戲。背面編號不看選的遊戲(碼本身就有遊戲代號)。
 */
export function matchBookScan<T>(
  items: readonly T[],
  scan: BookScanKey,
  factsOf: (item: T) => ScanBookFacts | undefined,
  pickedGameId: string | null = null,
): BookScanMatch<T> {
  const onBook = items.filter((item) => {
    const facts = factsOf(item);
    if (facts?.bookNo !== scan.bookNo) {
      return false;
    }
    if (scan.gameCode !== null) {
      return facts.gameCode === scan.gameCode;
    }
    return pickedGameId === null || facts.gameId === pickedGameId;
  });
  const gameIds = [
    ...new Set(onBook.map((item) => factsOf(item)?.gameId ?? "")),
  ];
  const [gameId] = gameIds;
  if (gameId === undefined) {
    return { kind: "none" };
  }
  if (gameIds.length > 1) {
    return { kind: "ambiguous_game", gameIds };
  }
  return { kind: "matched", items: onBook };
}
