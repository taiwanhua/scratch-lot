import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import { OPENING_REF_TYPE } from "@repo/domain/project/lottery";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import type { OperatorContext } from "../../../database/operator-context";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import {
  type Person,
  WORKFLOW_TEST_TIMEOUT_MS,
  person,
} from "../../../workflows/test-support/workflow-fixtures";
import { LOTTERY_BOOKS_COLLECTION } from "../../database/lottery-inventory/lottery-book.schema";
import { LOTTERY_STORE_OPENINGS_COLLECTION } from "../../database/lottery-inventory/lottery-store-opening.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import {
  insertGame,
  seedInventoryModule,
} from "../purchase/test-support/purchase-fixtures";
import { LotteryAllocationsService } from "../tickets/allocations.service";
import { LotteryBooksService } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const OPERATIONS = /* GraphQL */ `
  query Operations($input: LotteryOperationsReportInput!) {
    lotteryOperationsReport(input: $input) {
      stores {
        orgId
        sales {
          scan {
            count
            amount
          }
          net {
            count
            amount
          }
          cost
          games {
            gameCode
            sold
          }
        }
        inventory {
          openingTickets
          openingCost
          openingEntryBooks
          openingEntryVoidBooks
          openingEntryFixTickets
          openingEntryTickets
          openingEntryCost
          purchaseBooks
          purchaseTickets
          salesTickets
          salesCost
          endingTickets
          endingCost
          checkTickets
          checkCost
        }
        notes {
          openingEntry {
            startedAt
            closedAt
          }
        }
      }
    }
  }
`;

const base = () => {
  const now = new Date();
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
};

/** 台北時間。 */
const taipei = (date: string, time = "00:00") =>
  new Date(`${date}T${time}+08:00`);

/** 台北某一天的報表範圍(日)。 */
const dayOf = (date: string) => ({
  periodKind: "day",
  from: taipei(date).toISOString(),
  to: new Date(taipei(date).getTime() + 86_400_000).toISOString(),
});

/** 三位張號 `from`–`to`。 */
const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    String(from + index).padStart(3, "0"),
  );

interface TicketDoc {
  _id: Types.ObjectId;
  ticketNo: string;
  version: number;
  status: string;
  bookId: Types.ObjectId;
}

interface Store {
  orgId: string;
  sales: {
    scan: { count: number; amount: number };
    net: { count: number; amount: number };
    cost: number | null;
    games: { gameCode: string; sold: number }[];
  };
  inventory: Record<string, number | null>;
  notes: {
    openingEntry: { startedAt: string; closedAt: string | null } | null;
  };
}

function expectBalanced(row: Store) {
  expect(row.inventory.checkTickets).toBe(0);
  expect(row.inventory.checkCost).toBe(0);
}

/**
 * 期初建檔的營運報表(期初建檔規格 5.1、5.2、第 7 節 OP14–OP17;真帳本 + 真 MongoDB):區塊 4 的「期初建檔」列、
 * 期初已售不進銷售、期初更正與作廢、區塊 8 註記、預計要給本數。每個情境核對 `checkTickets` / `checkCost` = 0。
 *
 * 建檔、更正、作廢照服務寫的事件與軟刪除自己寫(服務一律用現在的時間,報表要指定日子)。
 */
describe("營運報表:期初建檔(OP14–OP17)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let tenant: Types.ObjectId;
  let store: Types.ObjectId;
  /** 沒有期初建檔的店 */
  let plainStore: Types.ObjectId;
  let game: Types.ObjectId;
  let hq: Person;
  let bookSequence = 0;
  const counter = new Types.ObjectId();

  const transactions = () => api.app.get(TransactionService);
  const ledger = () => api.app.get(TicketLedgerService);

  const storeOperator = (orgId: Types.ObjectId): OperatorContext => ({
    actorId: hq.userId,
    currentOrgId: orgId,
    visibleOrgIds: [orgId],
    managedOrgIds: [],
    memberOrgIds: [orgId],
    roleIds: [],
    memberTenants: [
      { tenantId: tenant, memberOrgIds: [orgId], ancestorOrgIds: [tenant] },
    ],
  });

  async function storeOn(date: string, orgId = store): Promise<Store> {
    const result: GraphqlResult = await api.graphql(
      OPERATIONS,
      { input: { ...dayOf(date), orgIds: [String(orgId)] } },
      { accessToken: hq.token },
    );
    expect(result.errors).toBeUndefined();
    const [row] = (
      result.data as { lotteryOperationsReport: { stores: Store[] } }
    ).lotteryOperationsReport.stores;
    if (row === undefined) {
      throw new Error("no store in report");
    }
    return row;
  }

  /** 期初建檔一本(真的 `createBook` + 計畫);成本 `cost`。 */
  async function openingBook(
    at: Date,
    input: {
      lastTicketNo: number;
      cost: number;
      sold?: string[];
      skipped?: string[];
      counterTickets?: string[];
      stockTickets?: string[];
    },
  ): Promise<Types.ObjectId> {
    bookSequence += 1;
    const placements = [
      ...(input.counterTickets === undefined
        ? []
        : [{ cashPointId: counter, ticketNos: input.counterTickets }]),
      ...(input.stockTickets === undefined
        ? []
        : [{ cashPointId: null, ticketNos: input.stockTickets }]),
    ];
    const { book } = await transactions().withTransaction((session) =>
      api.app
        .get(LotteryBooksService)
        .createBook(session, storeOperator(store), {
          orgId: store,
          gameId: game,
          bookNo: String(700_000 + bookSequence),
          lastTicketNo: input.lastTicketNo,
          rate: 92,
          cost: input.cost,
          at,
          opening: {
            soldTicketNos: input.sold ?? [],
            skippedTicketNos: input.skipped ?? [],
            placements,
          },
        }),
    );
    return book._id;
  }

  const ticketsOf = (bookId: Types.ObjectId) =>
    connection
      .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
      .find({ bookId })
      .sort({ ticketNo: 1 })
      .toArray();

  const pick = async (bookId: Types.ObjectId, ticketNos: string[]) => {
    const tickets = await ticketsOf(bookId);
    return tickets.filter((ticket) => ticketNos.includes(ticket.ticketNo));
  };

  async function apply(
    tickets: readonly TicketDoc[],
    input: Omit<
      Parameters<TicketLedgerService["applyTicketEvents"]>[2][number],
      "ticketId" | "expectedVersion"
    >,
  ): Promise<void> {
    await transactions().withTransaction((session) =>
      ledger().applyTicketEvents(
        session,
        { operator: storeOperator(store) },
        tickets.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          ...input,
        })),
      ),
    );
  }

  /** 刷條碼賣出(檯面那一台)。 */
  async function sell(tickets: readonly TicketDoc[], at: Date) {
    await apply(tickets, {
      type: "sale",
      at,
      amount: 200,
      cashEffect: "increase",
      cashPointId: counter,
      patch: { status: "sold", sold: { at, source: "scan" } },
    });
  }

  /** 期初更正(同 `InventoryOpeningService.fix` 寫的事件)。 */
  async function fix(
    tickets: readonly TicketDoc[],
    to: "unsold" | "opening_sold",
    at: Date,
  ) {
    for (const ticket of tickets) {
      await apply([ticket], {
        type: "opening_fix",
        at,
        patch:
          to === "unsold"
            ? {
                status: "unsold",
                sold: null,
                location: { kind: "counter", cashPointId: counter },
              }
            : {
                status: "sold",
                sold: { at, source: "opening" },
                saleEventId: null,
                unmatched: false,
              },
        ...(to === "unsold" ? { cashPointId: counter } : {}),
        refType: OPENING_REF_TYPE,
        refId: ticket.bookId,
        reasonKey: "mistake",
      });
    }
  }

  /** 期初建檔作廢(同 `InventoryOpeningService.voidBook`:事件 + 本已撤銷 + 本與張軟刪除)。 */
  async function voidBook(bookId: Types.ObjectId, at: Date) {
    await apply(await ticketsOf(bookId), {
      type: "opening_void",
      at,
      patch: {},
      refType: OPENING_REF_TYPE,
      refId: bookId,
    });
    await connection
      .collection(LOTTERY_BOOKS_COLLECTION)
      .updateOne(
        { _id: bookId },
        { $set: { status: "revoked", deletedAt: at } },
      );
    await connection
      .collection(LOTTERY_TICKETS_COLLECTION)
      .updateMany({ bookId }, { $set: { deletedAt: at } });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-reports-opening");
    connection = api.connection;
    const reportsModule = await connection
      .collection("modules")
      .findOne({ key: "reports" });
    if (reportsModule === null) {
      throw new Error("base seed did not create the reports module");
    }
    await connection.collection("permissions").insertOne({
      key: "reports.operations",
      moduleId: reportsModule._id,
      name: "reports.operations",
      enabled: true,
      isSystem: false,
      settings: {},
      source: "seed",
      retiredAt: null,
      ...base(),
    });
    await seedInventoryModule(connection);
    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    store = await createOrg(connection, { name: "中山店", parentId: tenant });
    plainStore = await createOrg(connection, {
      name: "新竹店",
      parentId: tenant,
    });
    game = await insertGame(connection, tenant, {
      gameCode: "5164",
      name: "發大財",
      unitPrice: 200,
      ticketsPerBook: 100,
    });
    hq = await person(api, connection, tenant, tenant, {
      moduleKeys: ["reports"],
      permissionKeys: ["reports.operations", "reports.show-cost"],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  let openedBook: Types.ObjectId;

  it("OP14 / OP15 建檔當期:拆過的本(期初已售 40 張)+ 原封未標跳號的本(迄號 101)→ 期初建檔 160 張,核對 0;期初已售不進區塊 1–2", async () => {
    openedBook = await openingBook(taipei("2026-11-02", "09:00"), {
      lastTicketNo: 100,
      cost: 18_400,
      sold: range(1, 40),
      counterTickets: range(41, 100),
    });
    await openingBook(taipei("2026-11-02", "09:30"), {
      lastTicketNo: 101,
      cost: 18_400,
      stockTickets: range(1, 101),
    });
    const day = await storeOn("2026-11-02");
    expect(day.inventory).toMatchObject({
      openingTickets: 0,
      openingCost: 0,
      openingEntryBooks: 2,
      openingEntryVoidBooks: 0,
      openingEntryFixTickets: 0,
      // 拆過的本在手上 60 張;原封的本 101 張扣掉待標註 1 張 = 100
      openingEntryTickets: 160,
      purchaseBooks: 0,
      purchaseTickets: 0,
      salesTickets: 0,
      endingTickets: 160,
    });
    expect(day.inventory.openingEntryCost).toBe(day.inventory.endingCost);
    expectBalanced(day);
    expect(day.sales.scan).toEqual({ count: 0, amount: 0 });
    expect(day.sales.net).toEqual({ count: 0, amount: 0 });
    expect(day.sales.games).toEqual([]);
    expect(day.notes.openingEntry).toEqual({
      startedAt: taipei("2026-11-02", "09:00").toISOString(),
      closedAt: null,
    });
  });

  it("OP14 下一期:期初 = 上一期期末,期初建檔列 0;賣 2 張照常進銷售,核對 0", async () => {
    await sell(
      await pick(openedBook, ["099", "100"]),
      taipei("2026-11-03", "10:00"),
    );
    const day = await storeOn("2026-11-03");
    expect(day.inventory).toMatchObject({
      openingTickets: 160,
      openingEntryBooks: 0,
      openingEntryFixTickets: 0,
      openingEntryTickets: 0,
      openingEntryCost: 0,
      salesTickets: 2,
      endingTickets: 158,
    });
    expectBalanced(day);
    expect(day.sales.scan.count).toBe(2);
  });

  it("OP16 期初更正與作廢:當期核對 0;作廢後舊報表重跑不變", async () => {
    // 11/03 再建一本,11/04 作廢(本號釋出);同一天另建另作廢一本
    const laterVoided = await openingBook(taipei("2026-11-03", "15:00"), {
      lastTicketNo: 100,
      cost: 18_400,
      stockTickets: range(1, 100),
    });
    const before = {
      day2: await storeOn("2026-11-02"),
      day3: await storeOn("2026-11-03"),
    };
    expect(before.day3.inventory).toMatchObject({
      openingEntryBooks: 1,
      openingEntryTickets: 100,
      endingTickets: 258,
    });
    expectBalanced(before.day3);

    await fix(
      await pick(openedBook, range(1, 5)),
      "unsold",
      taipei("2026-11-04", "09:00"),
    );
    await fix(
      await pick(openedBook, ["041"]),
      "opening_sold",
      taipei("2026-11-04", "09:10"),
    );
    await voidBook(laterVoided, taipei("2026-11-04", "09:20"));
    const sameDay = await openingBook(taipei("2026-11-04", "10:00"), {
      lastTicketNo: 100,
      cost: 18_400,
      stockTickets: range(1, 100),
    });
    await voidBook(sameDay, taipei("2026-11-04", "10:05"));

    const day = await storeOn("2026-11-04");
    expect(day.inventory).toMatchObject({
      openingTickets: 258,
      // 建一本、作廢兩本 → 本數 1 − 2
      openingEntryBooks: -1,
      openingEntryVoidBooks: 2,
      openingEntryFixTickets: 6,
      // +100(建)− 200(作廢)+ 5(改回未售)− 1(改成期初已售)
      openingEntryTickets: -96,
      endingTickets: 162,
    });
    expectBalanced(day);
    // 期初更正不是銷售也不是撤銷
    expect(day.sales.net).toEqual({ count: 0, amount: 0 });

    expect(await storeOn("2026-11-02")).toEqual(before.day2);
    expect(await storeOn("2026-11-03")).toEqual(before.day3);
  });

  it("區塊 8 註記:結束後帶結束時間;報表期末在結束前 → 進行中;沒建過的店 = null", async () => {
    await connection.collection(LOTTERY_STORE_OPENINGS_COLLECTION).insertOne({
      orgId: store,
      tenantId: tenant,
      closedAt: taipei("2026-11-05", "18:00"),
      closedBy: null,
      history: [
        {
          action: "close",
          at: taipei("2026-11-05", "18:00"),
          by: null,
          reason: null,
        },
      ],
      version: 1,
      moduleKey: "inventory",
      ...base(),
    });
    const closedDay = await storeOn("2026-11-05");
    expect(closedDay.notes.openingEntry).toEqual({
      startedAt: taipei("2026-11-02", "09:00").toISOString(),
      closedAt: taipei("2026-11-05", "18:00").toISOString(),
    });
    const beforeClose = await storeOn("2026-11-04");
    expect(beforeClose.notes.openingEntry?.closedAt).toBeNull();
    const beforeStart = await storeOn("2026-11-01");
    expect(beforeStart.notes.openingEntry).toBeNull();
    const plain = await storeOn("2026-11-05", plainStore);
    expect(plain.notes.openingEntry).toBeNull();
  });

  it("OP17 預計要給本數:期初建檔的本算 1 本(不論賣掉幾張);作廢的本不算", async () => {
    const [cell] = await api.app
      .get(LotteryAllocationsService)
      .allocationMatrix(storeOperator(store), [store], [game]);
    // 拆過的本(期初已售 41 張、賣 2 張)+ 原封的本 = 2 本;兩本作廢的不算
    expect(cell).toMatchObject({ givenBooks: 2, givenExtraTickets: 0 });
  });
});
