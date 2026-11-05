import { pickForReversal } from "./count-mode";
import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketLocationKind,
  type TicketSoldSource,
  type TicketStatus,
} from "./ticket-events";

/**
 * 撤銷售出申請送出時要鎖哪幾張(張數店規格 7.3 第 1、3 點、14.2 `beforeSubmitSaleReversal`;正本
 * `docs/modules/project/store.md`「撤銷售出申請」)。送出前檢查與送出時的寫入用同一個計畫,伺服器在交易裡算,不信用前端。
 */

/** 計畫用的一張(讀到的欄位;`locked` = 被別的單鎖住,這張單自己的鎖不算)。 */
export interface ReversalPlanTicket {
  id: string;
  gameId: string;
  /** 是這家分店的張 */
  inStore: boolean;
  status: TicketStatus;
  unmatched: boolean;
  locked: boolean;
  locationKind: TicketLocationKind;
  cashPointId: string | null;
  soldAt: Date | null;
  soldSource: TicketSoldSource | null;
}

/** 依張號的一張(刷條碼、手輸或點格子)與刷它的那一台(依張號列的收銀點)。 */
export interface ReversalPlanScan {
  rowId: string;
  ticket: ReversalPlanTicket;
  cashPointId: string | null;
}

/** 依遊戲 + 張數的一列。 */
export interface ReversalPlanCountLine {
  rowId: string;
  gameId: string;
  cashPointId: string;
  count: number;
}

export interface ReversalPlanInput {
  /** 這家店對號(張數店與轉換中);編號店只收已售、不對號 */
  matching: boolean;
  scans: readonly ReversalPlanScan[];
  /** 相關「遊戲 × 收銀點」的已售·未對號(依張數賣、盤點算售出挑到的張、對號接手的張) */
  carriers: readonly ReversalPlanTicket[];
  countLines: readonly ReversalPlanCountLine[];
}

/** 一張刷到的張要先和誰對號(對號後這張接手那張帶著的依張數售出,再鎖)。 */
export interface ReversalPlanMatch {
  scannedId: string;
  partnerId: string;
}

export type ReversalPlanProblem =
  /** 不是本店已售(或不能對號的狀態)、被別的單鎖住、跳號、報廢、在途 */
  | { kind: "not_reversible"; rowId: string; ticketId: string }
  /** 張數店刷到的票不是確定張號的已售,這台這個遊戲又沒有依張數售出可對號 */
  | { kind: "count_sale_not_found"; rowId: string; ticketId: string }
  /** 依遊戲 + 張數:這台這個遊戲的已售·未對號不夠,還有 `available` 張 */
  | { kind: "count_exceeds"; rowId: string; available: number };

export type ReversalPlan =
  | {
      ok: true;
      /** 照張號鎖的張(確定張號的已售;張數店找不到依張數售出可對號、自己就是已售的也照張號) */
      byNumber: string[];
      /** 先對號再鎖 */
      matches: ReversalPlanMatch[];
      /** 依遊戲 + 張數挑到的張(依列;售出時間新到舊) */
      picked: { rowId: string; ticketIds: string[] }[];
    }
  | { ok: false; problem: ReversalPlanProblem };

/** 確定張號的已售(刷條碼賣出、對過號或補點確認過):照張號撤。 */
function isCertainSold(ticket: ReversalPlanTicket): boolean {
  return ticket.status === TICKET_STATUS.sold && !ticket.unmatched;
}

/** 這張不能進撤銷申請(不看狀態是不是已售):不是本店、被別的單鎖住、跳號、報廢、在途。 */
function isBlocked(ticket: ReversalPlanTicket): boolean {
  return (
    !ticket.inStore ||
    ticket.locked ||
    ticket.status === TICKET_STATUS.skipped ||
    ticket.status === TICKET_STATUS.scrapped ||
    ticket.locationKind === TICKET_LOCATION_KIND.inTransit
  );
}

/** 售出時間新到舊;同時間依 id 新到舊(同 api 的 `{ soldAt: -1, _id: -1 }`)。 */
const newestFirst = (
  left: ReversalPlanTicket,
  right: ReversalPlanTicket,
): number =>
  (right.soldAt?.getTime() ?? 0) - (left.soldAt?.getTime() ?? 0) ||
  right.id.localeCompare(left.id);

/** 依張號的一張怎麼處理:照張號、先對號,或擋下的原因。 */
type ScanStep =
  | { kind: "by_number" }
  | { kind: "match"; partnerId: string }
  | { kind: "not_reversible" | "count_sale_not_found" };

/** 刷它的那一台、同遊戲最近一筆依張數售出帶著的一張(沒用過、沒被鎖)。 */
function countSaleCarrierOf(
  scan: ReversalPlanScan,
  carriers: readonly ReversalPlanTicket[],
  used: ReadonlySet<string>,
): ReversalPlanTicket | undefined {
  if (scan.cashPointId === null) {
    return undefined;
  }
  return carriers.find(
    (carrier) =>
      !used.has(carrier.id) &&
      carrier.gameId === scan.ticket.gameId &&
      carrier.inStore &&
      !carrier.locked &&
      carrier.status === TICKET_STATUS.sold &&
      carrier.unmatched &&
      carrier.soldSource === "count" &&
      carrier.locationKind === TICKET_LOCATION_KIND.counter &&
      carrier.cashPointId === scan.cashPointId,
  );
}

function scanStepOf(
  scan: ReversalPlanScan,
  matching: boolean,
  carriers: readonly ReversalPlanTicket[],
  used: ReadonlySet<string>,
): ScanStep {
  const ticket = scan.ticket;
  if (isBlocked(ticket)) {
    return { kind: "not_reversible" };
  }
  const sold = ticket.status === TICKET_STATUS.sold;
  if (isCertainSold(ticket) || (!matching && sold)) {
    return { kind: "by_number" };
  }
  if (!matching) {
    return { kind: "not_reversible" };
  }
  const partner = countSaleCarrierOf(scan, carriers, used);
  if (partner !== undefined) {
    return { kind: "match", partnerId: partner.id };
  }
  return sold ? { kind: "by_number" } : { kind: "count_sale_not_found" };
}

/**
 * 撤銷售出申請送出時的計畫(張數店規格 7.3 第 1、3 點):
 *
 * - **依張號**:確定張號的已售 → 照張號鎖。張數店的其他張(未售、待查、遺失、已售·未對號)→ 先和刷它的那一台、
 *   同遊戲最近一筆依張數售出帶著的其中一張對號(這張接手那筆售出),再鎖;那台沒有依張數售出可對號時,
 *   自己是已售(·未對號)就照張號鎖,否則擋下 `count_sale_not_found`。編號店只收已售。
 *   被別的單鎖住、跳號、報廢、在途、不是本店 → `not_reversible`。
 * - **依遊戲 + 張數**:這台這個遊戲最近的已售·未對號(`pickForReversal`,售出時間新到舊);
 *   不夠 → `count_exceeds` 帶還有幾張。
 *
 * 依張號先算(它對號用掉的張、它自己都不會再被依張數挑到),同一張只用一次。
 */
export function saleReversalPlanOf(input: ReversalPlanInput): ReversalPlan {
  const used = new Set(input.scans.map((scan) => scan.ticket.id));
  const byNumber: string[] = [];
  const matches: ReversalPlanMatch[] = [];
  const carriers = input.carriers.toSorted(newestFirst);
  for (const scan of input.scans) {
    const step = scanStepOf(scan, input.matching, carriers, used);
    if (step.kind === "by_number") {
      byNumber.push(scan.ticket.id);
    } else if (step.kind === "match") {
      used.add(step.partnerId);
      matches.push({ scannedId: scan.ticket.id, partnerId: step.partnerId });
    } else {
      return {
        ok: false,
        problem: {
          kind: step.kind,
          rowId: scan.rowId,
          ticketId: scan.ticket.id,
        },
      };
    }
  }
  const picked: { rowId: string; ticketIds: string[] }[] = [];
  for (const line of input.countLines) {
    const candidates = carriers.filter(
      (carrier) =>
        !used.has(carrier.id) &&
        carrier.inStore &&
        carrier.gameId === line.gameId &&
        carrier.locationKind === TICKET_LOCATION_KIND.counter &&
        carrier.cashPointId === line.cashPointId,
    );
    const result = pickForReversal(candidates, line.count);
    if (!result.ok) {
      return {
        ok: false,
        problem: {
          kind: "count_exceeds",
          rowId: line.rowId,
          available: result.available,
        },
      };
    }
    for (const id of result.ticketIds) {
      used.add(id);
    }
    picked.push({ rowId: line.rowId, ticketIds: result.ticketIds });
  }
  return { ok: true, byNumber, matches, picked };
}

/** 位置(撤銷申請核准後張回到哪裡)。 */
export interface ReversalPlace {
  locationKind: TicketLocationKind;
  cashPointId: string | null;
}

/**
 * 撤銷售出申請核准後張回到哪裡(張數店規格 7.3 第 5 點、8.4 第 3 點):盤點多出的申請(全店重刷列出「記已售但還在」
 * 送出的)→ 回到重刷刷到的位置;其他照現況回售出的收銀點(帶著的那筆售出記的收銀點)。
 *
 * 「重刷進來的」= 這張最近一次重刷結果是記已售但還在,且申請列記的位置就是那次刷到的位置(收銀點;庫存兩邊都是 null)。
 * 位置以重刷單為準,不信用前端。售出的收銀點也沒有 → null(位置不變)。
 */
export function saleReversalReturnPlaceOf(input: {
  saleCashPointId: string | null;
  lineCashPointId: string | null;
  /** 這張最近一次「記已售但還在」的重刷位置;沒有 = null */
  rescanPlace: { cashPointId: string | null } | null;
}): ReversalPlace | null {
  const rescan = input.rescanPlace;
  if (rescan !== null && rescan.cashPointId === input.lineCashPointId) {
    return rescan.cashPointId === null
      ? { locationKind: TICKET_LOCATION_KIND.stock, cashPointId: null }
      : {
          locationKind: TICKET_LOCATION_KIND.counter,
          cashPointId: rescan.cashPointId,
        };
  }
  return input.saleCashPointId === null
    ? null
    : {
        locationKind: TICKET_LOCATION_KIND.counter,
        cashPointId: input.saleCashPointId,
      };
}
