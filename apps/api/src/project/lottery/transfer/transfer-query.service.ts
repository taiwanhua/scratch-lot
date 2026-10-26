import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  TRANSFER_FORM_KEY,
  TRANSFER_MODE,
  TRANSFER_MODULE_KEY,
  pendingSkipCountOf,
  transferLinesOf,
} from "@repo/domain/project/lottery";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import {
  LotteryBooksRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryRequisitionLinesRepository } from "../../database/lottery-requisitions/lottery-requisition-lines.repository";
import { LotteryTransferReceiptsRepository } from "../../database/lottery-transfers/lottery-transfer-receipts.repository";
import { tenantOfOperator } from "../master-data-tenant";
import { inTransitBooksOf } from "../requisition/in-transit";
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
import { TransferRules, toObjectId } from "./transfer-rules.service";

/** 讀到的一張(選本 / 格子用)。 */
interface TicketFact {
  bookId: Types.ObjectId;
  orgId: Types.ObjectId;
  ticketNo: string;
  status: string;
  location: { kind: string };
  lockedBy: unknown;
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
      { select: "bookId" },
    )) as unknown as { bookId: Types.ObjectId }[];
    const counts = new Map<string, number>();
    for (const ticket of available) {
      const key = String(ticket.bookId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
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
                "gameId gameCode bookNo rate lastTicketNo standardTickets skippedTicketNos",
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
        const isWhole = own.every(
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
    return {
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
      {
        select: "bookId orgId ticketNo status location lockedBy",
        sort: { ticketNo: 1 },
      },
    )) as unknown as TicketFact[];
    if (tickets.length === 0) {
      throw notFoundError("本不存在");
    }
    return tickets.map((ticket) => {
      let state = "elsewhere";
      if (ticket.status === TICKET_STATUS.skipped) {
        state = "skipped";
      } else if (!ticket.orgId.equals(fromId)) {
        // 不在出貨店:維持 elsewhere
      } else if (ticket.lockedBy !== null) {
        state = "locked";
      } else if (ticket.status === TICKET_STATUS.sold) {
        state = "sold";
      } else if (isAvailableIn(ticket, fromId)) {
        state = "available";
      }
      return { ticketNo: ticket.ticketNo, state };
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
      { select: "submissionId rowId" },
    );
    const received = new Set(
      receipts.map((row) => `${String(row.submissionId)}:${row.rowId}`),
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
        receivedCount: lines.filter((line) =>
          received.has(`${key}:${line.rowId}`),
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
