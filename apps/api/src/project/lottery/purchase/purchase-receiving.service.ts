import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

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
  purchaseRedemptionsOf,
} from "@repo/domain/project/lottery";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { TransactionService } from "../../../database/transaction";
import { WorkflowTasksRepository } from "../../../database/workflow-tasks.repository";
import { isDuplicateKeyError } from "../../../forms/forms-error";
import { NotificationService } from "../../../notifications/notification.service";
import { LotteryPurchaseReceiptsRepository } from "../../database/lottery-purchases/lottery-purchase-receipts.repository";
import { LotteryRedemptionsRepository } from "../../database/lottery-redemptions/lottery-redemptions.repository";
import { LotteryRequisitionLinesRepository } from "../../database/lottery-requisitions/lottery-requisition-lines.repository";
import {
  LOTTERY_PURCHASE_REF,
  LOTTERY_PURCHASE_WRONG_STORE,
} from "../../notifications";
import { tenantOfOperator } from "../master-data-tenant";
import type { LotteryRedemptionModel } from "../redemption/models/redemption.model";
import { RedemptionViews } from "../redemption/redemption-views";
import type { StoreGrant } from "../store/store-access";
import { LotteryBooksService } from "../tickets/books.service";
import type {
  CompleteLotteryPurchaseReceivingPayload,
  LotteryPurchaseReceivingBatchModel,
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

function alreadyReceivedError(rowId: string | null) {
  return validationError(
    "Book is already received",
    ["code"],
    PURCHASE_REASONS.alreadyReceived,
    rowId === null ? {} : { rowId },
  );
}

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

/** 點收紀錄 → 每一次點收(依完成時間由舊到新,編號從 1 起)。 */
function batchesOf(
  receipts: readonly {
    rowId: string;
    batchId?: Types.ObjectId | null;
    batchedAt?: Date | null;
  }[],
): LotteryPurchaseReceivingBatchModel[] {
  const batches = new Map<string, { completedAt: Date; rowIds: string[] }>();
  for (const receipt of receipts) {
    if (receipt.batchId == null) {
      continue;
    }
    const key = String(receipt.batchId);
    const batch = batches.get(key) ?? {
      completedAt: receipt.batchedAt ?? new Date(0),
      rowIds: [],
    };
    batch.rowIds.push(receipt.rowId);
    batches.set(key, batch);
  }
  return [...batches.entries()]
    .toSorted(
      ([, a], [, b]) => a.completedAt.getTime() - b.completedAt.getTime(),
    )
    .map(([batchId, batch], index) => ({ batchId, no: index + 1, ...batch }));
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
 * - `complete`:[完成這次點收] → 「這一次」點收的列標上同一個點收批次(`batchId`);
 *   「這一次」由畫面記(上次完成或打開頁面之後點收的列),已在別的批次的列不重收。進貨點收單照批次印
 */
/** 從進貨單讀兌獎紀錄:不帶店面的權限(撤銷方式一律 null)。 */
const NO_STORE_GRANT: StoreGrant = { has: () => false };

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
    private readonly redemptions: LotteryRedemptionsRepository,
    private readonly redemptionViews: RedemptionViews,
  ) {}

  /**
   * 這張進貨單勾選的兌獎紀錄(兌獎紀錄詳情的入口之一,規格 6.5):讀取依據是**讀得到這張進貨單**
   * (`readable`;總部不一定有 `store.view`),兌獎紀錄在分店,以租戶邊界讀(反查),只讀這張單存值裡勾的那幾筆。
   * 回詳情欄位;撤銷方式一律 null(這個入口不能撤銷,撤銷走店面管理)。
   */
  async redemptionsOf(
    operator: OperatorContext,
    submissionIdText: string,
  ): Promise<LotteryRedemptionModel[]> {
    const submission = await this.readable(operator, submissionIdText);
    const ids = purchaseRedemptionsOf(
      submission.values as Record<string, unknown>,
    ).flatMap((row) =>
      Types.ObjectId.isValid(row.redemptionId)
        ? [new Types.ObjectId(row.redemptionId)]
        : [],
    );
    if (ids.length === 0) {
      return [];
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      null,
      submission.tenantId,
    );
    const rows = await this.redemptions.findMany(
      reader,
      { _id: { $in: ids }, tenantId: submission.tenantId },
      { sort: { redeemedAt: 1, _id: 1 } },
    );
    return this.redemptionViews.toModels(operator, rows, NO_STORE_GRANT);
  }

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
    gameId: string | null = null,
  ): Promise<ReceiveLotteryPurchaseBookPayload> {
    const submission = await this.readable(operator, submissionIdText);
    const rowId = await this.receiveInTransaction(
      operator,
      submission,
      code,
      gameId,
    );
    return {
      rowId,
      receiving: await this.toModel(
        operator,
        await this.readable(operator, submissionIdText),
      ),
    };
  }

  /**
   * 點收一本的交易。同一本同時刷兩次:後到的那個重讀後是「已點收」;交易沒有重跑、撞到唯一索引
   * `(submissionId, rowId)` 或本編號時,也一律當作已點收(`PURCHASE_ALREADY_RECEIVED`)。
   */
  private async receiveInTransaction(
    operator: OperatorContext,
    submission: SubmissionDoc,
    code: string,
    gameId: string | null,
  ): Promise<string> {
    try {
      return await this.tx.withTransaction(async (session) => {
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
          (lineGameId) => games.get(lineGameId)?.gameCode,
          gameId,
        );
        if (result.kind === "invalid") {
          throw validationError(
            "Unknown code",
            ["code"],
            PURCHASE_REASONS.scanInvalid,
          );
        }
        if (result.kind === "ambiguous_game") {
          throw validationError(
            "Several games on this purchase share the book number; scan the back code or pick a game",
            ["code"],
            PURCHASE_REASONS.scanAmbiguousGame,
            { gameIds: result.gameIds },
          );
        }
        if (result.kind === "not_on_purchase") {
          throw await this.notOnPurchaseError(submission, code);
        }
        if (result.kind === "already_received") {
          throw alreadyReceivedError(result.row.rowId);
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
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw alreadyReceivedError(null);
      }
      throw error;
    }
  }

  /**
   * [完成這次點收]:這一次點收的列(`rowIds` 裡這張單的、自己點收的、還沒有批次的)標上新的點收批次。
   * 要點收任務在自己手上(跟刷條碼同一個資格);沒有可收進批次的列 → `batch` 為 null。
   */
  async complete(
    operator: OperatorContext,
    submissionIdText: string,
    rowIds: readonly string[],
  ): Promise<CompleteLotteryPurchaseReceivingPayload> {
    const submission = await this.readable(operator, submissionIdText);
    if (!(await this.canReceive(operator, submission))) {
      throw forbiddenError(
        "Purchase is not waiting for your receiving",
        PURCHASE_REASONS.notReceivable,
      );
    }
    // 只收這張單的列(上限 = 列數;送超過的是壞請求)
    const lineRowIds = new Set(
      purchaseLinesOf(submission.values).map((line) => line.rowId),
    );
    if (rowIds.length > lineRowIds.size) {
      throw validationError("Too many rows", ["rowIds"]);
    }
    const batchId = new Types.ObjectId();
    // 以點收人自己的身分寫(點收紀錄是他寫的、在他的分店):只收他自己點收的列,更新者記他
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
      ref: { type: LOTTERY_PURCHASE_REF, id: String(hit.owner._id) },
      dedupeKey: `purchase-wrong-store:${String(hit.owner._id)}:${hit.line.rowId}:${String(submission._id)}`,
    });
    return true;
  }

  /**
   * 編輯頁的選項帶的 `submissionId`:操作者讀得到這張進貨單(同 `readable`)才回它的 id,
   * 讀不到 / 不是進貨單 → null(當作新增頁,不多列它引用的叫貨單)。
   */
  async readableIdOf(
    operator: OperatorContext,
    submissionIdText: string | null | undefined,
  ): Promise<Types.ObjectId | null> {
    if (submissionIdText === null || submissionIdText === undefined) {
      return null;
    }
    try {
      const submission = await this.readable(operator, submissionIdText);
      return submission._id;
    } catch {
      return null;
    }
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
    const batchOf = new Map(
      receipts.flatMap((receipt) =>
        receipt.batchId == null
          ? []
          : [[receipt.rowId, String(receipt.batchId)] as const],
      ),
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
            batchId: batchOf.get(row.rowId) ?? null,
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
      batches: batchesOf(receipts),
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
