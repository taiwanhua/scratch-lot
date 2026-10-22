import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  TRANSFER_MODULE_KEY,
  type TicketStatus,
} from "@repo/domain/project/lottery";

import { FormSubmissionsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import {
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryTransferReceiptsRepository } from "../../database/lottery-transfers/lottery-transfer-receipts.repository";

/** 期末還在店裡的張:庫存、檯面(在途算在途中,不算任何一家店)。 */
const ON_HAND_LOCATIONS: ReadonlySet<string> = new Set([
  TICKET_LOCATION_KIND.stock,
  TICKET_LOCATION_KIND.counter,
]);

/** 期末還算這家店的狀態(未售 → 期末庫存;待查 → 待查本數)。 */
const ENDING_STATUSES: readonly TicketStatus[] = [
  TICKET_STATUS.unsold,
  TICKET_STATUS.investigating,
];

/** 一家店的調入 / 調出(張數、調貨金額、原成本)。 */
export interface TransferFigures {
  inTickets: number;
  inAmount: number;
  outTickets: number;
  outAmount: number;
  /** 調出的張調入前的單張成本合計(調貨損益 = 調出金額 − 它) */
  outCost: number;
}

/** 期末庫存:張數、期末當時的成本、待查本數。 */
export interface EndingStock {
  tickets: number;
  cost: number;
  investigatingBooks: number;
}

interface ReceiptRow {
  _id: Types.ObjectId;
  submissionId: Types.ObjectId;
  orgId: Types.ObjectId;
  fromOrgId: Types.ObjectId;
  purchaseAmount: number;
  receivedAt: Date;
  tickets: { ticketId: Types.ObjectId; unitCost: number }[];
}

interface TicketState {
  ticketId: Types.ObjectId;
  bookId: Types.ObjectId;
  status: string;
  locationKind: string;
}

/**
 * 營運報表區塊 4 的調貨與期末庫存(規格 11.2、8.4;正本 `docs/modules/project/reports.md`「營運報表」)。
 *
 * - **調入 / 調出**:依點收時間算調貨點收;調貨單被**作廢**的,在作廢時間那份報表反向算回(已關帳月份的數字不變,
 *   作廢那個月少回來)。駁回前不能有點收,所以點收紀錄只會因作廢失效
 * - **期末庫存**:從張的**現況往回推**:只讀期末之後的事件(`at ≥ 迄`),不掃有史以來的事件 ——
 *   期末之後動過的張,期末狀態 = 它期末之後第一筆事件的「變動前」;沒動過的張,期末狀態 = 現況
 * - **期末成本**:期末之後才調入的張,單張成本已換成調入後的,改用期末之後最早那筆點收記的「調入前成本」還原
 */
@Injectable()
export class ReportStock {
  constructor(
    private readonly events: LotteryTicketEventsRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly receipts: LotteryTransferReceiptsRepository,
    private readonly submissions: FormSubmissionsRepository,
  ) {}

  async transfersOf(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    from: Date,
    to: Date,
  ): Promise<TransferFigures> {
    const touching = { $or: [{ orgId }, { fromOrgId: orgId }] };
    const [received, voidedDocs] = await Promise.all([
      this.receipts.findMany(
        reader,
        { ...touching, receivedAt: { $gte: from, $lt: to } },
        {
          select:
            "submissionId orgId fromOrgId purchaseAmount receivedAt tickets",
        },
      ) as unknown as Promise<ReceiptRow[]>,
      this.submissions.findMany(
        reader,
        {
          moduleKey: TRANSFER_MODULE_KEY,
          status: "voided",
          voidedAt: { $gte: from, $lt: to },
        },
        { select: "_id" },
      ),
    ]);
    const reversed =
      voidedDocs.length === 0
        ? []
        : ((await this.receipts.findMany(
            reader,
            {
              ...touching,
              submissionId: { $in: voidedDocs.map((row) => row._id) },
            },
            {
              select:
                "submissionId orgId fromOrgId purchaseAmount receivedAt tickets",
            },
          )) as unknown as ReceiptRow[]);
    const figures: TransferFigures = {
      inTickets: 0,
      inAmount: 0,
      outTickets: 0,
      outAmount: 0,
      outCost: 0,
    };
    const apply = (row: ReceiptRow, sign: 1 | -1) => {
      if (row.orgId.equals(orgId)) {
        figures.inTickets += sign * row.tickets.length;
        figures.inAmount += sign * row.purchaseAmount;
      }
      if (row.fromOrgId.equals(orgId)) {
        figures.outTickets += sign * row.tickets.length;
        figures.outAmount += sign * row.purchaseAmount;
        figures.outCost +=
          sign * row.tickets.reduce((sum, ticket) => sum + ticket.unitCost, 0);
      }
    };
    for (const row of received) apply(row, 1);
    for (const row of reversed) apply(row, -1);
    return figures;
  }

  async endingOf(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    to: Date,
  ): Promise<EndingStock> {
    // 期末之後碰過這家店的事件(進出這家店的那一筆,事件後或事件前一定是這家店);依時間
    const later = await this.events.findMany(
      reader,
      { at: { $gte: to }, $or: [{ orgId }, { "from.orgId": orgId }] },
      {
        select: "ticketId bookId from at",
        sort: { at: 1, _id: 1 },
      },
    );
    const firstLater = new Map<string, (typeof later)[number]>();
    for (const event of later) {
      if (!firstLater.has(String(event.ticketId))) {
        firstLater.set(String(event.ticketId), event);
      }
    }
    const states: TicketState[] = [];
    for (const event of firstLater.values()) {
      // 期末在這家店 ⇔ 期末之後第一筆碰到這家店的事件,變動前是這家店(進貨的變動前是 null:期末還不存在)
      if (
        event.from !== null &&
        event.from.orgId.equals(orgId) &&
        ENDING_STATUSES.includes(event.from.status)
      ) {
        states.push({
          ticketId: event.ticketId,
          bookId: event.bookId,
          status: event.from.status,
          locationKind: event.from.locationKind,
        });
      }
    }
    // 期末之後沒動過的張:現況就是期末狀態(索引 orgId + location.kind + status)
    const untouched = await this.tickets.findMany(
      reader,
      {
        orgId,
        status: { $in: [...ENDING_STATUSES] },
        _id: { $nin: [...firstLater.values()].map((event) => event.ticketId) },
      },
      { select: "bookId status location" },
    );
    for (const ticket of untouched) {
      states.push({
        ticketId: ticket._id,
        bookId: ticket.bookId,
        status: ticket.status,
        locationKind: ticket.location.kind,
      });
    }
    const onHand = states.filter(
      (state) =>
        state.status === TICKET_STATUS.unsold &&
        ON_HAND_LOCATIONS.has(state.locationKind),
    );
    const costs = await this.costsAt(
      reader,
      onHand.map((state) => state.ticketId),
      to,
    );
    return {
      tickets: onHand.length,
      cost: onHand.reduce(
        (sum, state) => sum + (costs.get(String(state.ticketId)) ?? 0),
        0,
      ),
      investigatingBooks: new Set(
        states
          .filter((state) => state.status === TICKET_STATUS.investigating)
          .map((state) => String(state.bookId)),
      ).size,
    };
  }

  /**
   * 這些張在 `at` 那一刻的單張成本:現況的單張成本;`at` 之後才調入的,用 `at` 之後最早那筆點收記的調入前成本
   * (作廢會把成本改回調入前,那筆點收記的也是同一個值)。
   */
  private async costsAt(
    reader: OperatorContext,
    ticketIds: readonly Types.ObjectId[],
    at: Date,
  ): Promise<Map<string, number>> {
    if (ticketIds.length === 0) {
      return new Map();
    }
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
