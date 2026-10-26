import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  TICKET_EVENT_TYPE,
  TICKET_STATUS,
  type TicketEventType,
} from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import {
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import type { LotteryOperationsInventoryModel } from "./models/operations-report.model";
import { type BookPendings, loadBookPendings } from "./report-pending";
import type { StorePeriod } from "./report-periods";
import {
  ReportStock,
  type StateSnapshot,
  type StockFigures,
  type TicketGroupInput,
  figuresOf,
  isOnHandAt,
  outboundGroupsOf,
} from "./report-stock";

/** 區塊 4 讀的張數事件(調貨另外讀;售出 / 撤銷由區塊 1 帶進來)。 */
export const INVENTORY_EVENT_TYPES: readonly TicketEventType[] = [
  TICKET_EVENT_TYPE.purchase,
  TICKET_EVENT_TYPE.purchaseVoid,
  TICKET_EVENT_TYPE.scrap,
  TICKET_EVENT_TYPE.investigate,
  TICKET_EVENT_TYPE.lose,
  TICKET_EVENT_TYPE.recover,
  TICKET_EVENT_TYPE.skip,
  TICKET_EVENT_TYPE.unskip,
];

/** 區塊 4 用的一筆事件(`cost` = 事件前的單張成本快照;舊資料沒有時由呼叫端補現況的單張成本)。 */
export interface InventoryEvent {
  ticketId: Types.ObjectId;
  bookId: Types.ObjectId;
  type: string;
  at: Date;
  cost: number;
  refId: Types.ObjectId | null;
  from: StateSnapshot | null;
  to: StateSnapshot;
}

/** 依「同一本 + 同一張來源單據 + 同一種事件」分組(整本的動作扣待標註)。 */
function groupsOf(events: readonly InventoryEvent[]): TicketGroupInput[] {
  const groups = new Map<string, TicketGroupInput & { costs: number[] }>();
  for (const event of events) {
    const key = `${event.type}|${String(event.bookId)}|${String(event.refId)}`;
    const group = groups.get(key) ?? {
      bookId: event.bookId,
      at: event.at,
      costs: [],
    };
    group.costs.push(event.cost);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * 確認遺失(依本 × 單據一組):還沒標的跳號(實體不存在、不會被逐張處理)算在還沒確認的那一組,只在這本期間內
 * 最後一組、而且期末已沒有待查時扣待標註(一本只扣一次;使用者 10/27 定案)。例:整本待查後尋回 3 張、其餘 98 張
 * 確認遺失 → 97 張。
 */
function lostFiguresOf(
  groups: readonly TicketGroupInput[],
  pendings: BookPendings,
  stillInvestigating: ReadonlySet<string>,
): StockFigures {
  const lastOf = new Map<string, number>();
  for (const group of groups) {
    const key = String(group.bookId);
    lastOf.set(key, Math.max(lastOf.get(key) ?? 0, group.at.getTime()));
  }
  const counted = new Set<string>();
  let tickets = 0;
  let cost = 0;
  for (const group of groups) {
    const key = String(group.bookId);
    const size = group.costs.length;
    const total = group.costs.reduce((sum, value) => sum + value, 0);
    const isLast =
      !counted.has(key) &&
      !stillInvestigating.has(key) &&
      group.at.getTime() === lastOf.get(key);
    const pending = isLast
      ? pendings.remainderAdjustmentOf(group.bookId, group.at, size)
      : 0;
    if (isLast) {
      counted.add(key);
    }
    tickets += size - pending;
    cost += size === 0 ? 0 : total - (pending * total) / size;
  }
  return { tickets, cost };
}

const minus = (left: StockFigures, right: StockFigures): StockFigures => ({
  tickets: left.tickets - right.tickets,
  cost: left.cost - right.cost,
});

/**
 * 營運報表區塊 4 庫存異動(規格 11.2;正本 `docs/modules/project/reports.md`「營運報表」):由上往下加減,
 * 最後一列核對要是 0。
 *
 * `期初 + 進貨 + 調入 − 調出 − 淨銷售 − 報廢 − 新增待查 + 待查轉回 + 遺失尋回 = 期末`
 *
 * - 每一列只算「進出這家店庫存(未售、在庫存或檯面)」的那一步:新增待查 = 庫存 → 待查;待查轉回 / 遺失尋回 =
 *   待查 / 遺失 → 這家店的庫存;確認遺失(待查 → 遺失)、跳號、期末在途、期末待查另列,不在加減裡
 * - 成本一律用事件的成本快照(那一刻的單張成本),期初 / 期末用那一刻的單張成本(`ReportStock`)
 * - 待標註的跳號(拆本前)不算張數與成本(使用者 10/27 定案甲);作廢的本從作廢那一刻起不算庫存
 */
@Injectable()
export class OperationsInventory {
  constructor(
    private readonly stock: ReportStock,
    private readonly books: LotteryBooksRepository,
    private readonly events: LotteryTicketEventsRepository,
  ) {}

  async inventoryOf(
    reader: OperatorContext,
    period: StorePeriod,
    events: readonly InventoryEvent[],
    sales: StockFigures,
  ): Promise<LotteryOperationsInventoryModel> {
    const { orgId, from, to } = period;
    const [openingHeld, endingHeld, inbound, outbound] = await Promise.all([
      this.stock.heldAt(reader, orgId, from),
      this.stock.heldAt(reader, orgId, to),
      this.stock.inboundOf(reader, orgId, from, to),
      this.stock.outboundOf(reader, orgId, from, to),
    ]);
    const pendings = await loadBookPendings(
      reader,
      { books: this.books, events: this.events },
      [
        ...openingHeld.map((ticket) => ticket.bookId),
        ...endingHeld.map((ticket) => ticket.bookId),
        ...events.map((event) => event.bookId),
        ...inbound.map((row) => row.bookId),
        ...outbound.map((row) => row.bookId),
      ],
    );
    const opening = this.stock.snapshotOf(openingHeld, pendings, from);
    const ending = this.stock.snapshotOf(endingHeld, pendings, to);
    const ofType = (type: string, keep: (event: InventoryEvent) => boolean) =>
      events.filter((event) => event.type === type && keep(event));
    const figures = (list: readonly InventoryEvent[]) =>
      figuresOf(groupsOf(list), pendings);
    const onHandBefore = (event: InventoryEvent) =>
      isOnHandAt(event.from, orgId);
    const onHandAfter = (event: InventoryEvent) => isOnHandAt(event.to, orgId);

    const purchasedEvents = ofType(TICKET_EVENT_TYPE.purchase, onHandAfter);
    // 進貨作廢:張的狀態不變、本改已撤銷 → 作廢那一刻起不算庫存(只算作廢時還在這家店庫存的張)
    const voidedEvents = ofType(TICKET_EVENT_TYPE.purchaseVoid, onHandBefore);
    const purchase = minus(figures(purchasedEvents), figures(voidedEvents));
    const booksOf = (list: readonly InventoryEvent[]) =>
      new Set(list.map((event) => String(event.bookId))).size;
    const voidBooks = booksOf(voidedEvents);

    const transferIn = inbound.reduce(
      (sum, row) => {
        const pending = pendings.adjustmentOf(
          row.bookId,
          row.receivedAt,
          row.tickets,
        );
        return {
          tickets: sum.tickets + row.sign * (row.tickets - pending),
          amount: sum.amount + row.sign * row.amount,
        };
      },
      { tickets: 0, amount: 0 },
    );
    const outCost = minus(
      figuresOf(
        outboundGroupsOf(outbound, 1, (row) => row.cost),
        pendings,
      ),
      figuresOf(
        outboundGroupsOf(outbound, -1, (row) => row.cost),
        pendings,
      ),
    );
    const outAmount = minus(
      figuresOf(
        outboundGroupsOf(outbound, 1, (row) => row.amount),
        pendings,
      ),
      figuresOf(
        outboundGroupsOf(outbound, -1, (row) => row.amount),
        pendings,
      ),
    );

    const scrap = figures(ofType(TICKET_EVENT_TYPE.scrap, onHandBefore));
    // 新增待查:庫存 → 待查,加上在途中被刪掉變待查的(那幾張的調出在同一天反向算回)
    const lostInTransit = figuresOf(
      outboundGroupsOf(
        outbound.filter((row) => row.lost),
        -1,
        (row) => row.cost,
      ),
      pendings,
    );
    const onHandInvestigating = figures(
      ofType(TICKET_EVENT_TYPE.investigate, onHandBefore),
    );
    const newInvestigating = {
      tickets: onHandInvestigating.tickets + lostInTransit.tickets,
      cost: onHandInvestigating.cost + lostInTransit.cost,
    };
    const recovered = ofType(TICKET_EVENT_TYPE.recover, onHandAfter);
    const investigateRecovered = figures(
      recovered.filter(
        (event) => event.from?.status === TICKET_STATUS.investigating,
      ),
    );
    const lostRecovered = figures(
      recovered.filter((event) => event.from?.status === TICKET_STATUS.lost),
    );
    // 確認遺失:還沒標的跳號在還沒確認實體的那一組,這本最後一次確認遺失、而且期末已沒有待查時才扣(一本只扣一次)
    const lost = lostFiguresOf(
      groupsOf(ofType(TICKET_EVENT_TYPE.lose, () => true)),
      pendings,
      new Set(ending.investigating.bookIds),
    );

    const expectedEnding = {
      tickets:
        opening.onHand.tickets +
        purchase.tickets +
        transferIn.tickets -
        outCost.tickets -
        sales.tickets -
        scrap.tickets -
        newInvestigating.tickets +
        investigateRecovered.tickets +
        lostRecovered.tickets,
      cost:
        opening.onHand.cost +
        purchase.cost +
        transferIn.amount -
        outCost.cost -
        sales.cost -
        scrap.cost -
        newInvestigating.cost +
        investigateRecovered.cost +
        lostRecovered.cost,
    };
    const inTransitAmount = await this.stock.inTransitAmountOf(
      reader,
      ending.inTransit,
      to,
    );
    return {
      openingTickets: opening.onHand.tickets,
      openingCost: opening.onHand.cost,
      purchaseBooks: booksOf(purchasedEvents) - voidBooks,
      purchaseVoidBooks: voidBooks,
      purchaseTickets: purchase.tickets,
      purchaseCost: purchase.cost,
      transferInTickets: transferIn.tickets,
      transferInAmount: transferIn.amount,
      transferOutTickets: outCost.tickets,
      transferOutCost: outCost.cost,
      transferOutAmount: outAmount.cost,
      transferGain: outAmount.cost - outCost.cost,
      salesTickets: sales.tickets,
      salesCost: sales.cost,
      scrapTickets: scrap.tickets,
      scrapCost: scrap.cost,
      newInvestigatingTickets: newInvestigating.tickets,
      newInvestigatingCost: newInvestigating.cost,
      investigateRecoveredTickets: investigateRecovered.tickets,
      investigateRecoveredCost: investigateRecovered.cost,
      lostRecoveredTickets: lostRecovered.tickets,
      lostRecoveredCost: lostRecovered.cost,
      endingTickets: ending.onHand.tickets,
      endingCost: ending.onHand.cost,
      checkTickets: expectedEnding.tickets - ending.onHand.tickets,
      checkCost: roundCents(expectedEnding.cost - ending.onHand.cost),
      inTransitTickets: ending.inTransit.reduce(
        (sum, group) => sum + group.ticketIds.length - group.pending,
        0,
      ),
      inTransitAmount,
      investigatingTickets: ending.investigating.tickets,
      investigatingCost: ending.investigating.cost,
      investigatingBooks: ending.investigating.bookIds.length,
      investigatingBookIds: ending.investigating.bookIds,
      lostTickets: lost.tickets,
      lostCost: lost.cost,
      skippedTickets:
        ofType(TICKET_EVENT_TYPE.skip, () => true).length -
        ofType(TICKET_EVENT_TYPE.unskip, () => true).length,
    };
  }
}

/**
 * 核對的成本差:單張成本不四捨五入(使用者 10/27「成本不四捨五入」),加減後只剩浮點誤差時當成 0
 * (小於 0.005 元)。
 */
function roundCents(value: number): number {
  return Math.abs(value) < 0.005 ? 0 : value;
}
