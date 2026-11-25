import { Injectable, Logger } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";
import {
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  WHOLESALE_MODULE_KEY,
  WHOLESALE_PAYMENT_MODE,
  WHOLESALE_REF_TYPE,
  WHOLESALE_SETTLEMENT_SIDE,
  type WholesaleHeader,
  type WholesaleLineValue,
  wholesaleAmountOf,
  wholesaleHeaderOf,
  wholesaleLinesOf,
  wholesaleReceivedProblemOf,
  wholesaleTotalOf,
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
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import type {
  FormEffectContext,
  FormGuardResult,
  LifecycleSubmission,
} from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { LotteryWholesaleCustomersRepository } from "../../database/lottery-dealers/lottery-dealers.repository";
import {
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { WholesaleCustomerDocuments } from "../dealers/wholesale-customer-documents";
import { SettlementLedger } from "../settlement/settlement-ledger";
import { settlementDocumentOf } from "../settlement/settlement-registry";
import { SettlementService } from "../settlement/settlement.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import {
  WholesaleLedger,
  wholesaleLockOf,
} from "../tickets/wholesale-ledger.service";
import {
  type WholesaleBookProblem,
  WholesaleBooks,
  type WholesaleTicket,
  objectIdsOf,
  serialOfProblem,
  toObjectId,
  wholesaleBookProblemOf,
} from "./wholesale-books.service";
import {
  type UnavailableBook,
  WHOLESALE_REASONS,
  bookUnavailableError,
} from "./wholesale-error";

const TICKET_SELECT = "bookId orgId ticketNo status location lockedBy";

function block(code: string, message: string): FormGuardResult {
  return { code, message };
}

/**
 * 批售單的規則(專案規格 21.4 掛接點表;正本 `docs/modules/project/purchasing.md`「批售單」)。
 * `wholesale-lifecycle.ts` 的守門與事後動作都委派到這裡。
 *
 * - 讀本 / 張 / 事件以租戶邊界上下文(單據可能是總部建的,系統身分只看得到單據的組織)
 * - 鎖定 / 解除用帳本的系統鎖(`lockTicketsInTenant`),出貨 / 取消用 `WholesaleLedger`,都在呼叫端的交易內
 * - 核准前的檢查只認流程的最後一關(租戶在前面加關卡不影響)
 */
@Injectable()
export class WholesaleRules {
  private readonly logger = new Logger(WholesaleRules.name);

  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly instances: WorkflowInstancesRepository,
    private readonly customers: LotteryWholesaleCustomersRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly books: WholesaleBooks,
    private readonly ledger: TicketLedgerService,
    private readonly wholesale: WholesaleLedger,
    private readonly customerDocuments: WholesaleCustomerDocuments,
    private readonly settlement: SettlementService,
    private readonly settlementLedger: SettlementLedger,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** 租戶的系統身分(反查)。 */
  readerOf(tenantId: Types.ObjectId | null): Promise<OperatorContext> {
    return tenantBoundaryContext(this.orgs, null, tenantId);
  }

  // ---- 守門 ----

  /** 送出前(規格 21.4 `beforeSubmit`,依表的順序)。 */
  async beforeSubmit(
    operator: OperatorContext,
    submission: LifecycleSubmission,
    values: StoredValues,
  ): Promise<FormGuardResult> {
    const record = values as Record<string, unknown>;
    const header = wholesaleHeaderOf(record);
    const fromId = toObjectId(header.fromBranchId);
    if (fromId === null || !isOrgVisible(operator, fromId)) {
      return block(
        WHOLESALE_REASONS.branchInvalid,
        "From branch must be visible",
      );
    }
    const customerId = toObjectId(header.customerId);
    const customer =
      customerId === null
        ? null
        : await this.customers.findOne(
            operator,
            { _id: customerId, status: "active" },
            { select: "_id" },
          );
    if (customer === null) {
      return block(
        WHOLESALE_REASONS.customerInvalid,
        "Customer must be active and visible",
      );
    }
    const lines = wholesaleLinesOf(record);
    if (lines.length === 0) {
      return block(WHOLESALE_REASONS.noLines, "Wholesale has no lines");
    }
    const reader = await this.readerOf(submission.tenantId);
    const lineProblem = await this.lineProblemOf(reader, lines, fromId);
    if (lineProblem !== null) {
      return lineProblem;
    }
    if (header.paymentMode !== WHOLESALE_PAYMENT_MODE.autoBank) {
      return null;
    }
    const accountProblem = await this.accountProblemOf(
      submission.tenantId,
      header,
      operator,
    );
    if (accountProblem !== null) {
      return accountProblem;
    }
    return (await this.settlementLedger.isCleared(operator, {
      ...submission,
      submittedAt: null,
    }))
      ? null
      : block(
          WHOLESALE_REASONS.modeHasReceipts,
          "Receipts are recorded; keep collect_first or reverse them first",
        );
  }

  /**
   * 核准前(最後一關):這張單的張仍是未售、在出貨分店庫存、被這張單鎖住;從帳戶入帳 = 帳戶仍可用;
   * 收到錢再核准 = 已收淨額等於批售金額。前面的關卡不檢查。
   */
  async beforeApprove(
    submission: LifecycleSubmission,
    operator: OperatorContext,
    stepKey: string | null,
  ): Promise<FormGuardResult> {
    const reader = await this.readerOf(submission.tenantId);
    const lastStep = await this.lastStepOf(reader, submission._id);
    if (stepKey === null || stepKey !== lastStep) {
      return null;
    }
    const header = wholesaleHeaderOf(submission.values);
    const lines = wholesaleLinesOf(submission.values);
    if (!(await this.isStillLocked(reader, submission._id, header, lines))) {
      return block(
        WHOLESALE_REASONS.bookUnavailable,
        "Books are no longer locked by this wholesale",
      );
    }
    if (header.paymentMode === WHOLESALE_PAYMENT_MODE.autoBank) {
      // 送出時已檢查送出的人看得到;核准的人不一定看得到這個帳戶
      return this.accountProblemOf(submission.tenantId, header);
    }
    const registration = settlementDocumentOf(WHOLESALE_MODULE_KEY);
    const [snapshot] =
      registration === undefined
        ? []
        : await this.settlementLedger.snapshotsOf(operator, registration, [
            { ...submission, submittedAt: null },
          ]);
    const problem = wholesaleReceivedProblemOf(
      wholesaleTotalOf(lines),
      snapshot?.state.sides[WHOLESALE_SETTLEMENT_SIDE] ?? { out: 0, in: 0 },
    );
    if (problem === null) {
      return null;
    }
    return problem.kind === "unreceived"
      ? block(
          WHOLESALE_REASONS.unreceived,
          `還差 ${String(problem.amount)} 元沒收`,
        )
      : block(
          WHOLESALE_REASONS.overreceived,
          `多收 ${String(problem.amount)} 元,請先記退款`,
        );
  }

  /** 作廢前(保險):批售出去的張都還是已批售,最後一筆事件是這張單的「批售」。 */
  async beforeVoid(submission: LifecycleSubmission): Promise<FormGuardResult> {
    const reader = await this.readerOf(submission.tenantId);
    const shipped = await this.events.findMany(
      reader,
      {
        refType: WHOLESALE_REF_TYPE,
        refId: submission._id,
        type: TICKET_EVENT_TYPE.wholesale,
      },
      { select: "ticketId" },
    );
    const ticketIds = shipped.map((event) => event.ticketId);
    if (ticketIds.length === 0) {
      return null;
    }
    const [tickets, latest] = await Promise.all([
      this.tickets.count(reader, {
        _id: { $in: ticketIds },
        status: TICKET_STATUS.wholesaled,
      }),
      this.events.aggregate(reader, [
        { $match: { ticketId: { $in: ticketIds } } },
        { $sort: { at: -1, _id: -1 } },
        {
          $group: {
            _id: "$ticketId",
            type: { $first: "$type" },
            refId: { $first: "$refId" },
          },
        },
      ]),
    ]);
    const isOurs = (row: Record<string, unknown>): boolean =>
      row.type === TICKET_EVENT_TYPE.wholesale &&
      String(row.refId) === String(submission._id);
    return tickets === ticketIds.length && latest.every((row) => isOurs(row))
      ? null
      : block(
          WHOLESALE_REASONS.booksInUse,
          "Wholesaled tickets have later events",
        );
  }

  // ---- 事後動作 ----

  /**
   * 送出後:這張單每一本的全部張(跳號以外)鎖定(批售中);重新送出時不再單上的解鎖。
   * 批售客戶的守門文件在同一個交易裡碰一下(`serialize`):和「刪除客戶」互相衝突,重跑的一方看得到對方
   * (刪除看得到引用 / 送出看到客戶已刪除),不會留下指到已刪除客戶的單。
   */
  async onSubmitted(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const submission = await this.submissionOf(context);
    const reader = await this.readerOf(tenantId);
    const customerId = toObjectId(
      wholesaleHeaderOf(submission.values).customerId,
    );
    const customer =
      customerId === null
        ? null
        : await this.customers.findById(reader, customerId, {
            select: "orgId",
            session: context.session,
          });
    if (customer !== null) {
      await this.customerDocuments.serialize(reader, customer, context.session);
    }
    const lock = wholesaleLockOf(context.submissionId);
    const ticketsOf = await this.books.ticketsOf(
      reader,
      objectIdsOf(
        wholesaleLinesOf(submission.values).map((line) => line.bookId),
      ),
      context.session,
    );
    const wanted = new Map(
      [...ticketsOf.values()]
        .flat()
        .filter((ticket) => ticket.status !== TICKET_STATUS.skipped)
        .map((ticket) => [String(ticket._id), ticket._id] as const),
    );
    const locked = await this.lockedTicketsOf(
      reader,
      context.submissionId,
      context.session,
    );
    const lockedIds = new Set(locked.map((ticket) => String(ticket._id)));
    await this.ledger.unlockTicketsInTenant(
      context.session,
      tenantId,
      locked
        .filter((ticket) => !wanted.has(String(ticket._id)))
        .map((ticket) => ticket._id),
      lock,
    );
    await this.ledger.lockTicketsInTenant(
      context.session,
      tenantId,
      [...wanted].flatMap(([key, id]) => (lockedIds.has(key) ? [] : [id])),
      lock,
    );
    this.publishBadgeAfterCommit(context);
  }

  /** 退回 / 撤回 / 駁回後:解除鎖定;結算紀錄保留。 */
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
    await this.ledger.unlockTicketsInTenant(
      context.session,
      tenantId,
      locked.map((ticket) => ticket._id),
      wholesaleLockOf(context.submissionId),
    );
    this.publishBadgeAfterCommit(context);
  }

  /**
   * 流程結束(核准 = 出貨 = 完成):每張寫「批售」事件、狀態改已批售、解鎖(事件的「誰」= 做決定的人);
   * 從帳戶入帳同一個交易自動記一筆「批售收入」= 批售金額。
   */
  async onCompleted(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const submission = await this.submissionOf(context);
    const values = submission.values as Record<string, unknown>;
    const header = wholesaleHeaderOf(values);
    const lines = wholesaleLinesOf(values);
    const reader = await this.readerOf(tenantId);
    await this.wholesale.ship(
      {
        session: context.session,
        reader,
        tenantId,
        submissionId: context.submissionId,
        actorId: context.decidedBy?.id ?? context.actorId,
      },
      lines.flatMap((line) => {
        const bookId = toObjectId(line.bookId);
        return bookId === null
          ? []
          : [{ bookId, amount: line.amount, tickets: line.tickets }];
      }),
    );
    const accountId = toObjectId(header.accountId);
    if (header.paymentMode === WHOLESALE_PAYMENT_MODE.autoBank) {
      if (accountId === null) {
        throw new Error(`批售單 ${String(context.submissionId)} 沒有入帳帳戶`);
      }
      await this.settlement.recordAutomatic(context.session, {
        operator: context.operator,
        moduleKey: WHOLESALE_MODULE_KEY,
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
        side: WHOLESALE_SETTLEMENT_SIDE,
        button: "in",
        accountId,
        amount: wholesaleTotalOf(lines),
      });
    }
    this.publishBadgeAfterCommit(context);
  }

  /** 作廢後:每張寫「取消批售」事件,回到出貨分店庫存的未售(帶作廢原因;單張成本不變、還是未拆)。 */
  async onVoided(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const submission = await this.submissionOf(context);
    await this.wholesale.cancel(
      {
        session: context.session,
        reader: await this.readerOf(tenantId),
        tenantId,
        submissionId: context.submissionId,
        actorId: submission.voidedBy ?? context.actorId,
      },
      {
        reasonKey: context.voidReason?.reasonKey ?? null,
        reasonNote: context.voidReason?.reasonNote ?? null,
      },
    );
    this.publishBadgeAfterCommit(context);
  }

  // ---- 內部 ----

  private async submissionOf(context: FormEffectContext) {
    const reader = await this.readerOf(context.tenantId);
    const submission = await this.submissions.findById(
      reader,
      context.submissionId,
      { session: context.session },
    );
    if (!submission) {
      throw new Error(`批售單 ${String(context.submissionId)} 讀不到`);
    }
    return submission;
  }

  private lockedTicketsOf(
    reader: OperatorContext,
    submissionId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<WholesaleTicket[]> {
    const lock = wholesaleLockOf(submissionId);
    return this.tickets.findMany(
      reader,
      { "lockedBy.refType": lock.refType, "lockedBy.refId": lock.refId },
      { select: TICKET_SELECT, session },
    );
  }

  /** 這張單目前的流程實例的最後一關。 */
  private async lastStepOf(
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

  /** 每一本的張(跳號以外)都還是未售、在出貨分店庫存、被這張單鎖住,而且沒有鎖到單上沒有的本。 */
  private async isStillLocked(
    reader: OperatorContext,
    submissionId: Types.ObjectId,
    header: WholesaleHeader,
    lines: readonly WholesaleLineValue[],
  ): Promise<boolean> {
    const bookIds = objectIdsOf(lines.map((line) => line.bookId));
    const [ticketsOf, locked] = await Promise.all([
      this.books.ticketsOf(reader, bookIds),
      this.lockedTicketsOf(reader, submissionId),
    ]);
    const usable = [...ticketsOf.values()]
      .flat()
      .filter((ticket) => ticket.status !== TICKET_STATUS.skipped);
    return (
      ticketsOf.size === bookIds.length &&
      usable.length === locked.length &&
      usable.every(
        (ticket) =>
          ticket.status === TICKET_STATUS.unsold &&
          ticket.location.kind === TICKET_LOCATION_KIND.stock &&
          String(ticket.orgId) === header.fromBranchId &&
          ticket.lockedBy?.refType === WHOLESALE_REF_TYPE &&
          ticket.lockedBy.refId.equals(submissionId),
      )
    );
  }

  /** 入帳帳戶使用中、使用組織包含出貨分店;給了 `viewer` 另要求他看得到。 */
  private async accountProblemOf(
    tenantId: Types.ObjectId | null,
    header: WholesaleHeader,
    viewer?: OperatorContext,
  ): Promise<FormGuardResult> {
    const accountId = toObjectId(header.accountId);
    const branchId = toObjectId(header.fromBranchId);
    const isUsable =
      accountId !== null &&
      branchId !== null &&
      (await this.settlement.isAccountUsable(
        tenantId,
        accountId,
        branchId,
        viewer,
      ));
    return isUsable
      ? null
      : block(
          WHOLESALE_REASONS.accountInvalid,
          "Account must be active and used by the branch",
        );
  }

  /**
   * 每一列:本正常、遊戲相同、張數 / 整本金額和遊戲相符、批購金額率 0–100 的整數、批售金額 = 公式、同一本不重複
   * (`WHOLESALE_LINE_INVALID`);再看每本能不能批售(`WHOLESALE_BOOK_UNAVAILABLE`,拋錯帶哪幾本與原因)。
   */
  private async lineProblemOf(
    reader: OperatorContext,
    lines: readonly WholesaleLineValue[],
    fromId: Types.ObjectId,
  ): Promise<FormGuardResult> {
    const bookIds = objectIdsOf(lines.map((line) => line.bookId));
    const books = await this.books.booksOf(reader, bookIds);
    const games = await this.books.gamesOf(
      reader,
      objectIdsOf([...books.values()].map((book) => String(book.gameId))),
    );
    const invalid = lines.find((line) => {
      const book = books.get(line.bookId);
      const game =
        book === undefined ? undefined : games.get(String(book.gameId));
      return (
        book?.status !== "normal" ||
        game === undefined ||
        line.gameId !== String(book.gameId) ||
        line.tickets !== game.ticketsPerBook ||
        line.bookPrice !== game.bookPrice ||
        !Number.isInteger(line.rate) ||
        line.rate < 0 ||
        line.rate > 100 ||
        line.amount !== wholesaleAmountOf(line.bookPrice, line.rate)
      );
    });
    if (
      invalid !== undefined ||
      new Set(lines.map((line) => line.bookId)).size !== lines.length
    ) {
      return block(
        WHOLESALE_REASONS.lineInvalid,
        invalid === undefined
          ? "The same book appears twice"
          : `Line ${invalid.rowId} does not match its book`,
      );
    }
    const ticketsOf = await this.books.ticketsOf(reader, bookIds);
    const problems = lines.flatMap((line) => {
      const book = books.get(line.bookId);
      const problem =
        book === undefined
          ? null
          : wholesaleBookProblemOf(
              book,
              ticketsOf.get(line.bookId) ?? [],
              fromId,
            );
      return book === undefined || problem === null
        ? []
        : [{ line, book, problem }];
    });
    if (problems.length === 0) {
      return null;
    }
    const serials = await this.books.serialsOf(
      reader,
      problems.map((item): WholesaleBookProblem => item.problem),
    );
    throw bookUnavailableError(
      problems.map(({ line, book, problem }): UnavailableBook => ({
        rowId: line.rowId,
        bookId: line.bookId,
        gameCode: book.gameCode,
        bookNo: book.bookNo,
        problem: problem.kind,
        lockedSerialNo: serialOfProblem(problem, serials),
      })),
    );
  }

  /**
   * 側欄「批售單」:交易提交後讀這張單的任務,對現任與曾持有的審核者送 `badge:purchasing.wholesale`
   * (同調貨單;改派由流程引擎送的 `badge:apply-center` 讓前端整份重抓)。盡力而為。
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
          await this.realtime.publishBadge(tenantId, WHOLESALE_MODULE_KEY, [
            ...reviewers,
          ]);
        }
      } catch (error) {
        this.logger.warn(
          `批售單 ${String(submissionId)} 的側欄計數信號沒有送出(盡力而為):${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }
}
