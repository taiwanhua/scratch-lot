import { Injectable, Logger } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";
import {
  LAST_TICKET_NO_MAX,
  PURCHASE_FORM_KEY,
  PURCHASE_MODULE_KEY,
  PURCHASE_SETTLEMENT_SIDE,
  type PurchaseLineValue,
  TICKET_EVENT_TYPE,
  bookKeyOf,
  duplicateBookKeysOf,
  purchaseHeaderOf,
  purchaseLinesOf,
  purchasePayableOf,
} from "@repo/domain/project/lottery";
import { GAME_STATUS } from "@repo/domain/project/lottery-master-data";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/base/repositories";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { afterCommit } from "../../../database/transaction";
import { WorkflowTasksRepository } from "../../../database/workflow-tasks.repository";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import type {
  FormEffectContext,
  FormGuardResult,
  LifecycleSubmission,
} from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import {
  LotteryDealerContactsRepository,
  LotteryDealersRepository,
  LotteryRelationshipsRepository,
} from "../../database/lottery-dealers/lottery-dealers.repository";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryPurchaseReceiptsRepository } from "../../database/lottery-purchases/lottery-purchase-receipts.repository";
import { LotteryRequisitionLinesRepository } from "../../database/lottery-requisitions/lottery-requisition-lines.repository";
import { DealerPurchaseDates } from "../dealers/purchase-dates";
import { RequisitionReference } from "../requisition/requisition-reference";
import { SettlementService } from "../settlement/settlement.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import { PURCHASE_REASONS } from "./purchase-error";

/** 「有效」的進貨單:送出之後、還沒駁回 / 作廢(草稿不算;規格 8 共通「草稿」)。 */
export const PURCHASE_LIVE_STATUSES = [
  "reviewing",
  "returned",
  "withdrawn",
  "completed",
] as const;

/** 待點收(在途):已建立還沒點收完成的進貨單(草稿不算)。 */
export const PURCHASE_OPEN_STATUSES = [
  "reviewing",
  "returned",
  "withdrawn",
] as const;

/** 經銷商 → 關係人的關聯 type(`lottery_relationships`)。 */
const DEALER_CONTACT = "lottery_dealer_lottery_dealer_contact";

export function toObjectId(id: string | null): Types.ObjectId | null {
  return id !== null && Types.ObjectId.isValid(id)
    ? new Types.ObjectId(id)
    : null;
}

function block(code: string, message: string): FormGuardResult {
  return { code, message };
}

/** 遊戲的事實(明細比對與點收用)。 */
export interface PurchaseGameFacts {
  id: Types.ObjectId;
  gameCode: string;
  name: string;
  status: string;
  ticketsPerBook: number;
  bookPrice: number;
  unitPrice: number;
}

/**
 * 進貨單的規則(專案規格 8.2 掛接點表;正本 `docs/modules/project/purchasing.md`「進貨單」)。
 * `purchase-lifecycle.ts` 的守門與事後動作都委派到這裡(同一個交易、系統身分或按按鈕的人)。
 *
 * - 讀「其他進貨單」「既有的本」「叫貨單」「經銷商」以租戶邊界上下文(問的是整個租戶;反查)
 * - 寫入(收付、叫貨單引用、批購日、本的撤銷)在呼叫端的交易內
 */
@Injectable()
export class PurchaseRules {
  private readonly logger = new Logger(PurchaseRules.name);

  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly games: LotteryGamesRepository,
    private readonly books: LotteryBooksRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly receipts: LotteryPurchaseReceiptsRepository,
    private readonly requisitionLines: LotteryRequisitionLinesRepository,
    private readonly dealers: LotteryDealersRepository,
    private readonly contacts: LotteryDealerContactsRepository,
    private readonly relationships: LotteryRelationshipsRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly settlement: SettlementService,
    private readonly requisitions: RequisitionReference,
    private readonly purchaseDates: DealerPurchaseDates,
    private readonly ledger: TicketLedgerService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** 租戶的系統身分(反查)。 */
  readerOf(tenantId: Types.ObjectId | null): Promise<OperatorContext> {
    return tenantBoundaryContext(this.orgs, null, tenantId);
  }

  /** 明細用到的遊戲(遊戲是全租戶共用的主檔)。 */
  async gamesOf(
    reader: OperatorContext,
    lines: readonly PurchaseLineValue[],
  ): Promise<Map<string, PurchaseGameFacts>> {
    const ids = [...new Set(lines.map((line) => line.gameId))].flatMap((id) => {
      const objectId = toObjectId(id);
      return objectId === null ? [] : [objectId];
    });
    if (ids.length === 0) {
      return new Map();
    }
    const games = await this.games.findMany(
      reader,
      { _id: { $in: ids } },
      {
        select: "gameCode name status ticketsPerBook bookPrice unitPrice",
      },
    );
    return new Map(
      games.map((game) => [
        String(game._id),
        {
          id: game._id,
          gameCode: game.gameCode,
          name: game.name,
          status: game.status,
          ticketsPerBook: game.ticketsPerBook,
          bookPrice: game.bookPrice,
          unitPrice: game.unitPrice,
        },
      ]),
    );
  }

  /** 這張單已點收的列(rowId → 點收)。 */
  async receiptsOf(
    reader: OperatorContext,
    submissionId: Types.ObjectId,
    session?: ClientSession,
  ) {
    return this.receipts.findMany(
      reader,
      { submissionId },
      { select: "rowId bookId receivedAt receivedBy", session },
    );
  }

  // ---- 守門 ----

  /**
   * 送出前(規格 8.2):明細有列、格式與遊戲相符、遊戲販售中、本號不重複(這張單 / 其他有效進貨單 /
   * 既有的本)、已點收的列沒被改或刪、叫貨單有效、甲類營業中、受託人、扣款帳戶。
   */
  async beforeSubmit(
    submission: LifecycleSubmission,
    values: StoredValues,
  ): Promise<FormGuardResult> {
    const record = values as Record<string, unknown>;
    const lines = purchaseLinesOf(record);
    if (lines.length === 0) {
      return block(PURCHASE_REASONS.noLines, "Purchase has no lines");
    }
    const reader = await this.readerOf(submission.tenantId);
    const games = await this.gamesOf(reader, lines);
    const lineProblem = this.lineProblemOf(lines, games);
    if (lineProblem !== null) {
      return lineProblem;
    }
    const received = await this.receiptsOf(reader, submission._id);
    const changed = await this.receivedRowsChanged(
      reader,
      lines,
      received.map((receipt) => ({
        rowId: receipt.rowId,
        bookId: receipt.bookId,
      })),
    );
    if (changed) {
      return block(
        PURCHASE_REASONS.receivedRowChanged,
        "Received rows cannot be changed or removed",
      );
    }
    const codeOf = (gameId: string) => games.get(gameId)?.gameCode;
    if (duplicateBookKeysOf(lines, codeOf).length > 0) {
      return block(PURCHASE_REASONS.bookDuplicate, "Duplicate book numbers");
    }
    const keys = lines.flatMap((line) => {
      const code = codeOf(line.gameId);
      return code === undefined || line.bookNo === null
        ? []
        : [bookKeyOf(code, line.bookNo)];
    });
    if (
      await this.isBookTaken(
        reader,
        submission._id,
        keys,
        games,
        received.map((receipt) => receipt.bookId),
      )
    ) {
      return block(
        PURCHASE_REASONS.bookDuplicate,
        "Book numbers are used by another purchase or an existing book",
      );
    }
    return this.headerProblemOf(submission, record);
  }

  /** 核准前:還有沒點收的列 → 擋下。 */
  async beforeApprove(
    submission: LifecycleSubmission,
  ): Promise<FormGuardResult> {
    const reader = await this.readerOf(submission.tenantId);
    const lines = purchaseLinesOf(submission.values);
    const receipts = await this.receiptsOf(reader, submission._id);
    const received = new Set(receipts.map((receipt) => receipt.rowId));
    return lines.every((line) => received.has(line.rowId))
      ? null
      : block(PURCHASE_REASONS.unreceivedRows, "Some rows are not received");
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
      : block(PURCHASE_REASONS.hasReceipts, "Purchase has received books");
  }

  /**
   * 作廢前:任何一張已售、已調出或已拆本 → 擋下。點收之後除了「進貨」以外有任何張數事件(拆本、售出、
   * 調出、移櫃、跳號、報廢……)或被單據鎖定(調貨中),就不是原封不動的進貨。
   */
  async beforeVoid(submission: LifecycleSubmission): Promise<FormGuardResult> {
    const reader = await this.readerOf(submission.tenantId);
    const receipts = await this.receiptsOf(reader, submission._id);
    const bookIds = receipts.map((receipt) => receipt.bookId);
    if (bookIds.length === 0) {
      return null;
    }
    const moved = await this.events.findOne(
      reader,
      {
        bookId: { $in: bookIds },
        type: { $ne: TICKET_EVENT_TYPE.purchase },
      },
      { select: "_id" },
    );
    const locked =
      moved === null
        ? await this.tickets.findOne(
            reader,
            { bookId: { $in: bookIds }, lockedBy: { $ne: null } },
            { select: "_id" },
          )
        : null;
    return moved === null && locked === null
      ? null
      : block(
          PURCHASE_REASONS.booksInUse,
          "Some tickets are sold, transferred or opened",
        );
  }

  // ---- 事後動作 ----

  /**
   * 送出後:第一次送出自動記「批貨支出」= 扣款金額(0 不記:收付金額一律正數,應付 0 = 已結清);
   * 重新送出不自動調整(結算區塊顯示待付 / 待退)。甲類批購日重算;叫貨單 → 已進貨(換了叫貨單的,舊的回到待購買)。
   */
  async onSubmitted(context: FormEffectContext): Promise<void> {
    const submission = await this.submissionOf(context);
    const values = submission.values as Record<string, unknown>;
    const header = purchaseHeaderOf(values);
    if (context.revision === 1) {
      const accountId = toObjectId(header.accountId);
      if (accountId !== null) {
        await this.settlement.recordAutomatic(context.session, {
          operator: context.operator,
          moduleKey: PURCHASE_MODULE_KEY,
          submission: {
            _id: submission._id,
            orgId: submission.orgId,
            tenantId: submission.tenantId,
            moduleKey: submission.moduleKey,
            status: submission.status,
            revision: submission.revision,
            values: submission.values,
            submittedAt: submission.submittedAt ?? null,
            serialNo: submission.serialNo ?? null,
          },
          side: PURCHASE_SETTLEMENT_SIDE,
          button: "out",
          accountId,
          amount: purchasePayableOf(values),
          note:
            header.purchaseDate === null
              ? null
              : `批購日 ${header.purchaseDate.toISOString().slice(0, 10)}`,
        });
      }
    }
    await this.recomputeDealer(context, header.dealerId);
    await this.referenceRequisition(context, header.requisitionNo);
    this.publishBadgeAfterCommit(context);
  }

  /** 駁回後:甲類日期重算;叫貨單回到待購買(駁回的單不是有效的進貨單)。 */
  async onRejected(context: FormEffectContext): Promise<void> {
    const submission = await this.submissionOf(context);
    const header = purchaseHeaderOf(submission.values);
    await this.recomputeDealer(context, header.dealerId);
    await this.releaseRequisitions(context);
    this.publishBadgeAfterCommit(context);
  }

  /**
   * 作廢後:甲類日期重算;點收過的本 → 已撤銷,每張寫「進貨作廢」事件;叫貨單回到待購買。
   */
  async onVoided(context: FormEffectContext): Promise<void> {
    const submission = await this.submissionOf(context);
    const header = purchaseHeaderOf(submission.values);
    await this.recomputeDealer(context, header.dealerId);
    await this.revokeBooks(context);
    await this.releaseRequisitions(context);
    this.publishBadgeAfterCommit(context);
  }

  /** 點收關卡任務結束(核准、退回、撤回):對那個任務的審核者送側欄信號。 */
  onTaskEnded(context: FormEffectContext): void {
    this.publishBadgeAfterCommit(context);
  }

  // ---- 內部 ----

  private async submissionOf(context: FormEffectContext) {
    const submission = await this.submissions.findById(
      context.operator,
      context.submissionId,
      { session: context.session },
    );
    if (!submission) {
      throw new Error(`進貨單 ${String(context.submissionId)} 讀不到`);
    }
    return submission;
  }

  private lineProblemOf(
    lines: readonly PurchaseLineValue[],
    games: ReadonlyMap<string, PurchaseGameFacts>,
  ): FormGuardResult {
    for (const line of lines) {
      const game = games.get(line.gameId);
      if (game?.status !== GAME_STATUS.onSale) {
        return block(
          PURCHASE_REASONS.gameDiscontinued,
          "Purchase has discontinued games",
        );
      }
      const isValid =
        line.bookNo !== null &&
        Number.isInteger(line.lastTicketNo) &&
        line.lastTicketNo >= game.ticketsPerBook &&
        line.lastTicketNo <= LAST_TICKET_NO_MAX &&
        line.tickets === game.ticketsPerBook &&
        line.bookPrice === game.bookPrice &&
        Number.isInteger(line.rate) &&
        line.rate >= 0 &&
        line.rate <= 100;
      if (!isValid) {
        return block(
          PURCHASE_REASONS.lineInvalid,
          `Line ${line.rowId} does not match its game`,
        );
      }
    }
    return null;
  }

  /** 已點收的列:還在、而且遊戲 / 本號 / 最後張號 / 批購金額率 / 成本和點收時建的本相同。 */
  private async receivedRowsChanged(
    reader: OperatorContext,
    lines: readonly PurchaseLineValue[],
    received: readonly { rowId: string; bookId: Types.ObjectId }[],
  ): Promise<boolean> {
    if (received.length === 0) {
      return false;
    }
    const books = await this.books.findMany(
      reader,
      { _id: { $in: received.map((receipt) => receipt.bookId) } },
      { select: "gameId bookNo lastTicketNo rate cost" },
    );
    const bookOf = new Map(books.map((book) => [String(book._id), book]));
    const lineOf = new Map(lines.map((line) => [line.rowId, line]));
    return received.some((receipt) => {
      const line = lineOf.get(receipt.rowId);
      const book = bookOf.get(String(receipt.bookId));
      return (
        line === undefined ||
        book === undefined ||
        String(book.gameId) !== line.gameId ||
        book.bookNo !== line.bookNo ||
        Number(book.lastTicketNo) !== line.lastTicketNo ||
        book.rate !== Math.round(line.rate) ||
        book.cost !== Math.round(line.amount)
      );
    });
  }

  /** 本號已在其他有效進貨單上,或已有這本(這張單自己點收建的本不算)。 */
  private async isBookTaken(
    reader: OperatorContext,
    submissionId: Types.ObjectId,
    keys: readonly string[],
    games: ReadonlyMap<string, PurchaseGameFacts>,
    ownBookIds: readonly Types.ObjectId[],
  ): Promise<boolean> {
    if (keys.length === 0) {
      return false;
    }
    const existing = await this.books.findOne(
      reader,
      {
        bookKey: { $in: [...keys] },
        _id: { $nin: [...ownBookIds] },
      },
      { select: "_id" },
    );
    if (existing !== null) {
      return true;
    }
    const wanted = new Set(keys);
    const bookNos = keys.map((key) => key.slice(key.indexOf("-") + 1));
    const others = await this.submissions.findMany(
      reader,
      {
        _id: { $ne: submissionId },
        moduleKey: PURCHASE_MODULE_KEY,
        formKey: PURCHASE_FORM_KEY,
        status: { $in: [...PURCHASE_LIVE_STATUSES] },
        "values.lines.book_no": { $in: bookNos },
      },
      { select: "values" },
    );
    if (others.length === 0) {
      return false;
    }
    const otherLines = others.flatMap((other) =>
      purchaseLinesOf(other.values as Record<string, unknown>),
    );
    const otherGames = await this.gamesOf(reader, otherLines);
    for (const [id, game] of games) {
      otherGames.set(id, game);
    }
    return otherLines.some((line) => {
      const code = otherGames.get(line.gameId)?.gameCode;
      return (
        code !== undefined &&
        line.bookNo !== null &&
        wanted.has(bookKeyOf(code, line.bookNo))
      );
    });
  }

  private async headerProblemOf(
    submission: LifecycleSubmission,
    values: Record<string, unknown>,
  ): Promise<FormGuardResult> {
    const header = purchaseHeaderOf(values);
    const tenantId = submission.tenantId;
    const reader = await this.readerOf(tenantId);
    const branchId = toObjectId(header.branchId);
    if (branchId === null) {
      return block(PURCHASE_REASONS.accountInvalid, "Branch is required");
    }
    if (header.requisitionNo !== null) {
      const rows = await this.requisitionLines.findMany(
        reader,
        { tenantId, serialNo: header.requisitionNo },
        { select: "requisitionId orgId voidedAt referencedBy" },
      );
      const requisitionIds = new Set(
        rows.map((row) => String(row.requisitionId)),
      );
      const isUsable =
        requisitionIds.size === 1 &&
        rows.every(
          (row) =>
            row.orgId.equals(branchId) &&
            row.voidedAt === null &&
            (row.referencedBy === null ||
              row.referencedBy.submissionId.equals(submission._id)),
        );
      if (!isUsable) {
        return block(
          PURCHASE_REASONS.requisitionInvalid,
          "Requisition is not a pending requisition of this branch",
        );
      }
    }
    const dealerId = toObjectId(header.dealerId);
    const dealer =
      dealerId === null
        ? null
        : await this.dealers.findOne(
            reader,
            { _id: dealerId, tenantId },
            { select: "type status" },
          );
    if (dealer?.type !== "a" || dealer.status !== "active") {
      return block(
        PURCHASE_REASONS.dealerInvalid,
        "Dealer must be an active class A dealer",
      );
    }
    if (!header.selfPurchase) {
      const trusteeId = toObjectId(header.trusteeId);
      const isTrustee =
        trusteeId !== null &&
        dealerId !== null &&
        (await this.isActiveTrustee(reader, tenantId, dealerId, trusteeId));
      if (!isTrustee) {
        return block(
          PURCHASE_REASONS.trusteeInvalid,
          "Trustee must be an active trustee of the dealer",
        );
      }
    }
    const accountId = toObjectId(header.accountId);
    const isUsable =
      accountId !== null &&
      (await this.settlement.isAccountUsable(tenantId, accountId, branchId));
    return isUsable
      ? null
      : block(
          PURCHASE_REASONS.accountInvalid,
          "Account must be active and used by the branch",
        );
  }

  private async isActiveTrustee(
    reader: OperatorContext,
    tenantId: Types.ObjectId | null,
    dealerId: Types.ObjectId,
    trusteeId: Types.ObjectId,
  ): Promise<boolean> {
    const contact = await this.contacts.findOne(
      reader,
      { _id: trusteeId, tenantId },
      { select: "status roles" },
    );
    if (contact?.status !== "active" || !contact.roles.includes("trustee")) {
      return false;
    }
    const link = await this.relationships.findOne(
      reader,
      {
        tenantId,
        type: DEALER_CONTACT,
        firstId: dealerId,
        secondId: trusteeId,
        "meta.role": "trustee",
      },
      { select: "_id" },
    );
    return link !== null;
  }

  private async recomputeDealer(
    context: FormEffectContext,
    dealerIdText: string | null,
  ): Promise<void> {
    const dealerId = toObjectId(dealerIdText);
    if (dealerId !== null) {
      await this.purchaseDates.recomputeDealerPurchaseDates(
        context.session,
        context.tenantId,
        dealerId,
      );
    }
  }

  /** 叫貨單 → 已進貨;這張單之前引用的其他叫貨單(退回後改了叫貨單)回到待購買。 */
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
        type: "purchase",
        submissionId: context.submissionId,
      });
    }
  }

  /** 叫貨單單號 → 叫貨單 id(叫貨明細副本的單號快照);沒填 / 找不到 → null。 */
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

  /** 點收過的本 → 已撤銷;每張寫「進貨作廢」事件(狀態與位置不變,報表與時間軸看得到)。 */
  private async revokeBooks(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const reader = await this.readerOf(tenantId);
    const receipts = await this.receiptsOf(
      reader,
      context.submissionId,
      context.session,
    );
    const bookIds = receipts.map((receipt) => receipt.bookId);
    if (bookIds.length === 0) {
      return;
    }
    const tickets = await this.tickets.findMany(
      reader,
      { bookId: { $in: bookIds } },
      { select: "_id version status", session: context.session },
    );
    await this.ledger.applyTicketEvents(
      context.session,
      { operator: null, crossStoreTenantId: tenantId },
      tickets.map((ticket) => ({
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        type: TICKET_EVENT_TYPE.purchaseVoid,
        patch: {},
        refType: "purchase",
        refId: context.submissionId,
        reasonKey: context.voidReason?.reasonKey ?? null,
        reasonNote: context.voidReason?.reasonNote ?? null,
      })),
    );
    await this.books.updateMany(
      reader,
      { _id: { $in: bookIds } },
      { $set: { status: "revoked" } },
      { session: context.session },
    );
  }

  /**
   * 側欄「進貨單」待點收:交易提交後讀這張單的任務,對現任與曾持有的審核者送 `badge:purchasing.purchase`
   * (送出派給 A、任務結束;改派由流程引擎送的 `badge:apply-center` 讓前端整份重抓)。盡力而為。
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
          await this.realtime.publishBadge(tenantId, PURCHASE_MODULE_KEY, [
            ...reviewers,
          ]);
        }
      } catch (error) {
        this.logger.warn(
          `進貨單 ${String(submissionId)} 的側欄計數信號沒有送出(盡力而為):${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }
}
