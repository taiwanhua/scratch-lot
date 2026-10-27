import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  TRANSFER_MODULE_KEY,
  type TicketStatus,
  transferHeaderOf,
} from "@repo/domain/project/lottery";

import { FormSubmissionsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import {
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryTransferReceiptsRepository } from "../../database/lottery-transfers/lottery-transfer-receipts.repository";
import type { BookPendings } from "./report-pending";
import type { PendingStores } from "./report-pending-store";

/** 在店裡的位置:庫存、檯面(在途不算任何一家店的庫存)。 */
const ON_HAND_LOCATIONS: ReadonlySet<string> = new Set([
  TICKET_LOCATION_KIND.stock,
  TICKET_LOCATION_KIND.counter,
]);

/** 某一刻還算這家店的狀態(未售 → 庫存或在途;待查 → 期末待查)。 */
const HELD_STATUSES: readonly TicketStatus[] = [
  TICKET_STATUS.unsold,
  TICKET_STATUS.investigating,
];

/** 事件前 / 後的張狀態(`from` / `to`)。 */
export interface StateSnapshot {
  status: string;
  locationKind: string;
  orgId: Types.ObjectId;
}

/** 這個狀態是「這家店的庫存」:在這家店、未售、在庫存或檯面。 */
export const isOnHandAt = (
  state: StateSnapshot | null | undefined,
  orgId: Types.ObjectId,
): boolean =>
  state != null &&
  state.orgId.equals(orgId) &&
  state.status === TICKET_STATUS.unsold &&
  ON_HAND_LOCATIONS.has(state.locationKind);

/** 某一刻一張的狀態與單張成本。 */
interface HeldTicket {
  ticketId: Types.ObjectId;
  bookId: Types.ObjectId;
  status: string;
  locationKind: string;
  cost: number;
}

/** 張數 + 成本。 */
export interface StockFigures {
  tickets: number;
  cost: number;
}

/** 某一刻在途的一組(同一本)。 */
export interface InTransitGroup {
  bookId: Types.ObjectId;
  ticketIds: Types.ObjectId[];
  /** 待標註(整本未拆、還沒標的跳號)要扣的張數 */
  pending: number;
}

/** 某一刻這家店的張:庫存、待查、在途。 */
export interface StockSnapshot {
  onHand: StockFigures;
  investigating: StockFigures & { bookIds: string[] };
  inTransit: InTransitGroup[];
}

/** 一組同一本的張(依某個鍵分組),扣掉待標註後的張數與成本。 */
export interface TicketGroupInput {
  bookId: Types.ObjectId;
  at: Date;
  costs: readonly number[];
}

/** 整本的一組扣掉待標註(`BookPendings.adjustmentOf`)後的張數與成本。 */
export const figuresOf = (
  groups: readonly TicketGroupInput[],
  pendings: BookPendings,
): StockFigures => {
  let tickets = 0;
  let cost = 0;
  for (const group of groups) {
    const size = group.costs.length;
    if (size === 0) {
      continue;
    }
    const total = group.costs.reduce((sum, value) => sum + value, 0);
    const pending = pendings.adjustmentOf(group.bookId, group.at, size);
    tickets += size - pending;
    cost += total - (pending * total) / size;
  }
  return { tickets, cost };
};

/**
 * 還待查的一組扣掉待標註(`BookPendings.remainderAdjustmentOf`):未拆的本整本待查後只處理了一部分,
 * 待標註的跳號仍算在還待查的那一組(t11 審查 S1:實測 96 → 95)。
 */
export const remainderFiguresOf = (
  groups: readonly TicketGroupInput[],
  pendings: BookPendings,
): StockFigures => {
  let tickets = 0;
  let cost = 0;
  for (const group of groups) {
    const size = group.costs.length;
    if (size === 0) {
      continue;
    }
    const total = group.costs.reduce((sum, value) => sum + value, 0);
    const pending = pendings.remainderAdjustmentOf(
      group.bookId,
      group.at,
      size,
    );
    tickets += size - pending;
    cost += total - (pending * total) / size;
  }
  return { tickets, cost };
};

/** 調入(依點收時間;作廢的在作廢那天反向)的一筆點收。 */
export interface InboundReceipt {
  bookId: Types.ObjectId;
  receivedAt: Date;
  tickets: number;
  amount: number;
  sign: 1 | -1;
}

/** 調出(依出貨時間;退回 / 作廢回到出貨店的反向)的一張。 */
export interface OutboundTicket {
  ticketId: Types.ObjectId;
  bookId: Types.ObjectId;
  refId: Types.ObjectId;
  at: Date;
  sign: 1 | -1;
  /** 這張的調貨金額(出貨當時記在「調出」事件上的快照) */
  amount: number;
  /** 這張調出前的單張成本 */
  cost: number;
  /** 在途中被刪掉、變待查的(調出反向,同時算新增待查) */
  lost: boolean;
}

interface ReceiptRow {
  _id: Types.ObjectId;
  submissionId: Types.ObjectId;
  orgId: Types.ObjectId;
  fromOrgId: Types.ObjectId;
  bookId: Types.ObjectId;
  purchaseAmount: number;
  receivedAt: Date;
  tickets: { ticketId: Types.ObjectId; unitCost: number }[];
}

interface TransferEventRow {
  ticketId: Types.ObjectId;
  bookId: Types.ObjectId;
  refId: Types.ObjectId;
  type: string;
  at: Date;
  amount: number;
  cost: number | null;
  from: StateSnapshot | null;
  to: StateSnapshot;
}

/** 調貨單:出貨店。 */
interface TransferDoc {
  fromBranchId: string | null;
}

const RECEIPT_SELECT =
  "submissionId orgId fromOrgId bookId purchaseAmount receivedAt tickets";

/**
 * 營運報表區塊 4 的張(規格 11.2、8.4;正本 `docs/modules/project/reports.md`「營運報表」)。
 * 原則:**每個數字以那一刻的事實為準**(重跑舊報表數字不變);全部批次讀,不逐張查(TX-06 延伸到交易外)。
 *
 * - **某一刻的張**(期初 = 期間起點、期末 = 期間終點):從張的**現況往回推**,只讀那一刻之後的事件 ——
 *   之後動過的張,那一刻的狀態 = 它之後第一筆事件的「變動前」、成本 = 那筆事件的成本快照;沒動過的張 = 現況
 * - **調入**:依點收時間算調貨點收;調貨單被作廢的,在作廢時間那份報表反向算回
 * - **調出**:依**出貨時間**(第一關通過或跳過、張變在途那一刻的「調出」事件);退回 / 駁回 / 作廢回到出貨店的
 *   「調入」在發生那天反向算回。金額 = 調貨單那一列的批購金額 ÷ 張數,原成本 = 調出前的單張成本
 */
@Injectable()
export class ReportStock {
  constructor(
    private readonly events: LotteryTicketEventsRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly receipts: LotteryTransferReceiptsRepository,
    private readonly submissions: FormSubmissionsRepository,
  ) {}

  /** 這家店在 `at` 那一刻持有的張(未售、待查;含在途),帶那一刻的單張成本。 */
  async heldAt(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    at: Date,
  ): Promise<HeldTicket[]> {
    // 那一刻之後碰過這家店的張,各取之後第一筆碰到這家店的事件的「變動前」與成本快照(資料庫端彙總,一張一列;
    // 選的時間點越早資料越多,排序 / 分組允許用暫存檔)
    const firsts = (await this.events.aggregate(
      reader,
      [
        {
          $match: {
            at: { $gte: at },
            $or: [{ orgId }, { "from.orgId": orgId }],
          },
        },
        { $sort: { at: 1, _id: 1 } },
        {
          $group: {
            _id: "$ticketId",
            bookId: { $first: "$bookId" },
            from: { $first: "$from" },
            cost: { $first: "$cost" },
          },
        },
      ],
      { allowDiskUse: true },
    )) as {
      _id: Types.ObjectId;
      bookId: Types.ObjectId;
      from: StateSnapshot | null;
      cost: number | null;
    }[];
    const touched = new Set(firsts.map((row) => String(row._id)));
    const held: (Omit<HeldTicket, "cost"> & { cost: number | null })[] = [];
    for (const row of firsts) {
      // 那一刻在這家店 ⇔ 之後第一筆碰到這家店的事件,變動前是這家店(進貨的變動前是 null:那時還不存在)
      if (
        row.from !== null &&
        row.from.orgId.equals(orgId) &&
        HELD_STATUSES.includes(row.from.status as TicketStatus)
      ) {
        held.push({
          ticketId: row._id,
          bookId: row.bookId,
          status: row.from.status,
          locationKind: row.from.locationKind,
          cost: row.cost,
        });
      }
    }
    // 之後沒動過的張:現況就是那一刻的狀態(索引 orgId + location.kind + status;動過的在記憶體裡排除)
    const current = await this.tickets.findMany(
      reader,
      { orgId, status: { $in: [...HELD_STATUSES] } },
      { select: "bookId status location unitCost" },
    );
    for (const ticket of current) {
      if (touched.has(String(ticket._id))) {
        continue;
      }
      held.push({
        ticketId: ticket._id,
        bookId: ticket.bookId,
        status: ticket.status,
        locationKind: ticket.location.kind,
        cost: ticket.unitCost,
      });
    }
    // 沒有成本快照的舊事件:改用現況的單張成本(那一刻之後才調入的,用點收記的調入前成本還原)
    const missing = held.filter((ticket) => ticket.cost === null);
    const restored =
      missing.length === 0
        ? new Map<string, number>()
        : await this.costsAt(
            reader,
            missing.map((ticket) => ticket.ticketId),
            at,
          );
    return held.map((ticket) => ({
      ...ticket,
      cost: ticket.cost ?? restored.get(String(ticket.ticketId)) ?? 0,
    }));
  }

  /**
   * 某一刻的庫存 / 待查 / 在途:作廢的本從作廢那一刻起不算;整本未拆的本扣掉待標註(`BookPendings`)。
   * 庫存 = 未售、在庫存或檯面;在途 = 未售、在途(還在出貨店名下);待查依本列出(合計工作表依本去重複)。
   */
  snapshotOf(
    held: readonly HeldTicket[],
    pendings: BookPendings,
    at: Date,
    stores?: { pendingStores: PendingStores; orgId: Types.ObjectId },
  ): StockSnapshot {
    const live = held.filter(
      (ticket) => !pendings.revokedBefore(ticket.bookId, at),
    );
    const groupsOf = (list: readonly HeldTicket[]) => {
      const byBook = new Map<string, HeldTicket[]>();
      for (const ticket of list) {
        const key = String(ticket.bookId);
        byBook.set(key, [...(byBook.get(key) ?? []), ticket]);
      }
      return [...byBook.values()];
    };
    const unsold = live.filter(
      (ticket) => ticket.status === TICKET_STATUS.unsold,
    );
    const onHand = unsold.filter((ticket) =>
      ON_HAND_LOCATIONS.has(ticket.locationKind),
    );
    const inTransit = unsold.filter(
      (ticket) => ticket.locationKind === TICKET_LOCATION_KIND.inTransit,
    );
    const investigating = live.filter(
      (ticket) => ticket.status === TICKET_STATUS.investigating,
    );
    const toGroups = (list: readonly HeldTicket[]) =>
      groupsOf(list).flatMap((group) => {
        const first = group[0];
        return first === undefined
          ? []
          : [
              {
                bookId: first.bookId,
                at,
                costs: group.map((ticket) => ticket.cost),
              },
            ];
      });
    // 有待標註的本:扣在哪一家店照整本(跨店)那一刻的狀態(`PendingStores`,和本的詳情同一個規則)
    const onHandGroups = toGroups(onHand);
    const covered = (group: TicketGroupInput) =>
      stores?.pendingStores.covers(group.bookId) === true;
    const onHandFigures = figuresOf(
      onHandGroups.filter((group) => !covered(group)),
      pendings,
    );
    for (const group of onHandGroups.filter((item) => covered(item))) {
      const size = group.costs.length;
      const total = group.costs.reduce((sum, value) => sum + value, 0);
      const pending =
        stores?.pendingStores.onHandAdjustment(
          group.bookId,
          stores.orgId,
          at,
        ) ?? 0;
      onHandFigures.tickets += size - pending;
      onHandFigures.cost += total - (pending * total) / size;
    }
    return {
      onHand: onHandFigures,
      investigating: {
        ...remainderFiguresOf(toGroups(investigating), pendings),
        bookIds: [
          ...new Set(investigating.map((ticket) => String(ticket.bookId))),
        ],
      },
      inTransit: groupsOf(inTransit).flatMap((group) => {
        const first = group[0];
        return first === undefined
          ? []
          : [
              {
                bookId: first.bookId,
                ticketIds: group.map((ticket) => ticket.ticketId),
                pending: pendings.adjustmentOf(first.bookId, at, group.length),
              },
            ];
      }),
    };
  }

  /** 調入:以這家店為收貨店、期間內點收的(依點收時間);期間內作廢的調貨單反向算回。 */
  async inboundOf(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    from: Date,
    to: Date,
  ): Promise<InboundReceipt[]> {
    const [received, voidedDocs] = await Promise.all([
      this.receipts.findMany(
        reader,
        { orgId, receivedAt: { $gte: from, $lt: to } },
        { select: RECEIPT_SELECT },
      ) as unknown as Promise<ReceiptRow[]>,
      this.voidedTransfersIn(reader, from, to),
    ]);
    const reversed =
      voidedDocs.length === 0
        ? []
        : ((await this.receipts.findMany(
            reader,
            { orgId, submissionId: { $in: voidedDocs } },
            { select: RECEIPT_SELECT },
          )) as unknown as ReceiptRow[]);
    const toInbound = (row: ReceiptRow, sign: 1 | -1): InboundReceipt => ({
      bookId: row.bookId,
      receivedAt: row.receivedAt,
      tickets: row.tickets.length,
      amount: row.purchaseAmount,
      sign,
    });
    return [
      ...received.map((row) => toInbound(row, 1)),
      ...reversed.map((row) => toInbound(row, -1)),
    ];
  }

  /**
   * 調出:這家店是**出貨店**的調貨單,期間內出貨(「調出」事件:庫存 / 檯面 → 在途)的張 +;期間內回到出貨店的
   * (駁回、作廢:在途或已點收的張寫「調入」回出貨店)與在途中被刪掉變待查的 −。收貨店作廢時寫的「調出」不算
   * (收貨店的調入會反向算回)。調貨金額一律用出貨那一筆「調出」事件記的快照(之後改單、刪列不影響舊報表)。
   */
  async outboundOf(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    from: Date,
    to: Date,
  ): Promise<OutboundTicket[]> {
    const rows = (await this.events.findMany(
      reader,
      {
        at: { $gte: from, $lt: to },
        orgId,
        $or: [
          { type: TICKET_EVENT_TYPE.transferOut, refType: "transfer" },
          {
            type: TICKET_EVENT_TYPE.transferIn,
            refType: "transfer",
            "from.locationKind": TICKET_LOCATION_KIND.inTransit,
          },
          {
            type: TICKET_EVENT_TYPE.investigate,
            "from.locationKind": TICKET_LOCATION_KIND.inTransit,
          },
        ],
      },
      {
        select: "ticketId bookId refId type at amount cost from to",
        sort: { at: 1, _id: 1 },
      },
    )) as unknown as TransferEventRow[];
    const shipped = rows.filter(
      (row) =>
        row.type === TICKET_EVENT_TYPE.transferOut &&
        isOnHandAt(row.from, orgId),
    );
    const back = rows.filter(
      (row) =>
        (row.type === TICKET_EVENT_TYPE.transferIn &&
          isOnHandAt(row.to, orgId)) ||
        (row.type === TICKET_EVENT_TYPE.investigate &&
          row.from?.orgId.equals(orgId) === true),
    );
    const all = [...shipped, ...back];
    if (all.length === 0) {
      return [];
    }
    const [docs, ships, receiptCost, facts] = await Promise.all([
      this.transferDocsOf(
        reader,
        all.map((row) => row.refId),
      ),
      this.shipsOf(reader, orgId, back),
      // 作廢回到出貨店的張:原成本用點收記的調入前成本(在途退回的,事件前就是出貨店的成本)
      this.receiptCostsOf(
        reader,
        back.map((row) => row.refId),
      ),
      this.ticketFactsOf(
        reader,
        all.map((row) => row.ticketId),
      ),
    ]);
    const result: OutboundTicket[] = [];
    for (const [sign, list] of [
      [1, shipped],
      [-1, back],
    ] as const) {
      for (const row of list) {
        const doc = docs.get(String(row.refId));
        if (doc?.fromBranchId !== String(orgId)) {
          continue;
        }
        const key = `${String(row.refId)}|${String(row.ticketId)}`;
        result.push({
          ticketId: row.ticketId,
          bookId: row.bookId,
          refId: row.refId,
          at: row.at,
          sign,
          // 反向的那一筆用出貨那一筆記的金額
          amount: sign === 1 ? row.amount : (ships(row)?.amount ?? 0),
          // 沒有成本快照的舊事件:用張現況的單張成本
          cost:
            (sign === -1 ? receiptCost.get(key) : undefined) ??
            row.cost ??
            facts.get(String(row.ticketId))?.unitCost ??
            0,
          lost: row.type === TICKET_EVENT_TYPE.investigate,
        });
      }
    }
    return result;
  }

  /** 在途的張的調貨金額:每張取 `at` 以前最後一筆「調出」事件記的金額;待標註的扣掉。 */
  async inTransitAmountOf(
    reader: OperatorContext,
    groups: readonly InTransitGroup[],
    at: Date,
  ): Promise<number> {
    const ticketIds = groups.flatMap((group) => group.ticketIds);
    if (ticketIds.length === 0) {
      return 0;
    }
    const lasts = (await this.events.aggregate(reader, [
      {
        $match: {
          ticketId: { $in: ticketIds },
          type: TICKET_EVENT_TYPE.transferOut,
          refType: "transfer",
          at: { $lt: at },
        },
      },
      { $sort: { at: -1, _id: -1 } },
      { $group: { _id: "$ticketId", amount: { $first: "$amount" } } },
    ])) as { _id: Types.ObjectId; amount: number }[];
    const amountOf = new Map(lasts.map((row) => [String(row._id), row.amount]));
    let amount = 0;
    for (const group of groups) {
      const units = group.ticketIds.map(
        (ticketId) => amountOf.get(String(ticketId)) ?? 0,
      );
      const total = units.reduce((sum, value) => sum + value, 0);
      amount +=
        units.length === 0 ? 0 : total - (group.pending * total) / units.length;
    }
    return amount;
  }

  // ---- 內部 ----

  /** 期間內作廢的調貨單 id。 */
  private async voidedTransfersIn(
    reader: OperatorContext,
    from: Date,
    to: Date,
  ): Promise<Types.ObjectId[]> {
    const rows = await this.submissions.findMany(
      reader,
      {
        moduleKey: TRANSFER_MODULE_KEY,
        status: "voided",
        voidedAt: { $gte: from, $lt: to },
      },
      { select: "_id" },
    );
    return rows.map((row) => row._id);
  }

  /** 調貨單的出貨店。 */
  private async transferDocsOf(
    reader: OperatorContext,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, TransferDoc>> {
    const unique = [...new Map(ids.map((id) => [String(id), id])).values()];
    if (unique.length === 0) {
      return new Map();
    }
    const rows = await this.submissions.findMany(
      reader,
      { _id: { $in: unique }, moduleKey: TRANSFER_MODULE_KEY },
      { select: "values" },
    );
    return new Map(
      rows.map((row) => [
        String(row._id),
        {
          fromBranchId: transferHeaderOf(row.values as Record<string, unknown>)
            .fromBranchId,
        },
      ]),
    );
  }

  /**
   * 反向的那幾張各自對應的出貨(同一張、同一張調貨單、這家店寫的「調出」,在反向之前最後一筆;一次查)。
   */
  private async shipsOf(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    back: readonly TransferEventRow[],
  ): Promise<(row: TransferEventRow) => TransferEventRow | undefined> {
    const rows =
      back.length === 0
        ? []
        : ((await this.events.findMany(
            reader,
            {
              orgId,
              type: TICKET_EVENT_TYPE.transferOut,
              refType: "transfer",
              ticketId: { $in: back.map((row) => row.ticketId) },
            },
            { select: "ticketId refId at amount", sort: { at: 1, _id: 1 } },
          )) as unknown as TransferEventRow[]);
    return (row) =>
      rows.findLast(
        (ship) =>
          ship.ticketId.equals(row.ticketId) &&
          ship.refId.equals(row.refId) &&
          ship.at <= row.at,
      );
  }

  /** 張號(選張列找調貨金額)與現況的單張成本(舊事件沒有成本快照時用)。 */
  private async ticketFactsOf(
    reader: OperatorContext,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, { ticketNo: string; unitCost: number }>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.tickets.findMany(
      reader,
      { _id: { $in: [...ids] } },
      { select: "ticketNo unitCost" },
    );
    return new Map(
      rows.map((row) => [
        String(row._id),
        { ticketNo: row.ticketNo, unitCost: row.unitCost },
      ]),
    );
  }

  /** 這些調貨單的點收紀錄上每張的調入前成本(`<單 id>|<張 id>`)。 */
  private async receiptCostsOf(
    reader: OperatorContext,
    submissionIds: readonly Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (submissionIds.length === 0) {
      return new Map();
    }
    const rows = (await this.receipts.findMany(
      reader,
      { submissionId: { $in: [...submissionIds] } },
      { select: "submissionId tickets" },
    )) as unknown as Pick<ReceiptRow, "submissionId" | "tickets">[];
    const result = new Map<string, number>();
    for (const row of rows) {
      for (const ticket of row.tickets) {
        result.set(
          `${String(row.submissionId)}|${String(ticket.ticketId)}`,
          ticket.unitCost,
        );
      }
    }
    return result;
  }

  /**
   * 這些張在 `at` 那一刻的單張成本(沒有成本快照的舊事件才用):現況的單張成本;`at` 之後才調入的,
   * 用 `at` 之後最早那筆點收記的調入前成本。
   */
  private async costsAt(
    reader: OperatorContext,
    ticketIds: readonly Types.ObjectId[],
    at: Date,
  ): Promise<Map<string, number>> {
    const [rows, laterReceipts] = await Promise.all([
      this.tickets.findMany(
        reader,
        { _id: { $in: [...ticketIds] } },
        { select: "unitCost" },
      ),
      this.receipts.findMany(
        reader,
        {
          receivedAt: { $gte: at },
          "tickets.ticketId": { $in: [...ticketIds] },
        },
        { select: "receivedAt tickets", sort: { receivedAt: 1, _id: 1 } },
      ),
    ]);
    const costs = new Map(rows.map((row) => [String(row._id), row.unitCost]));
    const restored = new Set<string>();
    for (const receipt of laterReceipts) {
      for (const ticket of receipt.tickets) {
        const key = String(ticket.ticketId);
        if (costs.has(key) && !restored.has(key)) {
          costs.set(key, ticket.unitCost);
          restored.add(key);
        }
      }
    }
    return costs;
  }
}

/** 調入、調出依「同一本 + 同一張調貨單」分組(整本調貨扣待標註)。 */
export function outboundGroupsOf(
  tickets: readonly OutboundTicket[],
  sign: 1 | -1,
  value: (ticket: OutboundTicket) => number,
): TicketGroupInput[] {
  const groups = new Map<string, TicketGroupInput & { costs: number[] }>();
  for (const ticket of tickets) {
    if (ticket.sign !== sign) {
      continue;
    }
    const key = `${String(ticket.bookId)}|${String(ticket.refId)}`;
    const group = groups.get(key) ?? {
      bookId: ticket.bookId,
      at: ticket.at,
      costs: [],
    };
    group.costs.push(value(ticket));
    groups.set(key, group);
  }
  return [...groups.values()];
}
