import { formatTicketNo } from "./ticket-code";

/**
 * 期初建檔(期初建檔規格第 2、3 節):導入當下店裡的一本,照張號記成
 * ① 導入前已賣出(期初已售)② 跳號 ③ 手上的張放在哪(收銀點檯面或庫存)。
 * api 建檔前檢查、admin 建檔頁的合計與提示用同一份判斷。
 */

/** ③ 分放的一組:這些張號放在哪個收銀點的檯面;`cashPointId: null` = 庫存。 */
export interface OpeningPlacement {
  cashPointId: string | null;
  ticketNos: readonly string[];
}

/** 建一本的計畫(張號一律三位字串,例 `"046"`)。 */
export interface OpeningPlan {
  /** 迄號(起號固定 001)。 */
  lastTicketNo: number;
  /** 遊戲的標準張數。 */
  standardTickets: number;
  /** ① 導入前已賣出。 */
  soldTicketNos: readonly string[];
  /** ② 跳號。 */
  skippedTicketNos: readonly string[];
  /** ③ 手上的張放在哪。 */
  placements: readonly OpeningPlacement[];
}

/**
 * 計畫不合的原因;可以建 = null。
 *
 * - `ticket_out_of_range`:張號不在 001–迄號
 * - `ticket_repeated`:同一張出現在兩個地方(已賣出 / 跳號 / 分放)
 * - `unplaced`:有張沒標、也沒分放
 * - `all_sold`:手上一張都沒有(整本都賣完的本不用建檔,E3)
 * - `skip_count_mismatch`:拆過的本跳號沒剛好標滿待標註;原封的本只能不標或標滿
 */
export type OpeningPlanProblem =
  | "ticket_out_of_range"
  | "ticket_repeated"
  | "unplaced"
  | "all_sold"
  | "skip_count_mismatch";

/** 待標註張數 = 迄號 − 標準張數。 */
export function openingPendingSkipCountOf(
  plan: Pick<OpeningPlan, "lastTicketNo" | "standardTickets">,
): number {
  return Math.max(0, plan.lastTicketNo - plan.standardTickets);
}

/** 這本拆過了沒:有導入前已賣出,或有張放在檯面(規格 2.3;整本原封在庫存 = 未拆)。 */
export function isOpeningBookOpened(plan: {
  soldTicketNos: readonly string[];
  /** `cashPointId` null = 庫存(api 傳 ObjectId、畫面傳字串都可以)。 */
  placements: readonly { cashPointId: unknown; ticketNos: readonly string[] }[];
}): boolean {
  return (
    plan.soldTicketNos.length > 0 ||
    plan.placements.some(
      (placement) =>
        placement.cashPointId !== null && placement.ticketNos.length > 0,
    )
  );
}

/** 期初建檔的計畫檢查(規格 3.1、3.2)。 */
export function openingPlanProblemOf(
  plan: OpeningPlan,
): OpeningPlanProblem | null {
  const all = new Set(
    Array.from({ length: plan.lastTicketNo }, (_, index) =>
      formatTicketNo(index + 1),
    ),
  );
  const seen = new Set<string>();
  const groups = [
    plan.soldTicketNos,
    plan.skippedTicketNos,
    ...plan.placements.map((placement) => placement.ticketNos),
  ];
  for (const group of groups) {
    for (const no of group) {
      if (!all.has(no)) {
        return "ticket_out_of_range";
      }
      if (seen.has(no)) {
        return "ticket_repeated";
      }
      seen.add(no);
    }
  }
  if (seen.size !== all.size) {
    return "unplaced";
  }
  const inHand =
    all.size - plan.soldTicketNos.length - plan.skippedTicketNos.length;
  if (inHand <= 0) {
    return "all_sold";
  }
  const pending = openingPendingSkipCountOf(plan);
  const skipped = plan.skippedTicketNos.length;
  const allowed = isOpeningBookOpened(plan) ? [pending] : [0, pending];
  return allowed.includes(skipped) ? null : "skip_count_mismatch";
}

/**
 * 期初已售放在哪(規格 2.2):跟著這本在手上的張,分放到幾個位置時放在張號最小那組的位置。
 * 回傳那一組的 `cashPointId`(null = 庫存)。
 */
export function openingSoldPlaceOf(
  placements: readonly OpeningPlacement[],
): string | null {
  let best: { no: string; cashPointId: string | null } | null = null;
  for (const placement of placements) {
    for (const no of placement.ticketNos) {
      if (best === null || no < best.no) {
        best = { no, cashPointId: placement.cashPointId };
      }
    }
  }
  return best?.cashPointId ?? null;
}

/**
 * 刷到「手上最上面那一張」→ 比它小的全部預先標成導入前已賣出(規格 3.1 ①;可再點格子改)。
 * 已標成跳號的張不算進來。
 */
export function openingPresoldOf(
  topTicketNo: string,
  skippedTicketNos: readonly string[] = [],
): string[] {
  const top = Number(topTicketNo);
  const skipped = new Set(skippedTicketNos);
  return Array.from({ length: Math.max(0, top - 1) }, (_, index) =>
    formatTicketNo(index + 1),
  ).filter((no) => !skipped.has(no));
}
