import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { type ClientSession, Types } from "mongoose";

import {
  INVENTORY_PERMISSIONS,
  OPENING_REF_TYPE,
  PURCHASE_FORM_KEY,
  PURCHASE_MODULE_KEY,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  bookKeyOf,
  displayBookNo,
  isOpeningSold,
  normalizeBookNo,
  openingPlanProblemOf,
  parseTicketInput,
  purchaseAmountOf,
  purchaseLinesOf,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import { GAME_STATUS } from "@repo/domain/project/lottery-master-data";
import { LOTTERY_SETTINGS_PERMISSIONS } from "@repo/domain/project/lottery-settings";

import { AuditService } from "../../../../audit/audit.service";
import { authError } from "../../../../auth/auth-error";
import type { Persisted } from "../../../../database/base.repository";
import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../../database/operator-context";
import { tenantBoundaryContext } from "../../../../database/tenant-boundary-context";
import { TransactionService } from "../../../../database/transaction";
import { FieldOptionsService } from "../../../../fields/field-options.service";
import { LotteryGamesRepository } from "../../../database/lottery-games/lottery-games.repository";
import {
  LotteryBooksRepository,
  type LotteryStoreOpeningDocument,
  LotteryStoreOpeningsRepository,
  LotteryTicketsRepository,
} from "../../../database/lottery-inventory/lottery-inventory.repository";
import type { StoreOpeningHistoryEntry } from "../../../database/lottery-inventory/lottery-store-opening.schema";
import { LOTTERY_FIELD_CATEGORIES } from "../../field-options/lottery-field-options";
import { tenantOfOperator } from "../../master-data-tenant";
import { PURCHASE_OPEN_STATUSES } from "../../purchase/purchase-rules.service";
import { StoreSalesSupport } from "../../store/store-sales-support";
import { LotteryBooksService } from "../../tickets/books.service";
import {
  INVENTORY_REASONS,
  notFoundError,
  ticketConflictError,
  validationError,
} from "../../tickets/inventory-error";
import { TicketLedgerService } from "../../tickets/ticket-ledger.service";
import { InventoryAccess } from "../inventory-access";
import { InventoryNames } from "../inventory-names";
import { isStoreOrg } from "../store-orgs";
import {
  type CreateLotteryOpeningBookInput,
  type FixLotteryOpeningTicketsInput,
  type LotteryOpeningScanInput,
  OPENING_FIX_DIRECTIONS,
  type OpeningFixDirection,
  type ReopenLotteryStoreOpeningInput,
} from "./opening.input";
import type {
  LotteryOpeningBookModel,
  LotteryOpeningBookPayload,
  LotteryOpeningScanCandidateModel,
  LotteryOpeningScanPayload,
  LotteryStoreOpeningModel,
} from "./opening.model";

type OpeningRecord = Persisted<LotteryStoreOpeningDocument>;

/** 分店(操作者看得到的、沒有下層組織的組織)。 */
interface OpeningStore {
  orgId: Types.ObjectId;
  name: string;
  tenantId: Types.ObjectId;
}

function storeClosedError(): GraphQLError {
  return new GraphQLError("這家店的期初建檔已結束", {
    extensions: {
      code: "VALIDATION_FAILED",
      reason: INVENTORY_REASONS.storeOpeningClosed,
      fields: ["orgId"],
    },
  });
}

function conflictError(): GraphQLError {
  return new GraphQLError("期初建檔狀態已被別人改過,請重新整理", {
    extensions: {
      code: "CONFLICT",
      reason: INVENTORY_REASONS.storeOpeningStateMismatch,
    },
  });
}

/** 刷到的本能不能建:已在系統裡 / 在有效的進貨單上 / 可以建(null)。 */
function blockOf(bookId: string | null, serialNo: string | null) {
  if (bookId !== null) {
    return "exists";
  }
  return serialNo === null ? null : "on_purchase";
}

const parseObjectId = (text: string | null | undefined) =>
  typeof text === "string" && Types.ObjectId.isValid(text)
    ? new Types.ObjectId(text)
    : null;

/**
 * 期初建檔(期初建檔規格第 2–4、6 節;正本 `docs/modules/project/inventory.md`「期初建檔」):
 *
 * - `storeOpening`:一家分店的期初建檔狀態、歷程、已建檔的本(建檔頁、刮刮樂設定那一列共用)
 * - `scan`:刷到一張 → 這本是哪款遊戲、能不能建(只讀)
 * - `create`:建一本(`LotteryBooksService.createBook` 的期初建檔模式;一本一個交易)
 * - `voidBook`:作廢一本(E4:只限只有期初建檔事件的本;寫「期初建檔作廢」、本改已撤銷再軟刪除釋出本號)
 * - `close` / `reopen`:期初建檔結束 / 重新開放(D10、E1)
 *
 * 建檔、作廢在同一個交易讀分店那一筆並 `$inc version`:和「結束」一定有先後,結束後一律 `STORE_OPENING_CLOSED`。
 * 權限由 resolver 守(`inventory.opening`、`lottery-settings.edit-org`);看不到的分店 → `FORBIDDEN`。
 */
@Injectable()
export class InventoryOpeningService {
  constructor(
    private readonly openings: LotteryStoreOpeningsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly games: LotteryGamesRepository,
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly bookService: LotteryBooksService,
    private readonly ledger: TicketLedgerService,
    private readonly support: StoreSalesSupport,
    private readonly access: InventoryAccess,
    private readonly names: InventoryNames,
    private readonly transactions: TransactionService,
    private readonly audit: AuditService,
    private readonly fieldOptions: FieldOptionsService,
  ) {}

  // ---- 讀取 ----

  /** 一家分店的期初建檔狀態;要有 `inventory.opening` 或 `lottery-settings.edit-org`。 */
  async storeOpening(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryStoreOpeningModel> {
    const grant = await this.access.grantOf(operator);
    const canOpenGrant = grant.has(INVENTORY_PERMISSIONS.opening);
    const canClose = grant.has(LOTTERY_SETTINGS_PERMISSIONS.editOrg);
    if (!canOpenGrant && !canClose) {
      throw authError("FORBIDDEN", "Missing permission inventory.opening");
    }
    const store = await this.mustStore(operator, orgIdText);
    const record = await this.recordOf(operator, store);
    const books = await this.books.findMany(
      operator,
      { orgId: store.orgId, source: "opening", status: "normal" },
      { sort: { openingAt: -1, _id: -1 } },
    );
    const items = canOpenGrant ? await this.bookModelsOf(operator, books) : [];
    const pointMap = canOpenGrant
      ? await this.support.cashPointsOf(operator, store.orgId)
      : null;
    const points = pointMap
      ? [...pointMap.values()]
          .toSorted((a, b) => a.order - b.order)
          .map((point) => ({ id: String(point._id), name: point.name }))
      : [];
    const firstAt = books
      .map((book) => book.openingAt)
      .filter((at): at is Date => at instanceof Date)
      .reduce<Date | null>(
        (min, at) => (min === null || at < min ? at : min),
        null,
      );
    const people = await this.names.userNames(operator, [
      record?.closedBy,
      ...(record?.history ?? []).map((entry) => entry.by),
    ]);
    const refOf = (id: Types.ObjectId | null | undefined) => {
      const name = id == null ? undefined : people.get(String(id));
      return id == null || name === undefined ? null : { id: String(id), name };
    };
    const closedAt = record?.closedAt ?? null;
    return {
      org: { id: String(store.orgId), name: store.name },
      closed: closedAt !== null,
      closedAt,
      closedBy: refOf(record?.closedBy),
      startedAt: firstAt,
      history: (record?.history ?? []).map((entry) => ({
        action: entry.action,
        at: entry.at,
        by: refOf(entry.by),
        reason: entry.reason ?? null,
      })),
      bookCount: books.length,
      books: items,
      canOpen: canOpenGrant && closedAt === null,
      canClose,
      canShowCost: grant.canShowCost,
      cashPoints: points,
    };
  }

  /** 刷到一張(只讀):帶出遊戲候選與能不能建。 */
  async scan(
    operator: OperatorContext,
    input: LotteryOpeningScanInput,
  ): Promise<LotteryOpeningScanPayload> {
    const store = await this.mustStore(operator, input.orgId);
    const parsed = parseTicketInput(input.code);
    const bookNo = parsed === null ? null : normalizeBookNo(parsed.bookNo);
    if (parsed === null || bookNo === null) {
      return {
        bookNo: null,
        topTicketNo: null,
        hasGameCode: false,
        candidates: [],
      };
    }
    const games = await this.games.findMany(
      operator,
      parsed.gameCode === undefined ? {} : { gameCode: parsed.gameCode },
      { sort: { gameCode: 1 } },
    );
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      store.tenantId,
    );
    const existing = await this.books.findMany(
      reader,
      {
        bookKey: { $in: games.map((game) => bookKeyOf(game.gameCode, bookNo)) },
      },
      { select: "_id bookKey" },
    );
    const existingOf = new Map(
      existing.map((book) => [book.bookKey, String(book._id)]),
    );
    const onPurchase = await this.purchasesOf(reader, bookNo);
    const candidates: LotteryOpeningScanCandidateModel[] = games.map((game) => {
      const bookId = existingOf.get(bookKeyOf(game.gameCode, bookNo)) ?? null;
      const serialNo =
        bookId === null ? (onPurchase.get(String(game._id)) ?? null) : null;
      return {
        gameId: String(game._id),
        gameCode: game.gameCode,
        gameName: game.name,
        ticketsPerBook: game.ticketsPerBook,
        bookPrice: game.bookPrice,
        defaultRate: game.defaultRate,
        discontinued: game.status === GAME_STATUS.discontinued,
        block: blockOf(bookId, serialNo),
        bookId,
        serialNo,
      };
    });
    return {
      bookNo,
      topTicketNo: parsed.ticketNo,
      hasGameCode: parsed.gameCode !== undefined,
      candidates,
    };
  }

  // ---- 寫入 ----

  /** 建一本(規格 3.1、3.2)。 */
  async create(
    operator: OperatorContext,
    input: CreateLotteryOpeningBookInput,
  ): Promise<LotteryOpeningBookPayload> {
    const store = await this.mustStore(operator, input.orgId);
    const gameId = parseObjectId(input.gameId);
    const game =
      gameId === null
        ? null
        : await this.games.findOne(operator, { _id: gameId });
    if (game === null) {
      throw notFoundError("遊戲不存在");
    }
    const bookNo = normalizeBookNo(input.bookNo);
    if (bookNo === null) {
      throw validationError("本號要 6 或 7 位數字", ["bookNo"]);
    }
    const problem = openingPlanProblemOf({
      lastTicketNo: input.lastTicketNo,
      standardTickets: game.ticketsPerBook,
      soldTicketNos: input.soldTicketNos,
      skippedTicketNos: input.skippedTicketNos,
      placements: input.placements.map((placement) => ({
        cashPointId: placement.cashPointId ?? null,
        ticketNos: placement.ticketNos,
      })),
    });
    if (problem !== null) {
      throw new GraphQLError("期初建檔的張號不合", {
        extensions: {
          code: "VALIDATION_FAILED",
          reason: INVENTORY_REASONS.openingPlanInvalid,
          fields: ["tickets"],
          openingProblem: problem,
        },
      });
    }
    // 放到的收銀點要是這家店啟用中的(停用 → 擋下,同拆本)
    const pointIds = new Map<string, Types.ObjectId>();
    for (const placement of input.placements) {
      const idText = placement.cashPointId ?? null;
      if (idText !== null && !pointIds.has(idText)) {
        const point = await this.support.mustCashPoint(
          operator,
          store.orgId,
          idText,
          "placements",
        );
        pointIds.set(idText, point._id);
      }
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      store.tenantId,
    );
    const purchases = await this.purchasesOf(reader, bookNo);
    const serialNo = purchases.get(String(game._id));
    if (serialNo !== undefined) {
      throw new GraphQLError(`這本在進貨單 #${serialNo},請在進貨單點收`, {
        extensions: {
          code: "VALIDATION_FAILED",
          reason: INVENTORY_REASONS.bookOnPurchase,
          fields: ["bookNo"],
          serialNo,
        },
      });
    }
    const rate = Math.round(input.rate);
    return this.transactions.withTransaction(async (session) => {
      await this.touchOpen(operator, store, session);
      const { book } = await this.bookService.createBook(session, operator, {
        orgId: store.orgId,
        gameId: game._id,
        bookNo,
        lastTicketNo: input.lastTicketNo,
        rate,
        cost: purchaseAmountOf(game.bookPrice, rate),
        opening: {
          soldTicketNos: input.soldTicketNos,
          skippedTicketNos: input.skippedTicketNos,
          placements: input.placements.map((placement) => ({
            cashPointId:
              placement.cashPointId == null
                ? null
                : (pointIds.get(placement.cashPointId) ?? null),
            ticketNos: placement.ticketNos,
          })),
        },
      });
      await this.audit.recordMany(operator, [
        {
          action: "inventory.opening",
          targetType: "lottery_book",
          targetId: book._id,
          after: {
            orgId: String(store.orgId),
            bookKey: book.bookKey,
            rate,
            soldTicketNos: input.soldTicketNos.length,
            skippedTicketNos: [...input.skippedTicketNos],
          },
        },
      ]);
      return { bookId: String(book._id), count: input.lastTicketNo };
    });
  }

  /**
   * 作廢一本(E4):只限期初建檔的本、這本每一張都只有期初建檔那一筆事件(版本 1、還在建檔的店)。
   * 每張寫「期初建檔作廢」(狀態不變)、本改已撤銷,再軟刪除本與張釋出本號(可以重建)。
   */
  async voidBook(
    operator: OperatorContext,
    bookIdText: string,
  ): Promise<LotteryOpeningBookPayload> {
    const bookId = parseObjectId(bookIdText);
    const book =
      bookId === null ? null : await this.books.findById(operator, bookId);
    if (book === null) {
      throw notFoundError("本不存在");
    }
    if (!isOrgVisible(operator, book.orgId)) {
      throw authError("FORBIDDEN", "store not visible");
    }
    const store = await this.mustStore(operator, String(book.orgId));
    return this.transactions.withTransaction(async (session) => {
      const tickets = await this.tickets.findMany(
        operator,
        { bookId: book._id },
        { select: "_id version orgId", session },
      );
      const untouched =
        book.source === "opening" &&
        book.status === "normal" &&
        tickets.length === Number(book.lastTicketNo) &&
        tickets.every(
          (ticket) => ticket.version === 1 && ticket.orgId.equals(book.orgId),
        );
      if (!untouched) {
        throw validationError(
          "這本已有銷售或其他動作,請用期初更正",
          ["bookId"],
          INVENTORY_REASONS.openingNotVoidable,
        );
      }
      await this.touchOpen(operator, store, session);
      await this.ledger.applyTicketEvents(
        session,
        { operator },
        tickets.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          type: TICKET_EVENT_TYPE.openingVoid,
          patch: {},
          refType: OPENING_REF_TYPE,
          refId: book._id,
        })),
      );
      await this.books.updateMany(
        operator,
        { _id: book._id },
        { $set: { status: "revoked" } },
        { session },
      );
      await this.tickets.softDeleteMany(
        operator,
        tickets.map((ticket) => ticket._id),
        { session },
      );
      await this.books.softDeleteMany(operator, [book._id], { session });
      await this.audit.recordMany(operator, [
        {
          action: "inventory.opening-void",
          targetType: "lottery_book",
          targetId: book._id,
          before: { bookKey: book.bookKey, status: "normal" },
          after: { status: "revoked" },
        },
      ]);
      return { bookId: String(book._id), count: tickets.length };
    });
  }

  /**
   * 期初更正(規格 4.1;寫 `opening_fix`,不碰現金、不寫售出 / 撤銷):
   *
   * - 改回未售:選到的全是期初已售 → 未售,放到選的收銀點檯面或庫存。任何時候都可以(含結束後)
   * - 改成導入前已賣出:選到的全是未售、沒被鎖、不在途 → 期初已售(位置不變);只在期初建檔進行中(E2)
   *
   * 張要在同一家店、操作者看得到,而且是期初建檔的本;原因必填(欄位管理「期初更正原因」)。回寫了幾張。
   */
  async fix(
    operator: OperatorContext,
    input: FixLotteryOpeningTicketsInput,
  ): Promise<number> {
    if (!(OPENING_FIX_DIRECTIONS as readonly string[]).includes(input.to)) {
      throw validationError("更正方向不合", ["to"]);
    }
    const to = input.to as OpeningFixDirection;
    const refs = new Map<string, number>();
    for (const ticket of input.tickets) {
      if (!Types.ObjectId.isValid(ticket.ticketId)) {
        throw validationError("張的 id 不合法", ["tickets"]);
      }
      refs.set(ticket.ticketId, ticket.version);
    }
    if (refs.size === 0) {
      throw validationError("請選擇張", ["tickets"]);
    }
    const reason = await this.fieldOptions.assertReason(
      operator,
      LOTTERY_FIELD_CATEGORY_KEYS.openingCorrectionReason,
      input,
      LOTTERY_FIELD_CATEGORIES,
    );
    const ids = [...refs.keys()].map((id) => new Types.ObjectId(id));
    const found = await this.tickets.findMany(operator, { _id: { $in: ids } });
    if (found.length !== ids.length) {
      throw notFoundError("有幾張找不到");
    }
    const orgIds = new Set(found.map((ticket) => String(ticket.orgId)));
    const [orgIdText] = [...orgIds];
    if (orgIds.size !== 1 || orgIdText === undefined) {
      throw validationError("一次只能更正同一家店的張", ["tickets"]);
    }
    const store = await this.mustStore(operator, orgIdText);
    const bookIds = [...new Set(found.map((ticket) => String(ticket.bookId)))];
    const openingBooks = await this.books.findMany(
      operator,
      {
        _id: { $in: bookIds.map((id) => new Types.ObjectId(id)) },
        source: "opening",
      },
      { select: "_id" },
    );
    if (openingBooks.length !== bookIds.length) {
      throw validationError(
        "只有期初建檔的本可以期初更正",
        ["tickets"],
        INVENTORY_REASONS.ticketStatusNotAllowed,
      );
    }
    const location =
      to === "unsold"
        ? await this.fixLocationOf(operator, store, input.cashPointId ?? null)
        : null;
    return this.transactions.withTransaction(async (session) => {
      const tickets = await this.tickets.findMany(
        operator,
        { _id: { $in: ids } },
        { session },
      );
      const stale = tickets.filter(
        (ticket) => refs.get(String(ticket._id)) !== ticket.version,
      );
      if (stale.length > 0 || tickets.length !== ids.length) {
        throw ticketConflictError(stale.map((ticket) => String(ticket._id)));
      }
      const wrong = tickets.filter((ticket) =>
        to === "unsold"
          ? !isOpeningSold(ticket)
          : ticket.status !== TICKET_STATUS.unsold ||
            ticket.lockedBy !== null ||
            ticket.location.kind === TICKET_LOCATION_KIND.inTransit,
      );
      if (wrong.length > 0) {
        throw new GraphQLError(
          to === "unsold"
            ? "要改回未售的不是導入前已賣出"
            : "要改成導入前已賣出的不是未售",
          {
            extensions: {
              code: "VALIDATION_FAILED",
              reason: INVENTORY_REASONS.ticketStatusNotAllowed,
              fields: ["tickets"],
              ticketIds: wrong.map((ticket) => String(ticket._id)),
            },
          },
        );
      }
      if (to === "opening_sold") {
        // E2:結束後不能把未售標成導入前已賣出
        await this.touchOpen(operator, store, session);
      }
      const at = new Date();
      await this.ledger.applyTicketEvents(
        session,
        { operator },
        tickets.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          expectedStatuses: [
            to === "unsold" ? TICKET_STATUS.sold : TICKET_STATUS.unsold,
          ],
          type: TICKET_EVENT_TYPE.openingFix,
          at,
          patch:
            to === "unsold"
              ? {
                  status: TICKET_STATUS.unsold,
                  sold: null,
                  ...(location === null ? {} : { location }),
                }
              : {
                  status: TICKET_STATUS.sold,
                  sold: { at, source: "opening" as const },
                  saleEventId: null,
                  unmatched: false,
                },
          ...(to === "unsold" && location?.cashPointId != null
            ? { cashPointId: location.cashPointId }
            : {}),
          refType: OPENING_REF_TYPE,
          refId: ticket.bookId,
          reasonKey: reason.reasonKey,
          reasonNote: reason.reasonNote,
        })),
      );
      await this.audit.recordMany(operator, [
        {
          action: "inventory.opening-fix",
          targetType: "lottery_ticket",
          targetId: tickets[0]?._id,
          after: {
            to,
            ticketIds: tickets.map((ticket) => String(ticket._id)),
            reasonKey: reason.reasonKey,
          },
        },
      ]);
      return tickets.length;
    });
  }

  /** [結束期初建檔](D10)。已結束 → `CONFLICT`。 */
  async close(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryStoreOpeningModel> {
    const store = await this.mustStore(operator, orgIdText);
    await this.transactions.withTransaction(async (session) => {
      const writer = await this.writerOf(operator, store);
      const record = await this.openings.findOne(
        writer,
        { orgId: store.orgId },
        { session },
      );
      if (record?.closedAt != null) {
        throw conflictError();
      }
      const now = new Date();
      const entry: StoreOpeningHistoryEntry = {
        action: "close",
        at: now,
        by: this.actorOf(operator),
        reason: null,
      };
      if (record === null) {
        await this.openings.create(
          writer,
          {
            orgId: store.orgId,
            closedAt: now,
            closedBy: entry.by,
            history: [entry],
            version: 1,
          },
          { session },
        );
      } else {
        const updated = await this.openings.findOneAndUpdate(
          writer,
          { _id: record._id, version: record.version },
          {
            $set: { closedAt: now, closedBy: entry.by },
            $push: { history: entry },
            $inc: { version: 1 },
          },
          { session },
        );
        if (updated === null) {
          throw conflictError();
        }
      }
      await this.audit.recordMany(operator, [
        {
          action: "inventory.opening-close",
          targetType: "lottery_store_opening",
          targetId: store.orgId,
          after: { closedAt: now.toISOString() },
        },
      ]);
    });
    return this.storeOpening(operator, orgIdText);
  }

  /** [重新開放](E1;原因必填)。沒結束 → `CONFLICT`。 */
  async reopen(
    operator: OperatorContext,
    input: ReopenLotteryStoreOpeningInput,
  ): Promise<LotteryStoreOpeningModel> {
    const reason = input.reason.trim();
    if (reason === "") {
      throw validationError("請填重新開放的原因", ["reason"]);
    }
    const store = await this.mustStore(operator, input.orgId);
    await this.transactions.withTransaction(async (session) => {
      const writer = await this.writerOf(operator, store);
      const record = await this.openings.findOne(
        writer,
        { orgId: store.orgId },
        { session },
      );
      if (record?.closedAt == null) {
        throw conflictError();
      }
      const entry: StoreOpeningHistoryEntry = {
        action: "reopen",
        at: new Date(),
        by: this.actorOf(operator),
        reason,
      };
      const updated = await this.openings.findOneAndUpdate(
        writer,
        { _id: record._id, version: record.version },
        {
          $set: { closedAt: null, closedBy: null },
          $push: { history: entry },
          $inc: { version: 1 },
        },
        { session },
      );
      if (updated === null) {
        throw conflictError();
      }
      await this.audit.recordMany(operator, [
        {
          action: "inventory.opening-reopen",
          targetType: "lottery_store_opening",
          targetId: store.orgId,
          before: { closedAt: record.closedAt.toISOString() },
          after: { closedAt: null, reason },
        },
      ]);
    });
    return this.storeOpening(operator, input.orgId);
  }

  // ---- 內部 ----

  /** 操作者看得到、而且是店的組織;看不到 → `FORBIDDEN`、不是店 → `VALIDATION_FAILED`。 */
  private async mustStore(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<OpeningStore> {
    const orgId = parseObjectId(orgIdText);
    if (orgId === null || !isOrgVisible(operator, orgId)) {
      throw authError("FORBIDDEN", `store not visible: ${orgIdText}`);
    }
    const tenantOrgs = await this.names.tenantOrgs(operator);
    const org = tenantOrgs.find((item) => item.id.equals(orgId));
    if (org === undefined) {
      throw authError("FORBIDDEN", `store not visible: ${orgIdText}`);
    }
    if (!isStoreOrg(org, tenantOrgs)) {
      throw validationError("請選分店", ["orgId"]);
    }
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (tenantId === null) {
      throw authError("FORBIDDEN", "tenant required");
    }
    return { orgId, name: org.name, tenantId };
  }

  /** 改回未售放哪:收銀點(要是這家店啟用中的)的檯面,或庫存。 */
  private async fixLocationOf(
    operator: OperatorContext,
    store: OpeningStore,
    cashPointIdText: string | null,
  ): Promise<{
    kind: "stock" | "counter";
    cashPointId: Types.ObjectId | null;
  }> {
    if (cashPointIdText === null) {
      return { kind: TICKET_LOCATION_KIND.stock, cashPointId: null };
    }
    const point = await this.support.mustCashPoint(
      operator,
      store.orgId,
      cashPointIdText,
      "cashPointId",
    );
    return { kind: TICKET_LOCATION_KIND.counter, cashPointId: point._id };
  }

  private writerOf(
    operator: OperatorContext,
    store: OpeningStore,
  ): Promise<OperatorContext> {
    return tenantBoundaryContext(this.orgs, operator, store.tenantId);
  }

  private actorOf(operator: OperatorContext): Types.ObjectId {
    if (operator.actorId === null) {
      throw authError("FORBIDDEN", "operator required");
    }
    return operator.actorId;
  }

  private async recordOf(
    operator: OperatorContext,
    store: OpeningStore,
  ): Promise<OpeningRecord | null> {
    return this.openings.findOne(await this.writerOf(operator, store), {
      orgId: store.orgId,
    });
  }

  /**
   * 建檔 / 作廢前:分店那一筆要還在進行中,並 `$inc version`(和「結束」一定有先後,規格 2.4)。
   * 沒有那一筆 → 建一筆(同時兩個人第一次建檔,唯一索引讓其中一個交易重試或失敗)。
   */
  private async touchOpen(
    operator: OperatorContext,
    store: OpeningStore,
    session: ClientSession,
  ): Promise<void> {
    const writer = await this.writerOf(operator, store);
    const record = await this.openings.findOne(
      writer,
      { orgId: store.orgId },
      { session },
    );
    if (record?.closedAt != null) {
      throw storeClosedError();
    }
    if (record === null) {
      await this.openings.create(
        writer,
        { orgId: store.orgId, history: [], version: 1 },
        { session },
      );
      return;
    }
    const updated = await this.openings.findOneAndUpdate(
      writer,
      { _id: record._id, version: record.version, closedAt: null },
      { $inc: { version: 1 } },
      { session },
    );
    if (updated === null) {
      throw storeClosedError();
    }
  }

  /** 有效的進貨單上有這個本號的列:遊戲 id → 單號(先建的那張)。 */
  private async purchasesOf(
    reader: OperatorContext,
    bookNo: string,
  ): Promise<Map<string, string>> {
    const found = await this.submissions.findMany(
      reader,
      {
        moduleKey: PURCHASE_MODULE_KEY,
        formKey: PURCHASE_FORM_KEY,
        status: { $in: [...PURCHASE_OPEN_STATUSES] },
        "values.lines.book_no": { $in: [bookNo, displayBookNo(bookNo)] },
      },
      { select: "values serialNo", sort: { createdAt: 1 } },
    );
    const result = new Map<string, string>();
    for (const submission of found) {
      for (const line of purchaseLinesOf(submission.values)) {
        if (line.bookNo === bookNo && !result.has(line.gameId)) {
          result.set(line.gameId, submission.serialNo ?? "");
        }
      }
    }
    return result;
  }

  /** 已建檔的本 → 清單列(一次查完張的分組與名稱)。 */
  private async bookModelsOf(
    operator: OperatorContext,
    books: readonly Awaited<
      ReturnType<LotteryBooksRepository["findMany"]>
    >[number][],
  ): Promise<LotteryOpeningBookModel[]> {
    if (books.length === 0) {
      return [];
    }
    const rows = await this.tickets.aggregate(operator, [
      { $match: { bookId: { $in: books.map((book) => book._id) } } },
      {
        $group: {
          _id: {
            bookId: "$bookId",
            status: "$status",
            soldSource: "$soldSource",
            cashPointId: "$location.cashPointId",
          },
          count: { $sum: 1 },
          maxVersion: { $max: "$version" },
        },
      },
    ]);
    interface Summary {
      openingSold: number;
      inHand: number;
      places: Map<string, number>;
      touched: boolean;
    }
    const summaries = new Map<string, Summary>();
    const pointIds: unknown[] = [];
    for (const row of rows) {
      const key = row._id as {
        bookId: Types.ObjectId;
        status: string;
        soldSource?: string | null;
        cashPointId?: Types.ObjectId | null;
      };
      const summary = summaries.get(String(key.bookId)) ?? {
        openingSold: 0,
        inHand: 0,
        places: new Map<string, number>(),
        touched: false,
      };
      const count = Number(row.count);
      if (Number(row.maxVersion) > 1) {
        summary.touched = true;
      }
      if (key.status === TICKET_STATUS.sold && key.soldSource === "opening") {
        summary.openingSold += count;
      }
      if (key.status === TICKET_STATUS.unsold) {
        summary.inHand += count;
        const place = key.cashPointId == null ? "" : String(key.cashPointId);
        summary.places.set(place, (summary.places.get(place) ?? 0) + count);
        pointIds.push(key.cashPointId);
      }
      summaries.set(String(key.bookId), summary);
    }
    const [games, people, points] = await Promise.all([
      this.games.findMany(operator, {
        _id: { $in: books.map((book) => book.gameId) },
      }),
      this.names.userNames(
        operator,
        books.map((book) => book.openedBy),
      ),
      this.names.cashPointNames(operator, pointIds),
    ]);
    const gameName = new Map(
      games.map((game) => [String(game._id), game.name]),
    );
    return books.map((book) => {
      const summary = summaries.get(String(book._id));
      const openedBy =
        book.openedBy == null ? undefined : people.get(String(book.openedBy));
      return {
        bookId: String(book._id),
        bookKey: book.bookKey,
        gameCode: book.gameCode,
        gameName: gameName.get(String(book.gameId)) ?? "",
        bookNo: book.bookNo,
        lastTicketNo: book.lastTicketNo,
        openingSoldCount: summary?.openingSold ?? 0,
        inHandCount: summary?.inHand ?? 0,
        places: [...(summary?.places ?? new Map<string, number>())]
          .map(([id, count]) => ({
            cashPoint: id === "" ? null : { id, name: points.get(id) ?? "" },
            count,
          }))
          .toSorted(
            (a, b) =>
              (a.cashPoint === null ? 1 : 0) - (b.cashPoint === null ? 1 : 0),
          ),
        openedBy:
          book.openedBy == null || openedBy === undefined
            ? null
            : { id: String(book.openedBy), name: openedBy },
        openingAt: book.openingAt ?? book.createdAt,
        voidable: summary !== undefined && !summary.touched,
      };
    });
  }
}
