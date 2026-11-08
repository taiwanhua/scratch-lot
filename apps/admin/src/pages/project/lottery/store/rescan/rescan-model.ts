import {
  type RescanPlaceState,
  STOCKTAKE_CONFIRM_FORM_KEY,
  displayBookNo,
  rescanBlocksCountGroup,
} from "@repo/domain/project/lottery";
import type {
  LotteryRescanFieldsFragment,
  LotteryRescanItemFieldsFragment,
  LotteryStocktakeStatusQuery,
} from "@repo/graphql";

/**
 * 全店重刷畫面的資料整理(張數店規格 8.4、8.5a、13.1、13.2;Figma CS-01c、CS-09b、CS-10b / 10d)。
 */

export type RescanView = LotteryRescanFieldsFragment;
export type RescanItem = LotteryRescanItemFieldsFragment;
export type RescanPlaceView = RescanView["places"][number];
export type RescanBrief =
  LotteryStocktakeStatusQuery["lotteryStocktakeStatus"]["rescans"][number];
export type RescanReminder =
  LotteryStocktakeStatusQuery["lotteryStocktakeStatus"]["rescanReminders"][number];

/** 重刷頁的 query key 前綴(看板信號 `board` 一起重抓:別人在別的位置刷、刷完、取消)。 */
export const STORE_RESCAN_QUERY_KEY = ["LotteryRescan"] as const;

/** 重刷頁的網址:盤點確認申請的新增頁(頁籤「盤點」),`?org=` 分店、`?rescan=` 那一次重刷。 */
export const rescanHref = (
  createRoute: string,
  orgId: string,
  rescanId: string,
): string =>
  `${createRoute}/${STOCKTAKE_CONFIRM_FORM_KEY}?${new URLSearchParams({
    org: orgId,
    rescan: rescanId,
  }).toString()}`;

/** 位置的 key(庫存 = 空字串;下拉的值)。 */
export const placeKeyOf = (cashPointId: string | null | undefined): string =>
  cashPointId ?? "";

/** 重刷頁清單的一列:刷到的一張,或連續幾張「沒問題」合成一列(Figma CS-10b「#044~050 等 7 張 沒問題」)。 */
export type RescanRow =
  | { kind: "item"; item: RescanItem }
  | {
      kind: "okRange";
      key: string;
      gameCode: string;
      bookNo: string;
      first: string;
      last: string;
      count: number;
    };

/** 清單的列:同一本、依刷的順序連續的「沒問題」合成一列(只有一張就照一張列)。 */
export const rescanRowsOf = (items: readonly RescanItem[]): RescanRow[] => {
  const rows: RescanRow[] = [];
  let run: RescanItem[] = [];
  const flush = () => {
    const first = run.at(0);
    const last = run.at(-1);
    if (first === undefined || last === undefined) {
      return;
    }
    if (run.length === 1) {
      rows.push({ kind: "item", item: first });
    } else {
      rows.push({
        kind: "okRange",
        key: `${first.ticketId}~${last.ticketId}`,
        gameCode: first.gameCode,
        bookNo: first.bookNo,
        first: first.ticketNo,
        last: last.ticketNo,
        count: run.length,
      });
    }
    run = [];
  };
  for (const item of items) {
    if (item.outcome !== "ok") {
      flush();
      rows.push({ kind: "item", item });
      continue;
    }
    if (run.length > 0 && run[0]?.bookNo !== item.bookNo) {
      flush();
    }
    run.push(item);
  }
  flush();
  return rows;
};

/** 一張的顯示:「5164 · 056528 · #043」。 */
export const ticketLabelOf = (
  item: Pick<RescanItem, "gameCode" | "bookNo" | "ticketNo">,
): string =>
  `${item.gameCode} · ${displayBookNo(item.bookNo)} · #${item.ticketNo}`;

/** 還沒刷完的位置名稱(庫存 = `stockLabel`)。 */
export const pendingPlaceNamesOf = (
  places: readonly Pick<RescanPlaceView, "cashPointId" | "name" | "state">[],
  stockLabel: string,
): string[] =>
  places
    .filter((place) => place.state !== "done")
    .map((place) => (place.cashPointId == null ? stockLabel : place.name));

/**
 * 盤點頁 B5(8.5a):進行中的重刷裡,位置 P 的 X 已開始刷、還沒按刷完 → 那一組不能數。回傳被擋的
 * `(cashPointId, gameId)` 判斷函式與要顯示的提示(位置 × 遊戲)。
 */
export const rescanBlockOf = (
  rescans: readonly RescanBrief[],
): ((cashPointId: string | null, gameId: string) => boolean) => {
  const active = rescans.map((rescan) => ({
    gameId: rescan.gameId,
    places: rescan.places.map((place) => ({
      cashPointId: place.cashPointId ?? null,
      state: place.state as RescanPlaceState,
    })),
  }));
  return (cashPointId, gameId) =>
    rescanBlocksCountGroup(active, cashPointId, gameId);
};

/** 盤點頁頂部 B5 的提示:正在重刷(已開始、還沒刷完)的位置 × 遊戲。 */
export const rescanningPlacesOf = (
  rescans: readonly RescanBrief[],
): { rescan: RescanBrief; place: RescanBrief["places"][number] }[] =>
  rescans.flatMap((rescan) =>
    rescan.places
      .filter(
        (place) => place.state === "scanning" || place.state === "released",
      )
      .map((place) => ({ rescan, place })),
  );

/** 結果摘要的五類(CS-10d):已對號、已尋回、記已售但還在、確定待查、要先更正。 */
export const rescanSummaryOf = (results: readonly RescanItem[]) => {
  const of = (outcomes: readonly string[]) =>
    results.filter((item) => outcomes.includes(item.outcome));
  return {
    matched: of(["matched"]),
    recovered: of(["recovered", "moved"]),
    soldHere: of(["sold_here"]),
    investigated: of(["investigated"]),
    toFix: of(["skipped", "scrapped", "locked", "unopened"]),
  };
};

/**
 * 進入盤點時有全店重刷進行中要提醒的那些重刷(張數店規格 8.5a「提醒時機」):全店盤點 = 還有沒刷完位置的重刷;
 * 單一收銀點 = 那台還沒刷完的重刷(只列自己那台)。
 */
export const rescansToNotice = (
  rescans: readonly RescanBrief[],
  scopeCashPointId: string | null,
): { rescan: RescanBrief; places: RescanBrief["places"] }[] =>
  rescans.flatMap((rescan) => {
    const places = rescan.places.filter(
      (place) =>
        place.state !== "done" &&
        (scopeCashPointId === null || place.cashPointId === scopeCashPointId),
    );
    return places.length === 0 ? [] : [{ rescan, places }];
  });
