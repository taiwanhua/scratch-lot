import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  INVENTORY_PERMISSIONS,
  STOCKTAKE_REMINDER_HOURS,
  STOCKTAKE_STATUSES,
  STOCKTAKE_TYPES,
  STORE_PERMISSIONS,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  serializeStocktakeDraft,
} from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { FormAccessService } from "../../../forms/form-access.service";
import { SubmissionReadAccess } from "../../../workflows/workflow-engine/submission-read-access.service";
import {
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import type {
  LotteryStocktake,
  StocktakeSummary,
} from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import {
  type LotteryStocktakeDocument,
  LotteryStocktakesRepository,
} from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { expectedDrawerCash } from "../store/drawer-cash";
import {
  type ShiftRecord,
  StoreShiftViews,
  parseId,
} from "../store/shift-views";
import { StoreAccess } from "../store/store-access";
import { StoreClock } from "../store/store-clock";
import { StoreSalesSupport } from "../store/store-sales-support";
import type { LotteryStocktakesInput } from "./dto/stocktake.input";
import type {
  LotteryStocktakeCashPointModel,
  LotteryStocktakeDetailModel,
  LotteryStocktakeListItemModel,
  LotteryStocktakeSheetModel,
  LotteryStocktakeStatusModel,
  LotteryStocktakeSummaryModel,
  LotteryStocktakesPayload,
} from "./models/stocktake.model";
import { forbiddenError, notFoundError } from "./stocktake-error";

type StocktakeRecord = Persisted<LotteryStocktakeDocument>;

const LIST_LIMIT_MAX = 100;

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "zh-Hant");

/** 舊資料防禦:加「未盤的本」之前建立的盤點單沒有 `summary.uncountedCount` → 0。 */
const uncountedCountOf = (summary: StocktakeSummary): number =>
  (summary as Partial<StocktakeSummary>).uncountedCount ?? 0;

/** 舊資料防禦:加「未盤的本」之前建立的盤點單沒有 `uncountedBooks` → 空。 */
const uncountedBooksOf = (
  record: Pick<LotteryStocktake, "uncountedBooks">,
): LotteryStocktake["uncountedBooks"] =>
  (record as Partial<Pick<LotteryStocktake, "uncountedBooks">>)
    .uncountedBooks ?? [];

/** 盤點單 → 畫面的彙總(沒有 `inventory.show-cost` 不給成本)。 */
export function summaryModelOf(
  summary: StocktakeSummary,
  showCost: boolean,
): LotteryStocktakeSummaryModel {
  return {
    books: summary.books,
    backfillCount: summary.backfillCount,
    backfillAmount: summary.backfillAmount,
    newInvestigate: summary.newInvestigate,
    flagged: summary.flagged,
    confirmLost: summary.confirmLost,
    confirmLostCost: showCost ? summary.confirmLostCost : null,
    uncountedCount: uncountedCountOf(summary),
  };
}

/** 盤點單 → 盤點內容(退回後打開盤點頁帶入原內容)。 */
export function draftOfStocktake(record: LotteryStocktake): string {
  return serializeStocktakeDraft({
    version: 1,
    orgId: String(record.orgId),
    scopeCashPointId:
      record.scopeCashPointId === null ? null : String(record.scopeCashPointId),
    startedAt: record.startedAt.toISOString(),
    lines: record.lines.map((line) => ({
      bookId: String(line.bookId),
      cashPointId: String(line.cashPointId),
      countedAt: line.countedAt.toISOString(),
      method: line.method,
      presentTicketNos: [...line.presentTicketNos],
      diffs: line.diffs.map((diff) => ({
        ticketNo: diff.ticketNo,
        action: diff.action,
        eventId: diff.eventId,
      })),
    })),
    unopened: record.unopenedLines.map((line) => ({
      bookId: String(line.bookId),
      present: line.present,
    })),
    lostReview: record.lostReviewLines.map((line) => ({
      ticketId: String(line.ticketId),
      action: line.action,
      reasonKey: line.reasonKey,
      reasonNote: line.reasonNote,
    })),
  });
}

/**
 * 盤點的讀取(專案規格 6.8、8.6;正本 `docs/modules/project/store.md`「盤點」):
 *
 * - `sheet`:盤點頁(收銀點與應有現金、檯面上的本、未拆的本、待查清單)
 * - `status`:看板頂部「建議盤點一次」(距離上次送出的盤點超過 24 小時)
 * - `list` / `detail`:盤點紀錄分頁、盤點確認申請檢視頁
 *
 * 讀取要 `store.view`(盤點頁另要 `store.stocktake`),照操作者的可見範圍;人名以租戶邊界反查。
 */
@Injectable()
export class StocktakeQueryService {
  constructor(
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly formAccess: FormAccessService,
    private readonly readAccess: SubmissionReadAccess,
    private readonly support: StoreSalesSupport,
    private readonly views: StoreShiftViews,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
  ) {}

  // ---- 盤點頁 ----

  async sheet(
    operator: OperatorContext,
    orgIdText: string,
    cashPointIdText: string | null,
  ): Promise<LotteryStocktakeSheetModel> {
    const grant = await this.access.assertView(operator);
    if (!grant.has(STORE_PERMISSIONS.stocktake)) {
      throw forbiddenError(`Missing permission ${STORE_PERMISSIONS.stocktake}`);
    }
    const store = await this.support.mustStore(operator, orgIdText);
    const org = await this.orgs.findById(operator, store.orgId);
    const allPoints = await this.support.cashPointsOf(operator, store.orgId);
    const scopeId = cashPointIdText === null ? null : parseId(cashPointIdText);
    if (
      cashPointIdText !== null &&
      (scopeId === null || !allPoints.has(String(scopeId)))
    ) {
      throw notFoundError(`cash point not found: ${cashPointIdText}`);
    }
    const points = [...allPoints.values()]
      .filter((point) => scopeId === null || point._id.equals(scopeId))
      .toSorted((a, b) => a.order - b.order || byName(a, b));
    const cashPoints = await this.cashPointModels(operator, store, points);

    const counter = await this.tickets.findMany(
      operator,
      {
        orgId: store.orgId,
        "location.kind": TICKET_LOCATION_KIND.counter,
        "location.cashPointId": { $in: points.map((point) => point._id) },
        status: { $in: [TICKET_STATUS.unsold, TICKET_STATUS.sold] },
      },
      { sort: { ticketNo: 1 } },
    );
    const bookIds = [
      ...new Set(counter.map((ticket) => String(ticket.bookId))),
    ];
    const bookRecords = await this.books.findMany(operator, {
      _id: { $in: bookIds.map((id) => new Types.ObjectId(id)) },
    });
    const unopened =
      scopeId === null ? await this.unopenedBooks(operator, store.orgId) : [];
    const lost =
      scopeId === null ? await this.lostTickets(operator, store.orgId) : [];
    const games = await this.support.gamesOf(operator, [
      ...bookRecords.map((book) => book.gameId),
      ...unopened.map((book) => book.gameId),
    ]);
    const bookById = new Map(
      bookRecords.map((book) => [String(book._id), book]),
    );
    const groups = new Map<string, typeof counter>();
    for (const ticket of counter) {
      const key = `${String(ticket.bookId)}:${String(ticket.location.cashPointId)}`;
      groups.set(key, [...(groups.get(key) ?? []), ticket]);
    }
    const order = new Map(
      points.map((point, index) => [String(point._id), index]),
    );
    const books = [...groups.values()]
      .flatMap((tickets) => {
        const first = tickets[0];
        const book =
          first === undefined ? undefined : bookById.get(String(first.bookId));
        if (first === undefined || book === undefined) {
          return [];
        }
        const game = games.get(String(book.gameId));
        // 只剩已售的本(售完)不必盤
        if (!tickets.some((ticket) => ticket.status === TICKET_STATUS.unsold)) {
          return [];
        }
        return [
          {
            bookId: String(book._id),
            cashPointId: String(first.location.cashPointId),
            gameCode: book.gameCode,
            gameName: game?.name ?? "",
            unitPrice: game?.unitPrice ?? 0,
            bookNo: book.bookNo,
            tickets: tickets.map((ticket) => ({
              ticketId: String(ticket._id),
              ticketNo: ticket.ticketNo,
              version: ticket.version,
              status: ticket.status,
              pendingReversal: ticket.lockedBy?.refType === "sale_reversal",
            })),
          },
        ];
      })
      .toSorted(
        (a, b) =>
          (order.get(a.cashPointId) ?? 0) - (order.get(b.cashPointId) ?? 0) ||
          a.gameCode.localeCompare(b.gameCode) ||
          a.bookNo.localeCompare(b.bookNo),
      );
    return {
      orgId: String(store.orgId),
      orgName: org?.name ?? "",
      serverNow: this.clock.now(),
      cashPoints,
      books,
      unopenedBooks: unopened.map((book) => ({
        bookId: String(book._id),
        gameCode: book.gameCode,
        gameName: games.get(String(book.gameId))?.name ?? "",
        bookNo: book.bookNo,
        ticketCount: book.ticketCount,
      })),
      lostTickets: lost,
    };
  }

  /** 每個收銀點:開著的班(應有現金)、最近一班。 */
  private async cashPointModels(
    operator: OperatorContext,
    store: { orgId: Types.ObjectId; tenantId: Types.ObjectId | null },
    points: readonly { _id: Types.ObjectId; name: string }[],
  ): Promise<LotteryStocktakeCashPointModel[]> {
    const shifts = await this.shifts.findMany(
      operator,
      {
        orgId: store.orgId,
        cashPointId: { $in: points.map((point) => point._id) },
      },
      { sort: { openedAt: -1 } },
    );
    const latest = new Map<string, ShiftRecord>();
    for (const shift of shifts) {
      const key = String(shift.cashPointId);
      if (!latest.has(key)) {
        latest.set(key, shift);
      }
    }
    const names = await this.views.userNames(
      operator,
      store.tenantId,
      [...latest.values()].map((shift) => shift.openedBy),
    );
    const models: LotteryStocktakeCashPointModel[] = [];
    for (const point of points) {
      const last = latest.get(String(point._id));
      const shift =
        last === undefined
          ? null
          : {
              id: String(last._id),
              ownerName: names.get(String(last.openedBy)) ?? "",
              openedAt: last.openedAt,
              closed: last.closedAt !== null,
              expectedCash:
                last.closedAt === null
                  ? await expectedDrawerCash(operator, last)
                  : null,
            };
      models.push({
        id: String(point._id),
        name: point.name,
        shift: shift?.closed === false ? shift : null,
        lastShift: shift,
      });
    }
    return models;
  }

  /** 本店還沒拆的本(未售的張全在庫存、沒有任何一張售出 / 待查…)。 */
  private async unopenedBooks(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<
    {
      _id: Types.ObjectId;
      gameId: Types.ObjectId;
      gameCode: string;
      bookNo: string;
      ticketCount: number;
    }[]
  > {
    const rows = await this.tickets.aggregate(operator, [
      { $match: { orgId, status: { $ne: TICKET_STATUS.skipped } } },
      {
        $group: {
          _id: "$bookId",
          total: { $sum: 1 },
          inStock: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", TICKET_STATUS.unsold] },
                    { $eq: ["$location.kind", TICKET_LOCATION_KIND.stock] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    const unopened = rows.filter(
      (row) =>
        Number(row.total) > 0 && Number(row.total) === Number(row.inStock),
    );
    if (unopened.length === 0) {
      return [];
    }
    const countOf = new Map(
      unopened.map((row) => [String(row._id), Number(row.inStock)]),
    );
    const books = await this.books.findMany(operator, {
      _id: { $in: unopened.map((row) => row._id as Types.ObjectId) },
      status: "normal",
    });
    return books
      .map((book) => ({
        _id: book._id,
        gameId: book.gameId,
        gameCode: book.gameCode,
        bookNo: book.bookNo,
        ticketCount: countOf.get(String(book._id)) ?? 0,
      }))
      .toSorted(
        (a, b) =>
          a.gameCode.localeCompare(b.gameCode) ||
          a.bookNo.localeCompare(b.bookNo),
      );
  }

  /** 待查清單:本店的待查張(含責任分店是本店的),帶變成待查的時間與來源。 */
  private async lostTickets(operator: OperatorContext, orgId: Types.ObjectId) {
    const found = await this.tickets.findMany(
      operator,
      { orgId, status: TICKET_STATUS.investigating },
      { sort: { bookNo: 1, ticketNo: 1 } },
    );
    if (found.length === 0) {
      return [];
    }
    const [books, events, totals] = await Promise.all([
      this.books.findMany(operator, {
        _id: {
          $in: [...new Set(found.map((ticket) => String(ticket.bookId)))].map(
            (id) => new Types.ObjectId(id),
          ),
        },
      }),
      this.events.findMany(
        operator,
        {
          ticketId: { $in: found.map((ticket) => ticket._id) },
          type: TICKET_EVENT_TYPE.investigate,
        },
        { sort: { at: -1 } },
      ),
      this.tickets.aggregate(operator, [
        {
          $match: {
            orgId,
            bookId: { $in: found.map((ticket) => ticket.bookId) },
            status: { $ne: TICKET_STATUS.skipped },
          },
        },
        { $group: { _id: "$bookId", count: { $sum: 1 } } },
      ]),
    ]);
    const bookById = new Map(books.map((book) => [String(book._id), book]));
    const eventOf = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      if (!eventOf.has(String(event.ticketId))) {
        eventOf.set(String(event.ticketId), event);
      }
    }
    const totalOf = new Map(
      totals.map((row) => [String(row._id), Number(row.count)]),
    );
    return found.map((ticket) => {
      const event = eventOf.get(String(ticket._id));
      const refType = event?.refType ?? null;
      return {
        ticketId: String(ticket._id),
        bookId: String(ticket.bookId),
        gameCode: bookById.get(String(ticket.bookId))?.gameCode ?? "",
        bookNo: ticket.bookNo,
        ticketNo: ticket.ticketNo,
        bookTicketCount: totalOf.get(String(ticket.bookId)) ?? 0,
        since: event?.at ?? null,
        source:
          refType === "transfer" || refType === "stocktake" ? refType : null,
      };
    });
  }

  // ---- 看板頂部 ----

  async status(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryStocktakeStatusModel> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, orgIdText);
    const last = await this.stocktakes.findOne(
      operator,
      { orgId: store.orgId, status: { $ne: "rejected" } },
      { sort: { submittedAt: -1 } },
    );
    const lastAt = last?.submittedAt ?? null;
    const limit = STOCKTAKE_REMINDER_HOURS * 60 * 60 * 1000;
    return {
      lastSubmittedAt: lastAt,
      remind:
        lastAt === null ||
        this.clock.now().getTime() - lastAt.getTime() > limit,
    };
  }

  // ---- 盤點紀錄、檢視頁 ----

  async list(
    operator: OperatorContext,
    input: LotteryStocktakesInput,
  ): Promise<LotteryStocktakesPayload> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, input.orgId);
    const filter: Record<string, unknown> = { orgId: store.orgId };
    if (input.from != null || input.to != null) {
      filter.submittedAt = {
        ...(input.from == null ? {} : { $gte: input.from }),
        ...(input.to == null ? {} : { $lte: input.to }),
      };
    }
    if (
      input.type != null &&
      (STOCKTAKE_TYPES as readonly string[]).includes(input.type)
    ) {
      filter.type = input.type;
    }
    if (
      input.status != null &&
      (STOCKTAKE_STATUSES as readonly string[]).includes(input.status)
    ) {
      filter.status = input.status;
    }
    const limit = Math.min(Math.max(input.limit ?? 20, 1), LIST_LIMIT_MAX);
    const offset = Math.max(input.offset ?? 0, 0);
    const [records, total] = await Promise.all([
      this.stocktakes.findMany(operator, filter, {
        sort: { submittedAt: -1, _id: -1 },
        skip: offset,
        limit,
      }),
      this.stocktakes.count(operator, filter),
    ]);
    const serials = await this.serialsOf(operator, store.tenantId, records);
    const showCost = await this.showCost(operator);
    return {
      total,
      items: records.map((record): LotteryStocktakeListItemModel => ({
        id: String(record._id),
        submissionId: String(record.submissionId),
        serialNo: serials.get(String(record.submissionId)) ?? null,
        type: record.type,
        status: record.status,
        startedAt: record.startedAt,
        submittedAt: record.submittedAt,
        summary: summaryModelOf(record.summary, showCost),
      })),
    };
  }

  async detail(
    operator: OperatorContext,
    submissionIdText: string,
  ): Promise<LotteryStocktakeDetailModel> {
    await this.access.assertView(operator);
    const submissionId = parseId(submissionIdText);
    // 審核者(店長)可能從申請中心進來:讀得到這張申請 = 讀得到盤點單(以租戶邊界反查)
    const record =
      submissionId === null
        ? null
        : await this.readableStocktake(operator, submissionId);
    if (record === null) {
      throw notFoundError(`stocktake not found: ${submissionIdText}`);
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      record.tenantId,
    );
    const [org, points, names] = await Promise.all([
      this.orgs.findById(reader, record.orgId),
      this.support.cashPointsOf(reader, record.orgId),
      this.views.userNames(
        operator,
        record.tenantId,
        record.submittedBy === null ? [] : [record.submittedBy],
      ),
    ]);
    const pointName = (id: Types.ObjectId | null) =>
      id === null ? "" : (points.get(String(id))?.name ?? "");
    const showCost = await this.showCost(operator);
    return {
      id: String(record._id),
      submissionId: String(record.submissionId),
      type: record.type,
      status: record.status,
      orgId: String(record.orgId),
      orgName: org?.name ?? "",
      scopeCashPoint:
        record.scopeCashPointId === null
          ? null
          : {
              id: String(record.scopeCashPointId),
              name: pointName(record.scopeCashPointId),
            },
      startedAt: record.startedAt,
      submittedAt: record.submittedAt,
      submittedBy:
        record.submittedBy === null
          ? null
          : {
              id: String(record.submittedBy),
              name: names.get(String(record.submittedBy)) ?? "",
            },
      confirmedAt: record.confirmedAt,
      lines: record.lines.map((line) => ({
        bookId: String(line.bookId),
        cashPointId: String(line.cashPointId),
        cashPointName: pointName(line.cashPointId),
        gameCode: line.gameCode,
        gameName: line.gameName,
        bookNo: line.bookNo,
        method: line.method,
        countedAt: line.countedAt,
        systemCount: line.systemCount,
        presentCount: line.presentTicketNos.length,
        diffs: line.diffs.map((diff) => ({
          ticketNo: diff.ticketNo,
          kind: diff.kind,
          action: diff.action,
          postClose: diff.postClose,
          amount: diff.amount,
        })),
      })),
      unopened: record.unopenedLines.map((line) => ({
        gameCode: line.gameCode,
        gameName: line.gameName,
        bookNo: line.bookNo,
        ticketCount: line.ticketCount,
        present: line.present,
      })),
      lostReview: record.lostReviewLines.map((line) => ({
        label: line.label,
        action: line.action,
        reasonLabel: line.reasonLabel,
        reasonNote: line.reasonNote,
      })),
      uncountedBooks: uncountedBooksOf(record).map((book) => ({
        bookId: String(book.bookId),
        cashPointId: String(book.cashPointId),
        cashPointName: pointName(book.cashPointId),
        gameCode: book.gameCode,
        gameName: book.gameName,
        bookNo: book.bookNo,
      })),
      summary: summaryModelOf(record.summary, showCost),
      draft: draftOfStocktake(record),
    };
  }

  /** 盤點單:操作者看得到那家店,或讀得到那張申請(審核者從申請中心進來)。 */
  private async readableStocktake(
    operator: OperatorContext,
    submissionId: Types.ObjectId,
  ): Promise<StocktakeRecord | null> {
    const own = await this.stocktakes.findOne(operator, { submissionId });
    if (own !== null) {
      return own;
    }
    const facts = await this.formAccess.factsOf(operator);
    const submission = await this.readAccess.findInTenant(facts, submissionId);
    if (submission === null) {
      return null;
    }
    const readable = await this.readAccess.readableRevisions(facts, submission);
    if (readable.kind === "none") {
      return null;
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      submission.tenantId,
    );
    return this.stocktakes.findOne(reader, { submissionId });
  }

  private async serialsOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    records: readonly StocktakeRecord[],
  ): Promise<Map<string, string>> {
    if (records.length === 0) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const found = await this.submissions.findMany(
      reader,
      { _id: { $in: records.map((record) => record.submissionId) } },
      { select: "serialNo" },
    );
    return new Map(
      found.flatMap((row) =>
        typeof row.serialNo === "string"
          ? [[String(row._id), row.serialNo] as const]
          : [],
      ),
    );
  }

  private async showCost(operator: OperatorContext): Promise<boolean> {
    const grant = await this.access.grantOf(operator);
    return grant.has(INVENTORY_PERMISSIONS.showCost);
  }
}
