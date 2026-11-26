import type { Types } from "mongoose";

import { TICKET_EVENT_TYPE } from "@repo/domain/project/lottery";

import type { BookPendings } from "./report-pending";
import type { PendingFlow } from "./report-pending-adjustment";
import type { PendingStores } from "./report-pending-store";
import { type StateSnapshot, isOnHandAt } from "./report-stock";

/** 批售的一筆事件(`amount` = 這張的批售金額;`cost` = 事件前的單張成本快照)。 */
export interface WholesaleFlowEvent {
  bookId: Types.ObjectId;
  type: string;
  at: Date;
  cost: number;
  amount: number;
  refId: Types.ObjectId | null;
  from: StateSnapshot | null;
  to: StateSnapshot;
}

/** 一張批售單在這一期的一個方向(出貨 = 庫存流出;作廢 = 回到庫存),已扣待標註。 */
export interface WholesaleFlow {
  refId: Types.ObjectId;
  /** 作廢那一筆(取消批售;報表是負數) */
  voided: boolean;
  /** 出貨 / 取消的時間(這張單這一方向最早的事件) */
  at: Date;
  books: number;
  tickets: number;
  amount: number;
  cost: number;
  /** 已扣的待標註(區塊 4「待標註調整」用) */
  pending: { tickets: number; cost: number };
}

interface Group {
  refId: Types.ObjectId;
  bookId: Types.ObjectId;
  voided: boolean;
  at: Date;
  costs: number[];
  amounts: number[];
}

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

/**
 * 這家店這一期的批售進出(專案規格 21.5、21.7;正本 `docs/modules/project/reports.md`「營運報表」):
 *
 * - 出貨 = 「批售」事件、事件前在這家店的庫存;作廢 = 「取消批售」事件、事件後在這家店的庫存
 * - 依「單據 + 本 + 方向」一組:待標註的跳號照共用的扣法(同整本調貨)—— 期間內有待標註的本看這組事件前後這家店
 *   要扣的差(`PendingStores.adjustmentChange`),其他照整本規則(`BookPendings.adjustmentOf`;張數 = 標準張數
 *   + 待標註時扣待標註)。金額與成本扣同樣張數 × 這組的平均
 * - 一張單一個方向一列(本數 = 本的數量);順序照事件
 */
export function wholesaleFlowsOf(
  events: readonly WholesaleFlowEvent[],
  pendings: BookPendings,
  pendingStores: PendingStores | null,
  orgId: Types.ObjectId,
): WholesaleFlow[] {
  const groups = new Map<string, Group>();
  for (const event of events) {
    const shipped =
      event.type === TICKET_EVENT_TYPE.wholesale &&
      isOnHandAt(event.from, orgId);
    const voided =
      event.type === TICKET_EVENT_TYPE.wholesaleVoid &&
      isOnHandAt(event.to, orgId);
    if ((!shipped && !voided) || event.refId === null) {
      continue;
    }
    const key = `${event.type}|${String(event.refId)}|${String(event.bookId)}`;
    const group = groups.get(key) ?? {
      refId: event.refId,
      bookId: event.bookId,
      voided,
      at: event.at,
      costs: [],
      amounts: [],
    };
    group.costs.push(event.cost);
    group.amounts.push(event.amount);
    groups.set(key, group);
  }
  const flows = new Map<string, WholesaleFlow>();
  for (const group of groups.values()) {
    const size = group.costs.length;
    const direction = group.voided ? 1 : -1;
    const pending =
      pendingStores?.covers(group.bookId) === true
        ? direction *
          pendingStores.adjustmentChange(group.bookId, orgId, group.at)
        : pendings.adjustmentOf(group.bookId, group.at, size);
    const cost = sum(group.costs);
    const amount = sum(group.amounts);
    const key = `${String(group.voided)}|${String(group.refId)}`;
    const flow = flows.get(key) ?? {
      refId: group.refId,
      voided: group.voided,
      at: group.at,
      books: 0,
      tickets: 0,
      amount: 0,
      cost: 0,
      pending: { tickets: 0, cost: 0 },
    };
    flow.books += 1;
    flow.tickets += size - pending;
    flow.amount += amount - (pending * amount) / size;
    flow.cost += cost - (pending * cost) / size;
    flow.pending.tickets += pending;
    flow.pending.cost += (pending * cost) / size;
    if (group.at < flow.at) {
      flow.at = group.at;
    }
    flows.set(key, flow);
  }
  return [...flows.values()];
}

/** 一個方向的合計(區塊 4 的淨批售、待標註調整的進出列)。 */
export function wholesaleFlowTotalOf(
  flows: readonly WholesaleFlow[],
  voided: boolean,
): PendingFlow {
  const list = flows.filter((flow) => flow.voided === voided);
  return {
    tickets: sum(list.map((flow) => flow.tickets)),
    cost: sum(list.map((flow) => flow.cost)),
    pending: {
      tickets: sum(list.map((flow) => flow.pending.tickets)),
      cost: sum(list.map((flow) => flow.pending.cost)),
    },
  };
}
