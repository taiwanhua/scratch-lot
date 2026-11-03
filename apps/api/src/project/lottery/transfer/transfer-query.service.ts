import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  COUNT_MODE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  TRANSFER_FORM_KEY,
  TRANSFER_MODE,
  TRANSFER_MODULE_KEY,
  type TicketStatus,
  pendingSkipCountOf,
  transferLinesOf,
} from "@repo/domain/project/lottery";
import { LOTTERY_SETTING_KEYS } from "@repo/domain/project/lottery-settings";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import {
  LotteryBooksRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryRequisitionLinesRepository } from "../../database/lottery-requisitions/lottery-requisition-lines.repository";
import { LotteryTransferReceiptsRepository } from "../../database/lottery-transfers/lottery-transfer-receipts.repository";
import { tenantOfOperator } from "../master-data-tenant";
import { inTransitBooksOf } from "../requisition/in-transit";
import { StoreCountModeService } from "../settings/store-count-mode.service";
import {
  SettlementLedger,
  outstandingOf,
} from "../settlement/settlement-ledger";
import { settlementDocumentOf } from "../settlement/settlement-registry";
import { LotteryAllocationsService } from "../tickets/allocations.service";
import type {
  LotteryTransferAllocationModel,
  LotteryTransferBookModel,
  LotteryTransferOptionsModel,
  LotteryTransferProgressModel,
  LotteryTransferRequisitionModel,
  LotteryTransferTicketCellModel,
} from "./models/transfer.model";
import { notFoundError } from "./transfer-error";
import { isLineReceived, receivedByRow } from "./transfer-received";
import {
  TransferRules,
  isGuessedTicket,
  toObjectId,
} from "./transfer-rules.service";

/** 讀到的一張(選本 / 格子用)。 */
interface TicketFact {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  orgId: Types.ObjectId;
  gameId: Types.ObjectId;
  ticketNo: string;
  status: TicketStatus;
  location: { kind: string; cashPointId?: Types.ObjectId | null };
  lockedBy: { refType: string; refId: Types.ObjectId } | null;
  unmatched: boolean;
  soldAt?: Date | null;
}

const CELL_SELECT =
  "bookId orgId gameId ticketNo status location lockedBy unmatched soldAt";

/** 格子的狀態(張數店規格 7.4「刷到不能調的提示」;順序 = 判斷順序)。 */
function cellStateOf(ticket: TicketFact, fromId: Types.ObjectId): string {
  if (ticket.status === TICKET_STATUS.skipped) {
    return "skipped";
  }
  if (!ticket.orgId.equals(fromId)) {
    return "elsewhere";
  }
  switch (ticket.status) {
    case TICKET_STATUS.sold: {
      // 已售(撤銷審核中鎖住的也是已售)
      return "sold";
    }
    case TICKET_STATUS.investigating:
    case TICKET_STATUS.lost:
    case TICKET_STATUS.scrapped: {
      return ticket.status;
    }
    default: {
      break;
    }
  }
  if (ticket.lockedBy !== null) {
    return "locked";
  }
  if (ticket.location.kind === TICKET_LOCATION_KIND.inTransit) {
    return "in_transit";
  }
  return ticket.location.kind === TICKET_LOCATION_KIND.counter
    ? "counter"
    : "available";
}

/** 這張在出貨店可以調:在出貨店、未售、沒被鎖定、不在途。 */
function isAvailableIn(ticket: TicketFact, fromId: Types.ObjectId): boolean {
  return (
    ticket.orgId.equals(fromId) &&
    ticket.status === TICKET_STATUS.unsold &&
    ticket.lockedBy === null &&
    ticket.location.kind !== TICKET_LOCATION_KIND.inTransit
  );
}

/**
 * 調貨單的讀取(專案規格 8.4;正本 `docs/modules/project/purchasing.md`「api 介面」):
 *
 * - `optionsOf`:新增頁的選項(出貨店能調的本、收貨店待購買的叫貨單)
 * - `ticketsOf`:選張的張數格子(一本的每一張在出貨店能不能調)
 * - `progressOf`:列表的本數 / 張數、點收進度、在途、結算
 *
 * 出貨店要在操作者的可見範圍;本與張以租戶邊界讀(本可能是別家店持有、張分在多家店)。權限由 resolver 守。
 */
@Injectable()
export class TransferQueryService {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly requisitionLines: LotteryRequisitionLinesRepository,
    private readonly receipts: LotteryTransferReceiptsRepository,
    private readonly rules: TransferRules,
    private readonly ledger: SettlementLedger,
    private readonly allocations: LotteryAllocationsService,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly countModes: StoreCountModeService,
  ) {}

  async optionsOf(
    operator: OperatorContext,
    fromId: Types.ObjectId,
    toId: Types.ObjectId | null,
    editingId: Types.ObjectId | null = null,
  ): Promise<LotteryTransferOptionsModel> {
    const reader = await this.readerFor(operator, fromId);
    const available = (await this.tickets.findMany(
      reader,
      {
        orgId: fromId,
        status: TICKET_STATUS.unsold,
        lockedBy: null,
        "location.kind": { $ne: TICKET_LOCATION_KIND.inTransit },
      },
      { select: "bookId location" },
    )) as unknown as { bookId: Types.ObjectId; location: { kind: string } }[];
    // 可調張數只算庫存(拆過的本的部分張只能從庫存調,張數店規格 7.4);檯面上有張的本仍列出,刷到時提示先收回
    const counts = new Map<string, number>();
    for (const ticket of available) {
      const key = String(ticket.bookId);
      const inStock = ticket.location.kind === TICKET_LOCATION_KIND.stock;
      counts.set(key, (counts.get(key) ?? 0) + (inStock ? 1 : 0));
    }
    const bookRows =
      counts.size === 0
        ? []
        : await this.books.findMany(
            reader,
            {
              _id: { $in: available.map((ticket) => ticket.bookId) },
              status: "normal",
            },
            {
              select:
                "gameId gameCode bookNo rate lastTicketNo standardTickets skippedTicketNos firstOpenedAt",
            },
          );
    const allTickets =
      bookRows.length === 0
        ? []
        : ((await this.tickets.findMany(
            reader,
            { bookId: { $in: bookRows.map((book) => book._id) } },
            { select: "bookId orgId ticketNo status location lockedBy" },
          )) as unknown as TicketFact[]);
    const games = await this.rules.gamesOf(
      reader,
      bookRows.map((book) => book.gameId),
    );
    const books: LotteryTransferBookModel[] = bookRows
      .flatMap((book) => {
        const game = games.get(String(book.gameId));
        if (game === undefined) {
          return [];
        }
        const own = allTickets.filter(
          (ticket) =>
            ticket.bookId.equals(book._id) &&
            ticket.status !== TICKET_STATUS.skipped,
        );
        // 整本 = 從沒拆過(拆過一次就只能選張)、整本在出貨店庫存、沒被鎖
        const isWhole =
          (book.firstOpenedAt ?? null) === null &&
          own.every(
            (ticket) =>
              isAvailableIn(ticket, fromId) &&
              ticket.location.kind === TICKET_LOCATION_KIND.stock,
          );
        return [
          {
            bookId: String(book._id),
            gameId: String(book.gameId),
            gameCode: book.gameCode,
            gameName: game.name,
            bookNo: book.bookNo,
            unitPrice: game.unitPrice,
            bookPrice: game.bookPrice,
            rate: book.rate,
            isWhole,
            lastTicketNo: Number(book.lastTicketNo),
            // 待標註的跳號(拆本前還沒標的)實體不存在:整本可調張數 = 標準張數(使用者 10/27 定案甲)
            availableCount: Math.max(
              0,
              (counts.get(String(book._id)) ?? 0) -
                pendingSkipCountOf(
                  Number(book.lastTicketNo),
                  book.standardTickets,
                  book.skippedTicketNos.length,
                ),
            ),
          },
        ];
      })
      .toSorted(
        (left, right) =>
          left.gameCode.localeCompare(right.gameCode, "zh-Hant") ||
          left.bookNo.localeCompare(right.bookNo, "zh-Hant"),
      );
    const countMode = await this.countModes.modeOf(reader, fromId);
    const gridPick =
      countMode === COUNT_MODE.numbered &&
      (await this.countModes.settingOf(
        reader,
        fromId,
        LOTTERY_SETTING_KEYS.transferGridPick,
      )) === "on";
    return {
      gridPick,
      countMode,
      books,
      requisitions:
        toId === null ? [] : await this.requisitionsOf(reader, toId, editingId),
      allocations:
        toId === null
          ? []
          : await this.allocationsOf(
              operator,
              toId,
              bookRows.map((book) => book.gameId),
            ),
    };
  }

  async ticketsOf(
    operator: OperatorContext,
    fromId: Types.ObjectId,
    bookIdText: string,
  ): Promise<LotteryTransferTicketCellModel[]> {
    const reader = await this.readerFor(operator, fromId);
    const bookId = toObjectId(bookIdText);
    if (bookId === null) {
      throw notFoundError("本不存在");
    }
    const tickets = (await this.tickets.findMany(
      reader,
      { bookId },
      { select: CELL_SELECT, sort: { ticketNo: 1 } },
    )) as unknown as TicketFact[];
    if (tickets.length === 0) {
      throw notFoundError("本不存在");
    }
    // 張數店與轉換中:系統預設帶入狀態的張在出貨店庫存有配對張 → 可以調(送出時先對號,7.4)
    const guessed = tickets.filter(
      (ticket) => ticket.orgId.equals(fromId) && isGuessedTicket(ticket),
    );
    const partners =
      guessed.length > 0 && (await this.rules.isCountingStore(reader, fromId))
        ? await this.rules.matchPartnersOf(reader, fromId, guessed, new Set())
        : new Map<string, unknown>();
    const pointIds = [
      ...new Set(
        tickets.flatMap((ticket) =>
          ticket.location.cashPointId == null
            ? []
            : [String(ticket.location.cashPointId)],
        ),
      ),
    ];
    const lockIds = [
      ...new Set(
        tickets.flatMap((ticket) =>
          ticket.lockedBy?.refType === "transfer"
            ? [String(ticket.lockedBy.refId)]
            : [],
        ),
      ),
    ];
    const [points, locks] = await Promise.all([
      pointIds.length === 0
        ? []
        : this.cashPoints.findMany(reader, {
            _id: { $in: pointIds.map((id) => toObjectId(id)) },
          }),
      lockIds.length === 0
        ? []
        : this.submissions.findMany(
            reader,
            { _id: { $in: lockIds.map((id) => toObjectId(id)) } },
            { select: "serialNo" },
          ),
    ]);
    const pointName = new Map(
      points.map((point) => [String(point._id), point.name]),
    );
    const serialOf = new Map(
      locks.map((lock) => [String(lock._id), lock.serialNo ?? null]),
    );
    return tickets.map((ticket) => {
      const state = cellStateOf(ticket, fromId);
      const pointId =
        ticket.location.cashPointId == null
          ? null
          : String(ticket.location.cashPointId);
      const sameStore = ticket.orgId.equals(fromId);
      return {
        ticketNo: ticket.ticketNo,
        state,
        unmatched: ticket.unmatched,
        matchable: partners.has(String(ticket._id)),
        soldCashPointName:
          state === "sold" && pointId !== null && sameStore
            ? (pointName.get(pointId) ?? null)
            : null,
        soldAt: state === "sold" ? (ticket.soldAt ?? null) : null,
        cashPointName:
          state === "counter" && pointId !== null
            ? (pointName.get(pointId) ?? null)
            : null,
        lockedSerialNo:
          state === "locked" && ticket.lockedBy?.refType === "transfer"
            ? (serialOf.get(String(ticket.lockedBy.refId)) ?? null)
            : null,
      };
    });
  }

  async progressOf(
    operator: OperatorContext,
    transferIds: readonly string[],
  ): Promise<LotteryTransferProgressModel[]> {
    const ids = transferIds.flatMap((id) => {
      const objectId = toObjectId(id);
      return objectId === null ? [] : [objectId];
    });
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (ids.length === 0 || tenantId === null) {
      return [];
    }
    const filter = {
      _id: { $in: ids },
      moduleKey: TRANSFER_MODULE_KEY,
      formKey: TRANSFER_FORM_KEY,
    };
    // 讀得到 = 一般讀取(可見範圍,或依欄位共用:出貨 / 收貨分店在讀者的可見範圍內;ADR-0014),與
    // `TransferAccess` / 收付同一個判準。點收紀錄與在途的張分在兩邊店,只對讀得到的這幾張單以租戶邊界讀
    const submissions = await this.submissions.findMany(operator, filter);
    if (submissions.length === 0) {
      return [];
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const receipts = await this.receipts.findMany(
      reader,
      { submissionId: { $in: submissions.map((row) => row._id) } },
      { select: "submissionId rowId tickets" },
    );
    const receivedOf = receivedByRow(
      receipts,
      (row) => `${String(row.submissionId)}:${row.rowId}`,
    );
    const transiting = await this.tickets.findMany(
      reader,
      {
        "lockedBy.refType": "transfer",
        "lockedBy.refId": { $in: submissions.map((row) => row._id) },
        "location.kind": TICKET_LOCATION_KIND.inTransit,
      },
      { select: "lockedBy" },
    );
    const inTransit = new Set(
      transiting.map((ticket) => String(ticket.lockedBy?.refId)),
    );
    const registration = settlementDocumentOf(TRANSFER_MODULE_KEY);
    const snapshots =
      registration === undefined
        ? []
        : await this.ledger.snapshotsOf(operator, registration, submissions);
    const dueOf = new Map(
      snapshots.map((snapshot) => [
        String(snapshot.submission._id),
        outstandingOf(snapshot)[0] ?? null,
      ]),
    );
    return submissions.map((submission) => {
      const key = String(submission._id);
      const lines = transferLinesOf(submission.values);
      const due = dueOf.get(key) ?? null;
      return {
        transferId: key,
        wholeBooks: lines.filter((line) => line.mode === TRANSFER_MODE.whole)
          .length,
        partialTickets: lines
          .filter((line) => line.mode === TRANSFER_MODE.partial)
          .reduce((sum, line) => sum + line.tickets, 0),
        // 點收進度以本計:一列全部到齊才算 1 本
        receivedCount: lines.filter((line) =>
          isLineReceived(line, receivedOf.get(`${key}:${line.rowId}`)),
        ).length,
        totalCount: lines.length,
        inTransit: inTransit.has(key),
        settlementKind: due?.kind ?? null,
        settlementAmount: due?.amount ?? 0,
        inSettlement: dueOf.has(key),
      };
    });
  }

  // ---- 內部 ----

  /** 出貨店要在操作者的可見範圍;回操作者當前租戶的邊界上下文。 */
  private async readerFor(
    operator: OperatorContext,
    fromId: Types.ObjectId,
  ): Promise<OperatorContext> {
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (tenantId === null || !isOrgVisible(operator, fromId)) {
      throw notFoundError("分店不存在");
    }
    return tenantBoundaryContext(this.orgs, null, tenantId);
  }

  /**
   * 收貨店這些遊戲的預計要給本數、已給、在途(只警告用;規格 7.6)。收貨店可能不在操作者的可見範圍:
   * 已給以操作者當前租戶計算(`allocationStatuses` 的權限與可見性由呼叫端判斷,這裡是 `create`)。
   */
  private async allocationsOf(
    operator: OperatorContext,
    toId: Types.ObjectId,
    gameIdList: readonly Types.ObjectId[],
  ): Promise<LotteryTransferAllocationModel[]> {
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    const gameIds = [
      ...new Map(gameIdList.map((id) => [String(id), id])).values(),
    ];
    if (tenantId === null || gameIds.length === 0) {
      return [];
    }
    const [inTransit, statuses] = await Promise.all([
      inTransitBooksOf({ tenantId, orgId: toId }),
      this.allocations.allocationStatuses(operator, toId, gameIds),
    ]);
    return statuses.map((status) => ({
      gameId: status.gameId,
      plannedBooks: status.plannedBooks,
      givenBooks: status.givenBooks,
      inTransitBooks: inTransit.get(status.gameId) ?? 0,
    }));
  }

  /**
   * 收貨店待購買的叫貨單(有效、未被引用的副本列,依叫貨單合計本數);編輯中的調貨單(`editingId`)
   * 另含它自己已引用的那張(退回修改時叫貨單仍是「已調貨」,要能照原樣帶入)。
   */
  private async requisitionsOf(
    reader: OperatorContext,
    toId: Types.ObjectId,
    editingId: Types.ObjectId | null,
  ): Promise<LotteryTransferRequisitionModel[]> {
    const rows = await this.requisitionLines.findMany(
      reader,
      {
        orgId: toId,
        voidedAt: null,
        ...(editingId === null
          ? { referencedBy: null }
          : {
              $or: [
                { referencedBy: null },
                { "referencedBy.submissionId": editingId },
              ],
            }),
      },
      {
        select: "requisitionId serialNo books completedAt",
        sort: { completedAt: -1, _id: 1 },
      },
    );
    const byRequisition = new Map<string, LotteryTransferRequisitionModel>();
    for (const row of rows) {
      const key = String(row.requisitionId);
      const group = byRequisition.get(key) ?? {
        id: key,
        serialNo: row.serialNo,
        books: 0,
      };
      group.books += row.books;
      byRequisition.set(key, group);
    }
    return [...byRequisition.values()];
  }
}
