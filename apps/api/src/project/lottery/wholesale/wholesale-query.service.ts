import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  INVENTORY_PERMISSIONS,
  TICKET_EVENT_TYPE,
  WHOLESALE_FIELD_KEYS,
  WHOLESALE_FORM_KEY,
  WHOLESALE_MODULE_KEY,
  WHOLESALE_PAYMENT_MODE,
  WHOLESALE_PERMISSIONS,
  WHOLESALE_REF_TYPE,
  WHOLESALE_SETTLEMENT_SIDE,
  normalizeBookNo,
  wholesaleHeaderOf,
  wholesaleLinesOf,
  wholesaleTotalOf,
} from "@repo/domain/project/lottery";
import { receivedNetOf, totalsOf } from "@repo/domain/project/lottery-accounts";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { WorkflowTasksRepository } from "../../../database/workflow-tasks.repository";
import type { FormSubmissionStatusEnum } from "../../../forms/form-runtime/models/form-submission.model";
import {
  PermissionResolver,
  holdsPermission,
} from "../../../permission/permission-resolver";
import { LotteryWholesaleCustomersRepository } from "../../database/lottery-dealers/lottery-dealers.repository";
import { LotteryTicketEventsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { tenantOfOperator } from "../master-data-tenant";
import {
  SettlementLedger,
  type SettlementSnapshot,
  outstandingOf,
} from "../settlement/settlement-ledger";
import { settlementDocumentOf } from "../settlement/settlement-registry";
import { SettlementService } from "../settlement/settlement.service";
import type {
  LotteryWholesaleDetailModel,
  LotteryWholesaleModel,
  LotteryWholesaleOptionModel,
  LotteryWholesaleOptionsModel,
  LotteryWholesaleScanMatchModel,
  LotteryWholesalesInput,
  LotteryWholesalesPayload,
} from "./models/wholesale.model";
import {
  WHOLESALE_MAX_PAGE_SIZE,
  WHOLESALE_PAGE_SIZE,
} from "./models/wholesale.model";
import {
  WholesaleBooks,
  objectIdsOf,
  serialOfProblem,
  toObjectId,
  wholesaleBookProblemOf,
} from "./wholesale-books.service";
import { WholesaleCustomerNames, labelOf } from "./wholesale-customer-names";
import { notFoundError } from "./wholesale-error";

type WholesaleSubmission = NonNullable<
  Awaited<ReturnType<FormSubmissionsRepository["findOne"]>>
>;

const K = WHOLESALE_FIELD_KEYS;

/** 單據狀態 → 明細每一本的狀態(審核中 = 批售中、已完成 = 已批售)。 */
const ROW_STATES: Readonly<Partial<Record<string, string>>> = {
  reviewing: "wholesaling",
  completed: "wholesaled",
};

/**
 * 批售單的讀取(專案規格 21.3;正本 `docs/modules/project/purchasing.md`「批售單」):
 *
 * - `optionsOf`:新增 / 編輯頁的選項(可批售的本、批售客戶、入帳帳戶)
 * - `scanMatchesOf`:刷到的碼對到哪些本、為什麼不能批售
 * - `listOf` / `customerDocumentsOf`:列表、批售客戶詳情的「批售紀錄」
 * - `detailOf`:檢視頁與申請中心詳情頁的內容
 *
 * 出貨分店要在操作者的可見範圍;本與張以租戶邊界讀。權限由 resolver 守(`detailOf` 例外:讀得到單據就讀得到)。
 */
@Injectable()
export class WholesaleQueryService {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly tasks: WorkflowTasksRepository,
    private readonly customers: LotteryWholesaleCustomersRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly books: WholesaleBooks,
    private readonly names: WholesaleCustomerNames,
    private readonly settlement: SettlementService,
    private readonly ledger: SettlementLedger,
    private readonly permissions: PermissionResolver,
  ) {}

  /** 可批售的本 = 出貨分店庫存裡未拆、整本未售、沒被任何單據鎖住的本(同調貨單的整本)。 */
  async optionsOf(
    operator: OperatorContext,
    fromId: Types.ObjectId,
  ): Promise<LotteryWholesaleOptionsModel> {
    const reader = await this.readerFor(operator, fromId);
    const canShowCost = await this.holds(
      operator,
      INVENTORY_PERMISSIONS.showCost,
    );
    const stock = await this.books.stockOf(reader, fromId);
    const bookIds = objectIdsOf([...stock.keys()]);
    const found = await this.books.booksOf(reader, bookIds);
    // 從沒拆過、沒撤銷
    const books = [...found.values()].filter(
      (book) =>
        book.status === "normal" && (book.firstOpenedAt ?? null) === null,
    );
    const [counts, games, customers, accounts] = await Promise.all([
      this.books.usableCountsOf(
        reader,
        books.map((book) => book._id),
      ),
      this.books.gamesOf(
        reader,
        objectIdsOf(books.map((book) => String(book.gameId))),
      ),
      this.customers.findMany(
        operator,
        { status: "active" },
        { select: "label", sort: { label: 1, _id: 1 } },
      ),
      this.settlement.usableAccountsOf(
        operator,
        tenantOfOperator(operator)?.tenantId ?? null,
        fromId,
      ),
    ]);
    return {
      books: books
        .flatMap((book) => {
          const key = String(book._id);
          const game = games.get(String(book.gameId));
          const own = stock.get(key) ?? { count: 0, cost: 0 };
          const usable = counts.get(key) ?? 0;
          // 整本都在這家店庫存才列(有張在別處、被鎖、不是未售就不是整本)
          if (game === undefined || own.count !== usable) {
            return [];
          }
          return [
            {
              bookId: key,
              gameId: String(book.gameId),
              gameCode: book.gameCode,
              gameName: game.name,
              bookNo: book.bookNo,
              unitPrice: game.unitPrice,
              tickets: game.ticketsPerBook,
              bookPrice: game.bookPrice,
              defaultRate: game.defaultRate,
              // 待標註的跳號實體不存在:成本照標準張數算(一本合計只扣一次)
              cost: canShowCost
                ? Math.round((own.cost / usable) * game.ticketsPerBook)
                : null,
            },
          ];
        })
        .toSorted(
          (left, right) =>
            left.gameCode.localeCompare(right.gameCode, "zh-Hant") ||
            left.bookNo.localeCompare(right.bookNo, "zh-Hant"),
        ),
      customers: customers.map((customer) => ({
        id: String(customer._id),
        label: customer.label,
      })),
      accounts,
    };
  }

  /** 刷到的碼對到的本(同本號可能好幾款遊戲)與各自的問題;背面編號給遊戲代號。 */
  async scanMatchesOf(
    operator: OperatorContext,
    fromId: Types.ObjectId,
    bookNoText: string,
    gameCode: string | null,
  ): Promise<LotteryWholesaleScanMatchModel[]> {
    const reader = await this.readerFor(operator, fromId);
    const bookNo = normalizeBookNo(bookNoText);
    if (bookNo === null) {
      return [];
    }
    const books = await this.books.booksByNo(reader, bookNo, gameCode);
    const ticketsOf = await this.books.ticketsOf(
      reader,
      books.map((book) => book._id),
    );
    const matches = books.map((book) => ({
      book,
      problem: wholesaleBookProblemOf(
        book,
        ticketsOf.get(String(book._id)) ?? [],
        fromId,
      ),
    }));
    const serials = await this.books.serialsOf(
      reader,
      matches.map((match) => match.problem),
    );
    return matches.map(({ book, problem }) => ({
      bookId: String(book._id),
      gameId: String(book.gameId),
      gameCode: book.gameCode,
      bookNo: book.bookNo,
      problem: problem?.kind ?? null,
      lockedSerialNo:
        problem === null ? null : serialOfProblem(problem, serials),
    }));
  }

  async listOf(
    operator: OperatorContext,
    input: LotteryWholesalesInput,
  ): Promise<LotteryWholesalesPayload> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      WHOLESALE_MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? WHOLESALE_PAGE_SIZE),
    );
    const filter: Record<string, unknown> = {
      ...this.readableFilterOf(operator),
      ...(input.status ? { status: input.status } : {}),
      ...(input.fromOrgId
        ? { [`values.${K.fromBranch}.id`]: input.fromOrgId }
        : {}),
      ...(input.customerId
        ? { [`values.${K.customer}.id`]: input.customerId }
        : {}),
      ...(input.paymentMode
        ? { [`values.${K.paymentMode}`]: input.paymentMode }
        : {}),
    };
    const [totalCount, records] = await Promise.all([
      this.submissions.count(operator, filter),
      this.submissions.findMany(operator, filter, {
        sort: { submittedAt: -1, _id: -1 },
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }),
    ]);
    return {
      items: await this.rowsOf(operator, records),
      totalCount,
      page,
      pageSize,
    };
  }

  /** 列表的「批售客戶」篩選:操作者讀得到的客戶(含停用的,既有的單照常)。 */
  async customerFilterOf(
    operator: OperatorContext,
  ): Promise<LotteryWholesaleOptionModel[]> {
    const customers = await this.customers.findMany(
      operator,
      {},
      { select: "label", sort: { label: 1, _id: 1 } },
    );
    return customers.map((customer) => ({
      id: String(customer._id),
      label: customer.label,
    }));
  }

  /** 批售客戶詳情「批售紀錄」:這位客戶的批售單(讀得到的;草稿只有自己的),新的在前。 */
  async customerDocumentsOf(
    operator: OperatorContext,
    customerIdText: string,
  ): Promise<LotteryWholesaleModel[]> {
    const customerId = toObjectId(customerIdText);
    const customer =
      customerId === null
        ? null
        : await this.customers.findById(operator, customerId, {
            select: "_id",
          });
    if (customer === null) {
      throw notFoundError("批售客戶不存在");
    }
    const records = await this.submissions.findMany(
      operator,
      {
        ...this.readableFilterOf(operator),
        [`values.${K.customer}.id`]: String(customer._id),
      },
      { sort: { createdAt: -1, _id: -1 } },
    );
    return this.rowsOf(operator, records);
  }

  /** 檢視頁的內容;讀得到單據就讀得到(沒有成本,不另守權限)。 */
  async detailOf(
    operator: OperatorContext,
    submissionIdText: string,
  ): Promise<LotteryWholesaleDetailModel> {
    const submission = await this.readable(operator, submissionIdText);
    const values = submission.values as Record<string, unknown>;
    const header = wholesaleHeaderOf(values);
    const lines = wholesaleLinesOf(values);
    const reader = await tenantBoundaryContext(
      this.orgs,
      null,
      submission.tenantId,
    );
    const books = await this.books.booksOf(
      reader,
      objectIdsOf(lines.map((line) => line.bookId)),
    );
    const [games, [customerName], snapshots, shipped] = await Promise.all([
      this.books.gamesOf(
        reader,
        objectIdsOf([...books.values()].map((book) => String(book.gameId))),
      ),
      this.names.storeNamesOf(submission.tenantId, [values]),
      this.snapshotsOf(operator, [submission]),
      this.events.findOne(
        reader,
        {
          refType: WHOLESALE_REF_TYPE,
          refId: submission._id,
          type: TICKET_EVENT_TYPE.wholesale,
        },
        { select: "at" },
      ),
    ]);
    const snapshot = snapshots.get(String(submission._id));
    return {
      submissionId: String(submission._id),
      fromBranchName: labelOf(values[K.fromBranch]),
      customerName: customerName ?? "",
      paymentMode: header.paymentMode,
      accountLabel:
        header.paymentMode === WHOLESALE_PAYMENT_MODE.autoBank
          ? labelOf(values[K.account]) || null
          : null,
      amount: wholesaleTotalOf(lines),
      received: receivedOf(snapshot),
      shippedAt: shipped?.at ?? null,
      rows: lines.flatMap((line) => {
        const book = books.get(line.bookId);
        const game =
          book === undefined ? undefined : games.get(String(book.gameId));
        return book === undefined || game === undefined
          ? []
          : [
              {
                rowId: line.rowId,
                bookId: line.bookId,
                gameId: String(book.gameId),
                gameCode: book.gameCode,
                gameName: game.name,
                bookNo: book.bookNo,
                unitPrice: game.unitPrice,
                defaultRate: game.defaultRate,
                tickets: line.tickets,
                bookPrice: line.bookPrice,
                rate: line.rate,
                amount: line.amount,
                state: ROW_STATES[submission.status] ?? null,
              },
            ];
      }),
    };
  }

  // ---- 內部 ----

  /** 讀得到的批售單(可見範圍 + 依欄位共用由 repository 套);草稿只給建立者本人(同表單列表)。 */
  private readableFilterOf(operator: OperatorContext): Record<string, unknown> {
    return {
      moduleKey: WHOLESALE_MODULE_KEY,
      formKey: WHOLESALE_FORM_KEY,
      $or: [
        { status: { $ne: "draft" } },
        { status: "draft", createdBy: operator.actorId },
      ],
    };
  }

  /** 讀得到這張單:一般讀取讀得到、建立者本人,或持有(曾持有)它的審核任務(同調貨單)。 */
  private async readable(
    operator: OperatorContext,
    submissionIdText: string,
  ): Promise<WholesaleSubmission> {
    const submissionId = toObjectId(submissionIdText);
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    const actorId = operator.actorId;
    if (submissionId === null) {
      throw notFound();
    }
    const visible = await this.submissions.findOne(operator, {
      ...this.readableFilterOf(operator),
      _id: submissionId,
    });
    if (visible !== null) {
      return visible;
    }
    if (tenantId === null || actorId === null) {
      throw notFound();
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const submission = await this.submissions.findOne(reader, {
      moduleKey: WHOLESALE_MODULE_KEY,
      formKey: WHOLESALE_FORM_KEY,
      _id: submissionId,
    });
    if (submission === null) {
      throw notFound();
    }
    if (submission.createdBy?.equals(actorId) === true) {
      return submission;
    }
    const held = await this.tasks.findOne(tenantId, {
      submissionId,
      $or: [{ assigneeId: actorId }, { previousAssigneeIds: actorId }],
    });
    if (held === null) {
      throw notFound();
    }
    return submission;
  }

  private async snapshotsOf(
    operator: OperatorContext,
    records: readonly WholesaleSubmission[],
  ): Promise<Map<string, SettlementSnapshot>> {
    const registration = settlementDocumentOf(WHOLESALE_MODULE_KEY);
    const snapshots =
      registration === undefined || records.length === 0
        ? []
        : await this.ledger.snapshotsOf(operator, registration, records);
    return new Map(
      snapshots.map((snapshot) => [String(snapshot.submission._id), snapshot]),
    );
  }

  private async rowsOf(
    operator: OperatorContext,
    records: readonly WholesaleSubmission[],
  ): Promise<LotteryWholesaleModel[]> {
    if (records.length === 0) {
      return [];
    }
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    const [names, snapshots, canCreate] = await Promise.all([
      this.names.storeNamesOf(
        tenantId,
        records.map((record) => record.values),
      ),
      this.snapshotsOf(operator, records),
      this.holds(operator, WHOLESALE_PERMISSIONS.create),
    ]);
    return records.map((record, index) => {
      const values = record.values as Record<string, unknown>;
      const header = wholesaleHeaderOf(values);
      const lines = wholesaleLinesOf(values);
      const snapshot = snapshots.get(String(record._id));
      const due =
        snapshot === undefined ? null : (outstandingOf(snapshot)[0] ?? null);
      return {
        id: String(record._id),
        serialNo: record.serialNo ?? null,
        fromBranchName: labelOf(values[K.fromBranch]),
        customerName: names[index] ?? "",
        paymentMode: header.paymentMode,
        books: lines.length,
        amount: wholesaleTotalOf(lines),
        received: receivedOf(snapshot),
        settlementKind: due?.kind ?? null,
        settlementAmount: due?.amount ?? 0,
        inSettlement: snapshot !== undefined,
        status: record.status as FormSubmissionStatusEnum,
        blocked: record.blocked,
        canDelete:
          record.status === "draft" &&
          canCreate &&
          operator.actorId !== null &&
          record.createdBy?.equals(operator.actorId) === true,
      };
    });
  }

  /** 出貨分店要在操作者的可見範圍;回操作者當前租戶的邊界上下文。 */
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
}

function notFound() {
  return notFoundError("批售單不存在");
}

/** 已收淨額(不參與收付 = 0)。 */
function receivedOf(snapshot: SettlementSnapshot | undefined): number {
  return snapshot === undefined
    ? 0
    : receivedNetOf(totalsOf(snapshot.state, WHOLESALE_SETTLEMENT_SIDE));
}
