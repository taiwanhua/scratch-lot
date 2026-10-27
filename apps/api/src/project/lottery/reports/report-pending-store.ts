import type { Types } from "mongoose";

import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketLocationKind,
  type TicketStatus,
  bookCountsOf,
  pendingPlacementOf,
  pendingStoreOf,
} from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import type {
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import type { BookPendings } from "./report-pending";

/** 一張的狀態(跨店)。 */
interface TicketState {
  status: TicketStatus;
  locationKind: TicketLocationKind;
  orgId: string;
}

/** 一張:現況與那一刻之後的事件(依時間,各帶變動前的狀態)。 */
interface TicketTimeline {
  current: TicketState;
  after: { at: number; from: TicketState | null }[];
}

/** 店裡的位置(庫存、檯面);在途不算任何一家店的庫存。 */
const isOnHand = (state: TicketState): boolean =>
  state.status === TICKET_STATUS.unsold &&
  (state.locationKind === TICKET_LOCATION_KIND.stock ||
    state.locationKind === TICKET_LOCATION_KIND.counter);

/**
 * 報表的「待標註扣在哪一家店的庫存」(使用者 10/27 定案;和本的詳情同一個規則 `pendingPlacementOf` /
 * `pendingStoreOf`):待標註一本只扣一次,算在還沒確認實體的那一組 —— 有待查 / 遺失 → 那一組(庫存不扣);
 * 沒有 → 未售張數最多的那家店的庫存。要看整本(跨店)那一刻的狀態:有待標註的本一次讀張、一次讀那之後的事件,
 * 在記憶體裡倒推(不逐本查)。
 */
export class PendingStores {
  constructor(
    private readonly pendings: BookPendings,
    private readonly timelines: ReadonlyMap<string, TicketTimeline[]>,
  ) {}

  /** 這本由這個規則管(期間內有待標註)。 */
  covers(bookId: Types.ObjectId | string): boolean {
    return this.timelines.has(String(bookId));
  }

  /**
   * 這家店在那一刻的庫存要扣的待標註張數(不超過這家店那一刻的庫存張數)。`afterEvents` = 那一刻的事件已套用
   * (一組事件寫完之後);預設是那一刻的事件之前。
   */
  onHandAdjustment(
    bookId: Types.ObjectId | string,
    orgId: Types.ObjectId,
    at: Date,
    afterEvents = false,
  ): number {
    const timelines = this.timelines.get(String(bookId));
    const pending = this.pendings.pendingAt(bookId, at);
    if (timelines === undefined || pending <= 0) {
      return 0;
    }
    const time = at.getTime();
    const states = timelines.map((ticket) => {
      const next = ticket.after.find((event) =>
        afterEvents ? event.at > time : event.at >= time,
      );
      return next === undefined ? ticket.current : next.from;
    });
    const existing = states.filter(
      (state): state is TicketState => state !== null,
    );
    const counts = bookCountsOf(existing);
    if (pendingPlacementOf(counts, pending) !== "unsold") {
      return 0;
    }
    const unsoldByStore = new Map<string, number>();
    for (const state of existing) {
      if (state.status === TICKET_STATUS.unsold) {
        unsoldByStore.set(
          state.orgId,
          (unsoldByStore.get(state.orgId) ?? 0) + 1,
        );
      }
    }
    if (pendingStoreOf(unsoldByStore) !== String(orgId)) {
      return 0;
    }
    const onHand = existing.filter(
      (state) => state.orgId === String(orgId) && isOnHand(state),
    ).length;
    return Math.min(pending, onHand);
  }

  /** 一組事件(那一刻)讓這家店的庫存要扣的待標註張數變了多少(事件後 − 事件前)。 */
  adjustmentChange(
    bookId: Types.ObjectId | string,
    orgId: Types.ObjectId,
    at: Date,
  ): number {
    return (
      this.onHandAdjustment(bookId, orgId, at, true) -
      this.onHandAdjustment(bookId, orgId, at)
    );
  }
}

const stateOf = (value: {
  status: TicketStatus;
  locationKind?: TicketLocationKind;
  location?: { kind: TicketLocationKind };
  orgId: Types.ObjectId;
}): TicketState => ({
  status: value.status,
  locationKind:
    value.location?.kind ?? value.locationKind ?? TICKET_LOCATION_KIND.stock,
  orgId: String(value.orgId),
});

/** 讀期間內有待標註的本的張與 `from` 之後的事件(各一次)。 */
export async function loadPendingStores(
  reader: OperatorContext,
  repositories: {
    tickets: LotteryTicketsRepository;
    events: LotteryTicketEventsRepository;
  },
  pendings: BookPendings,
  bookIds: readonly Types.ObjectId[],
  from: Date,
  to: Date,
): Promise<PendingStores> {
  const unique = [
    ...new Map(bookIds.map((id) => [String(id), id])).values(),
  ].filter(
    (id) => pendings.pendingAt(id, from) > 0 || pendings.pendingAt(id, to) > 0,
  );
  if (unique.length === 0) {
    return new PendingStores(pendings, new Map());
  }
  const [tickets, events] = await Promise.all([
    repositories.tickets.findMany(
      reader,
      { bookId: { $in: unique } },
      { select: "bookId status location orgId" },
    ),
    repositories.events.findMany(
      reader,
      { bookId: { $in: unique }, at: { $gte: from } },
      { select: "ticketId at from", sort: { at: 1, _id: 1 } },
    ),
  ]);
  const eventsOf = new Map<string, TicketTimeline["after"]>();
  for (const event of events) {
    const key = String(event.ticketId);
    const list = eventsOf.get(key) ?? [];
    list.push({
      at: event.at.getTime(),
      from: event.from === null ? null : stateOf(event.from),
    });
    eventsOf.set(key, list);
  }
  const timelines = new Map<string, TicketTimeline[]>();
  for (const ticket of tickets) {
    const key = String(ticket.bookId);
    const list = timelines.get(key) ?? [];
    list.push({
      current: stateOf(ticket),
      after: eventsOf.get(String(ticket._id)) ?? [],
    });
    timelines.set(key, list);
  }
  return new PendingStores(pendings, timelines);
}
