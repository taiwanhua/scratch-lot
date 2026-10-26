import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  INVENTORY_BOOK_FILTER_STATES,
  INVENTORY_PERMISSIONS,
  type InventoryBookFilterState,
  TICKET_EVENT_TYPE,
  TICKET_STATUS,
  type TicketEventType,
  bookDisplayStateOf,
  holdingsOf,
  holdingsWithoutPendingSkips,
  normalizeBookNo,
  remainingOfCounts,
  requiredSkipCountOf,
  totalOfCounts,
} from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  type LotteryBookDocument,
  LotteryBooksRepository,
  type LotteryTicketDocument,
  type LotteryTicketEventDocument,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import type { TicketStateSnapshot } from "../../database/lottery-inventory/lottery-ticket-event.schema";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { parseId } from "../accounts/accounts-util";
import { daysSince, localDayOf } from "../dealers/dealer-dates";
import { tenantOfOperator } from "../master-data-tenant";
import { countsOfBook, pendingSkipCountOfBook } from "../tickets/books.service";
import { notFoundError } from "../tickets/inventory-error";
import { bookStateConditionsOf } from "./book-state-filter";
import {
  INVENTORY_BOOKS_MAX_PAGE_SIZE,
  INVENTORY_BOOKS_PAGE_SIZE,
  type LotteryInventoryBooksInput,
  type LotteryTicketLookupInput,
} from "./dto/lottery-inventory.input";
import { InventoryAccess } from "./inventory-access";
import { InventoryNames } from "./inventory-names";
import type {
  LotteryInventoryBookDetailModel,
  LotteryInventoryBookModel,
  LotteryInventoryBooksPayload,
  LotteryInventoryEventModel,
  LotteryInventoryLocationModel,
  LotteryInventoryPlaceModel,
  LotteryInventoryRefModel,
  LotteryInventorySourceModel,
  LotteryInventoryTicketModel,
  LotteryInvestigationRowModel,
  LotteryInvestigationsPayload,
  LotteryTicketLookupItemModel,
} from "./models/lottery-inventory.model";

type BookRecord = Persisted<LotteryBookDocument>;
type TicketRecord = Persisted<LotteryTicketDocument>;
type EventRecord = Persisted<LotteryTicketEventDocument>;

/** 售出(撤銷要找的原售出):刷條碼 / 手動 / 快速銷售、盤點補登。 */
const SALE_EVENT_TYPES: ReadonlySet<string> = new Set([
  TICKET_EVENT_TYPE.sale,
  TICKET_EVENT_TYPE.saleStocktake,
]);

/** 待查 / 遺失。 */
const MISSING_STATUSES = [TICKET_STATUS.investigating, TICKET_STATUS.lost];

/** 來源事件:進貨、調入。 */
const SOURCE_EVENT_TYPES: ReadonlySet<TicketEventType> = new Set([
  TICKET_EVENT_TYPE.purchase,
  TICKET_EVENT_TYPE.transferIn,
]);

const ref = (
  id: Types.ObjectId | null | undefined,
  names: ReadonlyMap<string, string>,
): LotteryInventoryRefModel | null =>
  id == null ? null : { id: String(id), name: names.get(String(id)) ?? "" };

const mustRef = (
  id: Types.ObjectId,
  names: ReadonlyMap<string, string>,
): LotteryInventoryRefModel => ({
  id: String(id),
  name: names.get(String(id)) ?? "",
});

const isFilterState = (value: string): value is InventoryBookFilterState =>
  (INVENTORY_BOOK_FILTER_STATES as readonly string[]).includes(value);

const byTicketNo = (a: string, b: string): number => a.localeCompare(b);

/** 時間軸合併同一列用的地方 key。 */
const placeKey = (place: TicketStateSnapshot | null): string =>
  place === null
    ? "-"
    : `${String(place.orgId)}|${place.locationKind}|${String(place.cashPointId)}`;

/** 名稱對照(一次查完)。 */
interface Names {
  orgs: ReadonlyMap<string, string>;
  users: ReadonlyMap<string, string>;
  cashPoints: ReadonlyMap<string, string>;
  serials: ReadonlyMap<string, string>;
}

/**
 * 庫存管理的讀取(專案規格 7.3、7.4;正本 `docs/modules/project/inventory.md`):
 * 庫存分頁、本的詳情、查刮刮樂、待查·遺失分頁。讀取看模組有沒有綁(`InventoryAccess.assertModule`)。
 *
 * - **本**照操作者自己的範圍讀(讀取放行:所在分店或持有任何一張的分店看得到,資料共用 `holderOrgIds`)
 * - 讀得到本,就以租戶邊界上下文讀這本全部的張與事件(格子、時間軸要看整本;反查)
 */
@Injectable()
export class InventoryViewService {
  constructor(
    private readonly books: LotteryBooksRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly games: LotteryGamesRepository,
    private readonly orgs: OrgsRepository,
    private readonly names: InventoryNames,
    private readonly access: InventoryAccess,
  ) {}

  // ---- 庫存分頁 ----

  async listBooks(
    operator: OperatorContext,
    input: LotteryInventoryBooksInput,
  ): Promise<LotteryInventoryBooksPayload> {
    await this.access.assertModule(operator);
    const filter: Record<string, unknown> = { status: "normal" };
    const orgId = parseId(input.orgId);
    if (input.orgId != null) {
      if (orgId === null || !isOrgVisible(operator, orgId)) {
        throw notFoundError("分店不存在");
      }
      const tenantOrgs = await this.names.tenantOrgs(operator);
      const subtree = tenantOrgs
        .filter(
          (org) =>
            org.id.equals(orgId) ||
            org.ancestors.some((ancestor) => ancestor.equals(orgId)),
        )
        .map((org) => org.id);
      filter.holderOrgIds = { $in: subtree.length === 0 ? [orgId] : subtree };
    }
    const gameId = parseId(input.gameId);
    if (input.gameId != null) {
      filter.gameId = gameId;
    }
    const purchased = {
      ...(input.purchasedFrom == null ? {} : { $gte: input.purchasedFrom }),
      ...(input.purchasedTo == null ? {} : { $lt: input.purchasedTo }),
    };
    if (Object.keys(purchased).length > 0) {
      filter.purchasedAt = purchased;
    }
    const bookNo = input.bookNo?.trim() ?? "";
    if (bookNo !== "") {
      // 6 位補 0 後完整比對;其他長度當部分比對(只收數字)
      const normalized = normalizeBookNo(bookNo);
      filter.bookNo = normalized ?? {
        $regex: bookNo.replaceAll(/\D/g, "") || "^$",
      };
    }
    // 狀態以本上的張數欄位在資料庫篩(和 `bookDisplayStateOf` 同一套判斷),篩完再分頁
    const state = input.state ?? "";
    const where =
      state !== "" && isFilterState(state)
        ? { $and: [filter, ...bookStateConditionsOf(state)] }
        : filter;
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      INVENTORY_BOOKS_MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? INVENTORY_BOOKS_PAGE_SIZE),
    );
    const [records, totalCount] = await Promise.all([
      this.books.findMany(operator, where, {
        sort: { purchasedAt: -1, bookKey: 1 },
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }),
      this.books.count(operator, where),
    ]);
    const items = await this.toBookModels(operator, records);
    return { items, totalCount, page, pageSize };
  }

  // ---- 本的詳情 ----

  async bookDetail(
    operator: OperatorContext,
    id: string,
  ): Promise<LotteryInventoryBookDetailModel> {
    const grant = await this.access.assertModule(operator);
    const record = await this.mustBook(operator, id);
    const whole = await this.wholeBookReader(operator, record);
    const [tickets, events] = await Promise.all([
      this.tickets.findMany(whole, { bookId: record._id }),
      this.events.findMany(
        whole,
        { bookId: record._id },
        { sort: { at: -1, _id: -1 } },
      ),
    ]);
    const sortedTickets = tickets.toSorted((a, b) =>
      byTicketNo(a.ticketNo, b.ticketNo),
    );
    const [names, corrections] = await Promise.all([
      this.namesOf(operator, sortedTickets, events),
      this.correctionsOf(whole, events),
    ]);
    const [book] = await this.toBookModels(operator, [record], tickets);
    if (!book) {
      throw notFoundError("本不存在");
    }
    const usable = sortedTickets.filter(
      (ticket) => ticket.status !== TICKET_STATUS.skipped,
    );
    // 能不能操作某一張 = 它的所在分店在操作者的可見範圍內(別店的張只能看)
    const operable = (ticket: TicketRecord) =>
      isOrgVisible(operator, ticket.orgId);
    // 更正跳號要至少一張自己範圍內的跳號可以取消、一張自己範圍內的未售(未鎖定)可以改標
    const canCorrectSkips =
      sortedTickets.some(
        (ticket) => ticket.status === TICKET_STATUS.skipped && operable(ticket),
      ) &&
      sortedTickets.some(
        (ticket) =>
          ticket.status === TICKET_STATUS.unsold &&
          ticket.lockedBy === null &&
          operable(ticket),
      );
    const ticketNos = new Map(
      sortedTickets.map((ticket) => [String(ticket._id), ticket.ticketNo]),
    );
    return {
      book,
      tickets: sortedTickets.map((ticket) =>
        this.ticketModel(operator, ticket, names),
      ),
      locations: this.locationsOf(sortedTickets, names),
      events: this.timelineOf(
        events,
        ticketNos,
        names,
        corrections,
        record.firstOpenedAt ?? null,
      ),
      sources: this.sourcesOf(events, ticketNos, names),
      cost: grant.canShowCost
        ? {
            rate: record.rate,
            cost: record.cost,
            unitCost: record.cost / record.standardTickets,
          }
        : null,
      investigation: this.investigationOf(usable, events, names),
      abilities: {
        canCorrectSkips:
          grant.has(INVENTORY_PERMISSIONS.markSkipped) && canCorrectSkips,
        // 拆本時沒標的待標註(只尋回幾張就上檯面…)之後在這裡補標
        canMarkSkips:
          grant.has(INVENTORY_PERMISSIONS.markSkipped) &&
          pendingSkipCountOfBook(record) > 0 &&
          sortedTickets.some(
            (ticket) =>
              ticket.status === TICKET_STATUS.unsold &&
              ticket.lockedBy === null &&
              operable(ticket),
          ),
        canRecover: grant.has(INVENTORY_PERMISSIONS.recover),
        canScrap: grant.has(INVENTORY_PERMISSIONS.scrap),
        canShowCost: grant.canShowCost,
      },
    };
  }

  // ---- 查刮刮樂 ----

  async lookup(
    operator: OperatorContext,
    input: LotteryTicketLookupInput,
  ): Promise<LotteryTicketLookupItemModel[]> {
    await this.access.assertModule(operator);
    const bookNo = normalizeBookNo(input.bookNo);
    if (bookNo === null || !/^\d{3}$/.test(input.ticketNo)) {
      return [];
    }
    const gameCode = input.gameCode?.trim() ?? "";
    const records = await this.books.findMany(operator, {
      bookNo,
      ...(gameCode === "" ? {} : { gameCode }),
    });
    const items: LotteryTicketLookupItemModel[] = [];
    for (const record of records) {
      const whole = await this.wholeBookReader(operator, record);
      const ticket = await this.tickets.findOne(whole, {
        bookId: record._id,
        ticketNo: input.ticketNo,
      });
      if (!ticket) {
        continue;
      }
      const game = await this.games.findById(operator, record.gameId);
      const orgNames = await this.names.orgNames(operator, [
        ticket.orgId,
        ticket.responsibleOrgId,
      ]);
      items.push({
        bookId: String(record._id),
        bookNo: record.bookNo,
        gameCode: record.gameCode,
        gameName: game?.name ?? "",
        unitPrice: game?.unitPrice ?? 0,
        ticketId: String(ticket._id),
        ticketNo: ticket.ticketNo,
        status: ticket.status,
        version: ticket.version,
        org: mustRef(ticket.orgId, orgNames),
        responsibleOrg: ref(ticket.responsibleOrgId, orgNames),
      });
    }
    return items;
  }

  // ---- 待查·遺失 ----

  async investigations(
    operator: OperatorContext,
  ): Promise<LotteryInvestigationsPayload> {
    const grant = await this.access.assertModule(operator);
    // 張照可見範圍:分店的人看到自己店的;責任分店另外列在列上
    const missing = await this.tickets.findMany(operator, {
      status: { $in: MISSING_STATUSES },
    });
    if (missing.length === 0) {
      return {
        items: [],
        canRecover: grant.has(INVENTORY_PERMISSIONS.recover),
      };
    }
    const bookIds = [
      ...new Set(missing.map((ticket) => String(ticket.bookId))),
    ];
    const [bookRecords, events] = await Promise.all([
      this.books.findMany(operator, {
        _id: { $in: missing.map((ticket) => ticket.bookId) },
      }),
      this.events.findMany(
        operator,
        {
          ticketId: { $in: missing.map((ticket) => ticket._id) },
          type: {
            $in: [TICKET_EVENT_TYPE.investigate, TICKET_EVENT_TYPE.lose],
          },
        },
        { sort: { at: -1, _id: -1 } },
      ),
    ]);
    const games = await this.games.findMany(operator, {
      _id: { $in: bookRecords.map((book) => book.gameId) },
    });
    const gameOf = new Map(games.map((game) => [String(game._id), game]));
    const bookOf = new Map(bookRecords.map((book) => [String(book._id), book]));
    const names = await this.namesOf(operator, missing, events);
    // 天數:租戶時區的日曆天差(同經銷商的距今天數;日期只有一種做法)
    const timezone = await tenantTimezoneOf(
      this.orgs,
      operator,
      tenantOfOperator(operator)?.tenantId ?? null,
    );
    const today = localDayOf(new Date(), timezone);
    const rows: LotteryInvestigationRowModel[] = [];
    for (const bookId of bookIds) {
      const book = bookOf.get(bookId);
      // 還沒標的跳號在還沒處理的那一組(先待查、再遺失),一本只扣一次
      let pendingLeft = book === undefined ? 0 : pendingSkipCountOfBook(book);
      for (const status of MISSING_STATUSES) {
        const tickets = missing
          .filter(
            (ticket) =>
              String(ticket.bookId) === bookId && ticket.status === status,
          )
          .toSorted((a, b) => byTicketNo(a.ticketNo, b.ticketNo));
        const [first] = tickets;
        if (!first) {
          continue;
        }
        const ticketIds = new Set(tickets.map((ticket) => String(ticket._id)));
        // 待標註的跳號實體不存在,張數與成本都不算(還有待標註就扣;使用者 10/27 定案)
        const figures = withoutPendingSkipFigures(tickets, pendingLeft);
        pendingLeft -= tickets.length - figures.tickets;
        const latest = events.find((event) =>
          ticketIds.has(String(event.ticketId)),
        );
        rows.push({
          bookId,
          bookNo: book?.bookNo ?? first.bookNo,
          gameCode: book?.gameCode ?? "",
          gameName: gameOf.get(String(first.gameId))?.name ?? "",
          unitPrice: gameOf.get(String(first.gameId))?.unitPrice ?? 0,
          status,
          responsibleOrg: ref(first.responsibleOrgId, names.orgs),
          refType: latest?.refType ?? null,
          refSerialNo:
            latest?.refId == null
              ? null
              : (names.serials.get(String(latest.refId)) ?? null),
          at: latest?.at ?? null,
          days: daysSince(latest?.at ?? null, today, timezone),
          cost: grant.canShowCost ? Math.round(figures.cost) : null,
          ticketCount: figures.tickets,
          tickets: tickets.map((ticket) =>
            this.ticketModel(operator, ticket, names),
          ),
        });
      }
    }
    return {
      items: rows.toSorted(
        (a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0),
      ),
      canRecover: grant.has(INVENTORY_PERMISSIONS.recover),
    };
  }

  // ---- 內部 ----

  /** 讀得到這本(操作者自己的範圍 + 資料共用)才回;否則 `NOT_FOUND`。 */
  async mustBook(operator: OperatorContext, id: string): Promise<BookRecord> {
    const bookId = parseId(id);
    const record =
      bookId === null ? null : await this.books.findById(operator, bookId);
    if (!record?.tenantId) {
      throw notFoundError("本不存在");
    }
    return record;
  }

  /** 讀這本全部的張與事件用:這本所在租戶的邊界上下文(反查)。 */
  wholeBookReader(
    operator: OperatorContext,
    record: BookRecord,
  ): Promise<OperatorContext> {
    return tenantBoundaryContext(this.orgs, operator, record.tenantId);
  }

  private async toBookModels(
    operator: OperatorContext,
    records: readonly BookRecord[],
    knownTickets?: readonly TicketRecord[],
  ): Promise<LotteryInventoryBookModel[]> {
    if (records.length === 0) {
      return [];
    }
    const snapshotsOf = new Map<
      string,
      {
        status: TicketRecord["status"];
        locationKind: TicketRecord["location"]["kind"];
        storeOrgId: string;
      }[]
    >();
    const tickets =
      knownTickets?.filter(
        (ticket) => ticket.status === TICKET_STATUS.unsold,
      ) ?? (await this.unsoldTicketsOfBooks(operator, records));
    for (const ticket of tickets) {
      const key = String(ticket.bookId);
      const list = snapshotsOf.get(key) ?? [];
      list.push({
        status: ticket.status,
        locationKind: ticket.location.kind,
        storeOrgId: String(ticket.orgId),
      });
      snapshotsOf.set(key, list);
    }
    const [games, orgNames, dealerNames] = await Promise.all([
      this.games.findMany(operator, {
        _id: { $in: records.map((record) => record.gameId) },
      }),
      this.names.orgNames(operator, [
        ...records.map((record) => record.orgId),
        ...tickets.map((ticket) => ticket.orgId),
      ]),
      this.names.dealerNames(
        operator,
        records.map((record) => record.purchaseDealerId),
      ),
    ]);
    const gameOf = new Map(games.map((game) => [String(game._id), game]));
    return records.map((record) => {
      const snapshots = snapshotsOf.get(String(record._id)) ?? [];
      const game = gameOf.get(String(record.gameId));
      const lastTicketNo = Number(record.lastTicketNo);
      const pendingSkipCount = pendingSkipCountOfBook(record);
      const counts = countsOfBook(record);
      // 所在分店只算未售的張;待標註的跳號(拆本前還沒標的)不算持有與總張數(使用者 10/27 定案甲)
      const holdings = [
        ...holdingsWithoutPendingSkips(
          holdingsOf(snapshots),
          counts,
          pendingSkipCount,
        ),
      ]
        .map(([orgId, count]) => ({
          org: { id: orgId, name: orgNames.get(orgId) ?? "" },
          count,
        }))
        .toSorted((a, b) => b.count - a.count);
      return {
        id: String(record._id),
        bookKey: record.bookKey,
        bookNo: record.bookNo,
        gameId: String(record.gameId),
        gameCode: record.gameCode,
        gameName: game?.name ?? "",
        unitPrice: game?.unitPrice ?? 0,
        standardTickets: record.standardTickets,
        firstTicketNo: record.firstTicketNo,
        lastTicketNo: record.lastTicketNo,
        org: mustRef(record.orgId, orgNames),
        holdings,
        remainingCount: remainingOfCounts(counts, pendingSkipCount),
        totalCount: totalOfCounts(counts, pendingSkipCount),
        pendingSkipCount,
        requiredSkipCount: requiredSkipCountOf(
          lastTicketNo,
          record.standardTickets,
        ),
        skippedTicketNos: record.skippedTicketNos,
        state: bookDisplayStateOf({
          counts,
          firstOpenedAt: record.firstOpenedAt,
          revoked: record.status === "revoked",
        }),
        status: record.status,
        purchasedAt: record.purchasedAt,
        purchaseDealer: ref(record.purchaseDealerId, dealerNames),
      };
    });
  }

  /** 一批本的未售張(所在分店用;每本以它所在租戶的邊界上下文讀;同一租戶只建一次)。 */
  private async unsoldTicketsOfBooks(
    operator: OperatorContext,
    records: readonly BookRecord[],
  ): Promise<TicketRecord[]> {
    const byTenant = new Map<string, BookRecord[]>();
    for (const record of records) {
      const key = String(record.tenantId);
      byTenant.set(key, [...(byTenant.get(key) ?? []), record]);
    }
    const result: TicketRecord[] = [];
    for (const group of byTenant.values()) {
      const [first] = group;
      if (!first) {
        continue;
      }
      const whole = await this.wholeBookReader(operator, first);
      const found = await this.tickets.findMany(
        whole,
        {
          bookId: { $in: group.map((record) => record._id) },
          status: TICKET_STATUS.unsold,
        },
        { select: "bookId status location orgId" },
      );
      result.push(...found);
    }
    return result;
  }

  private async namesOf(
    operator: OperatorContext,
    tickets: readonly TicketRecord[],
    events: readonly EventRecord[],
  ): Promise<Names> {
    const places = events.flatMap((event) => [event.from, event.to]);
    const [orgs, users, cashPoints, serials] = await Promise.all([
      this.names.orgNames(operator, [
        ...tickets.flatMap((ticket) => [ticket.orgId, ticket.responsibleOrgId]),
        ...places.map((place) => place?.orgId),
      ]),
      this.names.userNames(
        operator,
        events.map((event) => event.by),
      ),
      this.names.cashPointNames(operator, [
        ...tickets.map((ticket) => ticket.location.cashPointId),
        ...places.map((place) => place?.cashPointId),
      ]),
      this.names.serialNos(
        operator,
        events.map((event) => event.refId),
      ),
    ]);
    return { orgs, users, cashPoints, serials };
  }

  private ticketModel(
    operator: OperatorContext,
    ticket: TicketRecord,
    names: Names,
  ): LotteryInventoryTicketModel {
    return {
      id: String(ticket._id),
      ticketNo: ticket.ticketNo,
      status: ticket.status,
      locationKind: ticket.location.kind,
      cashPoint: ref(ticket.location.cashPointId, names.cashPoints),
      org: mustRef(ticket.orgId, names.orgs),
      responsibleOrg: ref(ticket.responsibleOrgId, names.orgs),
      locked: ticket.lockedBy !== null,
      operable: isOrgVisible(operator, ticket.orgId),
      version: ticket.version,
    };
  }

  private placeOf(
    snapshot: TicketStateSnapshot,
    names: Names,
  ): LotteryInventoryPlaceModel {
    return {
      org: mustRef(snapshot.orgId, names.orgs),
      locationKind: snapshot.locationKind,
      cashPoint: ref(snapshot.cashPointId, names.cashPoints),
    };
  }

  /** 未售的張依「分店 + 位置 + 收銀點」分組(「所在」卡)。 */
  private locationsOf(
    tickets: readonly TicketRecord[],
    names: Names,
  ): LotteryInventoryLocationModel[] {
    const groups = new Map<string, LotteryInventoryLocationModel>();
    for (const ticket of tickets) {
      if (ticket.status !== TICKET_STATUS.unsold) {
        continue;
      }
      const key = `${String(ticket.orgId)}|${ticket.location.kind}|${String(ticket.location.cashPointId)}`;
      const group = groups.get(key) ?? {
        place: this.placeOf(
          {
            orgId: ticket.orgId,
            status: ticket.status,
            locationKind: ticket.location.kind,
            cashPointId: ticket.location.cashPointId,
          },
          names,
        ),
        ticketNos: [],
      };
      group.ticketNos.push(ticket.ticketNo);
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  /**
   * 事件時間軸:同一時間、類型、人、單據、原因、從 → 到的張合成一列(新的在上)。
   */
  private timelineOf(
    events: readonly EventRecord[],
    ticketNos: ReadonlyMap<string, string>,
    names: Names,
    corrections: ReadonlyMap<string, string>,
    firstOpenedAt: Date | null,
  ): LotteryInventoryEventModel[] {
    const rows = new Map<string, { event: EventRecord; ticketNos: string[] }>();
    const ticketNoOf = (event: EventRecord) =>
      ticketNos.get(String(event.ticketId)) ?? "";
    for (const event of events) {
      const key = [
        event.at.getTime(),
        event.type,
        String(event.by),
        String(event.refId),
        event.reasonKey ?? "",
        placeKey(event.from),
        placeKey(event.to),
        corrections.get(String(event._id)) ?? "",
      ].join("~");
      const row = rows.get(key) ?? { event, ticketNos: [] };
      row.ticketNos.push(ticketNoOf(event));
      rows.set(key, row);
    }
    return [...rows.values()].map(({ event, ticketNos: rowTicketNos }) => ({
      at: event.at,
      type: event.type,
      reopen:
        event.type === TICKET_EVENT_TYPE.open &&
        firstOpenedAt !== null &&
        event.at.getTime() > firstOpenedAt.getTime(),
      ticketNos: rowTicketNos.toSorted(byTicketNo),
      wholeBook: rowTicketNos.length === ticketNos.size,
      from: event.from === null ? null : this.placeOf(event.from, names),
      to: this.placeOf(event.to, names),
      by: ref(event.by, names.users),
      refType: event.refType,
      refId: event.refId === null ? null : String(event.refId),
      refSerialNo:
        event.refId === null
          ? null
          : (names.serials.get(String(event.refId)) ?? null),
      reasonKey: event.reasonKey,
      reasonNote: event.reasonNote,
      correctionOfShift: corrections.get(String(event._id)) ?? null,
    }));
  }

  /**
   * 跨班更正「前期更正,屬於 X 班」(規格 6.12、10.4;使用者 10/08 定案,同即時現金帳的 `correctionOfShift`):
   * 撤銷(當下撤銷、撤銷售出申請完成)和它撤銷的原售出不在同一班 → 原售出那一班;盤點補登的事後更正 → `postCloseOf`
   * 指向的班。讀取時算出(事件 id → 班次的顯示名稱),不另存欄位;同一本的事件都已讀進來,原售出從裡面找。
   */
  private async correctionsOf(
    reader: OperatorContext,
    events: readonly EventRecord[],
  ): Promise<Map<string, string>> {
    const shiftOf = new Map<string, Types.ObjectId>();
    const chronological = events.toReversed();
    const lastSale = new Map<string, EventRecord>();
    for (const event of chronological) {
      const ticketKey = String(event.ticketId);
      if (SALE_EVENT_TYPES.has(event.type)) {
        lastSale.set(ticketKey, event);
      }
      if (event.postCloseOf !== null) {
        shiftOf.set(String(event._id), event.postCloseOf);
        continue;
      }
      if (event.type === TICKET_EVENT_TYPE.saleUndo) {
        const originalShift = lastSale.get(ticketKey)?.shiftId ?? null;
        if (
          originalShift !== null &&
          event.shiftId?.equals(originalShift) !== true
        ) {
          shiftOf.set(String(event._id), originalShift);
        }
      }
    }
    if (shiftOf.size === 0) {
      return new Map();
    }
    const shifts = await this.shifts.findMany(
      reader,
      { _id: { $in: [...shiftOf.values()] } },
      { select: "label" },
    );
    const labelOf = new Map(
      shifts.map((shift) => [String(shift._id), shift.label]),
    );
    return new Map(
      [...shiftOf.entries()].map(([eventId, shiftId]) => [
        eventId,
        labelOf.get(String(shiftId)) ?? "",
      ]),
    );
  }

  /** 來源:進貨與調入的單據(依單據合併,舊的在上)。 */
  private sourcesOf(
    events: readonly EventRecord[],
    ticketNos: ReadonlyMap<string, string>,
    names: Names,
  ): LotteryInventorySourceModel[] {
    const sources = new Map<string, LotteryInventorySourceModel>();
    for (const event of events.toReversed()) {
      if (!SOURCE_EVENT_TYPES.has(event.type)) {
        continue;
      }
      const key = `${event.type}|${String(event.refId)}`;
      const source = sources.get(key) ?? {
        type: event.type,
        refId: event.refId === null ? null : String(event.refId),
        refSerialNo:
          event.refId === null
            ? null
            : (names.serials.get(String(event.refId)) ?? null),
        at: event.at,
        ticketNos: [],
      };
      source.ticketNos.push(ticketNos.get(String(event.ticketId)) ?? "");
      sources.set(key, source);
    }
    return [...sources.values()];
  }

  /**
   * 這本沒有未售、而且有待查或遺失的張 → 狀態列(最近一筆待查 / 遺失事件的時間、單據、責任分店;使用者 10/27
   * 定案:例如賣 10 張、其餘 90 張待查也出現)。[整本尋回] 只算待查 / 遺失的張。
   */
  private investigationOf(
    usable: readonly TicketRecord[],
    events: readonly EventRecord[],
    names: Names,
  ): LotteryInventoryBookDetailModel["investigation"] {
    const first = usable.find((ticket) =>
      (MISSING_STATUSES as readonly string[]).includes(ticket.status),
    );
    if (
      !first ||
      usable.some((ticket) => ticket.status === TICKET_STATUS.unsold)
    ) {
      return null;
    }
    const latest = events.find(
      (event) =>
        event.type === TICKET_EVENT_TYPE.investigate ||
        event.type === TICKET_EVENT_TYPE.lose,
    );
    const status = usable.some(
      (ticket) => ticket.status === TICKET_STATUS.investigating,
    )
      ? TICKET_STATUS.investigating
      : TICKET_STATUS.lost;
    return {
      status,
      at: latest?.at ?? null,
      refType: latest?.refType ?? null,
      refSerialNo:
        latest?.refId == null
          ? null
          : (names.serials.get(String(latest.refId)) ?? null),
      responsibleOrg: ref(first.responsibleOrgId, names.orgs),
    };
  }
}

/**
 * 待查·遺失一列的張數與成本:扣掉還沒標的跳號(實體不存在;不超過這一列的張數),成本扣同樣張數 ×
 * 這一列的平均單張成本。
 */
function withoutPendingSkipFigures(
  tickets: readonly { unitCost: number }[],
  pendingSkipCount: number,
): { tickets: number; cost: number } {
  const total = tickets.reduce((sum, ticket) => sum + ticket.unitCost, 0);
  const deducted = Math.min(pendingSkipCount, tickets.length);
  if (deducted <= 0) {
    return { tickets: tickets.length, cost: total };
  }
  const count = tickets.length - deducted;
  return { tickets: count, cost: (total * count) / tickets.length };
}
