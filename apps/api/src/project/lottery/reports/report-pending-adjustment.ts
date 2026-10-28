import type { Types } from "mongoose";

import { TICKET_EVENT_TYPE } from "@repo/domain/project/lottery";

import {
  type StateSnapshot,
  type StockFigures,
  isOnHandAt,
} from "./report-stock";

/** 一列算出來的張數 / 成本,加上這一列已扣掉的待標註(張數 / 成本;`size − pending` 的那個 pending)。 */
export interface PendingFlow extends StockFigures {
  pending: StockFigures;
}

/** 營運報表區塊 4 的一列:進(+)或出(−),帶這一列已扣的待標註。 */
export interface AttributedFlow {
  direction: 1 | -1;
  flow: PendingFlow;
}

/** 標跳號 / 取消跳號事件(這家店的庫存張變跳號、跳號改回這家店的庫存)。 */
export interface SkipEvent {
  bookId: Types.ObjectId;
  type: string;
  at: Date;
  cost: number;
  from: StateSnapshot | null;
  to: StateSnapshot;
}

const ZERO: StockFigures = { tickets: 0, cost: 0 };

const plus = (left: StockFigures, right: StockFigures): StockFigures => ({
  tickets: left.tickets + right.tickets,
  cost: left.cost + right.cost,
});

/**
 * 營運報表區塊 4 的「± 待標註調整」(規格 11.2、第 20 章方案 A;使用者 10/28 定案只改報表計算):
 * 這家店的庫存要扣的待標註張數有變、但不是自己的進出列造成的部分,加上這家店自己標跳號 / 取消跳號的張。
 *
 * `待標註調整 = (期初扣的待標註 − 期末扣的待標註) + Σ 進的列已扣的待標註 − Σ 出的列已扣的待標註
 *             − 這家店庫存張標成跳號的張 + 取消跳號回到這家店庫存的張`
 *
 * - 待標註「分在兩家店時只扣張數多的那家、有待查 / 遺失時扣在待查那一組」(規格 7.1,`PendingStores`),
 *   扣在哪裡會隨別家店的點收、售出、標跳號或待查改變,換扣的那一下沒有任何進出列 → 記在這一列
 * - 進出列(進貨、調入、調出、報廢、新增待查、尋回)算的時候已扣的待標註不重複算;淨銷售不扣待標註
 * - 標跳號:張離開庫存、待標註同時少一張;在待標註扣在這家店時兩者抵消(拆本標跳號 = 0)
 * - 只用「扣的待標註」與跳號事件計算,不讀庫存的實際張數:其他列漏算的張仍會出現在核對列(不是補差額)
 * - 成本:扣的待標註以那一本在這家店庫存的平均單張成本計(同期初 / 期末的扣法);跳號用事件的成本快照;
 *   取消跳號一律和同一刻同一本的跳號成對(對調跳號,規格 7.3),改回未售的張接手配對那張的單張成本
 *   → 用那筆跳號的成本快照(找不到配對時用事件的成本快照)
 */
export function pendingAdjustmentOf(input: {
  orgId: Types.ObjectId;
  /** 期初 / 期末這家店庫存扣掉的待標註 */
  openingPending: StockFigures;
  endingPending: StockFigures;
  /** 各進出列與它們已扣的待標註 */
  flows: readonly AttributedFlow[];
  /** 期間內的跳號 / 取消跳號事件(碰到這家店的) */
  skips: readonly SkipEvent[];
}): StockFigures {
  const { orgId } = input;
  let result: StockFigures = {
    tickets: input.openingPending.tickets - input.endingPending.tickets,
    cost: input.openingPending.cost - input.endingPending.cost,
  };
  for (const { direction, flow } of input.flows) {
    result = plus(result, {
      tickets: direction * flow.pending.tickets,
      cost: direction * flow.pending.cost,
    });
  }
  const skipped = input.skips.reduce(
    (sum, event) =>
      event.type === TICKET_EVENT_TYPE.skip && isOnHandAt(event.from, orgId)
        ? plus(sum, { tickets: 1, cost: event.cost })
        : sum,
    ZERO,
  );
  const pairKey = (event: SkipEvent) =>
    `${String(event.bookId)}|${String(event.at.getTime())}`;
  const pairCost = new Map(
    input.skips
      .filter((event) => event.type === TICKET_EVENT_TYPE.skip)
      .map((event) => [pairKey(event), event.cost]),
  );
  const unskipped = input.skips.reduce(
    (sum, event) =>
      event.type === TICKET_EVENT_TYPE.unskip && isOnHandAt(event.to, orgId)
        ? plus(sum, {
            tickets: 1,
            cost: pairCost.get(pairKey(event)) ?? event.cost,
          })
        : sum,
    ZERO,
  );
  return {
    tickets: result.tickets - skipped.tickets + unskipped.tickets,
    cost: result.cost - skipped.cost + unskipped.cost,
  };
}
