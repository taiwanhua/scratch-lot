import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import {
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  TRANSFER_FIELD_KEYS,
  TRANSFER_FORM_KEY,
  TRANSFER_MODE,
  TRANSFER_MODULE_KEY,
  type TransferLineValue,
  type TransferScan,
  displayBookNo,
  matchTransferScan,
  receivedLineAmountOf,
  transferHeaderOf,
  transferLinesOf,
  transferScanOf,
  transferTotalOf,
  transferUnitCostOf,
} from "@repo/domain/project/lottery";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { TransactionService } from "../../../database/transaction";
import { isDuplicateKeyError } from "../../../forms/forms-error";
import { NotificationService } from "../../../notifications/notification.service";
import { LotteryBooksRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryTransferReceiptsRepository } from "../../database/lottery-transfers/lottery-transfer-receipts.repository";
import {
  LOTTERY_TRANSFER_REF,
  LOTTERY_TRANSFER_WRONG_STORE,
} from "../../notifications";
import { receivingBatchesOf } from "../receiving-batches";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type {
  CompleteLotteryTransferReceivingPayload,
  LotteryTransferReceivingModel,
  ReceiveLotteryTransferBookPayload,
} from "./models/transfer.model";
import { TransferAccess, type TransferSubmission } from "./transfer-access";
import {
  TRANSFER_REASONS,
  forbiddenError,
  notFoundError,
  validationError,
} from "./transfer-error";
import {
  isLineReceived,
  receivedByRow,
  receivedCountOf,
} from "./transfer-received";
import {
  TRANSFER_OPEN_STATUSES,
  type TransferBook,
  type TransferGame,
  TransferRules,
  labelOf,
  toObjectId,
  transferLockOf,
} from "./transfer-rules.service";

function alreadyReceivedError(
  rowId: string | null,
  ticketNos: readonly string[] = [],
) {
  return validationError(
    "Already received",
    ["code"],
    TRANSFER_REASONS.alreadyReceived,
    {
      ...(rowId === null ? {} : { rowId }),
      ...(ticketNos.length === 0 ? {} : { ticketNos: [...ticketNos] }),
    },
  );
}

/** 這一次要點收的:那一列,與張號(整本的列 = null,整列)。 */
interface ReceivePick {
  line: TransferLineValue;
  ticketNos: string[] | null;
}

/**
 * 調貨點收(專案規格 8.4「點收一本」、送錯分店同進貨單;正本 `docs/modules/project/purchasing.md`「調貨單」):
 *
 * - `receivingOf`:檢視頁的出貨確認清單與點收區塊(每一列出貨了沒、點收了沒)
 * - `receive`:刷一張 → 整本的列:這列的張全部;選張的列:**只有刷到的那一張**(逐張點收,使用者 10/26 定案)
 *   改成收貨店庫存、寫「調入」事件(單張成本 = 該列批購金額 ÷ 張數)、解除鎖定、寫一筆 `lottery_transfer_receipts`,
 *   同一個交易。單據要在審核中、點收關卡的任務在操作者手上;這列還沒出貨 → 擋下;同一張再刷 → 「已點收」;
 *   單上沒有 → 查是不是送往別家店的調貨單(送錯分店:擋下、不入庫)
 * - `receiveTickets`:選張的列在格子上點收(點選格子 [點收選取的 N 張]、[其餘全部到齊…]),寫法同上、一次一筆
 * - `complete`:[完成這次點收] → 「這一次」點收的列標上同一個點收批次(`batchId`;同進貨點收);
 *   「這一次」由畫面記(上次完成或打開頁面之後點收的列),已在別的批次的列不重收。調貨點收單照批次印
 */
/** 這一列的張最近一次調出的時間;都沒有調出事件 = null。 */
function latestOf(
  tickets: readonly { _id: Types.ObjectId }[],
  shippedAt: ReadonlyMap<string, Date>,
): Date | null {
  let latest: Date | null = null;
  for (const ticket of tickets) {
    const at = shippedAt.get(String(ticket._id));
    if (at !== undefined && (latest === null || at > latest)) {
      latest = at;
    }
  }
  return latest;
}

@Injectable()
export class TransferReceivingService {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly receipts: LotteryTransferReceiptsRepository,
    private readonly rules: TransferRules,
    private readonly access: TransferAccess,
    private readonly ledger: TicketLedgerService,
    private readonly notifications: NotificationService,
    private readonly tx: TransactionService,
  ) {}

  /**
   * 編輯頁的選項帶的 `submissionId`:操作者讀得到這張調貨單(`TransferAccess.readable`)才回它的 id,
   * 讀不到 / 不是調貨單 → null(當作新增頁,不多列它引用的叫貨單)。
   */
  async readableIdOf(
    operator: OperatorContext,
    submissionIdText: string | null | undefined,
  ): Promise<Types.ObjectId | null> {
    if (submissionIdText === null || submissionIdText === undefined) {
      return null;
    }
    try {
      const submission = await this.access.readable(operator, submissionIdText);
      return submission._id;
    } catch {
      return null;
    }
  }

  async receivingOf(
    operator: OperatorContext,
    submissionIdText: string,
  ): Promise<LotteryTransferReceivingModel> {
    const submission = await this.access.readable(operator, submissionIdText);
    return this.toModel(operator, submission);
  }

  async receive(
    operator: OperatorContext,
    submissionIdText: string,
    code: string,
    gameId: string | null = null,
  ): Promise<ReceiveLotteryTransferBookPayload> {
    const submission = await this.access.readable(operator, submissionIdText);
    const received = await this.receiveInTransaction(
      operator,
      submission,
      (lines, books) => this.pickByScan(submission, lines, books, code, gameId),
    );
    return {
      ...received,
      receiving: await this.toModel(
        operator,
        await this.access.readable(operator, submissionIdText),
      ),
    };
  }

  /** 選張的列在格子上點收(點選格子 / 其餘全部到齊):張號都要在這一列;整本的列只能刷一張整列點收。 */
  async receiveTickets(
    operator: OperatorContext,
    submissionIdText: string,
    rowId: string,
    ticketNos: readonly string[],
  ): Promise<ReceiveLotteryTransferBookPayload> {
    const submission = await this.access.readable(operator, submissionIdText);
    const received = await this.receiveInTransaction(
      operator,
      submission,
      (lines) => {
        const line = lines.find((item) => item.rowId === rowId);
        const wanted = [...new Set(ticketNos)];
        if (line === undefined) {
          throw this.notOnTransferError();
        }
        if (line.mode !== TRANSFER_MODE.partial) {
          throw validationError(
            "Whole rows are received by scanning one ticket",
            ["rowId"],
            TRANSFER_REASONS.wholeRowTickets,
          );
        }
        const onLine = new Set(line.ticketNos);
        if (wanted.length === 0) {
          throw validationError("No tickets", ["ticketNos"]);
        }
        if (!wanted.every((no) => onLine.has(no))) {
          throw this.notOnTransferError();
        }
        return Promise.resolve({ line, ticketNos: wanted });
      },
    );
    return {
      ...received,
      receiving: await this.toModel(
        operator,
        await this.access.readable(operator, submissionIdText),
      ),
    };
  }

  /**
   * [完成這次點收]:這一次點收的列(`rowIds` 裡這張單的、自己點收的、還沒有批次的)標上新的點收批次。
   * 要點收任務在自己手上(跟刷條碼同一個資格);沒有可收進批次的列 → `batch` 為 null。
   */
  async complete(
    operator: OperatorContext,
    submissionIdText: string,
    rowIds: readonly string[],
  ): Promise<CompleteLotteryTransferReceivingPayload> {
    const submission = await this.access.readable(operator, submissionIdText);
    if (!(await this.access.canReceive(operator, submission))) {
      throw forbiddenError(
        "Transfer is not waiting for your receiving",
        TRANSFER_REASONS.notReceivable,
      );
    }
    // 只收這張單的列(上限 = 列數;送超過的是壞請求)
    const lineRowIds = new Set(
      transferLinesOf(submission.values).map((line) => line.rowId),
    );
    if (rowIds.length > lineRowIds.size) {
      throw validationError("Too many rows", ["rowIds"]);
    }
    const batchId = new Types.ObjectId();
    // 以點收人自己的身分寫(點收紀錄歸收貨店、是他寫的):只收他自己點收的列,更新者記他
    const updated = await this.receipts.updateMany(
      operator,
      {
        submissionId: submission._id,
        rowId: { $in: rowIds.filter((rowId) => lineRowIds.has(rowId)) },
        receivedBy: operator.actorId,
        batchId: null,
      },
      { $set: { batchId, batchedAt: new Date() } },
    );
    const receiving = await this.toModel(operator, submission);
    return {
      batch:
        updated === 0
          ? null
          : (receiving.batches.find(
              (batch) => batch.batchId === String(batchId),
            ) ?? null),
      receiving,
    };
  }

  /** 刷到的碼 → 這一次要點收的:整本的列 = 整列;選張的列 = 刷到的那一張。 */
  private async pickByScan(
    submission: TransferSubmission,
    lines: readonly TransferLineValue[],
    books: ReadonlyMap<string, TransferBook>,
    code: string,
    gameId: string | null,
  ): Promise<ReceivePick> {
    const scan = transferScanOf(code);
    if (scan === null) {
      throw validationError(
        "Unknown code",
        ["code"],
        TRANSFER_REASONS.scanInvalid,
      );
    }
    const matched = matchTransferScan(
      lines,
      (bookId) => {
        const book = books.get(bookId);
        return book === undefined
          ? undefined
          : {
              gameId: String(book.gameId),
              gameCode: book.gameCode,
              bookNo: book.bookNo,
            };
      },
      scan,
      gameId,
    );
    if (matched.kind === "ambiguous_game") {
      throw validationError(
        "Several games on this transfer share the book number; scan the back code or pick a game",
        ["code"],
        TRANSFER_REASONS.scanAmbiguousGame,
        { gameIds: matched.gameIds },
      );
    }
    if (matched.kind === "ticket_not_on_transfer") {
      throw this.notOnTransferError();
    }
    if (matched.kind === "not_on_transfer") {
      throw await this.notOnTransferOrWrongStore(submission, scan);
    }
    const { line } = matched;
    return {
      line,
      ticketNos: line.mode === TRANSFER_MODE.whole ? null : [scan.ticketNo],
    };
  }

  /**
   * 點收的交易(刷一張 / 點選格子 / 其餘全部到齊共用):`pick` 決定這一次點收哪一列、哪幾張;
   * 整本的列點收過、或選到的張已點收 → 「已點收」(同一張同時刷兩次:後到的寫不到,也是「已點收」)。
   */
  private async receiveInTransaction(
    operator: OperatorContext,
    submission: TransferSubmission,
    pick: (
      lines: readonly TransferLineValue[],
      books: ReadonlyMap<string, TransferBook>,
    ) => Promise<ReceivePick>,
  ): Promise<{ rowId: string; ticketNos: string[] }> {
    try {
      return await this.tx.withTransaction(async (session) => {
        if (!(await this.access.canReceive(operator, submission))) {
          throw forbiddenError(
            "Transfer is not waiting for your receiving",
            TRANSFER_REASONS.notReceivable,
          );
        }
        const reader = await this.rules.readerOf(submission.tenantId);
        const lines = transferLinesOf(submission.values);
        const books = await this.rules.booksOf(reader, lines);
        const { line, ticketNos } = await pick(lines, books);
        const receipts = await this.rules.receiptsOf(
          reader,
          submission._id,
          session,
        );
        const received = receivedByRow(receipts).get(line.rowId);
        if (isLineReceived(line, received)) {
          throw alreadyReceivedError(line.rowId, ticketNos ?? []);
        }
        const already = (ticketNos ?? []).filter(
          (no) => received?.ticketNos.has(no) === true,
        );
        if (already.length > 0) {
          throw alreadyReceivedError(line.rowId, already);
        }
        const moved = await this.receiveRow(
          operator,
          session,
          submission,
          line,
          ticketNos,
          receivedCountOf(received),
        );
        return { rowId: line.rowId, ticketNos: moved };
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw alreadyReceivedError(null);
      }
      throw error;
    }
  }

  /**
   * 點收一列的張(`ticketNos` = null → 整列):在途的張 → 收貨店庫存(調入)、解除鎖定、寫一筆點收紀錄
   * (這一次的張與它們的批購金額 = 點收後 − 點收前的已點收金額)。回這一次搬進來的張號。
   */
  private async receiveRow(
    operator: OperatorContext,
    session: ClientSession,
    submission: TransferSubmission,
    line: TransferLineValue,
    ticketNos: readonly string[] | null,
    receivedBefore: number,
  ): Promise<string[]> {
    const tenantId = submission.tenantId;
    const header = transferHeaderOf(submission.values);
    const toId = toObjectId(header.toBranchId);
    const fromId = toObjectId(header.fromBranchId);
    const actorId = operator.actorId;
    if (
      tenantId === null ||
      toId === null ||
      fromId === null ||
      actorId === null
    ) {
      throw validationError("Transfer is invalid", ["code"]);
    }
    const reader = await this.rules.readerOf(tenantId);
    const lock = transferLockOf(submission._id);
    const wanted = new Set(ticketNos ?? line.ticketNos);
    const locked = await this.rules.lockedTicketsOf(
      reader,
      submission._id,
      session,
    );
    const tickets = locked.filter(
      (ticket) =>
        String(ticket.bookId) === line.bookId &&
        (line.mode === TRANSFER_MODE.whole || wanted.has(ticket.ticketNo)),
    );
    const isShipped =
      tickets.length > 0 &&
      (ticketNos === null || tickets.length === wanted.size) &&
      tickets.every(
        (ticket) => ticket.location.kind === TICKET_LOCATION_KIND.inTransit,
      );
    if (!isShipped) {
      throw validationError(
        "Row is not shipped yet",
        ["code"],
        TRANSFER_REASONS.notShipped,
        { rowId: line.rowId },
      );
    }
    const unitCost = transferUnitCostOf(line);
    await this.ledger.applyTicketEvents(
      session,
      { operator, crossStoreTenantId: tenantId },
      tickets.map((ticket) => ({
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        allowLockedBy: lock,
        type: TICKET_EVENT_TYPE.transferIn,
        patch: {
          orgId: toId,
          location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
          unitCost,
        },
        refType: "transfer",
        refId: submission._id,
      })),
    );
    await this.ledger.unlockTicketsInTenant(
      session,
      tenantId,
      tickets.map((ticket) => ticket._id),
      lock,
    );
    const bookId = toObjectId(line.bookId);
    if (bookId === null) {
      throw validationError("Transfer line is invalid", ["code"]);
    }
    const receivedAfter = receivedBefore + tickets.length;
    await this.receipts.create(
      operator,
      {
        orgId: toId,
        fromOrgId: fromId,
        submissionId: submission._id,
        rowId: line.rowId,
        bookId,
        purchaseAmount:
          receivedLineAmountOf(line, receivedAfter) -
          receivedLineAmountOf(line, receivedBefore),
        tickets: tickets.map((ticket) => ({
          ticketId: ticket._id,
          unitCost: ticket.unitCost,
          ticketNo: ticket.ticketNo,
        })),
        receivedBy: actorId,
        receivedAt: new Date(),
      },
      { session },
    );
    return tickets.map((ticket) => ticket.ticketNo);
  }

  private notOnTransferError() {
    return validationError(
      "Book is not on this transfer",
      ["code"],
      TRANSFER_REASONS.bookNotOnTransfer,
    );
  }

  /** 單上沒有這本:送往別家分店、還沒點收完的調貨單上有 → 送錯分店;沒有 → 不在這張單上。 */
  private async notOnTransferOrWrongStore(
    submission: TransferSubmission,
    scan: TransferScan,
  ) {
    const hit = await this.wrongStoreHit(submission, scan);
    if (hit === null) {
      return this.notOnTransferError();
    }
    const values = hit.owner.values as Record<string, unknown>;
    return validationError(
      "Book belongs to another store's transfer",
      ["code"],
      TRANSFER_REASONS.wrongStore,
      {
        ownerBranchName: labelOf(values[TRANSFER_FIELD_KEYS.toBranch]),
        serialNo: hit.owner.serialNo ?? null,
        gameName: hit.game?.name ?? null,
        unitPrice: hit.game?.unitPrice ?? null,
        bookNo: displayBookNo(scan.bookNo),
      },
    );
  }

  /** 這本在送往別家分店、還沒結束的調貨單上(送錯分店):那張單、那一列、遊戲;沒有 → null。 */
  private async wrongStoreHit(
    submission: TransferSubmission,
    scan: TransferScan,
  ): Promise<{
    owner: TransferSubmission;
    rowId: string;
    game: TransferGame | undefined;
  } | null> {
    const reader = await tenantBoundaryContext(
      this.orgs,
      null,
      submission.tenantId,
    );
    const candidates = await this.books.findMany(
      reader,
      {
        bookNo: scan.bookNo,
        ...(scan.gameCode === null ? {} : { gameCode: scan.gameCode }),
      },
      { select: "gameId gameCode bookNo status" },
    );
    if (candidates.length === 0) {
      return null;
    }
    const candidateIds = new Set(candidates.map((book) => String(book._id)));
    const toBranch = transferHeaderOf(submission.values).toBranchId;
    const others = await this.submissions.findMany(
      reader,
      {
        _id: { $ne: submission._id },
        moduleKey: TRANSFER_MODULE_KEY,
        formKey: TRANSFER_FORM_KEY,
        status: { $in: [...TRANSFER_OPEN_STATUSES] },
        "values.lines.book.id": { $in: [...candidateIds] },
      },
      {
        select: "values serialNo createdBy orgId tenantId status",
        sort: { createdAt: -1 },
      },
    );
    const owner = others.find(
      (other) => transferHeaderOf(other.values).toBranchId !== toBranch,
    );
    const line =
      owner === undefined
        ? undefined
        : transferLinesOf(owner.values).find((item) =>
            candidateIds.has(item.bookId),
          );
    if (owner === undefined || line === undefined) {
      return null;
    }
    const book = candidates.find((item) => String(item._id) === line.bookId);
    const games = await this.rules.gamesOf(
      reader,
      book === undefined ? [] : [book.gameId],
    );
    return {
      owner,
      rowId: line.rowId,
      game: book === undefined ? undefined : games.get(String(book.gameId)),
    };
  }

  /**
   * [通知總部更正](送錯分店同進貨單):刷到的本若在送往別家分店的調貨單上,通知那張調貨單的建立者
   * (`lottery.transfer-wrong-store`);不是 → `NOT_FOUND`。讀得到這張調貨單才能按。
   */
  async notifyWrongStore(
    operator: OperatorContext,
    submissionIdText: string,
    code: string,
  ): Promise<boolean> {
    const submission = await this.access.readable(operator, submissionIdText);
    const scan = transferScanOf(code);
    const hit =
      scan === null ? null : await this.wrongStoreHit(submission, scan);
    if (hit === null) {
      throw notFoundError("這本不在送往別家分店的調貨單上");
    }
    const createdBy = hit.owner.createdBy ?? null;
    if (createdBy === null) {
      return false;
    }
    const values = submission.values as Record<string, unknown>;
    await this.notifications.notify({
      type: LOTTERY_TRANSFER_WRONG_STORE,
      tenantId: hit.owner.tenantId,
      orgId: hit.owner.orgId,
      recipients: { kind: "users", userIds: [createdBy] },
      params: {
        subject: hit.owner.serialNo ?? "",
        orgName: labelOf(values[TRANSFER_FIELD_KEYS.toBranch]),
      },
      ref: { type: LOTTERY_TRANSFER_REF, id: String(hit.owner._id) },
      dedupeKey: `transfer-wrong-store:${String(hit.owner._id)}:${hit.rowId}:${String(submission._id)}`,
    });
    return true;
  }

  async toModel(
    operator: OperatorContext,
    submission: TransferSubmission,
  ): Promise<LotteryTransferReceivingModel> {
    const reader = await this.rules.readerOf(submission.tenantId);
    const values = submission.values as Record<string, unknown>;
    const lines = transferLinesOf(values);
    const books = await this.rules.booksOf(reader, lines);
    const games = await this.rules.gamesOf(
      reader,
      [...books.values()].map((book) => book.gameId),
    );
    const receipts = await this.rules.receiptsOf(reader, submission._id);
    // 一列可以有好幾筆點收紀錄(選張的列逐張點收):最近一次的時間 / 點收批次
    const receivedAt = new Map<string, Date>();
    const batchOf = new Map<string, string>();
    for (const receipt of receipts.toSorted(
      (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
    )) {
      receivedAt.set(receipt.rowId, receipt.receivedAt);
      if (receipt.batchId != null) {
        batchOf.set(receipt.rowId, String(receipt.batchId));
      }
    }
    const receivedOf = receivedByRow(receipts);
    const shippedAtOfTicket = await this.rules.shippedAtOf(
      reader,
      submission._id,
    );
    const bookTickets = await this.rules.ticketsOfBooks(
      reader,
      [...books.values()].map((book) => book._id),
    );
    // 點收紀錄實際搬進來的張 → 張號(調貨點收單的號碼照這個印;選張的列可能只到部分張)
    const ticketNoOf = new Map(
      [...bookTickets.values()]
        .flat()
        .map((ticket) => [String(ticket._id), ticket.ticketNo] as const),
    );
    const ticketNosOfIds = (ids: Iterable<string>): string[] =>
      [...ids]
        .flatMap((id) => {
          const no = ticketNoOf.get(id);
          return no === undefined ? [] : [no];
        })
        .toSorted((a, b) => a.localeCompare(b));
    const rows = lines.map((line) => {
      const book = books.get(line.bookId);
      const game =
        book === undefined ? undefined : games.get(String(book.gameId));
      const rowTickets = this.rules.rowTicketsOf(
        line,
        bookTickets.get(line.bookId) ?? [],
      );
      const received = receivedOf.get(line.rowId);
      const isReceived = isLineReceived(line, received);
      const locked = rowTickets.filter(
        (ticket) =>
          ticket.lockedBy?.refType === "transfer" &&
          ticket.lockedBy.refId.equals(submission._id),
      );
      const isShipped =
        isReceived ||
        (locked.length > 0 &&
          locked.every(
            (ticket) => ticket.location.kind === TICKET_LOCATION_KIND.inTransit,
          ));
      return {
        rowId: line.rowId,
        bookId: line.bookId,
        gameCode: book?.gameCode ?? "",
        gameName: game?.name ?? "",
        bookNo: book?.bookNo ?? "",
        mode: line.mode,
        ticketNos:
          line.mode === TRANSFER_MODE.whole
            ? rowTickets
                .filter((ticket) => ticket.status !== TICKET_STATUS.skipped)
                .map((ticket) => ticket.ticketNo)
            : line.ticketNos,
        tickets: line.tickets,
        amount: line.amount,
        rate: line.rate,
        purchaseAmount: line.purchaseAmount,
        shipped: isShipped,
        received: isReceived,
        receivedTickets: receivedCountOf(received),
        receivedAt: receivedAt.get(line.rowId) ?? null,
        shippedAt: isShipped ? latestOf(rowTickets, shippedAtOfTicket) : null,
        batchId: batchOf.get(line.rowId) ?? null,
        receivedTicketNos: ticketNosOfIds(received?.ticketIds ?? []),
      };
    });
    // 每一次點收:列 + 這一次每一列點收的張(同一列在同一次點收可以有好幾筆紀錄)
    const batches = receivingBatchesOf(receipts).map((batch) => {
      const idsOfRow = new Map<string, Set<string>>();
      for (const receipt of receipts) {
        if (
          receipt.batchId == null ||
          String(receipt.batchId) !== batch.batchId
        ) {
          continue;
        }
        const ids = idsOfRow.get(receipt.rowId) ?? new Set<string>();
        for (const ticket of receipt.tickets) {
          ids.add(String(ticket.ticketId));
        }
        idsOfRow.set(receipt.rowId, ids);
      }
      return {
        ...batch,
        rows: batch.rowIds.map((rowId) => ({
          rowId,
          ticketNos: ticketNosOfIds(idsOfRow.get(rowId) ?? []),
        })),
      };
    });
    return {
      submissionId: String(submission._id),
      fromBranchName: labelOf(values[TRANSFER_FIELD_KEYS.fromBranch]),
      toBranchName: labelOf(values[TRANSFER_FIELD_KEYS.toBranch]),
      transferAmount: transferTotalOf(lines),
      canReceive: await this.access.canReceive(operator, submission),
      receivedCount: rows.filter((row) => row.received).length,
      totalCount: rows.length,
      rows,
      batches,
    };
  }
}
