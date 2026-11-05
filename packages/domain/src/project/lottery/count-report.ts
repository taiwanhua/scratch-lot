/**
 * 張數店的營運報表規則(張數店規格第 11 節、16.9 RP1–RP4;正本 `docs/modules/project/reports.md`「營運報表」):
 *
 * - `matchCostSplitOf`:期間內 `match`(對號)事件的成本差,依配對張的新狀態歸到已售成本 / 待查 / 遺失,剩下的是
 *   區塊 4「對號成本調整」那一列(11.2)
 * - `countReportEstimatedOf`:這家店這一期要不要標「估算」(11.1)
 * - `countModePeriodNotesOf`:區塊 8 的盤點制度、補點編號次數、距上次補點編號(11.4)
 * - `monthEndUnrenumberedOf`:區塊 8「月底未補點編號」(第 10 節;已關帳月份的快照)
 */
import {
  COUNT_MODE,
  type CountMode,
  type CountModeChangeCause,
} from "./count-mode";
import { TICKET_STATUS } from "./ticket-events";

/** 一筆 `match` 事件的成本與前 / 後狀態(`onHand` = 那一刻在這家店的庫存:未售、在庫存或檯面)。 */
export interface MatchCostEvent {
  cost: number;
  from: { status: string; onHand: boolean };
  to: { status: string; onHand: boolean };
}

/** 對號的成本差怎麼分(都是「這一期的增減」)。 */
export interface MatchCostSplit {
  /** 在手上(庫存)的成本變動:接手未售的 +、交出未售的 − */
  onHand: number;
  /** 已售成本的變動(配對張接手已售:差額換進已售成本,毛利跟著調) */
  sold: number;
  /** 待查成本的變動(期末待查是那一刻的快照,自然反映;這裡只供對照) */
  investigating: number;
  /** 遺失損失的變動(配對張接手遺失) */
  lost: number;
  /**
   * 區塊 4「對號成本調整」:在手上成本變動扣掉已經跟著已售成本換掉的部分(`onHand + sold`)。
   * 配對張接手已售時是 0(差額在已售成本裡);接手待查或遺失時差額才列在這一列(11.2「實作細節」)。
   */
  adjust: number;
}

const signedOf = (
  event: MatchCostEvent,
  pick: (state: MatchCostEvent["to"]) => boolean,
): number =>
  (pick(event.to) ? event.cost : 0) - (pick(event.from) ? event.cost : 0);

/**
 * 期間內 `match` 事件的成本差(11.2):每一筆依 `isOnHandAt(to)` 加、`isOnHandAt(from)` 減算出在手上的變動,
 * 再依新狀態歸到已售成本、待查、遺失;`adjust` 放進 `expectedEnding`,讓核對的成本是 0。
 * 例:依張數賣記 X(184)已售,刷到 X 時和 Y(200)對號 → 在手上 +184 − 200 = −16、已售成本 +16、調整列 0。
 */
export function matchCostSplitOf(
  events: readonly MatchCostEvent[],
): MatchCostSplit {
  let onHand = 0;
  let sold = 0;
  let investigating = 0;
  let lost = 0;
  for (const event of events) {
    onHand += signedOf(event, (state) => state.onHand);
    sold += signedOf(event, (state) => state.status === TICKET_STATUS.sold);
    investigating += signedOf(
      event,
      (state) => state.status === TICKET_STATUS.investigating,
    );
    lost += signedOf(event, (state) => state.status === TICKET_STATUS.lost);
  }
  return { onHand, sold, investigating, lost, adjust: onHand + sold };
}

/**
 * 這家店這一期的報表要不要標「估算」(11.1):這一期有未對號的事件(事件後是未對號),而且到期末為止沒有一次
 * 補點編號核准不早於這一期最後一筆未對號事件(核准和它自動對號的事件同一刻寫,同時算補點過)。
 * 張數店但這期全部都刷 → 沒有未對號的事件 → 不是估算。
 */
export function countReportEstimatedOf(input: {
  unmatchedAts: readonly Date[];
  renumberApprovedAts: readonly Date[];
  periodEnd: Date;
}): boolean {
  if (input.unmatchedAts.length === 0) {
    return false;
  }
  const last = Math.max(...input.unmatchedAts.map((at) => at.getTime()));
  return !input.renumberApprovedAts.some(
    (at) => at.getTime() >= last && at.getTime() < input.periodEnd.getTime(),
  );
}

/** 盤點制度歷程的一筆(`lottery_store_count_modes.history[]`)。 */
export interface CountModeHistoryRow {
  from: CountMode | null;
  to: CountMode;
  at: Date;
  cause: CountModeChangeCause;
}

/** 區塊 8 的盤點制度註記(11.4)。 */
export interface CountModePeriodNotes {
  /** 期間內任何時候是張數或轉換中(編號店畫面不變:這些列不顯示) */
  countStore: boolean;
  /** 期初那一刻的制度 */
  modeAtStart: CountMode;
  /** 期初那個制度從什麼時候開始(期初以前最後一次換制度);沒有歷程 = null */
  since: Date | null;
  /** 期末那一刻的制度 */
  modeAtEnd: CountMode;
  /** 期間內換制度(例「11/15 起 張數 → 轉換中」;補點編號沒改制度的不列) */
  changes: { at: Date; from: CountMode; to: CountMode }[];
  /** 期間內補點編號核准的時間(「補點編號次數」) */
  renumberAts: Date[];
  /** 期末以前最後一次補點編號核准 */
  lastRenumberAt: Date | null;
  /** 距上次補點編號幾天(期末 − 上次核准,整天;沒補點過 = null) */
  daysSinceRenumber: number | null;
}

const DAY_MS = 86_400_000;

const isCountLike = (mode: CountMode): boolean =>
  mode === COUNT_MODE.count || mode === COUNT_MODE.converting;

/**
 * 一家店某段期間的盤點制度註記(11.4 區塊 8;讀 5.6 `history`)。`current` = 分店那一筆現在的制度(沒有歷程時
 * 就是它;沒有筆 = 編號)。歷程依時間排序後判斷,和關帳快照(`countModeAtOf`)同一個做法。
 */
export function countModePeriodNotesOf(
  history: readonly CountModeHistoryRow[],
  current: CountMode,
  period: { from: Date; to: Date },
): CountModePeriodNotes {
  const sorted = history.toSorted(
    (left, right) => left.at.getTime() - right.at.getTime(),
  );
  const from = period.from.getTime();
  const to = period.to.getTime();
  const modeAt = (time: number): CountMode => {
    if (sorted.length === 0) {
      return current;
    }
    const last = sorted.findLast((entry) => entry.at.getTime() < time);
    return last?.to ?? sorted[0]?.from ?? COUNT_MODE.numbered;
  };
  const switches = sorted.filter(
    (entry) => entry.from !== null && entry.from !== entry.to,
  );
  const changes = switches
    .filter((entry) => entry.at.getTime() >= from && entry.at.getTime() < to)
    .map((entry) => ({
      at: entry.at,
      from: entry.from ?? COUNT_MODE.numbered,
      to: entry.to,
    }));
  const approvals = sorted.filter(
    (entry) => entry.cause === "renumber_approved",
  );
  const renumberAts = approvals
    .filter((entry) => entry.at.getTime() >= from && entry.at.getTime() < to)
    .map((entry) => entry.at);
  const lastRenumberAt =
    approvals.findLast((entry) => entry.at.getTime() < to)?.at ?? null;
  const modeAtStart = modeAt(from);
  const modeAtEnd = modeAt(to);
  return {
    countStore:
      isCountLike(modeAtStart) ||
      changes.some((change) => isCountLike(change.to)),
    modeAtStart,
    since:
      sorted
        .filter((entry) => entry.at.getTime() < from)
        .findLast((entry) => entry.from === null || entry.from !== entry.to)
        ?.at ?? null,
    modeAtEnd,
    changes,
    renumberAts,
    lastRenumberAt,
    daysSinceRenumber:
      lastRenumberAt === null
        ? null
        : Math.floor((to - lastRenumberAt.getTime()) / DAY_MS),
  };
}

/** 已關帳月份快照裡一家店的月底補點編號(5.7 `snapshot.stores[].renumber`)。 */
export interface MonthEndRenumberSnapshot {
  month: string;
  periodEnd: Date;
  renumber: { mode: CountMode; done: boolean } | null;
}

/**
 * 區塊 8「月底未補點編號」(第 10 節:關帳被放行、或設「只提醒」的店):月底落在這段期間(`from` < 月底 ≤ `to`)的
 * 已關帳月份裡,快照記這家店月底是張數或轉換中、該月最後一次日結前沒補點編號的月份(`YYYY-MM`)。
 * 關帳後改設定不影響已關帳的月;還沒關帳的月份不列(關帳時才判斷)。
 */
export function monthEndUnrenumberedOf(
  closes: readonly MonthEndRenumberSnapshot[],
  period: { from: Date; to: Date },
): string[] {
  return closes
    .filter(
      (close) =>
        close.periodEnd.getTime() > period.from.getTime() &&
        close.periodEnd.getTime() <= period.to.getTime() &&
        close.renumber !== null &&
        isCountLike(close.renumber.mode) &&
        !close.renumber.done,
    )
    .map((close) => close.month)
    .toSorted((left, right) => left.localeCompare(right));
}
