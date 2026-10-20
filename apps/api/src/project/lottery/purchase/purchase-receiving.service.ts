import { Injectable } from "@nestjs/common";
import type { ClientSession } from "mongoose";

import {
  PURCHASE_FIELD_KEYS,
  PURCHASE_FORM_KEY,
  PURCHASE_MODULE_KEY,
  type PurchaseLineValue,
  displayBookNo,
  groupPurchaseLines,
  matchReceiveScan,
  parseTicketInput,
  purchaseHeaderOf,
  purchaseLinesOf,
} from "@repo/domain/project/lottery";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { TransactionService } from "../../../database/transaction";
import { WorkflowTasksRepository } from "../../../database/workflow-tasks.repository";
import { NotificationService } from "../../../notifications/notification.service";
import { LotteryPurchaseReceiptsRepository } from "../../database/lottery-purchases/lottery-purchase-receipts.repository";
import { LotteryRequisitionLinesRepository } from "../../database/lottery-requisitions/lottery-requisition-lines.repository";
import { LOTTERY_PURCHASE_WRONG_STORE } from "../../notifications";
import { tenantOfOperator } from "../master-data-tenant";
import { LotteryBooksService } from "../tickets/books.service";
import type {
  LotteryPurchaseReceivingGroupModel,
  LotteryPurchaseReceivingModel,
  ReceiveLotteryPurchaseBookPayload,
} from "./models/purchase.model";
import {
  PURCHASE_REASONS,
  forbiddenError,
  notFoundError,
  validationError,
} from "./purchase-error";
import {
  PURCHASE_OPEN_STATUSES,
  type PurchaseGameFacts,
  PurchaseRules,
  toObjectId,
} from "./purchase-rules.service";

type SubmissionDoc = NonNullable<
  Awaited<ReturnType<FormSubmissionsRepository["findOne"]>>
>;

function labelOf(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string"
    ? value.label
    : "";
}

/** 刷到別家店的進貨單上的本(送錯分店)。 */
interface WrongStoreHit {
  owner: SubmissionDoc;
  line: PurchaseLineValue;
  game: PurchaseGameFacts | undefined;
}

/**
 * 進貨點收(專案規格 8.2「點收一本」「錯誤情境」、8.3;正本 `docs/modules/project/purchasing.md`「進貨單」):
 *
 * - `receivingOf`:檢視頁的點收區塊(依遊戲分組、「叫貨 N,已刷 M」、每本點收了沒)
 * - `receive`:刷一本 → 寫 `lottery_purchase_receipts` + `createBook`(本、張、「進貨」事件),同一個交易。
 *   單據要在審核中、點收任務在操作者手上;最後張號不同 → 擋下「請退回更正」;單上沒有 → 查是不是別家店的
 *   進貨單(送錯分店:擋下、不入庫,錯誤帶那張單的分店與單號)
 * - `notifyWrongStore`:[通知總部更正] → 通知那張進貨單的建立者(`lottery.purchase-wrong-store`)
 *
 * [完成這次點收] 不寫資料(「這一次」由畫面記;列印由 58mm 的功能接在畫面的完成動作後)。
 */
@Injectable()
export class PurchaseReceivingService {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly receipts: LotteryPurchaseReceiptsRepository,
    private readonly requisitionLines: LotteryRequisitionLinesRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly books: LotteryBooksService,
    private readonly rules: PurchaseRules,
    private readonly notifications: NotificationService,
    private readonly tx: TransactionService,
  ) {}

  async receivingOf(
    operator: OperatorContext,
    submissionIdText: string,
  ): Promise<LotteryPurchaseReceivingModel> {
    const submission = await this.readable(operator, submissionIdText);
    return this.toModel(operator, submission);
  }

  async receive(
    operator: OperatorContext,
    submissionIdText: string,
    code: string,
  ): Promise<ReceiveLotteryPurchaseBookPayload> {
    const submission = await this.readable(operator, submissionIdText);
    const rowId = await this.tx.withTransaction(async (session) => {
      if (!(await this.canReceive(operator, submission))) {
        throw forbiddenError(
          "Purchase is not waiting for your receiving",
          PURCHASE_REASONS.notReceivable,
        );
      }
      const reader = await tenantBoundaryContext(
        this.orgs,
        null,
        submission.tenantId,
      );
      const lines = purchaseLinesOf(submission.values);
      const games = await this.rules.gamesOf(reader, lines);
      const receipts = await this.rules.receiptsOf(
        reader,
        submission._id,
        session,
      );
      const received = new Set(receipts.map((receipt) => receipt.rowId));
      const result = matchReceiveScan(
        lines,
        received,
        code,
        (gameId) => games.get(gameId)?.gameCode,
      );
      if (result.kind === "invalid") {
        throw validationError(
          "Unknown code",
          ["code"],
          PURCHASE_REASONS.scanInvalid,
        );
      }
      if (result.kind === "not_on_purchase") {
        throw await this.notOnPurchaseError(submission, code);
      }
      if (result.kind === "already_received") {
        throw validationError(
          "Book is already received",
          ["code"],
          PURCHASE_REASONS.alreadyReceived,
          { rowId: result.row.rowId },
        );
      }
      if (result.kind === "last_ticket_mismatch") {
        throw validationError(
          "Last ticket number differs from the purchase; return it for correction",
          ["code"],
          PURCHASE_REASONS.lastTicketMismatch,
          { rowId: result.row.rowId },
        );
      }
      await this.receiveRow(operator, session, submission, result.row);
      return result.row.rowId;
    });
    return {
      rowId,
      receiving: await this.toModel(
        operator,
        await this.readable(operator, submissionIdText),
      ),
    };
  }

  /** [通知總部更正]:這本若是別家店進貨單上的,通知那張單的建立者;不是 → `NOT_FOUND`。 */
  async notifyWrongStore(
    operator: OperatorContext,
    submissionIdText: string,
    code: string,
  ): Promise<boolean> {
    const submission = await this.readable(operator, submissionIdText);
    const hit = await this.wrongStoreHit(submission, code);
    if (hit === null) {
      throw notFoundError("這本不在別家分店的進貨單上");
    }
    const createdBy = hit.owner.createdBy ?? null;
    if (createdBy === null) {
      return false;
    }
    const values = submission.values as Record<string, unknown>;
    await this.notifications.notify({
      type: LOTTERY_PURCHASE_WRONG_STORE,
      tenantId: hit.owner.tenantId,
      orgId: hit.owner.orgId,
      recipients: { kind: "users", userIds: [createdBy] },
      params: {
        subject: hit.owner.serialNo ?? "",
        orgName: labelOf(values[PURCHASE_FIELD_KEYS.branch]),
      },
      dedupeKey: `purchase-wrong-store:${String(hit.owner._id)}:${hit.line.rowId}:${String(submission._id)}`,
    });
    return true;
  }

  // ---- 內部 ----

  /**
   * 讀得到這張進貨單:可見範圍內,或建立者本人,或持有(曾持有)它的審核任務(店長在申請中心進來點收;
   * 單據可能是總部建的,不在店長的可見範圍)。讀不到 → `NOT_FOUND`。
   */
  private async readable(
    operator: OperatorContext,
    submissionIdText: string,
  ): Promise<SubmissionDoc> {
    const submissionId = toObjectId(submissionIdText);
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (submissionId === null || tenantId === null) {
      throw notFoundError("進貨單不存在");
    }
    const filter = {
      _id: submissionId,
      moduleKey: PURCHASE_MODULE_KEY,
      formKey: PURCHASE_FORM_KEY,
    };
    const visible = await this.submissions.findOne(operator, filter);
    if (visible !== null) {
      return visible;
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const submission = await this.submissions.findOne(reader, filter);
    const actorId = operator.actorId;
    if (submission === null || actorId === null) {
      throw notFoundError("進貨單不存在");
    }
    if (submission.createdBy?.equals(actorId) === true) {
      return submission;
    }
    const held = await this.tasks.findOne(tenantId, {
      submissionId,
      $or: [{ assigneeId: actorId }, { previousAssigneeIds: actorId }],
    });
    if (held === null) {
      throw notFoundError("進貨單不存在");
    }
    return submission;
  }

  /** 單據在審核中,而且點收(進貨單唯一一關)的任務在操作者手上。 */
  private async canReceive(
    operator: OperatorContext,
    submission: SubmissionDoc,
  ): Promise<boolean> {
    if (
      submission.status !== "reviewing" ||
      submission.tenantId === null ||
      operator.actorId === null
    ) {
      return false;
    }
    const task = await this.tasks.findOne(submission.tenantId, {
      submissionId: submission._id,
      assigneeId: operator.actorId,
      status: "pending",
    });
    return task !== null;
  }

  /** 點收一列:先建本(本號重複等由 `createBook` 擋),再寫點收紀錄(唯一 `(submissionId, rowId)`)。 */
  private async receiveRow(
    operator: OperatorContext,
    session: ClientSession,
    submission: SubmissionDoc,
    row: PurchaseLineValue,
  ): Promise<void> {
    const header = purchaseHeaderOf(submission.values);
    const branchId = toObjectId(header.branchId);
    const gameId = toObjectId(row.gameId);
    const actorId = operator.actorId;
    if (
      branchId === null ||
      gameId === null ||
      row.bookNo === null ||
      actorId === null
    ) {
      throw validationError("Purchase line is invalid", ["code"]);
    }
    const at = new Date();
    const { book } = await this.books.createBook(session, operator, {
      orgId: branchId,
      gameId,
      bookNo: row.bookNo,
      lastTicketNo: row.lastTicketNo,
      rate: row.rate,
      cost: row.amount,
      purchaseSubmissionId: submission._id,
      purchasedAt: header.purchaseDate,
      purchaseDealerId: toObjectId(header.dealerId),
      at,
    });
    await this.receipts.create(
      operator,
      {
        orgId: branchId,
        submissionId: submission._id,
        rowId: row.rowId,
        bookId: book._id,
        receivedBy: actorId,
        receivedAt: at,
      },
      { session },
    );
  }

  private async notOnPurchaseError(submission: SubmissionDoc, code: string) {
    const hit = await this.wrongStoreHit(submission, code);
    if (hit === null) {
      return validationError(
        "Book is not on this purchase",
        ["code"],
        PURCHASE_REASONS.bookNotOnPurchase,
      );
    }
    const owner = hit.owner.values as Record<string, unknown>;
    return validationError(
      "Book belongs to another store's purchase",
      ["code"],
      PURCHASE_REASONS.wrongStore,
      {
        ownerBranchName: labelOf(owner[PURCHASE_FIELD_KEYS.branch]),
        serialNo: hit.owner.serialNo ?? null,
        gameName: hit.game?.name ?? null,
        unitPrice: hit.game?.unitPrice ?? null,
        bookNo:
          hit.line.bookNo === null ? null : displayBookNo(hit.line.bookNo),
      },
    );
  }

  /** 這本在別家分店的進貨單上(建立了、還沒點收完成的)。 */
  private async wrongStoreHit(
    submission: SubmissionDoc,
    code: string,
  ): Promise<WrongStoreHit | null> {
    const parsed = parseTicketInput(code);
    if (parsed === null || submission.tenantId === null) {
      return null;
    }
    const branchId = purchaseHeaderOf(submission.values).branchId;
    const reader = await tenantBoundaryContext(
      this.orgs,
      null,
      submission.tenantId,
    );
    const others = await this.submissions.findMany(
      reader,
      {
        _id: { $ne: submission._id },
        moduleKey: PURCHASE_MODULE_KEY,
        formKey: PURCHASE_FORM_KEY,
        status: { $in: [...PURCHASE_OPEN_STATUSES] },
        "values.lines.book_no": {
          $in: [parsed.bookNo, displayBookNo(parsed.bookNo)],
        },
      },
      {
        select: "values serialNo createdBy orgId tenantId status",
        sort: { createdAt: -1 },
      },
    );
    for (const owner of others) {
      if (purchaseHeaderOf(owner.values).branchId === branchId) {
        continue;
      }
      const lines = purchaseLinesOf(owner.values);
      const games = await this.rules.gamesOf(reader, lines);
      const line = lines.find(
        (item) =>
          item.bookNo === parsed.bookNo &&
          (parsed.gameCode === undefined ||
            games.get(item.gameId)?.gameCode === parsed.gameCode),
      );
      if (line !== undefined) {
        return { owner, line, game: games.get(line.gameId) };
      }
    }
    return null;
  }

  private async toModel(
    operator: OperatorContext,
    submission: SubmissionDoc,
  ): Promise<LotteryPurchaseReceivingModel> {
    const reader = await tenantBoundaryContext(
      this.orgs,
      null,
      submission.tenantId,
    );
    const lines = purchaseLinesOf(submission.values);
    const games = await this.rules.gamesOf(reader, lines);
    const receipts = await this.rules.receiptsOf(reader, submission._id);
    const receivedAt = new Map(
      receipts.map((receipt) => [receipt.rowId, receipt.receivedAt]),
    );
    const requested = await this.requestedBooksOf(reader, submission);
    const groups = groupPurchaseLines(lines).map(
      (group): LotteryPurchaseReceivingGroupModel => {
        const game = games.get(group.gameId);
        return {
          gameId: group.gameId,
          gameCode: game?.gameCode ?? "",
          gameName: game?.name ?? "",
          unitPrice: game?.unitPrice ?? 0,
          requestedBooks: requested?.get(group.gameId) ?? null,
          receivedBooks: group.rows.filter((row) => receivedAt.has(row.rowId))
            .length,
          subtotal: group.subtotal,
          rows: group.rows.map((row) => ({
            rowId: row.rowId,
            bookNo: row.bookNo ?? "",
            lastTicketNo: row.lastTicketNo,
            tickets: row.tickets,
            bookPrice: row.bookPrice,
            rate: row.rate,
            amount: row.amount,
            received: receivedAt.has(row.rowId),
            receivedAt: receivedAt.get(row.rowId) ?? null,
          })),
        };
      },
    );
    return {
      submissionId: String(submission._id),
      canReceive: await this.canReceive(operator, submission),
      receivedCount: lines.filter((line) => receivedAt.has(line.rowId)).length,
      totalCount: lines.length,
      groups,
    };
  }

  /** 從叫貨單帶入:每個遊戲叫了幾本(叫貨明細副本)。沒有叫貨單 → null。 */
  private async requestedBooksOf(
    reader: OperatorContext,
    submission: SubmissionDoc,
  ): Promise<Map<string, number> | null> {
    const requisitionId = await this.rules.requisitionIdOf(
      submission.tenantId,
      purchaseHeaderOf(submission.values).requisitionNo,
    );
    if (requisitionId === null) {
      return null;
    }
    const rows = await this.requisitionLines.findMany(
      reader,
      { requisitionId },
      { select: "gameId books" },
    );
    return new Map(rows.map((row) => [String(row.gameId), row.books]));
  }
}
