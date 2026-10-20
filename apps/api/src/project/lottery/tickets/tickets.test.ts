import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import type { Model, Types } from "mongoose";

import {
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
} from "@repo/domain/project/lottery";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg, newObjectId } from "../../../auth/test-support/fixtures";
import type { OperatorContext } from "../../../database/operator-context";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import { LotteryAllocation } from "../../database/lottery-inventory/lottery-allocation.schema";
import { LotteryBook } from "../../database/lottery-inventory/lottery-book.schema";
import { LotteryTicketEventsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryTicketEvent } from "../../database/lottery-inventory/lottery-ticket-event.schema";
import { LotteryTicket } from "../../database/lottery-inventory/lottery-ticket.schema";
import { isGameInUse } from "../games/game-usage";
import { LotteryAllocationsService } from "./allocations.service";
import { LotteryBooksService } from "./books.service";
import { TicketLedgerService } from "./ticket-ledger.service";
import type { TicketEventInput } from "./ticket-ledger.types";

interface TicketRow {
  _id: Types.ObjectId;
  ticketNo: string;
  status: string;
  version: number;
  storeOrgId: Types.ObjectId;
  unitCost: number;
  lockedBy: unknown;
}

function byText(left: string, right: string): number {
  return left.localeCompare(right);
}

/** 呼叫並取第一個錯誤的 extensions(GraphQLError)。 */
async function extensionsOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return (error as { extensions?: unknown }).extensions;
  }
  throw new Error("預期要失敗");
}

/**
 * 張數核心(專案規格 7.1、7.2、7.6、第 17 章共通原則):帳本服務、本的建立、預計要給本數,
 * 對真 MongoDB(replica set,交易)直接呼叫 service(TEST-07)。
 * 組織樹:root ─ 租戶甲 ─┬─ 甲一店
 *                         └─ 甲二店
 */
describe("張數核心(帳本 + 本 + 預計要給本數)", () => {
  let api: AuthTestApp;
  let tenant: Types.ObjectId;
  let storeA: Types.ObjectId;
  let storeB: Types.ObjectId;
  let gameId: Types.ObjectId;
  let transactions: TransactionService;
  let ledger: TicketLedgerService;
  let booksService: LotteryBooksService;
  let allocations: LotteryAllocationsService;
  let bookSequence = 100_000;

  function model<T>(name: string): Model<T> {
    return api.app.get<Model<T>>(getModelToken(name));
  }

  /** 甲一店的店長(手寫的操作者上下文;只用於讀與預計要給本數)。 */
  function storeOperator(orgId: Types.ObjectId): OperatorContext {
    return {
      actorId: newObjectId(),
      currentOrgId: orgId,
      visibleOrgIds: [orgId],
      managedOrgIds: [],
      memberOrgIds: [orgId],
      roleIds: [],
      memberTenants: [
        { tenantId: tenant, memberOrgIds: [orgId], ancestorOrgIds: [tenant] },
      ],
    };
  }

  /** 總部(租戶頂層 + 全部分店可見)。 */
  function headquarters(): OperatorContext {
    return {
      actorId: newObjectId(),
      currentOrgId: tenant,
      visibleOrgIds: [tenant, storeA, storeB],
      managedOrgIds: [tenant, storeA, storeB],
      memberOrgIds: [tenant],
      roleIds: [],
      memberTenants: [
        { tenantId: tenant, memberOrgIds: [tenant], ancestorOrgIds: [] },
      ],
    };
  }

  async function receiveBook(
    overrides: { lastTicketNo?: number; storeOrgId?: Types.ObjectId } = {},
  ): Promise<Types.ObjectId> {
    bookSequence += 1;
    const { book } = await transactions.withTransaction((session) =>
      booksService.createBook(session, {
        tenantId: tenant,
        storeOrgId: overrides.storeOrgId ?? storeA,
        gameId,
        bookNo: String(bookSequence).padStart(6, "0"),
        lastTicketNo: overrides.lastTicketNo ?? 100,
        rate: 92,
        cost: 18_400,
        by: null,
      }),
    );
    return book._id;
  }

  async function ticketsOf(bookId: Types.ObjectId): Promise<TicketRow[]> {
    return api.connection
      .collection<TicketRow>("lottery_tickets")
      .find({ bookId })
      .sort({ ticketNo: 1 })
      .toArray();
  }

  async function ticketById(id: Types.ObjectId): Promise<TicketRow | null> {
    return api.connection
      .collection<TicketRow>("lottery_tickets")
      .findOne({ _id: id });
  }

  async function eventCount(ticketId: Types.ObjectId): Promise<number> {
    return api.connection
      .collection("lottery_ticket_events")
      .countDocuments({ ticketId });
  }

  function saleOf(
    ticket: TicketRow,
    overrides: Partial<TicketEventInput> = {},
  ): TicketEventInput {
    return {
      tenantId: tenant,
      ticketId: ticket._id,
      expectedVersion: ticket.version,
      expectedStatuses: [TICKET_STATUS.unsold],
      type: TICKET_EVENT_TYPE.sale,
      by: null,
      amount: 200,
      cashEffect: "increase",
      patch: {
        status: TICKET_STATUS.sold,
        sold: { at: new Date(), by: null, source: "scan" },
      },
      ...overrides,
    };
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-tickets");
    tenant = await createOrg(api.connection, { name: "租戶甲" });
    storeA = await createOrg(api.connection, {
      name: "甲一店",
      parentId: tenant,
    });
    storeB = await createOrg(api.connection, {
      name: "甲二店",
      parentId: tenant,
    });
    const now = new Date();
    const { insertedId } = await api.connection
      .collection("lottery_games")
      .insertOne({
        orgId: tenant,
        tenantId: tenant,
        moduleKey: "master-data",
        gameCode: "5164",
        name: "發大財",
        unitPrice: 200,
        ticketsPerBook: 100,
        bookPrice: 20_000,
        defaultRate: 92,
        color: null,
        status: "on_sale",
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
    gameId = insertedId;
    transactions = api.app.get(TransactionService);
    ledger = api.app.get(TicketLedgerService);
    booksService = api.app.get(LotteryBooksService);
    allocations = api.app.get(LotteryAllocationsService);
    // 唯一索引(事件 id、本編號)要先建好
    await Promise.all([
      model(LotteryBook.name).init(),
      model(LotteryTicket.name).init(),
      model(LotteryTicketEvent.name).init(),
      model(LotteryAllocation.name).init(),
    ]);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("createBook(規格 7.1)", () => {
    it("迄號 < 標準張數或 > 999 → 擋下", async () => {
      for (const lastTicketNo of [99, 1000]) {
        const extensions = await extensionsOf(receiveBook({ lastTicketNo }));
        expect(extensions).toMatchObject({
          code: "VALIDATION_FAILED",
          fields: ["lastTicketNo"],
          reason: "LAST_TICKET_NO_OUT_OF_RANGE",
        });
      }
    });

    it("迄號 103、標準 100 → 待標註 3;本號補 0、起號 001、單張成本 = 成本 ÷ 標準張數、每張一筆進貨事件", async () => {
      const result = await transactions.withTransaction((session) =>
        booksService.createBook(session, {
          tenantId: tenant,
          storeOrgId: storeA,
          gameId,
          bookNo: "056527",
          lastTicketNo: 103,
          rate: 92,
          cost: 18_400.4,
          by: null,
        }),
      );
      expect(result.pendingSkipCount).toBe(3);
      expect(result.book).toMatchObject({
        bookNo: "0056527",
        bookKey: "5164-0056527",
        gameCode: "5164",
        firstTicketNo: "001",
        lastTicketNo: "103",
        standardTickets: 100,
        cost: 18_400,
        status: "normal",
      });
      const tickets = await ticketsOf(result.book._id);
      expect(tickets).toHaveLength(103);
      expect(tickets[0]?.ticketNo).toBe("001");
      expect(tickets[102]?.ticketNo).toBe("103");
      expect(tickets[0]?.unitCost).toBe(184);
      expect(tickets.every((ticket) => ticket.version === 1)).toBe(true);
      expect(
        await api.connection
          .collection("lottery_ticket_events")
          .countDocuments({
            bookId: result.book._id,
            type: TICKET_EVENT_TYPE.purchase,
          }),
      ).toBe(103);
      const stats = await booksService.statsOf(
        storeOperator(storeA),
        result.book._id,
      );
      expect(stats).toMatchObject({
        pendingSkipCount: 3,
        remainingCount: 103,
        state: "unopened",
        holdings: [{ orgId: String(storeA), count: 103 }],
      });
      // 同一本再點收一次 → 擋下
      const duplicate = await extensionsOf(
        transactions.withTransaction((session) =>
          booksService.createBook(session, {
            tenantId: tenant,
            storeOrgId: storeA,
            gameId,
            bookNo: "0056527",
            lastTicketNo: 100,
            rate: 92,
            cost: 18_400,
            by: null,
          }),
        ),
      );
      expect(duplicate).toMatchObject({ reason: "BOOK_KEY_DUPLICATE" });
      // 有本之後遊戲就是「有庫存」
      expect(await isGameInUse(tenant, gameId)).toBe(true);
    });

    it("別的分店看不到這本;本所在的分店看得到", async () => {
      const bookId = await receiveBook();
      await expect(
        booksService.statsOf(storeOperator(storeB), bookId),
      ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
      await expect(
        booksService.statsOf(storeOperator(storeA), bookId),
      ).resolves.toMatchObject({ remainingCount: 100 });
    });
  });

  describe("帳本(第 17 章共通原則)", () => {
    it("同一張同時兩個條件更新 → 一個成功、一個 CONFLICT", async () => {
      const [ticket] = await ticketsOf(await receiveBook());
      if (!ticket) {
        throw new Error("沒有張");
      }
      const results = await Promise.allSettled([
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, [
            saleOf(ticket, { by: newObjectId() }),
          ]),
        ),
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, [
            saleOf(ticket, { by: newObjectId() }),
          ]),
        ),
      ]);
      const fulfilled = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({
        extensions: {
          code: "CONFLICT",
          reason: "TICKET_ALREADY_PROCESSED",
          ticketIds: [String(ticket._id)],
        },
      });
      const reloaded = await ticketById(ticket._id);
      expect(reloaded).toMatchObject({ status: "sold", version: 2 });
      // 進貨 1 筆 + 售出 1 筆
      expect(await eventCount(ticket._id)).toBe(2);
    });

    it("同一事件 id 重送 → 不重複寫入", async () => {
      const [ticket] = await ticketsOf(await receiveBook());
      if (!ticket) {
        throw new Error("沒有張");
      }
      const by = newObjectId();
      const first = await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(session, [saleOf(ticket, { by })]),
      );
      const resent = await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(session, [saleOf(ticket, { by })]),
      );
      expect(first).toEqual([
        {
          ticketId: String(ticket._id),
          eventId: `${String(ticket._id)}:2`,
          version: 2,
          applied: true,
        },
      ]);
      expect(resent).toEqual([{ ...first[0], applied: false }]);
      expect(await eventCount(ticket._id)).toBe(2);
      const reloaded = await ticketById(ticket._id);
      expect(reloaded?.version).toBe(2);
    });

    it("目前狀態與事件同一交易:事件寫入失敗 → 狀態不變", async () => {
      const [ticket] = await ticketsOf(await receiveBook());
      if (!ticket) {
        throw new Error("沒有張");
      }
      const events = api.app.get(LotteryTicketEventsRepository);
      const spy = jest
        .spyOn(events, "create")
        .mockRejectedValueOnce(new Error("注入的事件寫入失敗"));
      try {
        await expect(
          transactions.withTransaction((session) =>
            ledger.applyTicketEvents(session, [saleOf(ticket)]),
          ),
        ).rejects.toThrow("注入的事件寫入失敗");
      } finally {
        spy.mockRestore();
      }
      const reloaded = await ticketById(ticket._id);
      expect(reloaded).toMatchObject({ status: "unsold", version: 1 });
      expect(await eventCount(ticket._id)).toBe(1);
    });

    it("金額不是正數 → 擋下", async () => {
      const [ticket] = await ticketsOf(await receiveBook());
      if (!ticket) {
        throw new Error("沒有張");
      }
      const extensions = await extensionsOf(
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, [saleOf(ticket, { amount: -200 })]),
        ),
      );
      expect(extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["amount"],
      });
    });

    it("鎖定時不能賣;同一個鎖的單據可以動;解除後可以賣", async () => {
      const bookId = await receiveBook();
      const [ticket] = await ticketsOf(bookId);
      if (!ticket) {
        throw new Error("沒有張");
      }
      const lock = {
        tenantId: tenant,
        refType: "transfer" as const,
        refId: newObjectId(),
      };
      await transactions.withTransaction((session) =>
        ledger.lockTickets(session, [ticket._id], lock),
      );
      // 重送鎖定不出錯
      await transactions.withTransaction((session) =>
        ledger.lockTickets(session, [ticket._id], lock),
      );
      const book = await api.connection
        .collection<{ lockedTicketCount: number }>("lottery_books")
        .findOne({ _id: bookId });
      expect(book?.lockedTicketCount).toBe(1);
      const locked = await ticketById(ticket._id);
      if (!locked) {
        throw new Error("沒有張");
      }
      expect(locked.version).toBe(2);
      await expect(
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, [saleOf(locked)]),
        ),
      ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
      // 別的單據要鎖 → CONFLICT
      await expect(
        transactions.withTransaction((session) =>
          ledger.lockTickets(session, [ticket._id], {
            ...lock,
            refId: newObjectId(),
          }),
        ),
      ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
      // 調貨單自己鎖住的張可以寫調出
      await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(session, [
          {
            tenantId: tenant,
            ticketId: locked._id,
            expectedVersion: locked.version,
            allowLockedBy: { refType: lock.refType, refId: lock.refId },
            type: TICKET_EVENT_TYPE.transferOut,
            by: null,
            patch: {
              location: {
                kind: TICKET_LOCATION_KIND.inTransit,
                cashPointId: null,
              },
            },
            refType: "transfer",
            refId: lock.refId,
          },
        ]),
      );
      await transactions.withTransaction((session) =>
        ledger.unlockTickets(session, [ticket._id], lock),
      );
      const unlocked = await ticketById(ticket._id);
      expect(unlocked).toMatchObject({ lockedBy: null, version: 4 });
      const afterUnlock = await api.connection
        .collection<{ lockedTicketCount: number }>("lottery_books")
        .findOne({ _id: bookId });
      expect(afterUnlock?.lockedTicketCount).toBe(0);
    });
  });

  describe("預計要給本數(規格 7.6)", () => {
    let gameOfAllocation: Types.ObjectId;

    beforeAll(async () => {
      // 另一款遊戲,不受上面幾個測試點收的本影響
      const now = new Date();
      const { insertedId } = await api.connection
        .collection("lottery_games")
        .insertOne({
          orgId: tenant,
          tenantId: tenant,
          moduleKey: "master-data",
          gameCode: "5170",
          name: "金好運",
          unitPrice: 200,
          ticketsPerBook: 100,
          bookPrice: 20_000,
          defaultRate: 92,
          color: null,
          status: "on_sale",
          createdAt: now,
          updatedAt: now,
          createdBy: null,
          updatedBy: null,
          deletedAt: null,
        });
      gameOfAllocation = insertedId;
    });

    it("進 2 本、調出 30 張 → 1 本 +70 張;收貨店 +30 張;持有分店跟著改", async () => {
      const original = gameId;
      gameId = gameOfAllocation;
      let secondBook: Types.ObjectId;
      try {
        await receiveBook();
        secondBook = await receiveBook();
      } finally {
        gameId = original;
      }
      const secondTickets = await ticketsOf(secondBook);
      const moving = secondTickets.slice(0, 30);
      await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(
          session,
          moving.map((ticket) => ({
            tenantId: tenant,
            ticketId: ticket._id,
            expectedVersion: ticket.version,
            type: TICKET_EVENT_TYPE.transferOut,
            by: null,
            patch: {
              location: {
                kind: TICKET_LOCATION_KIND.inTransit,
                cashPointId: null,
              },
            },
          })),
        ),
      );
      await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(
          session,
          moving.map((ticket) => ({
            tenantId: tenant,
            ticketId: ticket._id,
            expectedVersion: ticket.version + 1,
            type: TICKET_EVENT_TYPE.transferIn,
            by: null,
            patch: {
              storeOrgId: storeB,
              location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
            },
          })),
        ),
      );
      const statusA = await allocations.allocationStatus(
        storeOperator(storeA),
        storeA,
        gameOfAllocation,
      );
      expect(statusA).toMatchObject({ givenBooks: 1, givenExtraTickets: 70 });
      // 調貨的出貨店也算得出收貨店的已給
      const statusB = await allocations.allocationStatus(
        storeOperator(storeA),
        storeB,
        gameOfAllocation,
      );
      expect(statusB).toMatchObject({
        givenBooks: 0,
        givenExtraTickets: 30,
        plannedBooks: null,
      });
      const book = await api.connection
        .collection<{
          holderOrgIds: Types.ObjectId[];
          storeOrgId: Types.ObjectId;
        }>("lottery_books")
        .findOne({ _id: secondBook });
      expect(book?.holderOrgIds.map(String).toSorted(byText)).toEqual(
        [String(storeA), String(storeB)].toSorted(byText),
      );
      expect(String(book?.storeOrgId)).toBe(String(storeA));
      // 收貨店持有其中幾張,就讀得到那一本(讀取放行)
      await expect(
        booksService.statsOf(storeOperator(storeB), secondBook),
      ).resolves.toMatchObject({ remainingCount: 100 });
    });

    it("設定預計要給本數寫 audit_log,已給一起回", async () => {
      const operator = headquarters();
      await allocations.setAllocation(operator, {
        orgId: storeA,
        gameId: gameOfAllocation,
        plannedBooks: 3,
        note: "週年慶",
      });
      await allocations.setAllocation(operator, {
        orgId: storeA,
        gameId: gameOfAllocation,
        plannedBooks: 4,
      });
      expect(
        await api.connection
          .collection("lottery_allocations")
          .countDocuments({ orgId: storeA, gameId: gameOfAllocation }),
      ).toBe(1);
      expect(
        await api.connection
          .collection("audit_logs")
          .countDocuments({ action: "lottery-allocation.edit" }),
      ).toBe(2);
      await expect(
        allocations.allocationStatus(operator, storeA, gameOfAllocation),
      ).resolves.toMatchObject({ plannedBooks: 4, note: null, givenBooks: 1 });
      await expect(
        allocations.setAllocation(operator, {
          orgId: storeA,
          gameId: gameOfAllocation,
          plannedBooks: -1,
        }),
      ).rejects.toMatchObject({ extensions: { code: "VALIDATION_FAILED" } });
    });
  });
});
