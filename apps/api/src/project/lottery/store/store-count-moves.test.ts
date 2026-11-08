import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import {
  INVENTORY_PERMISSIONS as I,
  STORE_PERMISSIONS as S,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS as F } from "@repo/domain/project/lottery-fields";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../../auth/test-support/fixtures";
import type { OperatorContext } from "../../../database/operator-context";
import { countDbCommands } from "../../../database/test-support/db-commands";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import { PASSWORD, login } from "../../../fields/test-support/fixtures";
import { createRole } from "../../../permission/test-support/fixtures";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import type { LotteryTicketDocument } from "../../database/lottery-inventory/lottery-inventory.repository";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import { LOTTERY_STORE_COUNT_MODES_COLLECTION } from "../../database/lottery-settings/lottery-store-count-mode.schema";
import {
  LOTTERY_SHIFTS_COLLECTION,
  LotteryShift,
} from "../../database/lottery-store/lottery-shift.schema";
import { useFakeNow } from "../../test-support/test-clock";
import { seedReasonCategory } from "../test-support/master-data-fixtures";
import { LotteryBooksService } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";
import { StoreClock } from "./store-clock";

// ---- GraphQL ----

const COUNTER_SCAN = /* GraphQL */ `
  query CounterScan($input: LotteryStoreCounterScanInput!) {
    lotteryStoreCounterScan(input: $input) {
      items {
        ticketId
        version
        ticketNo
        status
        unmatched
        problem
        match
      }
    }
  }
`;

const RECALL = /* GraphQL */ `
  mutation Recall($input: RecallLotteryTicketsInput!) {
    recallLotteryTickets(input: $input) {
      count
    }
  }
`;

const MOVE = /* GraphQL */ `
  mutation Move($input: MoveLotteryTicketsInput!) {
    moveLotteryTickets(input: $input) {
      count
    }
  }
`;

const MOVE_BY_COUNT = /* GraphQL */ `
  mutation MoveByCount($input: MoveLotteryTicketsByCountInput!) {
    moveLotteryTicketsByCount(input: $input) {
      count
    }
  }
`;

const SPLIT = /* GraphQL */ `
  mutation Split($input: SplitLotteryBookInput!) {
    splitLotteryBook(input: $input) {
      count
    }
  }
`;

const STOCK_BOOKS = /* GraphQL */ `
  query StockBooks($orgId: ID!) {
    lotteryStoreStockBooks(orgId: $orgId) {
      items {
        bookId
        ticketCount
        pendingSkipCount
        pendingSkipTotal
        sealed
      }
    }
  }
`;

const BOARD = /* GraphQL */ `
  query Board($orgId: ID!) {
    lotteryStoreBoard(orgId: $orgId) {
      item {
        movePauses {
          gameId
        }
      }
    }
  }
`;

const SCRAP = /* GraphQL */ `
  mutation Scrap($input: ScrapLotteryTicketsInput!) {
    scrapLotteryTickets(input: $input) {
      count
      lossCost
    }
  }
`;

const UNDO_SCRAP = /* GraphQL */ `
  mutation UndoScrap($input: UndoLotteryScrapInput!) {
    undoLotteryScrap(input: $input) {
      count
      lossCost
    }
  }
`;

const SWAP = /* GraphQL */ `
  mutation Swap($input: SwapLotterySkippedTicketInput!) {
    swapLotterySkippedTicket(input: $input) {
      count
    }
  }
`;

// ---- 型別與小工具 ----

interface StoreUser {
  userId: Types.ObjectId;
  token: string;
}

interface CounterScanRow {
  ticketId: string;
  version: number;
  ticketNo: string;
  status: string;
  unmatched: boolean;
  problem: string | null;
  match: boolean;
}

type TicketDoc = LotteryTicketDocument & { _id: Types.ObjectId };

interface EventDoc {
  ticketId: Types.ObjectId;
  type: string;
  cashPointId: Types.ObjectId | null;
  refId: Types.ObjectId | null;
  cost: number | null;
  reasonKey: string | null;
}

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

const taipei = (time: string) => new Date(`2026-11-06T${time}:00+08:00`);

/** 種子的一條權限。 */
const permission = (key: string, moduleId: Types.ObjectId) => ({
  key,
  moduleId,
  name: key,
  enabled: true,
  isSystem: false,
  settings: {},
  source: "seed",
  retiredAt: null,
  ...base(),
});

/** 正面條碼 = 本號 7 位 + 張號 3 位。 */
const barcodeOf = (bookNo: string, ticketNo: string) => `${bookNo}${ticketNo}`;

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    String(from + index).padStart(3, "0"),
  );

const refOf = (ticket: { _id: Types.ObjectId; version: number }) => ({
  ticketId: String(ticket._id),
  version: ticket.version,
});

function scrapInput(tickets: readonly TicketDoc[]) {
  return {
    input: {
      tickets: tickets.map((ticket) => refOf(ticket)),
      reasonKey: "damaged",
    },
  };
}

function swapInput(
  bookId: Types.ObjectId,
  skipped: TicketDoc,
  missing: TicketDoc,
  scanned: boolean | null,
) {
  return {
    input: {
      bookId: String(bookId),
      skipped: refOf(skipped),
      unsold: refOf(missing),
      reasonKey: "mark-error",
      ...(scanned === null ? {} : { scanned }),
    },
  };
}

/**
 * 張數店 T5:收回、移櫃(刷條碼、依張數)、拆本的手上實際張數、報廢只限庫存與撤銷報廢、更正跳號
 * (張數店規格 6.3、7.5–7.8、7.10、8.5a B1 / B2;驗收 16.6 R1、R2、SK1、SC1–SC3,16.7 S11):打真的 GraphQL 端點、
 * 對真 MongoDB(TEST-07);「現在」由 `StoreClock` 注入。每張 200 元。
 *
 * 組織樹:root ─ 租戶甲 ─┬─ 信義店(張數店;店內櫃台 = A 台、店外攤位 = B 台)
 *                        └─ 板橋店(編號店;店內櫃台)
 */
describe("張數店:收回、移櫃、拆本、報廢、更正跳號(GraphQL 端點 + 真 MongoDB)", () => {
  // 前置資料、api 的 `new Date()` 與店面時鐘同一條時間軸:起點早於測試撥到的每個時間
  useFakeNow(new Date("2026-11-06T00:00:00+08:00"));

  let api: AuthTestApp;
  let connection: Connection;

  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let banqiao: Types.ObjectId;
  let counterA: Types.ObjectId;
  let stallB: Types.ObjectId;
  let counterBanqiao: Types.ObjectId;
  let gameId: Types.ObjectId;
  let otherGameId: Types.ObjectId;

  /** 店員:銷售、拆本、移櫃 */
  let wang: StoreUser;
  /** 只有移櫃、沒有銷售(對號要 `store.sell`) */
  let mover: StoreUser;
  let banqiaoClerk: StoreUser;
  /** 庫存管理:報廢、標跳號、看成本 */
  let keeper: StoreUser;

  let sequence = 0;
  let bookSequence = 81_000;

  function gql(
    user: StoreUser,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> {
    return api.graphql(query, variables, { accessToken: user.token });
  }

  async function ok<T>(
    user: StoreUser,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const result = await gql(user, query, variables);
    expect(result.errors).toBeUndefined();
    return result.data as T;
  }

  async function errorOf(
    user: StoreUser,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const result = await gql(user, query, variables);
    return result.errors?.[0]?.extensions;
  }

  function now(time: string): void {
    jest.spyOn(api.app.get(StoreClock), "now").mockReturnValue(taipei(time));
  }

  async function storeUser(
    orgIds: Types.ObjectId[],
    permissionKeys: readonly string[],
    name: string,
    moduleKeys: readonly string[] = ["store"],
  ): Promise<StoreUser> {
    sequence += 1;
    const account = `store-moves-${String(sequence)}`;
    const userId = await createUser(connection, {
      account,
      password: PASSWORD,
      orgIds,
    });
    await connection
      .collection("users")
      .updateOne({ _id: userId }, { $set: { name } });
    const [ownerOrgId] = orgIds;
    if (ownerOrgId === undefined) {
      throw new Error("需要所屬組織");
    }
    await createRole(api.app, connection, {
      name: `店面角色:${account}`,
      ownerOrgId,
      moduleKeys: [...moduleKeys],
      permissionKeys: [...permissionKeys],
      assignTo: [userId],
    });
    return { userId, token: await login(api, account) };
  }

  async function cashPoint(
    orgId: Types.ObjectId,
    name: string,
    order: number,
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection(LOTTERY_CASH_POINTS_COLLECTION)
      .insertOne({
        orgId,
        tenantId: tenant,
        positionKey: `position-${String(order)}`,
        name,
        order,
        enabled: true,
        printerId: null,
        note: null,
        moduleKey: "master-data",
        ...base(),
      });
    return insertedId;
  }

  async function shift(
    orgId: Types.ObjectId,
    cashPointId: Types.ObjectId,
    openedBy: Types.ObjectId,
  ): Promise<void> {
    await connection.collection(LOTTERY_SHIFTS_COLLECTION).insertOne({
      orgId,
      tenantId: tenant,
      cashPointId,
      openedBy,
      openedAt: taipei("08:00"),
      openingFloat: 5000,
      openingFloatSource: "handover",
      previousShiftId: null,
      openingMovementId: null,
      scheduleEntryId: null,
      scheduleTaskSnapshot: null,
      positionMismatch: null,
      closedAt: null,
      checkoutId: null,
      drawerVersion: 0,
      moduleKey: "store",
      ...base(),
    });
  }

  /** 分店那一筆:盤點制度與移櫃暫停(`movePauses`;全店重刷 T6、補點 T8 才會寫,這裡直接設)。 */
  async function setMode(
    orgId: Types.ObjectId,
    mode: "numbered" | "count" | "converting",
    movePauses: { gameId: Types.ObjectId | null }[] = [],
  ): Promise<void> {
    const pauses = movePauses.map((pause) => ({
      stocktakeId: new Types.ObjectId(),
      gameId: pause.gameId,
    }));
    await connection.collection(LOTTERY_STORE_COUNT_MODES_COLLECTION).updateOne(
      { orgId },
      {
        $set: {
          mode,
          since: taipei("07:00"),
          movePauses: pauses,
          // 補點編號的暫停跟著它的盤點中登記(全店、還有效;T8)
          stocktakeSessions: pauses.flatMap((pause) =>
            pause.gameId === null
              ? [
                  {
                    sessionId: `renumber-${String(pause.stocktakeId)}`,
                    type: "daily",
                    cashPointIds: [null],
                    by: new Types.ObjectId(),
                    startedAt: taipei("07:00"),
                    lastActiveAt: taipei("09:59"),
                    draft: null,
                    endedAt: null,
                    endedBy: null,
                    renumberPauseId: pause.stocktakeId,
                  },
                ]
              : [],
          ),
        },
        $setOnInsert: {
          orgId,
          tenantId: tenant,
          moduleKey: "store",
          lastRenumberAt: null,
          lastRenumberStocktakeId: null,
          history: [],
          version: 0,
          ...base(),
        },
      },
      { upsert: true },
    );
  }

  async function modeVersion(orgId: Types.ObjectId): Promise<number> {
    const record = await connection
      .collection<{ version: number }>(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .findOne({ orgId });
    return record?.version ?? Number.NaN;
  }

  function storeOperator(orgId: Types.ObjectId): OperatorContext {
    return {
      actorId: new Types.ObjectId(),
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

  /** 點收一本(標準 100 張;迄號 > 100 = 有待標註)。 */
  async function receiveBook(
    options: {
      game?: Types.ObjectId;
      orgId?: Types.ObjectId;
      lastTicketNo?: number;
    } = {},
  ): Promise<{ bookId: Types.ObjectId; bookNo: string }> {
    const orgId = options.orgId ?? xinyi;
    bookSequence += 1;
    const { book } = await api.app
      .get(TransactionService)
      .withTransaction((session) =>
        api.app
          .get(LotteryBooksService)
          .createBook(session, storeOperator(orgId), {
            orgId,
            gameId: options.game ?? gameId,
            bookNo: String(bookSequence).padStart(6, "0"),
            lastTicketNo: options.lastTicketNo ?? 100,
            rate: 92,
            cost: 18_400,
          }),
      );
    return { bookId: book._id, bookNo: book.bookNo };
  }

  /** 拆本(經 api):依張號分到收銀點,沒列到的放 A 台(板橋店放店內櫃台)。 */
  async function split(
    bookId: Types.ObjectId,
    places: { cashPointId: Types.ObjectId; ticketNos: string[] }[],
    options: {
      orgId?: Types.ObjectId;
      user?: StoreUser;
      skipped?: string[];
      last?: number;
    } = {},
  ): Promise<void> {
    const orgId = options.orgId ?? xinyi;
    const skipped = options.skipped ?? [];
    const listed = new Set([
      ...places.flatMap((place) => place.ticketNos),
      ...skipped,
    ]);
    const rest = range(1, options.last ?? 100).filter((no) => !listed.has(no));
    const assignments = places.map((place) => ({
      cashPointId: String(place.cashPointId),
      ticketNos: place.ticketNos,
    }));
    if (rest.length > 0) {
      assignments.push({
        cashPointId: String(orgId.equals(xinyi) ? counterA : counterBanqiao),
        ticketNos: rest,
      });
    }
    await ok(options.user ?? wang, SPLIT, {
      input: {
        orgId: String(orgId),
        bookId: String(bookId),
        skippedTicketNos: skipped,
        assignments,
      },
    });
  }

  async function ticketOf(
    bookId: Types.ObjectId,
    ticketNo: string,
  ): Promise<TicketDoc> {
    const found = await connection
      .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
      .findOne({ bookId, ticketNo });
    if (found === null) {
      throw new Error(`沒有 #${ticketNo}`);
    }
    return found;
  }

  async function eventsOf(
    ticketId: Types.ObjectId,
    type?: string,
  ): Promise<EventDoc[]> {
    return connection
      .collection<EventDoc>("lottery_ticket_events")
      .find({ ticketId, ...(type === undefined ? {} : { type }) })
      .sort({ at: 1, _id: 1 })
      .toArray();
  }

  /** 某位置某遊戲的系統未售張數(I1)。 */
  async function unsoldAt(
    cashPointId: Types.ObjectId | null,
    game = gameId,
  ): Promise<number> {
    return connection.collection(LOTTERY_TICKETS_COLLECTION).countDocuments({
      gameId: game,
      status: "unsold",
      orgId: xinyi,
      ...(cashPointId === null
        ? { "location.kind": "stock" }
        : {
            "location.kind": "counter",
            "location.cashPointId": cashPointId,
          }),
    });
  }

  /** 直接經帳本寫事件(模擬依張數賣、盤點待查之後的狀態,那些是 T3、T4 的票)。 */
  async function applyEvents(
    events: TicketEventInput[],
    orgId = xinyi,
  ): Promise<void> {
    await api.app
      .get(TransactionService)
      .withTransaction((session) =>
        api.app
          .get(TicketLedgerService)
          .applyTicketEvents(
            session,
            { operator: storeOperator(orgId) },
            events,
          ),
      );
  }

  /** 依張數賣挑到的張:已售·未對號(位置不變)。 */
  async function soldUnmatched(ticket: TicketDoc): Promise<void> {
    await applyEvents([
      {
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        type: "sale",
        amount: 200,
        patch: {
          status: "sold",
          unmatched: true,
          sold: { at: taipei("09:30"), source: "count" },
        },
      },
    ]);
  }

  /** 盤點 [待查] 挑到的張:待查·未對號(位置不變)。 */
  async function investigatingUnmatched(ticket: TicketDoc): Promise<void> {
    await applyEvents([
      {
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        type: "investigate",
        patch: {
          status: "investigating",
          responsibleOrgId: xinyi,
          unmatched: true,
        },
      },
    ]);
  }

  /** 一家店裡這個遊戲只剩這本(別本照挑張順序會先被挑到;每個情境用新遊戲)。 */
  let gameSequence = 0;
  async function freshGame(): Promise<Types.ObjectId> {
    gameSequence += 1;
    const { insertedId } = await connection
      .collection("lottery_games")
      .insertOne({
        orgId: tenant,
        tenantId: tenant,
        moduleKey: "master-data",
        shareOrgs: [{ orgId: tenant, includeDescendants: true }],
        gameCode: String(6000 + gameSequence),
        name: `測試遊戲 ${String(gameSequence)}`,
        unitPrice: 200,
        ticketsPerBook: 100,
        bookPrice: 20_000,
        defaultRate: 92,
        color: null,
        status: "on_sale",
        ...base(),
      });
    return insertedId;
  }

  async function counterScan(
    user: StoreUser,
    code: string,
    toCashPointId: Types.ObjectId | null = null,
  ): Promise<CounterScanRow[]> {
    const data = await ok<{
      lotteryStoreCounterScan: { items: CounterScanRow[] };
    }>(user, COUNTER_SCAN, {
      input: {
        orgId: String(xinyi),
        fromCashPointId: String(counterA),
        code,
        ...(toCashPointId === null
          ? {}
          : { toCashPointId: String(toCashPointId) }),
      },
    });
    return data.lotteryStoreCounterScan.items;
  }

  function recallInput(
    tickets: readonly TicketDoc[],
    source: "scan" | "grid" = "scan",
  ) {
    return {
      input: {
        orgId: String(xinyi),
        tickets: tickets.map((ticket) => refOf(ticket)),
        source,
        fromCashPointId: String(counterA),
      },
    };
  }

  function moveByCountInput(
    count: number,
    game = gameId,
    from = counterA,
    to = stallB,
  ) {
    return {
      input: {
        orgId: String(xinyi),
        fromCashPointId: String(from),
        toCashPointId: String(to),
        gameId: String(game),
        count,
      },
    };
  }

  /** 迄號 102 的本拆過又全部收回:不是原封不動、待標註 2。 */
  async function reopenedBook(
    orgId = xinyi,
  ): Promise<{ bookId: Types.ObjectId; bookNo: string }> {
    const book = await receiveBook({ orgId, lastTicketNo: 102 });
    const tickets = await connection
      .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
      .find({ bookId: book.bookId })
      .toArray();
    const at = orgId.equals(xinyi) ? counterA : counterBanqiao;
    await applyEvents(
      tickets.map((ticket) => ({
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        type: "open",
        patch: { location: { kind: "counter", cashPointId: at } },
        cashPointId: at,
      })),
      orgId,
    );
    const opened = await connection
      .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
      .find({ bookId: book.bookId })
      .toArray();
    await applyEvents(
      opened.map((ticket) => ({
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        type: "recall",
        patch: { location: { kind: "stock", cashPointId: null } },
        cashPointId: at,
      })),
      orgId,
    );
    return book;
  }

  function splitInput(
    bookId: Types.ObjectId,
    actualCount: number | null,
    skipped: string[],
    orgId = xinyi,
  ) {
    const point = orgId.equals(xinyi) ? counterA : counterBanqiao;
    return {
      input: {
        orgId: String(orgId),
        bookId: String(bookId),
        skippedTicketNos: skipped,
        assignments: [
          {
            cashPointId: String(point),
            ticketNos: range(1, 102).filter((no) => !skipped.includes(no)),
          },
        ],
        ...(actualCount === null ? {} : { actualCount }),
      },
    };
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-store-moves");
    connection = api.connection;
    await api.app
      .get<Model<LotteryShift>>(getModelToken(LotteryShift.name))
      .init();
    const module = (key: string, name: string, order: number) =>
      connection.collection("modules").insertOne({
        key,
        name,
        parentId: null,
        ancestors: [],
        route: key,
        sidebarType: "link",
        order,
        enabled: true,
        isSystem: false,
        icon: null,
        settings: {},
        engine: "fixed",
        ...base(),
      });
    const { insertedId: storeModuleId } = await module("store", "店面管理", 10);
    const { insertedId: inventoryModuleId } = await module(
      "inventory",
      "庫存管理",
      20,
    );
    await connection
      .collection("permissions")
      .insertMany([
        ...Object.values(S).map((key) => permission(key, storeModuleId)),
        ...Object.values(I).map((key) => permission(key, inventoryModuleId)),
      ]);
    await seedReasonCategory(connection, F.scrapReason, [
      { value: "damaged", label: "破損" },
    ]);
    await seedReasonCategory(connection, F.scrapUndoReason, [
      { value: "mis-scrapped", label: "報錯張" },
      { value: "other", label: "其他" },
    ]);
    await seedReasonCategory(connection, F.skipCorrectionReason, [
      { value: "mark-error", label: "標註錯誤" },
    ]);
    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
    banqiao = await createOrg(connection, { name: "板橋店", parentId: tenant });
    counterBanqiao = await cashPoint(banqiao, "店內櫃台", 1);
    gameId = await freshGame();
    otherGameId = await freshGame();

    const clerk = [S.view, S.sell, S.undoSale, S.split, S.move];
    wang = await storeUser([xinyi], clerk, "王小明");
    mover = await storeUser([xinyi], [S.view, S.move, S.split], "只會移櫃");
    banqiaoClerk = await storeUser([banqiao], clerk, "板橋店員");
    keeper = await storeUser(
      [xinyi, banqiao],
      [I.scrap, I.markSkipped, I.showCost, S.view],
      "庫存管理員",
      ["inventory", "store"],
    );
    await shift(banqiao, counterBanqiao, banqiaoClerk.userId);
    await setMode(xinyi, "count");
  }, HOOK_TIMEOUT_MS);

  // 每個情境用新的兩台收銀點與新的遊戲(挑張、找配對都看收銀點與遊戲;不受前面情境留下的張影響)
  let pointOrder = 0;
  beforeEach(async () => {
    pointOrder += 2;
    counterA = await cashPoint(
      xinyi,
      `店內櫃台 ${String(pointOrder)}`,
      pointOrder,
    );
    stallB = await cashPoint(
      xinyi,
      `店外攤位 ${String(pointOrder)}`,
      pointOrder + 1,
    );
    await shift(xinyi, counterA, wang.userId);
    gameId = await freshGame();
    otherGameId = await freshGame();
    now("10:00");
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await setMode(xinyi, "count");
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("收回(16.6 R1;規格 6.3、7.6)", () => {
    it("張數店只接受刷條碼或手輸張號的張:格子(或沒給來源台)→ COUNT_STORE_SCAN_ONLY;轉換中同樣", async () => {
      const { bookId } = await receiveBook();
      await split(bookId, []);
      const ticket = await ticketOf(bookId, "050");
      expect(
        await errorOf(wang, RECALL, recallInput([ticket], "grid")),
      ).toMatchObject({ reason: "COUNT_STORE_SCAN_ONLY" });
      await setMode(xinyi, "converting");
      expect(
        await errorOf(wang, RECALL, recallInput([ticket], "grid")),
      ).toMatchObject({ reason: "COUNT_STORE_SCAN_ONLY" });
      expect(await ticketOf(bookId, "050")).toMatchObject({
        location: { kind: "counter" },
      });
    });

    it("刷到這台檯面上的未售 → 照現況收回(事件記原收銀點);庫存張號 = 實體(I2)", async () => {
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, []);
      const [item] = await counterScan(wang, barcodeOf(bookNo, "050"));
      expect(item).toMatchObject({ problem: null, match: false });
      const ticket = await ticketOf(bookId, "050");
      await ok(wang, RECALL, recallInput([ticket]));
      expect(await ticketOf(bookId, "050")).toMatchObject({
        status: "unsold",
        location: { kind: "stock", cashPointId: null },
      });
      const [recall] = await eventsOf(ticket._id, "recall");
      expect(recall?.cashPointId?.equals(counterA)).toBe(true);
    });

    it("刷到已售·未對號 → 先在來源台對號再收回:刷到的張回庫存、配對張接手已售·未對號;各位置張數照收回的增減(I1、I2、I4)", async () => {
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, []);
      await soldUnmatched(await ticketOf(bookId, "001"));
      const unsoldBefore = await unsoldAt(counterA);
      const [item] = await counterScan(wang, barcodeOf(bookNo, "001"));
      expect(item).toMatchObject({
        status: "sold",
        unmatched: true,
        problem: null,
        match: true,
      });
      await ok(wang, RECALL, recallInput([await ticketOf(bookId, "001")]));
      expect(await ticketOf(bookId, "001")).toMatchObject({
        status: "unsold",
        unmatched: false,
        location: { kind: "stock", cashPointId: null },
      });
      // 配對張 = A 台照挑張順序的第一張未售(#002),接手已售·未對號、位置不變
      expect(await ticketOf(bookId, "002")).toMatchObject({
        status: "sold",
        unmatched: true,
        location: { kind: "counter" },
      });
      expect(await unsoldAt(counterA)).toBe(unsoldBefore - 1);
      const matches = await connection
        .collection<EventDoc & { amount: number; cashEffect: string }>(
          "lottery_ticket_events",
        )
        .find({ bookId, type: "match" })
        .toArray();
      expect(matches).toHaveLength(2);
      expect(
        matches.every(
          (event) => event.amount === 0 && event.cashEffect === "none",
        ),
      ).toBe(true);
    });

    it("刷到系統記在別台的未售 → 在來源台對號後從來源台收回;別台的張數不變(I1)", async () => {
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, [{ cashPointId: stallB, ticketNos: ["090"] }]);
      const atA = await unsoldAt(counterA);
      const atB = await unsoldAt(stallB);
      const [item] = await counterScan(wang, barcodeOf(bookNo, "090"));
      expect(item).toMatchObject({ problem: null, match: true });
      await ok(wang, RECALL, recallInput([await ticketOf(bookId, "090")]));
      expect(await ticketOf(bookId, "090")).toMatchObject({
        location: { kind: "stock" },
      });
      expect(await unsoldAt(counterA)).toBe(atA - 1);
      expect(await unsoldAt(stallB)).toBe(atB);
      const recalled = await ticketOf(bookId, "090");
      const [recall] = await eventsOf(recalled._id, "recall");
      expect(recall?.cashPointId?.equals(counterA)).toBe(true);
    });

    it("撿到不見的票刷條碼收回(16.6 F1 的收回一段):待查·未對號、來源台有配對 → 對號後收進庫存,配對張接手待查", async () => {
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, []);
      await investigatingUnmatched(await ticketOf(bookId, "001"));
      const [item] = await counterScan(wang, barcodeOf(bookNo, "001"));
      expect(item).toMatchObject({ match: true, problem: null });
      await ok(wang, RECALL, recallInput([await ticketOf(bookId, "001")]));
      expect(await ticketOf(bookId, "001")).toMatchObject({
        status: "unsold",
        location: { kind: "stock" },
      });
      expect(await ticketOf(bookId, "002")).toMatchObject({
        status: "investigating",
        unmatched: true,
      });
    });

    it("已售·未對號、來源台沒有可對號的張 → COUNTER_TICKET_BLOCKED unmatched_no_partner,什麼都不寫", async () => {
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, [{ cashPointId: stallB, ticketNos: range(2, 100) }]);
      await soldUnmatched(await ticketOf(bookId, "001"));
      const [item] = await counterScan(wang, barcodeOf(bookNo, "001"));
      expect(item).toMatchObject({
        problem: "unmatched_no_partner",
        match: false,
      });
      const before = await ticketOf(bookId, "001");
      expect(await errorOf(wang, RECALL, recallInput([before]))).toMatchObject({
        reason: "COUNTER_TICKET_BLOCKED",
        problems: [
          { ticketId: String(before._id), problem: "unmatched_no_partner" },
        ],
      });
      expect(await ticketOf(bookId, "001")).toMatchObject({
        version: before.version,
      });
    });

    it("刷到確定的已售、跳號、在庫存 → 當下說原因(不加進清單)", async () => {
      const { bookId, bookNo } = await receiveBook({ lastTicketNo: 101 });
      await split(bookId, [], { skipped: ["101"], last: 101 });
      const sold = await ticketOf(bookId, "003");
      await applyEvents([
        {
          ticketId: sold._id,
          expectedVersion: sold.version,
          type: "sale",
          amount: 200,
          patch: {
            status: "sold",
            sold: { at: taipei("09:00"), source: "scan" },
          },
        },
      ]);
      const problemOf = async (no: string) => {
        const [item] = await counterScan(wang, barcodeOf(bookNo, no));
        return item?.problem;
      };
      expect(await problemOf("003")).toBe("sold");
      expect(await problemOf("101")).toBe("skipped");
      await ok(wang, RECALL, recallInput([await ticketOf(bookId, "004")]));
      expect(await problemOf("004")).toBe("in_stock");
    });

    it("對號要 store.sell:只有移櫃權限的人刷到要對號的張 → FORBIDDEN;不用對號的照收回", async () => {
      const { bookId } = await receiveBook();
      await split(bookId, []);
      await soldUnmatched(await ticketOf(bookId, "001"));
      expect(
        await errorOf(
          mover,
          RECALL,
          recallInput([await ticketOf(bookId, "001")]),
        ),
      ).toMatchObject({ code: "FORBIDDEN" });
      await ok(mover, RECALL, recallInput([await ticketOf(bookId, "050")]));
    });

    it("編號店照現況:格子收回不用刷", async () => {
      const { bookId } = await receiveBook({ orgId: banqiao });
      await split(bookId, [], { orgId: banqiao, user: banqiaoClerk });
      const ticket = await ticketOf(bookId, "010");
      await ok(banqiaoClerk, RECALL, {
        input: { orgId: String(banqiao), tickets: [refOf(ticket)] },
      });
      expect(await ticketOf(bookId, "010")).toMatchObject({
        location: { kind: "stock" },
      });
    });
  });

  describe("移櫃(16.6 R2;規格 7.7、8.5a B1 / B2)", () => {
    it("依張數移櫃:照挑張順序挑來源台的張,各位置張數照移的數量增減(I1);上限 = 來源台這個遊戲的總剩餘(跨本)", async () => {
      const first = await receiveBook();
      const second = await receiveBook();
      now("09:00");
      await split(first.bookId, [
        { cashPointId: stallB, ticketNos: range(1, 98) },
      ]);
      now("09:30");
      await split(second.bookId, [
        { cashPointId: stallB, ticketNos: range(1, 97) },
      ]);
      now("10:00");
      // A 台:第一本 #099–100、第二本 #098–100 → 5 張(2 本)
      expect(await unsoldAt(counterA)).toBe(5);
      const atB = await unsoldAt(stallB);
      expect(
        await errorOf(wang, MOVE_BY_COUNT, moveByCountInput(6)),
      ).toMatchObject({
        reason: "MOVE_BY_COUNT_INVALID",
        problem: "exceeds",
        available: 5,
      });
      await ok(wang, MOVE_BY_COUNT, moveByCountInput(3));
      expect(await unsoldAt(counterA)).toBe(2);
      expect(await unsoldAt(stallB)).toBe(atB + 3);
      // 先拆的本、同一本張號小到大
      for (const [bookId, no] of [
        [first.bookId, "099"],
        [first.bookId, "100"],
        [second.bookId, "098"],
      ] as const) {
        expect(await ticketOf(bookId, no)).toMatchObject({
          location: { cashPointId: stallB },
        });
      }
    });

    it("依張數移櫃:轉換中、編號店擋 not_count_store;移到同一台擋;要 store.sell", async () => {
      const { bookId } = await receiveBook();
      await split(bookId, []);
      expect(
        await errorOf(
          wang,
          MOVE_BY_COUNT,
          moveByCountInput(1, gameId, counterA, counterA),
        ),
      ).toMatchObject({ problem: "same_cash_point" });
      expect(
        await errorOf(mover, MOVE_BY_COUNT, moveByCountInput(1)),
      ).toMatchObject({ code: "FORBIDDEN" });
      await setMode(xinyi, "converting");
      expect(
        await errorOf(wang, MOVE_BY_COUNT, moveByCountInput(1)),
      ).toMatchObject({ problem: "not_count_store", countMode: "converting" });
      await setMode(xinyi, "numbered");
      expect(
        await errorOf(wang, MOVE_BY_COUNT, moveByCountInput(1)),
      ).toMatchObject({ problem: "not_count_store", countMode: "numbered" });
    });

    it("張數店的「整本」/ 格子移櫃 → COUNT_STORE_SCAN_ONLY;刷條碼移櫃刷到已售·未對號 → 在來源台對號後移到 B 台", async () => {
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, []);
      const whole = await connection
        .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
        .find({ bookId })
        .toArray();
      expect(
        await errorOf(wang, MOVE, {
          input: {
            orgId: String(xinyi),
            tickets: whole.map((ticket) => refOf(ticket)),
            toCashPointId: String(stallB),
          },
        }),
      ).toMatchObject({ reason: "COUNT_STORE_SCAN_ONLY" });
      await soldUnmatched(await ticketOf(bookId, "001"));
      const [item] = await counterScan(wang, barcodeOf(bookNo, "001"), stallB);
      expect(item).toMatchObject({ problem: null, match: true });
      const atA = await unsoldAt(counterA);
      await ok(wang, MOVE, {
        input: {
          ...recallInput([await ticketOf(bookId, "001")]).input,
          toCashPointId: String(stallB),
        },
      });
      expect(await ticketOf(bookId, "001")).toMatchObject({
        status: "unsold",
        unmatched: false,
        location: { kind: "counter", cashPointId: stallB },
      });
      expect(await unsoldAt(counterA)).toBe(atA - 1);
      expect(await unsoldAt(stallB)).toBe(1);
    });

    it("刷條碼移櫃:來源台沒有可配對的張、系統記在要移到的那台 → already_there;移回來源台 → 照現況從系統記的那台移", async () => {
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, [{ cashPointId: stallB, ticketNos: range(1, 100) }]);
      const [there] = await counterScan(wang, barcodeOf(bookNo, "050"), stallB);
      expect(there).toMatchObject({ problem: "already_there", match: false });
      const [elsewhere] = await counterScan(
        wang,
        barcodeOf(bookNo, "050"),
        counterA,
      );
      expect(elsewhere).toMatchObject({ problem: null, match: false });
    });

    it("移櫃暫停:全店重刷遊戲 X → X 的兩種移櫃都擋、其他遊戲照常;補點編號 → 全部遊戲都擋;沒擋時分店那一筆 version +1", async () => {
      const x = await receiveBook();
      const y = await receiveBook({ game: otherGameId });
      await split(x.bookId, []);
      await split(y.bookId, []);
      await setMode(xinyi, "count", [{ gameId }]);
      expect(
        await errorOf(wang, MOVE_BY_COUNT, moveByCountInput(1)),
      ).toMatchObject({
        reason: "MOVE_PAUSED",
        pause: { kind: "rescan", gameId: String(gameId) },
      });
      expect(
        await errorOf(wang, MOVE, {
          input: {
            ...recallInput([await ticketOf(x.bookId, "010")]).input,
            toCashPointId: String(stallB),
          },
        }),
      ).toMatchObject({ reason: "MOVE_PAUSED" });
      const before = await modeVersion(xinyi);
      await ok(wang, MOVE_BY_COUNT, moveByCountInput(1, otherGameId));
      expect(await modeVersion(xinyi)).toBe(before + 1);
      // 看板回暫停的遊戲(按鈕變灰;後端一律再檢查)
      const board = await ok<{
        lotteryStoreBoard: {
          item: { movePauses: { gameId: string | null }[] };
        };
      }>(wang, BOARD, { orgId: String(xinyi) });
      expect(board.lotteryStoreBoard.item.movePauses).toEqual([
        { gameId: String(gameId) },
      ]);
      await setMode(xinyi, "count", [{ gameId: null }]);
      expect(
        await errorOf(wang, MOVE_BY_COUNT, moveByCountInput(1, otherGameId)),
      ).toMatchObject({ reason: "MOVE_PAUSED", pause: { kind: "renumber" } });
      // 收回不暫停(只暫停檯面之間的移櫃,8.5)
      await ok(wang, RECALL, recallInput([await ticketOf(x.bookId, "010")]));
    });

    it("依張數移櫃的資料庫指令數與張數無關(TX-06)", async () => {
      const { bookId } = await receiveBook();
      await split(bookId, []);
      const one = await countDbCommands(() =>
        ok(wang, MOVE_BY_COUNT, moveByCountInput(1)),
      );
      const five = await countDbCommands(() =>
        ok(wang, MOVE_BY_COUNT, moveByCountInput(5)),
      );
      expect(five.total).toBe(one.total);
    });
  });

  describe("拆本:手上實際張數(16.6 SC3、16.7 S11;規格 7.5)", () => {
    it("原封不動的本不問張數:照現況標滿待標註", async () => {
      const { bookId } = await receiveBook({ lastTicketNo: 102 });
      const stock = await ok<{
        lotteryStoreStockBooks: {
          items: {
            bookId: string;
            sealed: boolean;
            pendingSkipCount: number;
          }[];
        };
      }>(wang, STOCK_BOOKS, { orgId: String(xinyi) });
      expect(
        stock.lotteryStoreStockBooks.items.find(
          (item) => item.bookId === String(bookId),
        ),
      ).toMatchObject({ sealed: true, pendingSkipCount: 2 });
      await ok(wang, SPLIT, splitInput(bookId, null, ["101", "102"]));
      expect(await ticketOf(bookId, "101")).toMatchObject({
        status: "skipped",
      });
    });

    it("拆過又收回的本:要輸入實際張數;多了 / 少太多(超過待標註)擋下;差幾張標幾張", async () => {
      const { bookId } = await reopenedBook();
      const stock = await ok<{
        lotteryStoreStockBooks: {
          items: {
            bookId: string;
            sealed: boolean;
            ticketCount: number;
            pendingSkipTotal: number;
          }[];
        };
      }>(wang, STOCK_BOOKS, { orgId: String(xinyi) });
      expect(
        stock.lotteryStoreStockBooks.items.find(
          (item) => item.bookId === String(bookId),
        ),
      ).toMatchObject({ sealed: false, ticketCount: 102, pendingSkipTotal: 2 });
      expect(
        await errorOf(wang, SPLIT, splitInput(bookId, null, [])),
      ).toMatchObject({ reason: "SPLIT_ACTUAL_COUNT_REQUIRED" });
      expect(
        await errorOf(wang, SPLIT, splitInput(bookId, 104, [])),
      ).toMatchObject({
        reason: "SPLIT_ACTUAL_COUNT_MISMATCH",
        problem: "over",
        count: 2,
      });
      expect(
        await errorOf(wang, SPLIT, splitInput(bookId, 99, [])),
      ).toMatchObject({
        reason: "SPLIT_ACTUAL_COUNT_MISMATCH",
        problem: "short",
        count: 3,
      });
      // 少 1 張:要剛好標 1 張跳號(不要求標滿待標註)
      expect(
        await errorOf(wang, SPLIT, splitInput(bookId, 101, [])),
      ).toMatchObject({ reason: "SPLIT_PLAN_INVALID" });
      await ok(wang, SPLIT, splitInput(bookId, 101, ["102"]));
      expect(await ticketOf(bookId, "102")).toMatchObject({
        status: "skipped",
      });
      // 檯面上的張數 = 手上實際張數
      expect(await unsoldAt(counterA)).toBe(101);
    });

    it("整本待查後只尋回幾張:實際 = 系統 → 差 0、直接拆(待標註保留)", async () => {
      const { bookId } = await reopenedBook();
      await ok(wang, SPLIT, splitInput(bookId, 102, []));
      expect(await unsoldAt(counterA)).toBe(102);
    });

    it("編號店照現況:拆過的本不問張數、不標跳號", async () => {
      const { bookId } = await reopenedBook(banqiao);
      await ok(banqiaoClerk, SPLIT, splitInput(bookId, null, [], banqiao));
      expect(await ticketOf(bookId, "101")).toMatchObject({ status: "unsold" });
    });
  });

  describe("報廢只限庫存、撤銷報廢(16.6 SC1、SC2;規格 7.8)", () => {
    it("從沒拆過的本不能報廢;拆過的本檯面上的張要先收回;庫存的張可以報廢", async () => {
      const sealed = await receiveBook();
      expect(
        await errorOf(
          keeper,
          SCRAP,
          scrapInput([await ticketOf(sealed.bookId, "001")]),
        ),
      ).toMatchObject({
        reason: "SCRAP_NOT_ALLOWED",
        scrapBlock: "book_unopened",
      });
      const { bookId } = await receiveBook();
      await split(bookId, []);
      expect(
        await errorOf(
          keeper,
          SCRAP,
          scrapInput([await ticketOf(bookId, "001")]),
        ),
      ).toMatchObject({
        reason: "SCRAP_NOT_ALLOWED",
        scrapBlock: "not_in_stock",
      });
      await ok(wang, RECALL, recallInput([await ticketOf(bookId, "001")]));
      await ok(keeper, SCRAP, scrapInput([await ticketOf(bookId, "001")]));
      expect(await ticketOf(bookId, "001")).toMatchObject({
        status: "scrapped",
      });
    });

    it("撤銷報廢:inventory.scrap、原因必填;寫 scrap_undo(未售、位置不變、記成本快照與原因)、回扣回的損失", async () => {
      const { bookId } = await receiveBook();
      await split(bookId, []);
      await ok(wang, RECALL, recallInput([await ticketOf(bookId, "002")]));
      await ok(keeper, SCRAP, scrapInput([await ticketOf(bookId, "002")]));
      const scrapped = await ticketOf(bookId, "002");
      expect(
        await errorOf(keeper, UNDO_SCRAP, {
          input: { tickets: [refOf(scrapped)], reasonKey: "" },
        }),
      ).toMatchObject({ code: "VALIDATION_FAILED" });
      expect(
        await errorOf(wang, UNDO_SCRAP, {
          input: { tickets: [refOf(scrapped)], reasonKey: "mis-scrapped" },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
      const result = await ok<{
        undoLotteryScrap: { count: number; lossCost: number | null };
      }>(keeper, UNDO_SCRAP, {
        input: { tickets: [refOf(scrapped)], reasonKey: "mis-scrapped" },
      });
      expect(result.undoLotteryScrap).toEqual({ count: 1, lossCost: 184 });
      expect(await ticketOf(bookId, "002")).toMatchObject({
        status: "unsold",
        location: { kind: "stock", cashPointId: null },
      });
      const [undo] = await eventsOf(scrapped._id, "scrap_undo");
      expect(undo).toMatchObject({ cost: 184, reasonKey: "mis-scrapped" });
      // 不是報廢的張不能撤銷
      expect(
        await errorOf(keeper, UNDO_SCRAP, {
          input: {
            tickets: [refOf(await ticketOf(bookId, "002"))],
            reasonKey: "mis-scrapped",
          },
        }),
      ).toMatchObject({ reason: "TICKET_STATUS_NOT_ALLOWED" });
    });
  });

  describe("更正跳號(16.6 SK1;規格 7.10)", () => {
    it("張數店:跳號那張要刷或手輸(scanned);沒給 → COUNT_STORE_SCAN_ONLY", async () => {
      const { bookId } = await receiveBook({ lastTicketNo: 101 });
      await split(bookId, [], { skipped: ["101"], last: 101 });
      expect(
        await errorOf(
          keeper,
          SWAP,
          swapInput(
            bookId,
            await ticketOf(bookId, "101"),
            await ticketOf(bookId, "050"),
            null,
          ),
        ),
      ).toMatchObject({ reason: "COUNT_STORE_SCAN_ONLY" });
      await ok(
        keeper,
        SWAP,
        swapInput(
          bookId,
          await ticketOf(bookId, "101"),
          await ticketOf(bookId, "050"),
          true,
        ),
      );
      expect(await ticketOf(bookId, "101")).toMatchObject({
        status: "unsold",
        location: { kind: "counter" },
      });
      expect(await ticketOf(bookId, "050")).toMatchObject({
        status: "skipped",
      });
    });

    it("要改標跳號的張是已售·未對號 → 先把這個狀態移給同位置一張未售,再更正(張數照舊,I1)", async () => {
      const { bookId } = await receiveBook({ lastTicketNo: 101 });
      await split(bookId, [], { skipped: ["101"], last: 101 });
      await soldUnmatched(await ticketOf(bookId, "001"));
      const atA = await unsoldAt(counterA);
      await ok(
        keeper,
        SWAP,
        swapInput(
          bookId,
          await ticketOf(bookId, "101"),
          await ticketOf(bookId, "001"),
          true,
        ),
      );
      expect(await ticketOf(bookId, "001")).toMatchObject({
        status: "skipped",
      });
      expect(await ticketOf(bookId, "002")).toMatchObject({
        status: "sold",
        unmatched: true,
      });
      expect(await ticketOf(bookId, "101")).toMatchObject({
        status: "unsold",
        location: { kind: "counter" },
      });
      expect(await unsoldAt(counterA)).toBe(atA);
    });

    it("編號店照現況:不用 scanned", async () => {
      const { bookId } = await receiveBook({
        orgId: banqiao,
        lastTicketNo: 101,
      });
      await split(bookId, [], {
        orgId: banqiao,
        user: banqiaoClerk,
        skipped: ["101"],
        last: 101,
      });
      await ok(
        keeper,
        SWAP,
        swapInput(
          bookId,
          await ticketOf(bookId, "101"),
          await ticketOf(bookId, "050"),
          null,
        ),
      );
      expect(await ticketOf(bookId, "050")).toMatchObject({
        status: "skipped",
      });
    });
  });
});
