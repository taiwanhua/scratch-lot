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
import {
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryTicketEvent } from "../../database/lottery-inventory/lottery-ticket-event.schema";
import { LotteryTicket } from "../../database/lottery-inventory/lottery-ticket.schema";
import { isGameInUse } from "../games/game-usage";
import { LotteryAllocationsService } from "./allocations.service";
import { LotteryBooksService } from "./books.service";
import { TicketLedgerService } from "./ticket-ledger.service";
import type { LedgerContext, TicketEventInput } from "./ticket-ledger.types";

interface TicketRow {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  ticketNo: string;
  status: string;
  version: number;
  unitCost: number;
  lockedBy: unknown;
}

function byText(left: string, right: string): number {
  return left.localeCompare(right, "zh-Hant");
}

function own(operator: OperatorContext): LedgerContext {
  return { operator };
}

function saleOf(
  ticket: TicketRow,
  overrides: Partial<TicketEventInput> = {},
): TicketEventInput {
  return {
    ticketId: ticket._id,
    expectedVersion: ticket.version,
    expectedStatuses: [TICKET_STATUS.unsold],
    type: TICKET_EVENT_TYPE.sale,
    amount: 200,
    cashEffect: "increase",
    patch: {
      status: TICKET_STATUS.sold,
      sold: { at: new Date(), source: "scan" },
    },
    ...overrides,
  };
}

/** 呼叫並取錯誤的 extensions(GraphQLError)。 */
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
 * 對真 MongoDB(replica set,交易)直接呼叫 service(TEST-07)。操作者上下文手寫(形狀同登入線)。
 *
 * 組織樹:root ─┬─ 租戶甲 ─┬─ 北區 ─┬─ 甲一店
 *              │          │        └─ 甲二店
 *              │          └─ 甲三店
 *              └─ 租戶乙 ─┬─ 乙一店
 *                         └─ 乙二店
 */
describe("張數核心(帳本 + 本 + 預計要給本數)", () => {
  let api: AuthTestApp;
  let tenant: Types.ObjectId;
  let region: Types.ObjectId;
  let storeA: Types.ObjectId;
  let storeB: Types.ObjectId;
  let storeC: Types.ObjectId;
  let tenantB: Types.ObjectId;
  let storeB1: Types.ObjectId;
  let storeB2: Types.ObjectId;
  let gameId: Types.ObjectId;
  let gameOfTenantB: Types.ObjectId;
  let transactions: TransactionService;
  let ledger: TicketLedgerService;
  let booksService: LotteryBooksService;
  let allocations: LotteryAllocationsService;
  let bookSequence = 100_000;

  function model<T>(name: string): Model<T> {
    return api.app.get<Model<T>>(getModelToken(name));
  }

  /** 分店人員(所屬 = 那家店,可見範圍 = 那家店)。 */
  function storeOperator(orgId: Types.ObjectId): OperatorContext {
    const tenantOf = [storeB1, storeB2].some((id) => id.equals(orgId))
      ? tenantB
      : tenant;
    const ancestors = [storeA, storeB].some((id) => id.equals(orgId))
      ? [tenant, region]
      : [tenantOf];
    return {
      actorId: newObjectId(),
      currentOrgId: orgId,
      visibleOrgIds: [orgId],
      managedOrgIds: [],
      memberOrgIds: [orgId],
      roleIds: [],
      memberTenants: [
        {
          tenantId: tenantOf,
          memberOrgIds: [orgId],
          ancestorOrgIds: ancestors,
        },
      ],
    };
  }

  /** 總部(最上層組織,可見範圍 = 整個租戶甲)。 */
  function headquarters(): OperatorContext {
    const all = [tenant, region, storeA, storeB, storeC];
    return {
      actorId: newObjectId(),
      currentOrgId: tenant,
      visibleOrgIds: all,
      managedOrgIds: all,
      memberOrgIds: [tenant],
      roleIds: [],
      memberTenants: [
        { tenantId: tenant, memberOrgIds: [tenant], ancestorOrgIds: [] },
      ],
    };
  }

  /** 中間層(北區)的人:可見範圍 = 北區與底下兩家店。 */
  function regionManager(): OperatorContext {
    return {
      actorId: newObjectId(),
      currentOrgId: region,
      visibleOrgIds: [region, storeA, storeB],
      managedOrgIds: [region, storeA, storeB],
      memberOrgIds: [region],
      roleIds: [],
      memberTenants: [
        { tenantId: tenant, memberOrgIds: [region], ancestorOrgIds: [tenant] },
      ],
    };
  }

  /** 同時屬於兩個租戶的人:甲一店與乙一店。 */
  function twoTenantPerson(): OperatorContext {
    return {
      actorId: newObjectId(),
      currentOrgId: storeA,
      visibleOrgIds: [storeA, storeB1],
      managedOrgIds: [],
      memberOrgIds: [storeA, storeB1],
      roleIds: [],
      memberTenants: [
        {
          tenantId: tenant,
          memberOrgIds: [storeA],
          ancestorOrgIds: [tenant, region],
        },
        {
          tenantId: tenantB,
          memberOrgIds: [storeB1],
          ancestorOrgIds: [tenantB],
        },
      ],
    };
  }

  async function insertGame(
    tenantId: Types.ObjectId,
    gameCode: string,
  ): Promise<Types.ObjectId> {
    const now = new Date();
    const { insertedId } = await api.connection
      .collection("lottery_games")
      .insertOne({
        orgId: tenantId,
        tenantId,
        moduleKey: "master-data",
        shareOrgs: [{ orgId: tenantId, includeDescendants: true }],
        gameCode,
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
    return insertedId;
  }

  async function receiveBook(
    overrides: {
      lastTicketNo?: number;
      orgId?: Types.ObjectId;
      game?: Types.ObjectId;
    } = {},
  ): Promise<Types.ObjectId> {
    bookSequence += 1;
    const orgId = overrides.orgId ?? storeA;
    const { book } = await transactions.withTransaction((session) =>
      booksService.createBook(session, storeOperator(orgId), {
        orgId,
        gameId: overrides.game ?? gameId,
        bookNo: String(bookSequence).padStart(6, "0"),
        lastTicketNo: overrides.lastTicketNo ?? 100,
        rate: 92,
        cost: 18_400,
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

  async function firstTicket(bookId: Types.ObjectId): Promise<TicketRow> {
    const [ticket] = await ticketsOf(bookId);
    if (!ticket) {
      throw new Error("沒有張");
    }
    return ticket;
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

  /** 甲一店還在店裡的前 N 張調出 → 甲二店調入(調入由甲二店的人寫,張還在甲一店:跨店例外寫入)。 */
  async function transfer(
    bookId: Types.ObjectId,
    count: number,
  ): Promise<void> {
    const inStoreA = await ticketsOf(bookId);
    const moving = inStoreA
      .filter((ticket) => ticket.orgId.equals(storeA))
      .slice(0, count);
    await transactions.withTransaction((session) =>
      ledger.applyTicketEvents(
        session,
        own(storeOperator(storeA)),
        moving.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          type: TICKET_EVENT_TYPE.transferOut,
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
        { operator: storeOperator(storeB), crossStoreTenantId: tenant },
        moving.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version + 1,
          type: TICKET_EVENT_TYPE.transferIn,
          patch: {
            orgId: storeB,
            location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
          },
        })),
      ),
    );
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-tickets");
    tenant = await createOrg(api.connection, { name: "租戶甲" });
    region = await createOrg(api.connection, {
      name: "北區",
      parentId: tenant,
    });
    storeA = await createOrg(api.connection, {
      name: "甲一店",
      parentId: region,
    });
    storeB = await createOrg(api.connection, {
      name: "甲二店",
      parentId: region,
    });
    storeC = await createOrg(api.connection, {
      name: "甲三店",
      parentId: tenant,
    });
    tenantB = await createOrg(api.connection, { name: "租戶乙" });
    storeB1 = await createOrg(api.connection, {
      name: "乙一店",
      parentId: tenantB,
    });
    storeB2 = await createOrg(api.connection, {
      name: "乙二店",
      parentId: tenantB,
    });
    gameId = await insertGame(tenant, "5164");
    gameOfTenantB = await insertGame(tenantB, "5164");
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
      const operator = storeOperator(storeA);
      const result = await transactions.withTransaction((session) =>
        booksService.createBook(session, operator, {
          orgId: storeA,
          gameId,
          bookNo: "056527",
          lastTicketNo: 103,
          rate: 92,
          cost: 18_400.4,
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
      expect(String(result.book.orgId)).toBe(String(storeA));
      const tickets = await ticketsOf(result.book._id);
      expect(tickets).toHaveLength(103);
      expect(tickets[0]?.ticketNo).toBe("001");
      expect(tickets[102]?.ticketNo).toBe("103");
      expect(tickets[0]?.unitCost).toBe(184);
      expect(
        tickets.every(
          (ticket) => ticket.version === 1 && ticket.orgId.equals(storeA),
        ),
      ).toBe(true);
      const purchases = await api.connection
        .collection("lottery_ticket_events")
        .find({ bookId: result.book._id, type: TICKET_EVENT_TYPE.purchase })
        .toArray();
      expect(purchases).toHaveLength(103);
      expect(String(purchases[0]?.by)).toBe(String(operator.actorId));
      // 進貨事件記成本快照(點收時的單張成本)
      expect(
        purchases.every((event) => event.cost === result.book.cost / 100),
      ).toBe(true);
      // 待標註的跳號(拆本前)實體不存在:總張數、持有張數都是標準張數(使用者 10/27 定案甲)
      await expect(
        booksService.statsOf(operator, result.book._id),
      ).resolves.toMatchObject({
        pendingSkipCount: 3,
        remainingCount: 100,
        totalCount: 100,
        state: "unopened",
        holdings: [{ orgId: String(storeA), count: 100 }],
      });
      // 同一本再點收一次(別的分店也一樣)→ 擋下
      const duplicate = await extensionsOf(
        transactions.withTransaction((session) =>
          booksService.createBook(session, storeOperator(storeB), {
            orgId: storeB,
            gameId,
            bookNo: "0056527",
            lastTicketNo: 100,
            rate: 92,
            cost: 18_400,
          }),
        ),
      );
      expect(duplicate).toMatchObject({ reason: "BOOK_KEY_DUPLICATE" });
      // 有本之後遊戲就是「有庫存」
      expect(await isGameInUse(tenant, gameId)).toBe(true);
    });

    it("點收分店不在點收人的可見範圍 → 寫不進去", async () => {
      await expect(
        transactions.withTransaction((session) =>
          booksService.createBook(session, storeOperator(storeA), {
            orgId: storeB,
            gameId,
            bookNo: "777777",
            lastTicketNo: 100,
            rate: 92,
            cost: 18_400,
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("帳本(第 17 章共通原則)", () => {
    it("同一張同時兩個條件更新 → 一個成功、一個 CONFLICT", async () => {
      const ticket = await firstTicket(await receiveBook());
      const results = await Promise.allSettled([
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, own(storeOperator(storeA)), [
            saleOf(ticket),
          ]),
        ),
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, own(storeOperator(storeA)), [
            saleOf(ticket),
          ]),
        ),
      ]);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({
        extensions: {
          code: "CONFLICT",
          reason: "TICKET_ALREADY_PROCESSED",
          ticketIds: [String(ticket._id)],
        },
      });
      expect(await ticketById(ticket._id)).toMatchObject({
        status: "sold",
        version: 2,
      });
      // 進貨 1 筆 + 售出 1 筆
      expect(await eventCount(ticket._id)).toBe(2);
    });

    it("同一事件 id 重送 → 不重複寫入;同時重送時後到的回 CONFLICT", async () => {
      const ticket = await firstTicket(await receiveBook());
      const clerk = storeOperator(storeA);
      const first = await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(session, own(clerk), [saleOf(ticket)]),
      );
      const resent = await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(session, own(clerk), [saleOf(ticket)]),
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
      expect(await ticketById(ticket._id)).toMatchObject({ version: 2 });
    });

    it("目前狀態與事件同一交易:事件寫入失敗 → 狀態不變", async () => {
      const ticket = await firstTicket(await receiveBook());
      const events = api.app.get(LotteryTicketEventsRepository);
      const spy = jest
        .spyOn(events, "createMany")
        .mockRejectedValueOnce(new Error("注入的事件寫入失敗"));
      try {
        await expect(
          transactions.withTransaction((session) =>
            ledger.applyTicketEvents(session, own(storeOperator(storeA)), [
              saleOf(ticket),
            ]),
          ),
        ).rejects.toThrow("注入的事件寫入失敗");
      } finally {
        spy.mockRestore();
      }
      expect(await ticketById(ticket._id)).toMatchObject({
        status: "unsold",
        version: 1,
      });
      expect(await eventCount(ticket._id)).toBe(1);
    });

    it("金額不是正數 → 擋下", async () => {
      const ticket = await firstTicket(await receiveBook());
      const extensions = await extensionsOf(
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, own(storeOperator(storeA)), [
            saleOf(ticket, { amount: -200 }),
          ]),
        ),
      );
      expect(extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["amount"],
      });
    });

    it("操作者自己的範圍:別家店的人動不到這張(CONFLICT)", async () => {
      const ticket = await firstTicket(await receiveBook());
      await expect(
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, own(storeOperator(storeB)), [
            saleOf(ticket),
          ]),
        ),
      ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
    });

    it("鎖定時不能賣;鎖定 / 解除回新版本、用掉一個版本不寫事件;同一個鎖的單據可以動", async () => {
      const bookId = await receiveBook();
      const ticket = await firstTicket(bookId);
      const operator = storeOperator(storeA);
      const clerk = own(operator);
      const lock = { refType: "transfer" as const, refId: newObjectId() };
      const locked = await transactions.withTransaction((session) =>
        ledger.lockTickets(session, operator, [ticket._id], lock),
      );
      expect(locked).toEqual([
        { ticketId: String(ticket._id), version: 2, changed: true },
      ]);
      // 重送鎖定:版本不變
      const again = await transactions.withTransaction((session) =>
        ledger.lockTickets(session, operator, [ticket._id], lock),
      );
      expect(again).toEqual([
        { ticketId: String(ticket._id), version: 2, changed: false },
      ]);
      expect(await eventCount(ticket._id)).toBe(1);
      const book = await api.connection
        .collection<{ lockedTicketCount: number }>("lottery_books")
        .findOne({ _id: bookId });
      expect(book?.lockedTicketCount).toBe(1);
      await expect(
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, clerk, [
            saleOf({ ...ticket, version: 2 }),
          ]),
        ),
      ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
      // 別的單據要鎖 → CONFLICT
      await expect(
        transactions.withTransaction((session) =>
          ledger.lockTickets(session, operator, [ticket._id], {
            ...lock,
            refId: newObjectId(),
          }),
        ),
      ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
      // 調貨單自己鎖住的張可以寫調出
      await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(session, clerk, [
          {
            ticketId: ticket._id,
            expectedVersion: 2,
            allowLockedBy: lock,
            type: TICKET_EVENT_TYPE.transferOut,
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
      const unlocked = await transactions.withTransaction((session) =>
        ledger.unlockTickets(session, operator, [ticket._id], lock),
      );
      expect(unlocked).toEqual([
        { ticketId: String(ticket._id), version: 4, changed: true },
      ]);
      expect(await ticketById(ticket._id)).toMatchObject({
        lockedBy: null,
        version: 4,
      });
      const afterUnlock = await api.connection
        .collection<{ lockedTicketCount: number }>("lottery_books")
        .findOne({ _id: bookId });
      expect(afterUnlock?.lockedTicketCount).toBe(0);
    });
  });

  describe("整批寫的邊界(TX-06)", () => {
    it("同一批重複同一張:同內容 → 第二筆是重送(applied: false);內容不同 → CONFLICT、整批回復", async () => {
      const ticket = await firstTicket(await receiveBook());
      const clerk = storeOperator(storeA);
      const same = await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(session, own(clerk), [
          saleOf(ticket),
          saleOf(ticket),
        ]),
      );
      expect(same.map((result) => [result.version, result.applied])).toEqual([
        [2, true],
        [2, false],
      ]);
      expect(await eventCount(ticket._id)).toBe(2);

      const other = await firstTicket(await receiveBook());
      const extensions = await extensionsOf(
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, own(clerk), [
            saleOf(other),
            saleOf(other, { amount: 300 }),
          ]),
        ),
      );
      expect(extensions).toMatchObject({
        code: "CONFLICT",
        ticketIds: [String(other._id)],
      });
      expect(await ticketById(other._id)).toMatchObject({
        status: "unsold",
        version: 1,
      });
      expect(await eventCount(other._id)).toBe(1);
    });

    it("同一組裡一張不符條件(版本對、但被鎖住)→ CONFLICT 只列那一張;其他張沒寫入、沒有事件(交易回復)", async () => {
      const bookId = await receiveBook();
      const all = await ticketsOf(bookId);
      const tickets = all.slice(0, 5);
      const locked = tickets[2];
      if (!locked) {
        throw new Error("沒有第 3 張");
      }
      // 版本不變、直接鎖住:讀取時版本對得上,要到條件更新(沒被鎖定)才不符
      await api.connection
        .collection("lottery_tickets")
        .updateOne(
          { _id: locked._id },
          { $set: { lockedBy: { refType: "transfer", refId: newObjectId() } } },
        );
      const extensions = await extensionsOf(
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(
            session,
            own(storeOperator(storeA)),
            tickets.map((ticket) => saleOf(ticket)),
          ),
        ),
      );
      expect(extensions).toMatchObject({
        code: "CONFLICT",
        reason: "TICKET_ALREADY_PROCESSED",
        ticketIds: [String(locked._id)],
      });
      for (const ticket of tickets) {
        expect(await ticketById(ticket._id)).toMatchObject({
          status: "unsold",
          version: 1,
        });
        expect(await eventCount(ticket._id)).toBe(1);
      }
    });

    it("換店與不換店混在同一批:要換的換店(一筆搬家稽核)、不換的只改欄位;結果照輸入順序", async () => {
      const bookId = await receiveBook();
      const [moving, staying] = await ticketsOf(bookId);
      if (!moving || !staying) {
        throw new Error("沒有張");
      }
      const actor = newObjectId();
      const cashPointId = newObjectId();
      const results = await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(
          session,
          { operator: null, crossStoreTenantId: tenant, systemActorId: actor },
          [
            {
              ticketId: staying._id,
              expectedVersion: staying.version,
              type: TICKET_EVENT_TYPE.open,
              patch: {
                location: { kind: TICKET_LOCATION_KIND.counter, cashPointId },
              },
            },
            {
              ticketId: moving._id,
              expectedVersion: moving.version,
              type: TICKET_EVENT_TYPE.transferIn,
              patch: {
                orgId: storeB,
                location: {
                  kind: TICKET_LOCATION_KIND.stock,
                  cashPointId: null,
                },
              },
            },
          ],
        ),
      );
      expect(results.map((result) => result.ticketId)).toEqual([
        String(staying._id),
        String(moving._id),
      ]);
      expect(results.every((result) => result.applied)).toBe(true);
      expect(await ticketById(moving._id)).toMatchObject({
        orgId: storeB,
        version: 2,
      });
      expect(await ticketById(staying._id)).toMatchObject({
        orgId: storeA,
        version: 2,
        location: { kind: "counter", cashPointId },
      });
      const audits = await api.connection
        .collection<{ after: { ids: string[] } }>("audit_logs")
        .find({
          action: "data.reassign-org",
          targetType: "lottery_tickets",
          actorId: actor,
        })
        .toArray();
      expect(audits.map((audit) => audit.after.ids)).toEqual([
        [String(moving._id)],
      ]);
    });

    it("重送一半:已寫過的回 applied: false、沒寫過的照寫;不重複寫事件", async () => {
      const bookId = await receiveBook();
      const [done, fresh] = await ticketsOf(bookId);
      if (!done || !fresh) {
        throw new Error("沒有張");
      }
      const clerk = storeOperator(storeA);
      await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(session, own(clerk), [saleOf(done)]),
      );
      const results = await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(session, own(clerk), [
          saleOf(done),
          saleOf(fresh),
        ]),
      );
      expect(
        results.map((result) => [result.ticketId, result.applied]),
      ).toEqual([
        [String(done._id), false],
        [String(fresh._id), true],
      ]);
      expect(await eventCount(done._id)).toBe(2);
      expect(await eventCount(fresh._id)).toBe(2);
      expect(await ticketById(fresh._id)).toMatchObject({
        status: "sold",
        version: 2,
      });
    });

    it("整本要跟著搬、但那本搬不了(已刪除)→ CONFLICT(bookIds),整筆回復、張也不搬", async () => {
      const bookId = await receiveBook();
      await api.connection
        .collection("lottery_books")
        .updateOne({ _id: bookId }, { $set: { deletedAt: new Date() } });
      const tickets = await ticketsOf(bookId);
      const extensions = await extensionsOf(
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(
            session,
            { operator: storeOperator(storeB), crossStoreTenantId: tenant },
            tickets.map((ticket) => ({
              ticketId: ticket._id,
              expectedVersion: ticket.version,
              type: TICKET_EVENT_TYPE.transferIn,
              patch: {
                orgId: storeB,
                location: {
                  kind: TICKET_LOCATION_KIND.stock,
                  cashPointId: null,
                },
              },
            })),
          ),
        ),
      );
      expect(extensions).toMatchObject({
        code: "CONFLICT",
        bookIds: [String(bookId)],
      });
      const after = await ticketsOf(bookId);
      expect(after.every((ticket) => ticket.orgId.equals(storeA))).toBe(true);
      expect(after.every((ticket) => ticket.version === 1)).toBe(true);
    });
  });

  describe("換店與可見範圍", () => {
    it("調入以搬家入口換店(寫稽核);持有分店跟著改;整本都過去 → 本也搬過去", async () => {
      const bookId = await receiveBook();
      await transfer(bookId, 30);
      const tickets = await ticketsOf(bookId);
      expect(
        tickets.filter((ticket) => ticket.orgId.equals(storeB)),
      ).toHaveLength(30);
      // 批次搬家:一批一筆稽核,列出搬了哪幾張
      const audits = await api.connection
        .collection<{ after: { ids: string[]; count: number } }>("audit_logs")
        .find({ action: "data.reassign-org", targetType: "lottery_tickets" })
        .toArray();
      expect(audits.map((audit) => audit.after.count)).toContain(30);
      expect(
        audits
          .find((audit) => audit.after.count === 30)
          ?.after.ids.toSorted(byText),
      ).toEqual(
        tickets
          .filter((ticket) => ticket.orgId.equals(storeB))
          .map((ticket) => String(ticket._id))
          .toSorted(byText),
      );
      const book = await api.connection
        .collection<{ holderOrgIds: Types.ObjectId[]; orgId: Types.ObjectId }>(
          "lottery_books",
        )
        .findOne({ _id: bookId });
      expect(book?.holderOrgIds.map(String).toSorted(byText)).toEqual(
        [String(storeA), String(storeB)].toSorted(byText),
      );
      expect(String(book?.orgId)).toBe(String(storeA));

      // 甲二店:持有幾張就讀得到那一本(讀取放行),張只看得到自己店的
      const clerkB = storeOperator(storeB);
      await expect(booksService.statsOf(clerkB, bookId)).resolves.toMatchObject(
        { remainingCount: 100 },
      );
      const tickets2 = api.app.get(LotteryTicketsRepository);
      expect(await tickets2.count(clerkB, { bookId })).toBe(30);
      // 甲三店:沒有持有 → 讀不到
      await expect(
        booksService.statsOf(storeOperator(storeC), bookId),
      ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });

      // 剩下 70 張也調過去 → 本跟著搬到甲二店
      await transfer(bookId, 100);
      const moved = await api.connection
        .collection<{ holderOrgIds: Types.ObjectId[]; orgId: Types.ObjectId }>(
          "lottery_books",
        )
        .findOne({ _id: bookId });
      expect(String(moved?.orgId)).toBe(String(storeB));
      expect(moved?.holderOrgIds.map(String)).toEqual([String(storeB)]);
    });

    it("跨店寫入只能把張移進自己看得到的店:賣掉別店的張、移到看不到的店 → FORBIDDEN", async () => {
      const ticket = await firstTicket(await receiveBook());
      const crossB = {
        operator: storeOperator(storeB),
        crossStoreTenantId: tenant,
      };
      // 甲二店的人跨店把甲一店的張賣掉
      await expect(
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, crossB, [saleOf(ticket)]),
        ),
      ).rejects.toMatchObject({
        extensions: {
          code: "FORBIDDEN",
          reason: "CROSS_STORE_NOT_ALLOWED",
          ticketIds: [String(ticket._id)],
        },
      });
      // 甲二店的人跨店把甲一店的張移到甲三店(他看不到的店)
      await expect(
        transactions.withTransaction((session) =>
          ledger.applyTicketEvents(session, crossB, [
            {
              ticketId: ticket._id,
              expectedVersion: ticket.version,
              type: TICKET_EVENT_TYPE.recover,
              patch: { orgId: storeC },
            },
          ]),
        ),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(await ticketById(ticket._id)).toMatchObject({
        status: "unsold",
        version: 1,
      });
      // 移進自己看得到的店(尋回到刷到的甲二店)可以
      await transactions.withTransaction((session) =>
        ledger.applyTicketEvents(session, crossB, [
          {
            ticketId: ticket._id,
            expectedVersion: ticket.version,
            type: TICKET_EVENT_TYPE.recover,
            patch: { orgId: storeB },
          },
        ]),
      );
      const moved = await ticketById(ticket._id);
      expect(String(moved?.orgId)).toBe(String(storeB));
    });

    it("鎖定只照操作者自己的範圍:別店的人鎖不到這張", async () => {
      const ticket = await firstTicket(await receiveBook());
      await expect(
        transactions.withTransaction((session) =>
          ledger.lockTickets(session, storeOperator(storeB), [ticket._id], {
            refType: "transfer",
            refId: newObjectId(),
          }),
        ),
      ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
      expect(await ticketById(ticket._id)).toMatchObject({
        lockedBy: null,
        version: 1,
      });
    });

    it("點收分店的租戶要和當前組織的租戶相同;本編號只在同一個租戶內唯一", async () => {
      const person = twoTenantPerson();
      // 當前組織在租戶甲,點收到乙一店(看得到,但在租戶乙)→ 擋下
      const extensions = await extensionsOf(
        transactions.withTransaction((session) =>
          booksService.createBook(session, person, {
            orgId: storeB1,
            gameId: gameOfTenantB,
            bookNo: "880001",
            lastTicketNo: 100,
            rate: 92,
            cost: 18_400,
          }),
        ),
      );
      expect(extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["orgId"],
        reason: "STORE_OUTSIDE_TENANT",
      });
      // 兩個租戶各自點收同一個本號(同代號遊戲)→ 都可以
      for (const [orgId, game] of [
        [storeA, gameId],
        [storeB1, gameOfTenantB],
      ] as const) {
        await transactions.withTransaction((session) =>
          booksService.createBook(session, storeOperator(orgId), {
            orgId,
            gameId: game,
            bookNo: "880002",
            lastTicketNo: 100,
            rate: 92,
            cost: 18_400,
          }),
        );
      }
      expect(
        await api.connection
          .collection("lottery_books")
          .countDocuments({ bookKey: "5164-0880002" }),
      ).toBe(2);
    });

    it("中間層(北區)的人看得到底下兩家店的本與張,看不到不在北區的店", async () => {
      const bookA = await receiveBook();
      const bookC = await receiveBook({ orgId: storeC });
      const manager = regionManager();
      const books = api.app.get(LotteryBooksRepository);
      const tickets = api.app.get(LotteryTicketsRepository);
      expect(await books.findById(manager, bookA)).not.toBeNull();
      expect(await tickets.count(manager, { bookId: bookA })).toBe(100);
      expect(await books.findById(manager, bookC)).toBeNull();
      expect(await tickets.count(manager, { bookId: bookC })).toBe(0);
      // 總部看得到全部
      expect(await books.findById(headquarters(), bookC)).not.toBeNull();
    });

    it("同時屬於兩個租戶的人:只看得到自己所屬分店的本;預計要給本數只算當前組織的租戶", async () => {
      const bookA = await receiveBook();
      const bookB1 = await receiveBook({ orgId: storeB1, game: gameOfTenantB });
      const bookB2 = await receiveBook({ orgId: storeB2, game: gameOfTenantB });
      const person = twoTenantPerson();
      const books = api.app.get(LotteryBooksRepository);
      expect(await books.findById(person, bookA)).not.toBeNull();
      expect(await books.findById(person, bookB1)).not.toBeNull();
      expect(await books.findById(person, bookB2)).toBeNull();
      // 當前組織在租戶甲:不能拿租戶乙的分店去算
      await expect(
        allocations.allocationStatus(person, storeB1, gameOfTenantB),
      ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    });
  });

  describe("預計要給本數(規格 7.6)", () => {
    let gameOfAllocation: Types.ObjectId;

    beforeAll(async () => {
      // 另一款遊戲,不受上面幾個測試點收的本影響
      gameOfAllocation = await insertGame(tenant, "5170");
    });

    it("進 2 本、調出 30 張 → 1 本 +70 張;收貨店 +30 張", async () => {
      await receiveBook({ game: gameOfAllocation });
      const secondBook = await receiveBook({ game: gameOfAllocation });
      await transfer(secondBook, 30);
      await expect(
        allocations.allocationStatus(
          storeOperator(storeA),
          storeA,
          gameOfAllocation,
        ),
      ).resolves.toMatchObject({ givenBooks: 1, givenExtraTickets: 70 });
      // 調貨的出貨店也算得出收貨店的已給
      await expect(
        allocations.allocationStatus(
          storeOperator(storeA),
          storeB,
          gameOfAllocation,
        ),
      ).resolves.toMatchObject({
        givenBooks: 0,
        givenExtraTickets: 30,
        plannedBooks: null,
      });
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
