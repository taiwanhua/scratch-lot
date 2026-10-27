import { Injectable, Logger } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";
import {
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  TRANSFER_FORM_KEY,
  TRANSFER_MODE,
  TRANSFER_MODULE_KEY,
  TRANSFER_PERMISSIONS,
  TRANSFER_SETTLEMENT_SIDE,
  type TicketLocationKind,
  type TicketStatus,
  type TransferLineValue,
  isUnopenedInStore,
  pendingSkipCountOf,
  transferHeaderOf,
  transferLineAmountOf,
  transferLinesOf,
  transferSettlementProblemOf,
  transferTicketAmountOf,
  transferUnitCostOf,
} from "@repo/domain/project/lottery";

import {
  FormSubmissionsRepository,
  OrgsRepository,
  WorkflowInstancesRepository,
} from "../../../database/base/repositories";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { afterCommit } from "../../../database/transaction";
import { WorkflowTasksRepository } from "../../../database/workflow-tasks.repository";
import {
  PermissionResolver,
  holdsPermission,
} from "../../../permission/permission-resolver";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import type {
  FormEffectContext,
  FormGuardResult,
  LifecycleSubmission,
} from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryRequisitionLinesRepository } from "../../database/lottery-requisitions/lottery-requisition-lines.repository";
import { LotteryTransferReceiptsRepository } from "../../database/lottery-transfers/lottery-transfer-receipts.repository";
import {
  LOTTERY_TRANSFER_REF,
  LOTTERY_TRANSFER_SHIPPED,
} from "../../notifications";
import { RequisitionReference } from "../requisition/requisition-reference";
import { SettlementLedger } from "../settlement/settlement-ledger";
import { settlementDocumentOf } from "../settlement/settlement-registry";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketLockRef } from "../tickets/ticket-ledger.types";
import { TRANSFER_REASONS } from "./transfer-error";
import {
  type RowReceived,
  isLineReceived,
  receivedByRow,
} from "./transfer-received";

/** 「有效」的調貨單:送出之後、還沒駁回 / 作廢(草稿不算;規格 8 共通「草稿」)。 */
export const TRANSFER_LIVE_STATUSES = [
  "reviewing",
  "returned",
  "withdrawn",
  "completed",
] as const;

/** 未結束的調貨單:已建立還沒完成(草稿不算)。 */
export const TRANSFER_OPEN_STATUSES = [
  "reviewing",
  "returned",
  "withdrawn",
] as const;

export function toObjectId(id: string | null): Types.ObjectId | null {
  return id !== null && Types.ObjectId.isValid(id)
    ? new Types.ObjectId(id)
    : null;
}

/** 這張調貨單的鎖(張被它鎖定 = 「調貨中」)。 */
export function transferLockOf(submissionId: Types.ObjectId): TicketLockRef {
  return { refType: "transfer", refId: submissionId };
}

function block(code: string, message: string): FormGuardResult {
  return { code, message };
}

export function labelOf(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string"
    ? value.label
    : "";
}

/** 讀到的張(規則判斷用的欄位)。 */
export interface TransferTicket {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  orgId: Types.ObjectId;
  ticketNo: string;
  status: TicketStatus;
  location: { kind: TicketLocationKind; cashPointId: Types.ObjectId | null };
  lockedBy: { refType: string; refId: Types.ObjectId } | null;
  unitCost: number;
  version: number;
}

const TICKET_SELECT =
  "bookId orgId ticketNo status location lockedBy unitCost version";

/** 讀到的本。 */
export interface TransferBook {
  _id: Types.ObjectId;
  gameId: Types.ObjectId;
  gameCode: string;
  bookNo: string;
  status: string;
  /** 標準張數(整本調貨單上的張數 = 它) */
  standardTickets: number;
  /** 待標註張數(拆本前還沒標的跳號;實體不存在,整本調貨的張數不算它們) */
  pendingSkipCount: number;
  /** 第一次拆本時間;null = 從沒拆過。 */
  firstOpenedAt: Date | null;
}

/** 遊戲(金額比對用)。 */
export interface TransferGame {
  gameCode: string;
  name: string;
  unitPrice: number;
  bookPrice: number;
}

/** 這張單被它鎖定的張(= 還沒點收的列)。 */
function isLockedBy(ticket: TransferTicket, submissionId: Types.ObjectId) {
  return (
    ticket.lockedBy?.refType === "transfer" &&
    ticket.lockedBy.refId.equals(submissionId)
  );
}

const isInTransit = (ticket: TransferTicket): boolean =>
  ticket.location.kind === TICKET_LOCATION_KIND.inTransit;

/**
 * 在途的列內容沒變:遊戲、本、方式、張號、張數,以及金額、批購金額率、批購金額都一樣
 * (在途的列不能改,只能整列刪掉 → 待查;使用者 10/26 定案)。
 */
const isSameShipment = (
  before: TransferLineValue,
  after: TransferLineValue,
): boolean =>
  before.gameId === after.gameId &&
  before.bookId === after.bookId &&
  before.mode === after.mode &&
  before.tickets === after.tickets &&
  before.ticketNos.join(",") === after.ticketNos.join(",") &&
  before.amount === after.amount &&
  before.rate === after.rate &&
  before.purchaseAmount === after.purchaseAmount;

/**
 * 已出貨的選張列只移除沒到的張(少張處理,使用者 10/26 定案做法 A):遊戲、本、方式、批購金額率不變;
 * 張號只能少不能多或換,已點收的張都還在;張數 = 張號數、金額 = 面額 × 張數(面額照原本那一列)。
 * 拿掉的在途張送出後變待查(`onSubmitted`)。整本的列不能縮(整本只能整列刪)。
 */
const isShrunkShipment = (
  before: TransferLineValue,
  after: TransferLineValue,
  receivedNos: ReadonlySet<string>,
): boolean => {
  if (
    before.mode !== TRANSFER_MODE.partial ||
    after.mode !== TRANSFER_MODE.partial ||
    before.gameId !== after.gameId ||
    before.bookId !== after.bookId ||
    before.rate !== after.rate ||
    before.tickets <= 0 ||
    after.ticketNos.length === 0 ||
    after.tickets !== after.ticketNos.length
  ) {
    return false;
  }
  const kept = new Set(before.ticketNos);
  const remaining = new Set(after.ticketNos);
  return (
    after.ticketNos.every((no) => kept.has(no)) &&
    [...receivedNos].every((no) => remaining.has(no)) &&
    after.amount * before.tickets === before.amount * after.tickets
  );
};

/** 部分點收的列剩下還沒點收的張(選張的列;整本的列一次整列點收,原樣回)。 */
function remainingLineOf(
  line: TransferLineValue,
  received: RowReceived,
): TransferLineValue {
  return line.mode === TRANSFER_MODE.partial
    ? {
        ...line,
        ticketNos: line.ticketNos.filter((no) => !received.ticketNos.has(no)),
      }
    : line;
}

/** 上一次送出、已出貨(張都在途或已點收)的一列:那一列與已點收的張號。 */
interface ShippedLine {
  line: TransferLineValue;
  receivedNos: ReadonlySet<string>;
}

/**
 * 已出貨 / 有點收的列改了什麼(送出前):有點收的列不在上一次的出貨裡 → 已點收的列被改;
 * 內容沒改、或選張的列只移除沒到的張(還沒到齊)→ 合法;其他 → 擋下。
 */
function shippedProblemOf(
  lines: readonly TransferLineValue[],
  shipped: ReadonlyMap<string, ShippedLine>,
  receivedOf: ReadonlyMap<string, RowReceived>,
): FormGuardResult {
  for (const line of lines) {
    const before = shipped.get(line.rowId);
    const received = receivedOf.get(line.rowId);
    if (before === undefined) {
      if (received !== undefined) {
        return block(
          TRANSFER_REASONS.receivedRowChanged,
          "Received rows cannot be changed or removed",
        );
      }
      continue;
    }
    const isAllowed =
      isSameShipment(before.line, line) ||
      (!isLineReceived(before.line, received) &&
        isShrunkShipment(before.line, line, before.receivedNos));
    if (!isAllowed) {
      return block(
        received === undefined
          ? TRANSFER_REASONS.lineInvalid
          : TRANSFER_REASONS.receivedRowChanged,
        "Shipped rows can only drop tickets that did not arrive",
      );
    }
  }
  return null;
}

/**
 * 一列和它的本相符(規格 8.4 明細):本正常、遊戲相同、批購金額率 0–100 的整數、張數 = 這列的張
 * (整本 = 這本跳號以外的張扣掉待標註 = 標準張數;使用者 10/27 定案甲);
 * 整本要原封不動(從沒拆過、沒有張在別家店),選張要拆過、張號都在這本;金額 = 整本金額或面額 × 張數。
 */
function isLineValid(
  line: TransferLineValue,
  book: TransferBook,
  game: TransferGame,
  bookTickets: readonly TransferTicket[],
  rowTickets: readonly TransferTicket[],
): boolean {
  // 拆過 = 不是整本原封不動:拆過一次(`firstOpenedAt`,之後全部收回也算拆過;使用者 10/27 定案 D)、
  // 有張不是未售在庫存(售出、待查…),或已有張調到別家店
  const isOpened =
    !isUnopenedInStore(
      book.firstOpenedAt,
      bookTickets.map((ticket) => ({
        status: ticket.status,
        locationKind: ticket.location.kind,
      })),
    ) || new Set(bookTickets.map((ticket) => String(ticket.orgId))).size > 1;
  const isModeValid =
    line.mode === TRANSFER_MODE.whole
      ? !isOpened
      : isOpened && rowTickets.length === line.ticketNos.length;
  return (
    book.status === "normal" &&
    (line.gameId === null || line.gameId === String(book.gameId)) &&
    Number.isInteger(line.rate) &&
    line.rate >= 0 &&
    line.rate <= 100 &&
    rowTickets.length > 0 &&
    line.tickets ===
      rowTickets.length -
        (line.mode === TRANSFER_MODE.whole ? book.pendingSkipCount : 0) &&
    isModeValid &&
    line.amount === transferLineAmountOf(line.mode, game, line.tickets)
  );
}

/**
 * 調貨單的規則(專案規格 8.4 掛接點表;正本 `docs/modules/project/purchasing.md`「調貨單」)。
 * `transfer-lifecycle.ts` 的守門與事後動作都委派到這裡。
 *
 * - 「這張單鎖定的張」= 還沒點收的列(送出後鎖定、點收時解除);出貨與否看張的位置(在途)
 * - 讀「本 / 張 / 其他調貨單 / 叫貨單」以租戶邊界上下文(單據可能是總部建的,系統身分只看得到單據的組織)
 * - 鎖定 / 解除用帳本的系統鎖(`lockTicketsInTenant`);張數事件經帳本、在呼叫端的交易內
 */
@Injectable()
export class TransferRules {
  private readonly logger = new Logger(TransferRules.name);

  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly instances: WorkflowInstancesRepository,
    private readonly games: LotteryGamesRepository,
    private readonly books: LotteryBooksRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly receipts: LotteryTransferReceiptsRepository,
    private readonly requisitionLines: LotteryRequisitionLinesRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly permissions: PermissionResolver,
    private readonly settlementLedger: SettlementLedger,
    private readonly requisitions: RequisitionReference,
    private readonly ledger: TicketLedgerService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** 租戶的系統身分(反查)。 */
  readerOf(tenantId: Types.ObjectId | null): Promise<OperatorContext> {
    return tenantBoundaryContext(this.orgs, null, tenantId);
  }

  /** 這張單已點收的列。 */
  /** 這張單每一張的最近一次「調出」時間(張 id → 時間)。 */
  async shippedAtOf(
    reader: OperatorContext,
    submissionId: Types.ObjectId,
  ): Promise<Map<string, Date>> {
    const events = await this.events.findMany(
      reader,
      {
        refType: "transfer",
        refId: submissionId,
        type: TICKET_EVENT_TYPE.transferOut,
      },
      { select: "ticketId at" },
    );
    const latest = new Map<string, Date>();
    for (const event of events) {
      const key = String(event.ticketId);
      const current = latest.get(key);
      if (current === undefined || event.at > current) {
        latest.set(key, event.at);
      }
    }
    return latest;
  }

  async receiptsOf(
    reader: OperatorContext,
    submissionId: Types.ObjectId,
    session?: ClientSession,
  ) {
    return this.receipts.findMany(
      reader,
      { submissionId },
      {
        select:
          "rowId bookId tickets purchaseAmount receivedAt receivedBy batchId batchedAt",
        session,
      },
    );
  }

  /** 明細用到的本。 */
  async booksOf(
    reader: OperatorContext,
    lines: readonly TransferLineValue[],
  ): Promise<Map<string, TransferBook>> {
    const ids = [...new Set(lines.map((line) => line.bookId))].flatMap((id) => {
      const objectId = toObjectId(id);
      return objectId === null ? [] : [objectId];
    });
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.books.findMany(
      reader,
      { _id: { $in: ids } },
      {
        select:
          "gameId gameCode bookNo status lastTicketNo standardTickets skippedTicketNos firstOpenedAt",
      },
    );
    return new Map(
      rows.map((book) => [
        String(book._id),
        {
          _id: book._id,
          gameId: book.gameId,
          gameCode: book.gameCode,
          bookNo: book.bookNo,
          status: book.status,
          standardTickets: book.standardTickets,
          pendingSkipCount: pendingSkipCountOf(
            Number(book.lastTicketNo),
            book.standardTickets,
            book.skippedTicketNos.length,
          ),
          firstOpenedAt: book.firstOpenedAt ?? null,
        },
      ]),
    );
  }

  /** 遊戲(以本的遊戲為準)。 */
  async gamesOf(
    reader: OperatorContext,
    gameIds: readonly Types.ObjectId[],
  ): Promise<Map<string, TransferGame>> {
    if (gameIds.length === 0) {
      return new Map();
    }
    const rows = await this.games.findMany(
      reader,
      { _id: { $in: [...gameIds] } },
      { select: "gameCode name unitPrice bookPrice" },
    );
    return new Map(
      rows.map((game) => [
        String(game._id),
        {
          gameCode: game.gameCode,
          name: game.name,
          unitPrice: game.unitPrice,
          bookPrice: game.bookPrice,
        },
      ]),
    );
  }

  /**
   * 幾本的張(整本,依張號排序):本 id → 張;一次讀完(不逐本讀)。沒有張的本不在回傳裡,
   * 呼叫端以 `?? []` 取。
   */
  async ticketsOfBooks(
    reader: OperatorContext,
    bookIds: readonly Types.ObjectId[],
    session?: ClientSession,
  ): Promise<Map<string, TransferTicket[]>> {
    const unique = [...new Map(bookIds.map((id) => [String(id), id])).values()];
    const byBook = new Map<string, TransferTicket[]>();
    if (unique.length === 0) {
      return byBook;
    }
    const rows: TransferTicket[] = await this.tickets.findMany(
      reader,
      { bookId: { $in: unique } },
      { select: TICKET_SELECT, sort: { bookId: 1, ticketNo: 1 }, session },
    );
    for (const ticket of rows) {
      const key = String(ticket.bookId);
      const list = byBook.get(key) ?? [];
      list.push(ticket);
      byBook.set(key, list);
    }
    return byBook;
  }

  /**
   * 上一次送出的列裡,已出貨的(每一張都在途而且鎖在這張單上,或已點收):rowId → 上一次的列與已點收的張號。
   * 退回 / 撤回後重送時,這些列保持在途,不再走「在出貨店、原封不動」的送出前檢查;選張的列可以移除沒到的張
   * (`isShrunkShipment`)。
   */
  async shippedLinesOf(
    reader: OperatorContext,
    submissionId: Types.ObjectId,
    receivedTicketIds: ReadonlySet<string>,
  ): Promise<Map<string, ShippedLine>> {
    const doc = await this.submissions.findOne(
      reader,
      { _id: submissionId },
      { select: { revisions: { $slice: -1 } } },
    );
    const last = doc?.revisions.at(-1);
    if (last === undefined) {
      return new Map();
    }
    const locked = await this.lockedTicketsOf(reader, submissionId);
    const inTransit = new Set(
      locked
        .filter((ticket) => isInTransit(ticket))
        .map((ticket) => String(ticket._id)),
    );
    if (inTransit.size === 0 && receivedTicketIds.size === 0) {
      return new Map();
    }
    const shipped = new Map<string, ShippedLine>();
    const lines = transferLinesOf(last.values);
    const ticketsOf = await this.ticketsOfBooks(
      reader,
      lines.flatMap((line) => {
        const bookId = toObjectId(line.bookId);
        return bookId === null ? [] : [bookId];
      }),
    );
    for (const line of lines) {
      const bookId = toObjectId(line.bookId);
      if (bookId === null) {
        continue;
      }
      const rowTickets = this.rowTicketsOf(
        line,
        ticketsOf.get(String(bookId)) ?? [],
      );
      const isShipped =
        rowTickets.length > 0 &&
        rowTickets.every(
          (ticket) =>
            inTransit.has(String(ticket._id)) ||
            receivedTicketIds.has(String(ticket._id)),
        );
      if (isShipped) {
        shipped.set(line.rowId, {
          line,
          receivedNos: new Set(
            rowTickets
              .filter((ticket) => receivedTicketIds.has(String(ticket._id)))
              .map((ticket) => ticket.ticketNo),
          ),
        });
      }
    }
    return shipped;
  }

  async lockedTicketsOf(
    reader: OperatorContext,
    submissionId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<TransferTicket[]> {
    return this.tickets.findMany(
      reader,
      { "lockedBy.refType": "transfer", "lockedBy.refId": submissionId },
      { select: TICKET_SELECT, sort: { bookId: 1, ticketNo: 1 }, session },
    );
  }

  /** 一列要調的張:整本 = 這本跳號以外的張;選張 = 列上的張號。 */
  rowTicketsOf(
    line: TransferLineValue,
    bookTickets: readonly TransferTicket[],
  ): TransferTicket[] {
    if (line.mode === TRANSFER_MODE.whole) {
      return bookTickets.filter(
        (ticket) => ticket.status !== TICKET_STATUS.skipped,
      );
    }
    const wanted = new Set(line.ticketNos);
    return bookTickets.filter((ticket) => wanted.has(ticket.ticketNo));
  }

  /**
   * 點收關卡(第二關)= 這次送出的流程實例的最後一關。點收、核准前的全部檢查、側欄計數都只認這一關;
   * 第一關(出貨確認)核准不檢查點收與收付。讀不到實例 → null。
   */
  async receivingStepKeyOf(
    reader: OperatorContext,
    instanceId: Types.ObjectId,
  ): Promise<string | null> {
    const instance = await this.instances.findOne(
      reader,
      { _id: instanceId },
      { select: "steps.stepKey" },
    );
    const steps = instance?.steps ?? [];
    return steps.at(-1)?.stepKey ?? null;
  }

  /** 這張單目前的實例的點收關卡。 */
  async receivingStepOfSubmission(
    reader: OperatorContext,
    submissionId: Types.ObjectId,
  ): Promise<string | null> {
    const instance = await this.instances.findOne(
      reader,
      { submissionId },
      { select: "steps.stepKey revision", sort: { revision: -1 } },
    );
    return instance?.steps.at(-1)?.stepKey ?? null;
  }

  // ---- 守門 ----

  /**
   * 送出前(規格 8.4):出貨 / 收貨分店不同、出貨店在送出的人的範圍;明細的本與方式、金額、張數相符;
   * 選張要 `partial-tickets`;本和張都在出貨店、未售、沒被其他單鎖定、不在其他未結束的調貨單上;
   * 已點收的列沒被改或刪;叫貨單是收貨分店待購買的。
   */
  async beforeSubmit(
    operator: OperatorContext,
    submission: LifecycleSubmission,
    values: StoredValues,
  ): Promise<FormGuardResult> {
    const record = values as Record<string, unknown>;
    const header = transferHeaderOf(record);
    const fromId = toObjectId(header.fromBranchId);
    const toId = toObjectId(header.toBranchId);
    if (
      fromId === null ||
      toId === null ||
      fromId.equals(toId) ||
      !isOrgVisible(operator, fromId)
    ) {
      return block(
        TRANSFER_REASONS.branchInvalid,
        "From and to branches must differ; from branch must be visible",
      );
    }
    const lines = transferLinesOf(record);
    if (lines.length === 0) {
      return block(TRANSFER_REASONS.noLines, "Transfer has no lines");
    }
    if (
      lines.some((line) => line.mode === TRANSFER_MODE.partial) &&
      !(await this.holds(operator, TRANSFER_PERMISSIONS.partialTickets))
    ) {
      return block(
        TRANSFER_REASONS.partialForbidden,
        "Partial tickets need purchasing.transfer.partial-tickets",
      );
    }
    const reader = await this.readerOf(submission.tenantId);
    const receipts = await this.receiptsOf(reader, submission._id);
    const lineOf = new Map(lines.map((line) => [line.rowId, line]));
    const receivedOf = receivedByRow(receipts);
    // 有點收的列不能刪、不能換本
    const removedReceived = receipts.some(
      (receipt) => lineOf.get(receipt.rowId)?.bookId !== String(receipt.bookId),
    );
    if (removedReceived) {
      return block(
        TRANSFER_REASONS.receivedRowChanged,
        "Received rows cannot be changed or removed",
      );
    }
    // 已出貨的列(張都在途或已點收;退回 / 撤回後保持在途,規格 8.4):內容沒改 → 合法,不再檢查
    // 「在出貨店、原封不動」;選張的列只移除沒到的張(已點收的留著)→ 合法,拿掉的張送出後待查;
    // 其他改法(換遊戲 / 本 / 方式 / 率、加張、拿掉已點收的張)→ 擋下
    const receivedTicketIds = new Set(
      [...receivedOf.values()].flatMap((row) => [...row.ticketIds]),
    );
    const shipped = await this.shippedLinesOf(
      reader,
      submission._id,
      receivedTicketIds,
    );
    const shippedProblem = shippedProblemOf(lines, shipped, receivedOf);
    if (shippedProblem !== null) {
      return shippedProblem;
    }
    const pending = lines.filter(
      (line) => !receivedOf.has(line.rowId) && !shipped.has(line.rowId),
    );
    const lineProblem = await this.lineProblemOf(reader, pending, fromId, {
      submissionId: submission._id,
    });
    if (lineProblem !== null) {
      return lineProblem;
    }
    return this.requisitionProblemOf(
      reader,
      submission,
      header.requisitionNo,
      toId,
    );
  }

  /**
   * 核准前(點收關卡):全部點收,而且收貨店已付淨額 = 出貨店已收淨額 = 調貨金額;
   * 不相等 → 擋下並提示是哪一邊(規格 8.4「核准前」、第 9 章)。第一關(出貨確認)不檢查。
   */
  async beforeApprove(
    submission: LifecycleSubmission,
    operator: OperatorContext,
    stepKey: string | null,
  ): Promise<FormGuardResult> {
    const reader = await this.readerOf(submission.tenantId);
    const receivingStep = await this.receivingStepOfSubmission(
      reader,
      submission._id,
    );
    if (stepKey === null || stepKey !== receivingStep) {
      return null;
    }
    const lines = transferLinesOf(submission.values);
    const receipts = await this.receiptsOf(reader, submission._id);
    const receivedOf = receivedByRow(receipts);
    // 每一列的張都要到齊(選張的列逐張點收;少張 → 退回由出貨店移除沒到的張,畫面列出是哪幾張)
    if (
      !lines.every((line) => isLineReceived(line, receivedOf.get(line.rowId)))
    ) {
      return block(
        TRANSFER_REASONS.unreceivedRows,
        "Some tickets are not received",
      );
    }
    const registration = settlementDocumentOf(TRANSFER_MODULE_KEY);
    if (registration === undefined) {
      return null;
    }
    const [snapshot] = await this.settlementLedger.snapshotsOf(
      operator,
      registration,
      [{ ...submission, submittedAt: null }],
    );
    if (snapshot === undefined) {
      return null;
    }
    const sides = snapshot.state.sides;
    const problem = transferSettlementProblemOf(
      snapshot.state.payable,
      sides[TRANSFER_SETTLEMENT_SIDE.receiver] ?? { out: 0, in: 0 },
      sides[TRANSFER_SETTLEMENT_SIDE.shipper] ?? { out: 0, in: 0 },
    );
    if (problem === null) {
      return null;
    }
    const reasons = {
      receiver_underpaid: TRANSFER_REASONS.receiverUnderpaid,
      shipper_unreceived: TRANSFER_REASONS.shipperUnreceived,
      shipper_overreceived: TRANSFER_REASONS.shipperOverreceived,
      receiver_overpaid: TRANSFER_REASONS.receiverOverpaid,
    } as const;
    return block(
      reasons[problem.kind],
      `Settlement is not even: ${problem.kind} ${String(problem.amount)}`,
    );
  }

  /** 駁回前 / 刪除前:已有點收 → 擋下。 */
  async withoutReceipts(
    submission: LifecycleSubmission,
  ): Promise<FormGuardResult> {
    const reader = await this.readerOf(submission.tenantId);
    const found = await this.receipts.findOne(
      reader,
      { submissionId: submission._id },
      { select: "_id" },
    );
    return found === null
      ? null
      : block(TRANSFER_REASONS.hasReceipts, "Transfer has received books");
  }

  /**
   * 作廢前:調入後已售、再調出或拆本 → 擋下。點收搬進來的張,最後一筆事件都要還是這張單的「調入」、
   * 而且仍是收貨店庫存裡未售、沒被鎖定的張。
   */
  async beforeVoid(submission: LifecycleSubmission): Promise<FormGuardResult> {
    const reader = await this.readerOf(submission.tenantId);
    const receipts = await this.receiptsOf(reader, submission._id);
    const ticketIds = receipts.flatMap((receipt) =>
      receipt.tickets.map((ticket) => ticket.ticketId),
    );
    if (ticketIds.length === 0) {
      return null;
    }
    const tickets = (await this.tickets.findMany(
      reader,
      { _id: { $in: ticketIds } },
      { select: TICKET_SELECT },
    )) as unknown as TransferTicket[];
    const untouched = tickets.every(
      (ticket) =>
        ticket.status === TICKET_STATUS.unsold &&
        ticket.location.kind === TICKET_LOCATION_KIND.stock &&
        ticket.lockedBy === null,
    );
    const latest = untouched
      ? await this.events.aggregate(reader, [
          { $match: { ticketId: { $in: ticketIds } } },
          { $sort: { at: -1, _id: -1 } },
          {
            $group: {
              _id: "$ticketId",
              type: { $first: "$type" },
              refId: { $first: "$refId" },
            },
          },
        ])
      : [];
    const isOurs = (row: Record<string, unknown>): boolean =>
      row.type === TICKET_EVENT_TYPE.transferIn &&
      String(row.refId) === String(submission._id);
    return untouched &&
      latest.length === tickets.length &&
      latest.every((row) => isOurs(row))
      ? null
      : block(
          TRANSFER_REASONS.booksInUse,
          "Received tickets were sold, transferred again or opened",
        );
  }

  // ---- 事後動作 ----

  /**
   * 送出後:鎖定(調貨中,不能賣);重新送出時,被刪掉的列 —— 已在途的 → 待查(責任分店 = 出貨店)、
   * 還沒出貨的 → 解除鎖定;叫貨單 → 已調貨(換了叫貨單的,舊的回到待購買)。
   */
  async onSubmitted(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const submission = await this.submissionOf(context);
    const values = submission.values as Record<string, unknown>;
    const header = transferHeaderOf(values);
    const fromId = toObjectId(header.fromBranchId);
    const reader = await this.readerOf(tenantId);
    const lock = transferLockOf(context.submissionId);
    const receipts = await this.receiptsOf(
      reader,
      context.submissionId,
      context.session,
    );
    const receivedOf = receivedByRow(receipts);
    const wanted = new Map<string, TransferTicket>();
    // 全部到齊的列不再鎖;部分點收的列只鎖還沒點收的張(已點收的已是收貨店庫存)
    const pendingLines = transferLinesOf(values).filter(
      (line) =>
        !isLineReceived(line, receivedOf.get(line.rowId)) &&
        toObjectId(line.bookId) !== null,
    );
    const ticketsOf = await this.ticketsOfBooks(
      reader,
      pendingLines.flatMap((line) => {
        const bookId = toObjectId(line.bookId);
        return bookId === null ? [] : [bookId];
      }),
      context.session,
    );
    for (const line of pendingLines) {
      const bookTickets = ticketsOf.get(String(toObjectId(line.bookId))) ?? [];
      const received = receivedOf.get(line.rowId);
      for (const ticket of this.rowTicketsOf(line, bookTickets)) {
        if (received?.ticketIds.has(String(ticket._id)) !== true) {
          wanted.set(String(ticket._id), ticket);
        }
      }
    }
    await this.repriceReceived(
      reader,
      tenantId,
      values,
      receivedOf,
      context.session,
      context.submissionId,
    );
    const locked = await this.lockedTicketsOf(
      reader,
      context.submissionId,
      context.session,
    );
    const removed = locked.filter((ticket) => !wanted.has(String(ticket._id)));
    const lost = removed.filter((ticket) => isInTransit(ticket));
    if (lost.length > 0 && fromId !== null) {
      // 在途的列被刪除 → 待查,責任分店 = 出貨店(規格 7.4、8.4)
      await this.ledger.applyTicketEvents(
        context.session,
        { operator: null, crossStoreTenantId: tenantId },
        lost.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          allowLockedBy: lock,
          type: TICKET_EVENT_TYPE.investigate,
          patch: {
            status: TICKET_STATUS.investigating,
            responsibleOrgId: fromId,
          },
          refType: "transfer",
          refId: context.submissionId,
        })),
      );
    }
    await this.ledger.unlockTicketsInTenant(
      context.session,
      tenantId,
      removed.map((ticket) => ticket._id),
      lock,
    );
    const lockedIds = new Set(locked.map((ticket) => String(ticket._id)));
    await this.ledger.lockTicketsInTenant(
      context.session,
      tenantId,
      [...wanted.values()]
        .filter((ticket) => !lockedIds.has(String(ticket._id)))
        .map((ticket) => ticket._id),
      lock,
    );
    await this.referenceRequisition(context, header.requisitionNo);
    this.publishBadgeAfterCommit(context);
  }

  /**
   * 關卡通過後(含跳過,`skipped: true`):還沒出貨的張 → 位置改「在途」、寫「調出」事件;
   * 負責人提醒「調貨出貨通知」給收貨店(規格 3.4);側欄信號給第二關的審核者。
   */
  async onStepPassed(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const reader = await this.readerOf(tenantId);
    const lock = transferLockOf(context.submissionId);
    const locked = await this.lockedTicketsOf(
      reader,
      context.submissionId,
      context.session,
    );
    const pending = locked.filter((ticket) => !isInTransit(ticket));
    if (pending.length > 0) {
      const submission = await this.submissionOf(context);
      const values = submission.values as Record<string, unknown>;
      const lines = transferLinesOf(values);
      await this.ledger.applyTicketEvents(
        context.session,
        { operator: null, crossStoreTenantId: tenantId },
        pending.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          allowLockedBy: lock,
          type: TICKET_EVENT_TYPE.transferOut,
          patch: {
            location: {
              kind: TICKET_LOCATION_KIND.inTransit,
              cashPointId: null,
            },
          },
          // 這張出貨當時的調貨金額快照(營運報表的調出 / 在途金額讀它;之後改單、刪列不影響舊報表)
          amount: transferTicketAmountOf(
            lines,
            String(ticket.bookId),
            ticket.ticketNo,
          ),
          refType: "transfer",
          refId: context.submissionId,
        })),
      );
      const toId = toObjectId(transferHeaderOf(values).toBranchId);
      if (toId !== null) {
        await context.notify({
          type: LOTTERY_TRANSFER_SHIPPED,
          tenantId,
          orgId: toId,
          params: {
            subject: submission.serialNo ?? "",
            fromOrgName: labelOf(values.from_branch),
          },
          // 點進去 = 那張調貨單
          ref: { type: LOTTERY_TRANSFER_REF, id: String(context.submissionId) },
          dedupeKey: `transfer-shipped:${String(context.submissionId)}:${String(context.revision)}`,
        });
      }
    }
    this.publishBadgeAfterCommit(context);
  }

  /** 退回 / 撤回後:還沒出貨的解除鎖定;已在途的保持在途;結算紀錄保留。 */
  async onReleased(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const reader = await this.readerOf(tenantId);
    const locked = await this.lockedTicketsOf(
      reader,
      context.submissionId,
      context.session,
    );
    const notShipped = locked.filter((ticket) => !isInTransit(ticket));
    await this.ledger.unlockTicketsInTenant(
      context.session,
      tenantId,
      notShipped.map((ticket) => ticket._id),
      transferLockOf(context.submissionId),
    );
    this.publishBadgeAfterCommit(context);
  }

  /** 駁回後:全部回到出貨店(在途的寫反向的「調入」回出貨店庫存),解除鎖定;叫貨單回到待購買。 */
  async onRejected(context: FormEffectContext): Promise<void> {
    await this.returnLockedToShipper(context);
    await this.releaseRequisitions(context);
    this.publishBadgeAfterCommit(context);
  }

  /**
   * 作廢後:點收搬進收貨店的張全部回到出貨店 —— 收貨店寫「調出」、出貨店寫「調入」(反向事件,`reasonKey` /
   * `reasonNote` 帶作廢原因),單張成本改回調入前;還鎖著的照駁回處理;叫貨單回到待購買。
   * 換店的稽核記作廢的人(事後動作的系統身分沒有操作者)。
   */
  async onVoided(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const submission = await this.submissionOf(context);
    const fromId = toObjectId(transferHeaderOf(submission.values).fromBranchId);
    const reader = await this.readerOf(tenantId);
    const receipts = await this.receiptsOf(
      reader,
      context.submissionId,
      context.session,
    );
    const costOf = new Map(
      receipts.flatMap((receipt) =>
        receipt.tickets.map(
          (ticket) => [String(ticket.ticketId), ticket.unitCost] as const,
        ),
      ),
    );
    const tickets =
      costOf.size === 0
        ? []
        : ((await this.tickets.findMany(
            reader,
            {
              _id: {
                $in: [...costOf.keys()].map((id) => new Types.ObjectId(id)),
              },
            },
            { select: TICKET_SELECT, session: context.session },
          )) as unknown as TransferTicket[]);
    if (tickets.length > 0 && fromId !== null) {
      const reason = {
        refType: "transfer",
        refId: context.submissionId,
        reasonKey: context.voidReason?.reasonKey ?? null,
        reasonNote: context.voidReason?.reasonNote ?? null,
      };
      await this.ledger.applyTicketEvents(
        context.session,
        {
          operator: null,
          crossStoreTenantId: tenantId,
          systemActorId: submission.voidedBy ?? null,
        },
        tickets.flatMap((ticket) => [
          {
            ticketId: ticket._id,
            expectedVersion: ticket.version,
            type: TICKET_EVENT_TYPE.transferOut,
            patch: {
              location: {
                kind: TICKET_LOCATION_KIND.inTransit,
                cashPointId: null,
              },
            },
            ...reason,
          },
          {
            ticketId: ticket._id,
            expectedVersion: ticket.version + 1,
            type: TICKET_EVENT_TYPE.transferIn,
            patch: {
              orgId: fromId,
              location: {
                kind: TICKET_LOCATION_KIND.stock,
                cashPointId: null,
              },
              unitCost: costOf.get(String(ticket._id)) ?? ticket.unitCost,
            },
            ...reason,
          },
        ]),
      );
    }
    await this.returnLockedToShipper(context);
    await this.releaseRequisitions(context);
    this.publishBadgeAfterCommit(context);
  }

  /**
   * 少張處理後重算已點收張的單張成本(使用者 10/27 定案):選張的列移除沒到的張、縮小以後,已點收那幾張的
   * 單張成本改成「重算後這一列的批購金額 ÷ 張數」,這一列調入的成本合計 = 調貨金額。經帳本寫「成本調整」事件
   * (時間 = 重送那一刻;事件的成本快照 = 調整前的成本,舊報表重跑不變),整批寫;沒縮小的列成本相同,不寫。
   */
  private async repriceReceived(
    reader: OperatorContext,
    tenantId: Types.ObjectId,
    values: Record<string, unknown>,
    receivedOf: ReadonlyMap<string, RowReceived>,
    session: ClientSession,
    submissionId: Types.ObjectId,
  ): Promise<void> {
    const costOf = new Map<string, number>();
    for (const line of transferLinesOf(values)) {
      const received = receivedOf.get(line.rowId);
      if (line.mode !== TRANSFER_MODE.partial || received === undefined) {
        continue;
      }
      const unitCost = transferUnitCostOf(line);
      for (const id of received.ticketIds) {
        costOf.set(id, unitCost);
      }
    }
    if (costOf.size === 0) {
      return;
    }
    const tickets = (await this.tickets.findMany(
      reader,
      { _id: { $in: [...costOf.keys()].map((id) => new Types.ObjectId(id)) } },
      { select: TICKET_SELECT, session },
    )) as unknown as TransferTicket[];
    const changed = tickets.filter(
      (ticket) => costOf.get(String(ticket._id)) !== ticket.unitCost,
    );
    if (changed.length === 0) {
      return;
    }
    const at = new Date();
    await this.ledger.applyTicketEvents(
      session,
      { operator: null, crossStoreTenantId: tenantId },
      changed.map((ticket) => ({
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        type: TICKET_EVENT_TYPE.costAdjust,
        at,
        patch: { unitCost: costOf.get(String(ticket._id)) ?? ticket.unitCost },
        refType: "transfer",
        refId: submissionId,
      })),
    );
  }

  /** 點收關卡任務結束(核准):對審核者送側欄信號。 */
  onTaskEnded(context: FormEffectContext): void {
    this.publishBadgeAfterCommit(context);
  }

  // ---- 內部 ----

  private async holds(
    operator: OperatorContext,
    permission: string,
  ): Promise<boolean> {
    if (operator.actorId === null) {
      return false;
    }
    const resolution = await this.permissions.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    return holdsPermission(resolution, permission);
  }

  private async submissionOf(context: FormEffectContext) {
    const reader = await this.readerOf(context.tenantId);
    const submission = await this.submissions.findById(
      reader,
      context.submissionId,
      { session: context.session },
    );
    if (!submission) {
      throw new Error(`調貨單 ${String(context.submissionId)} 讀不到`);
    }
    return submission;
  }

  /** 還沒點收的列:每一列的本、方式、張數、金額、張的位置與鎖。 */
  private async lineProblemOf(
    reader: OperatorContext,
    lines: readonly TransferLineValue[],
    fromId: Types.ObjectId,
    own: { submissionId: Types.ObjectId },
  ): Promise<FormGuardResult> {
    const books = await this.booksOf(reader, lines);
    const games = await this.gamesOf(
      reader,
      [...books.values()].map((book) => book.gameId),
    );
    const ticketsOf = await this.ticketsOfBooks(
      reader,
      [...books.values()].map((book) => book._id),
    );
    const seen = new Set<string>();
    for (const line of lines) {
      const book = books.get(line.bookId);
      const game =
        book === undefined ? undefined : games.get(String(book.gameId));
      const bookTickets =
        book === undefined ? [] : (ticketsOf.get(String(book._id)) ?? []);
      const rowTickets = this.rowTicketsOf(line, bookTickets);
      const keys = rowTickets.map((ticket) => String(ticket._id));
      if (
        book === undefined ||
        game === undefined ||
        keys.some((key) => seen.has(key)) ||
        !isLineValid(line, book, game, bookTickets, rowTickets)
      ) {
        return block(
          TRANSFER_REASONS.lineInvalid,
          `Line ${line.rowId} does not match its book`,
        );
      }
      for (const key of keys) {
        seen.add(key);
      }
      const isAvailable = rowTickets.every(
        (ticket) =>
          ticket.orgId.equals(fromId) &&
          (isLockedBy(ticket, own.submissionId)
            ? true
            : ticket.lockedBy === null &&
              ticket.status === TICKET_STATUS.unsold &&
              !isInTransit(ticket)),
      );
      if (!isAvailable) {
        return block(
          TRANSFER_REASONS.ticketsUnavailable,
          `Tickets of line ${line.rowId} are not available in the from branch`,
        );
      }
    }
    if (await this.onOtherOpenTransfer(reader, lines, own.submissionId)) {
      return block(
        TRANSFER_REASONS.ticketsUnavailable,
        "Tickets are on another open transfer",
      );
    }
    return null;
  }

  /** 本 / 張在其他未結束的調貨單上(同一本整本對任何一列、選張對選張張號重疊)。 */
  private async onOtherOpenTransfer(
    reader: OperatorContext,
    lines: readonly TransferLineValue[],
    submissionId: Types.ObjectId,
  ): Promise<boolean> {
    const bookIds = [...new Set(lines.map((line) => line.bookId))];
    const others = await this.submissions.findMany(
      reader,
      {
        _id: { $ne: submissionId },
        moduleKey: TRANSFER_MODULE_KEY,
        formKey: TRANSFER_FORM_KEY,
        status: { $in: [...TRANSFER_OPEN_STATUSES] },
        "values.lines.book.id": { $in: bookIds },
      },
      { select: "values" },
    );
    if (others.length === 0) {
      return false;
    }
    const otherReceipts = await this.receipts.findMany(
      reader,
      { submissionId: { $in: others.map((other) => other._id) } },
      { select: "submissionId rowId tickets" },
    );
    const receivedOf = receivedByRow(
      otherReceipts,
      (row) => `${String(row.submissionId)}:${row.rowId}`,
    );
    // 別張單還沒到齊的列;部分點收的選張列只看還沒點收的張(已點收的已是收貨店的庫存)
    const otherLines = others.flatMap((other) =>
      transferLinesOf(other.values as Record<string, unknown>).flatMap(
        (line) => {
          const received = receivedOf.get(`${String(other._id)}:${line.rowId}`);
          if (isLineReceived(line, received)) {
            return [];
          }
          return [
            received === undefined ? line : remainingLineOf(line, received),
          ];
        },
      ),
    );
    return lines.some((line) =>
      otherLines.some((other) => {
        if (other.bookId !== line.bookId) {
          return false;
        }
        if (
          line.mode === TRANSFER_MODE.whole ||
          other.mode === TRANSFER_MODE.whole
        ) {
          return true;
        }
        const mine = new Set(line.ticketNos);
        return other.ticketNos.some((ticketNo) => mine.has(ticketNo));
      }),
    );
  }

  private async requisitionProblemOf(
    reader: OperatorContext,
    submission: LifecycleSubmission,
    requisitionNo: string | null,
    toId: Types.ObjectId,
  ): Promise<FormGuardResult> {
    if (requisitionNo === null) {
      return null;
    }
    const rows = await this.requisitionLines.findMany(
      reader,
      { tenantId: submission.tenantId, serialNo: requisitionNo },
      { select: "requisitionId orgId voidedAt referencedBy" },
    );
    const requisitionIds = new Set(
      rows.map((row) => String(row.requisitionId)),
    );
    const isUsable =
      requisitionIds.size === 1 &&
      rows.every(
        (row) =>
          row.orgId.equals(toId) &&
          row.voidedAt === null &&
          (row.referencedBy === null ||
            row.referencedBy.submissionId.equals(submission._id)),
      );
    return isUsable
      ? null
      : block(
          TRANSFER_REASONS.requisitionInvalid,
          "Requisition is not a pending requisition of the to branch",
        );
  }

  /** 還鎖著的張回到出貨店:在途的寫「調入」回庫存(反向事件),再解除鎖定。 */
  private async returnLockedToShipper(
    context: FormEffectContext,
  ): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const reader = await this.readerOf(tenantId);
    const lock = transferLockOf(context.submissionId);
    const locked = await this.lockedTicketsOf(
      reader,
      context.submissionId,
      context.session,
    );
    const inTransit = locked.filter((ticket) => isInTransit(ticket));
    if (inTransit.length > 0) {
      await this.ledger.applyTicketEvents(
        context.session,
        { operator: null, crossStoreTenantId: tenantId },
        inTransit.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          allowLockedBy: lock,
          type: TICKET_EVENT_TYPE.transferIn,
          patch: {
            location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
          },
          refType: "transfer",
          refId: context.submissionId,
          reasonKey: context.voidReason?.reasonKey ?? null,
          reasonNote: context.voidReason?.reasonNote ?? null,
        })),
      );
    }
    await this.ledger.unlockTicketsInTenant(
      context.session,
      tenantId,
      locked.map((ticket) => ticket._id),
      lock,
    );
  }

  /** 叫貨單 → 已調貨;這張單之前引用的其他叫貨單(退回後改了叫貨單)回到待購買。 */
  private async referenceRequisition(
    context: FormEffectContext,
    requisitionNo: string | null,
  ): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const requisitionId = await this.requisitionIdOf(tenantId, requisitionNo);
    await this.releaseRequisitions(context, requisitionId);
    if (requisitionId !== null) {
      await this.requisitions.markRequisitionReferenced(context.session, {
        tenantId,
        requisitionId,
        type: "transfer",
        submissionId: context.submissionId,
      });
    }
  }

  /** 叫貨單單號 → 叫貨單 id;沒填 / 找不到 → null。 */
  async requisitionIdOf(
    tenantId: Types.ObjectId | null,
    requisitionNo: string | null,
  ): Promise<Types.ObjectId | null> {
    if (requisitionNo === null) {
      return null;
    }
    const reader = await this.readerOf(tenantId);
    const row = await this.requisitionLines.findOne(
      reader,
      { tenantId, serialNo: requisitionNo },
      { select: "requisitionId" },
    );
    return row?.requisitionId ?? null;
  }

  /** 這張單引用的叫貨單(`keep` 以外)回到待購買。 */
  private async releaseRequisitions(
    context: FormEffectContext,
    keep: Types.ObjectId | null = null,
  ): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const reader = await this.readerOf(tenantId);
    const referenced = await this.requisitionLines.findMany(
      reader,
      { tenantId, "referencedBy.submissionId": context.submissionId },
      { select: "requisitionId", session: context.session },
    );
    const ids = new Map(
      referenced.map((row) => [String(row.requisitionId), row.requisitionId]),
    );
    for (const requisitionId of ids.values()) {
      if (keep?.equals(requisitionId) === true) {
        continue;
      }
      await this.requisitions.unmarkRequisitionReferenced(context.session, {
        tenantId,
        requisitionId,
      });
    }
  }

  /**
   * 側欄「調貨單」待點收:交易提交後讀這張單的任務,對現任與曾持有的審核者送 `badge:purchasing.transfer`
   * (第一關通過派給收貨店店長、任務結束;改派由流程引擎送的 `badge:apply-center` 讓前端整份重抓)。盡力而為。
   */
  private publishBadgeAfterCommit(context: FormEffectContext): void {
    const { tenantId, submissionId } = context;
    if (tenantId === null) {
      return;
    }
    afterCommit(async () => {
      try {
        const tasks = await this.tasks.findMany(tenantId, { submissionId });
        const reviewers = new Set(
          tasks.flatMap((task) => [
            String(task.assigneeId),
            ...task.previousAssigneeIds.map(String),
          ]),
        );
        if (reviewers.size > 0) {
          await this.realtime.publishBadge(tenantId, TRANSFER_MODULE_KEY, [
            ...reviewers,
          ]);
        }
      } catch (error) {
        this.logger.warn(
          `調貨單 ${String(submissionId)} 的側欄計數信號沒有送出(盡力而為):${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }
}
