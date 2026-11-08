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

import { STORE_PERMISSIONS as S } from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

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
import { matchEventsOf } from "./store-matching";
import { StoreSalesSupport } from "./store-sales-support";

// ---- GraphQL ----

const SCAN = /* GraphQL */ `
  query Scan($input: LotteryStoreScanInput!) {
    lotteryStoreScan(input: $input) {
      items {
        ticketId
        version
        ticketNo
        status
        outcome
        blockReason
        unmatched
        match
      }
    }
  }
`;

const SALE_FIELDS = /* GraphQL */ `
  ticketId
  version
  ticketKey
  amount
  soldAt
  shiftId
  undone
  undoBlock
  matched
  countSale {
    refId
    gameId
    gameCode
    count
    undoneCount
    undoableCount
  }
`;

const SELL = /* GraphQL */ `
  mutation Sell($input: SellLotteryTicketsInput!) {
    sellLotteryTickets(input: $input) { items { ${SALE_FIELDS} } }
  }
`;

const SELL_BY_COUNT = /* GraphQL */ `
  mutation SellByCount($input: SellLotteryTicketsByCountInput!) {
    sellLotteryTicketsByCount(input: $input) {
      items {
        refId
        gameId
        gameCode
        count
        amount
      }
    }
  }
`;

const UNDO = /* GraphQL */ `
  mutation Undo($input: UndoLotteryTicketSaleInput!) {
    undoLotteryTicketSale(input: $input) { item { ${SALE_FIELDS} } }
  }
`;

const UNDO_COUNT = /* GraphQL */ `
  mutation UndoCount($input: UndoLotteryCountSaleInput!) {
    undoLotteryCountSale(input: $input) { item { ${SALE_FIELDS} } }
  }
`;

const RECENT = /* GraphQL */ `
  query Recent($shiftId: ID!) {
    lotteryStoreRecentSales(shiftId: $shiftId) { items { ${SALE_FIELDS} } }
  }
`;

const BOARD = /* GraphQL */ `
  query Board($orgId: ID!) {
    lotteryStoreBoard(orgId: $orgId) {
      item {
        countMode
        cashPoints {
          id
          shift {
            expectedCash
          }
          books {
            bookId
            remaining
          }
          gameTotals {
            gameId
            gameCode
            remaining
            bookCount
          }
        }
      }
    }
  }
`;

const CARD = /* GraphQL */ `
  query Card($orgId: ID!, $bookId: ID!) {
    lotteryStoreBookCard(orgId: $orgId, bookId: $bookId) {
      item {
        unmatchedCount
        tickets {
          ticketNo
          status
          unmatched
          soldSource
        }
      }
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

const RECOVER = /* GraphQL */ `
  mutation Recover($input: RecoverLotteryTicketsInput!) {
    recoverLotteryTickets(input: $input) {
      count
    }
  }
`;

// ---- 型別 ----

interface StoreUser {
  userId: Types.ObjectId;
  token: string;
}

interface ScanRow {
  ticketId: string;
  version: number;
  ticketNo: string;
  status: string;
  outcome: string;
  blockReason: string | null;
  unmatched: boolean;
  match: boolean;
}

interface SaleRow {
  ticketId: string;
  version: number;
  ticketKey: string;
  amount: number;
  soldAt: string;
  shiftId: string;
  undone: boolean;
  undoBlock: string | null;
  matched: boolean;
  countSale: {
    refId: string;
    gameId: string;
    gameCode: string;
    count: number;
    undoneCount: number;
    undoableCount: number;
  } | null;
}

interface CountSaleRow {
  refId: string;
  gameId: string;
  gameCode: string;
  count: number;
  amount: number;
}

type TicketDoc = LotteryTicketDocument & { _id: Types.ObjectId };

interface EventDoc {
  _id: Types.ObjectId;
  eventId: string;
  ticketId: Types.ObjectId;
  type: string;
  amount: number;
  cashEffect: string;
  refType: string | null;
  refId: Types.ObjectId | null;
  shiftId: Types.ObjectId | null;
  from: { status: string; unmatched: boolean } | null;
  to: { status: string; unmatched: boolean };
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

const taipei = (time: string) => new Date(`2026-11-05T${time}:00+08:00`);

/** 正面條碼 = 本號 7 位 + 張號 3 位。 */
const barcodeOf = (bookNo: string, ticketNo: string) => `${bookNo}${ticketNo}`;

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    String(from + index).padStart(3, "0"),
  );

/**
 * 張數店 T3 銷售(張數店規格第 6 節、7.1–7.3、7.9、13.4、14.2;驗收 16.3 對號 M1–M8、16.4 銷售與撤銷 SA1、U1、U3–U5,
 * 16.6 RC1):打真的 GraphQL 端點、對真 MongoDB(TEST-07);「現在」由 `StoreClock` 注入。每張 200 元。
 *
 * 組織樹:root ─ 租戶甲 ─┬─ 信義店(張數店;店內櫃台 = A 台、店外攤位 = B 台)
 *                        └─ 板橋店(編號店;店內櫃台)
 * 班:王 開 A 台、林 開 B 台;板橋店員開板橋店內櫃台。
 */
describe("張數店:對號、依張數賣與撤銷(GraphQL 端點 + 真 MongoDB)", () => {
  // 前置資料、api 的 `new Date()` 與店面時鐘同一條時間軸:從當天 00:00 起算,店面時鐘撥到的時間都在前置資料之後
  useFakeNow(new Date("2026-11-05T00:00:00+08:00"));

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

  /** 店員:銷售、當下撤銷、拆本(沒有移櫃) */
  let wang: StoreUser;
  let lin: StoreUser;
  let banqiaoClerk: StoreUser;

  let shiftA: Types.ObjectId;
  let shiftB: Types.ObjectId;

  let sequence = 0;
  let bookSequence = 71_000;

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
    const account = `store-count-${String(sequence)}`;
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
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .insertOne({
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
    return insertedId;
  }

  /** 分店實際的盤點制度(`lottery_store_count_modes` 一店一筆)。 */
  async function setMode(
    orgId: Types.ObjectId,
    mode: "numbered" | "count" | "converting",
  ): Promise<void> {
    await connection.collection(LOTTERY_STORE_COUNT_MODES_COLLECTION).updateOne(
      { orgId },
      {
        $set: { mode, since: taipei("07:00") },
        $setOnInsert: {
          orgId,
          tenantId: tenant,
          moduleKey: "store",
          lastRenumberAt: null,
          lastRenumberStocktakeId: null,
          history: [],
          movePauses: [],
          stocktakeSessions: [],
          version: 0,
          ...base(),
        },
      },
      { upsert: true },
    );
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

  /** 點收一本(標準 100 張)。 */
  async function receiveBook(
    game = gameId,
    orgId = xinyi,
    lastTicketNo = 100,
  ): Promise<{ bookId: Types.ObjectId; bookNo: string }> {
    bookSequence += 1;
    const { book } = await api.app
      .get(TransactionService)
      .withTransaction((session) =>
        api.app
          .get(LotteryBooksService)
          .createBook(session, storeOperator(orgId), {
            orgId,
            gameId: game,
            bookNo: String(bookSequence).padStart(6, "0"),
            lastTicketNo,
            rate: 92,
            cost: 18_400,
          }),
      );
    return { bookId: book._id, bookNo: book.bookNo };
  }

  /** 拆本:依張號分到收銀點(經 api,寫「拆本」事件;沒列到的留在 A 台)。 */
  async function split(
    bookId: Types.ObjectId,
    places: { cashPointId: Types.ObjectId; ticketNos: string[] }[],
    orgId = xinyi,
    user = wang,
  ): Promise<void> {
    const listed = new Set(places.flatMap((place) => place.ticketNos));
    const rest = range(1, 100).filter((no) => !listed.has(no));
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
    await ok(user, SPLIT, {
      input: {
        orgId: String(orgId),
        bookId: String(bookId),
        skippedTicketNos: [],
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

  async function eventsOf(ticketId: Types.ObjectId): Promise<EventDoc[]> {
    return connection
      .collection<EventDoc>("lottery_ticket_events")
      .find({ ticketId })
      .sort({ at: 1, _id: 1 })
      .toArray();
  }

  async function typesOf(ticketId: Types.ObjectId): Promise<string[]> {
    const events = await eventsOf(ticketId);
    return events.map((event) => event.type);
  }

  async function statusOf(
    bookId: Types.ObjectId,
    ticketNo: string,
  ): Promise<string> {
    const ticket = await ticketOf(bookId, ticketNo);
    return ticket.status;
  }

  /** 最近售出裡某一次依張數賣出那一列。 */
  async function countRowOf(
    user: StoreUser,
    shiftId: Types.ObjectId,
    refId: string,
  ): Promise<SaleRow | undefined> {
    const rows = await recent(user, shiftId);
    return rows.find((row) => row.countSale?.refId === refId);
  }

  /** 某位置某遊戲的系統未售張數(I1)。 */
  async function unsoldAt(
    cashPointId: Types.ObjectId,
    game = gameId,
  ): Promise<number> {
    return connection.collection(LOTTERY_TICKETS_COLLECTION).countDocuments({
      gameId: game,
      status: "unsold",
      "location.kind": "counter",
      "location.cashPointId": cashPointId,
    });
  }

  async function scan(
    user: StoreUser,
    code: string,
    local: Types.ObjectId = counterA,
    orgId = xinyi,
  ): Promise<ScanRow[]> {
    const data = await ok<{ lotteryStoreScan: { items: ScanRow[] } }>(
      user,
      SCAN,
      {
        input: {
          orgId: String(orgId),
          code,
          localCashPointId: String(local),
        },
      },
    );
    return data.lotteryStoreScan.items;
  }

  function sellInput(
    ticket: { _id: Types.ObjectId; version: number },
    local = counterA,
    orgId = xinyi,
  ) {
    return {
      input: {
        orgId: String(orgId),
        localCashPointId: String(local),
        tickets: [{ ticketId: String(ticket._id), version: ticket.version }],
        source: "scan",
      },
    };
  }

  async function sell(
    user: StoreUser,
    ticket: TicketDoc,
    local = counterA,
  ): Promise<SaleRow> {
    const data = await ok<{ sellLotteryTickets: { items: SaleRow[] } }>(
      user,
      SELL,
      sellInput(ticket, local),
    );
    const [row] = data.sellLotteryTickets.items;
    if (row === undefined) {
      throw new Error("沒有售出");
    }
    return row;
  }

  function byCountInput(
    lines: { gameId: Types.ObjectId; count: number }[],
    local = counterA,
    orgId = xinyi,
  ) {
    return {
      input: {
        orgId: String(orgId),
        localCashPointId: String(local),
        lines: lines.map((line) => ({
          gameId: String(line.gameId),
          count: line.count,
        })),
        reasonKey: "too-busy",
      },
    };
  }

  async function sellByCount(
    user: StoreUser,
    count: number,
    local = counterA,
    game = gameId,
  ): Promise<CountSaleRow> {
    const data = await ok<{
      sellLotteryTicketsByCount: { items: CountSaleRow[] };
    }>(user, SELL_BY_COUNT, byCountInput([{ gameId: game, count }], local));
    const [row] = data.sellLotteryTicketsByCount.items;
    if (row === undefined) {
      throw new Error("沒有依張數售出");
    }
    return row;
  }

  async function expectedOf(cashPointId: Types.ObjectId): Promise<number> {
    const data = await ok<{
      lotteryStoreBoard: {
        item: {
          cashPoints: { id: string; shift: { expectedCash: number } | null }[];
        };
      };
    }>(wang, BOARD, { orgId: String(xinyi) });
    return (
      data.lotteryStoreBoard.item.cashPoints.find(
        (point) => point.id === String(cashPointId),
      )?.shift?.expectedCash ?? Number.NaN
    );
  }

  async function recent(
    user: StoreUser,
    shiftId: Types.ObjectId,
  ): Promise<SaleRow[]> {
    const data = await ok<{ lotteryStoreRecentSales: { items: SaleRow[] } }>(
      user,
      RECENT,
      { shiftId: String(shiftId) },
    );
    return data.lotteryStoreRecentSales.items;
  }

  /** 直接經帳本寫事件(模擬盤點 / 重刷 / 補點之後的狀態,那些是 T4、T6、T8 的票)。 */
  async function applyEvents(events: TicketEventInput[]): Promise<void> {
    await api.app
      .get(TransactionService)
      .withTransaction((session) =>
        api.app
          .get(TicketLedgerService)
          .applyTicketEvents(
            session,
            { operator: storeOperator(xinyi) },
            events,
          ),
      );
  }

  /** 盤點 [待查] 挑到的張:待查·未對號(位置不變、責任分店 = 這家店)。 */
  async function investigateUnmatched(ticket: TicketDoc): Promise<void> {
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

  /** 對號(全店重刷刷到時的互換,T6 的票;這裡直接用同一個 `matchEventsOf`)。 */
  async function swap(scanned: TicketDoc, partner: TicketDoc): Promise<void> {
    await applyEvents(
      matchEventsOf(scanned as never, partner as never, taipei("09:00")),
    );
  }

  /** 卡片在某收銀點的剩餘。 */
  async function cardRemaining(
    cashPointId: Types.ObjectId,
    bookId: Types.ObjectId,
  ): Promise<number | undefined> {
    const data = await ok<{
      lotteryStoreBoard: {
        item: {
          cashPoints: {
            id: string;
            books: { bookId: string; remaining: number }[];
          }[];
        };
      };
    }>(wang, BOARD, { orgId: String(xinyi) });
    return data.lotteryStoreBoard.item.cashPoints
      .find((point) => point.id === String(cashPointId))
      ?.books.find((book) => book.bookId === String(bookId))?.remaining;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-store-count");
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
    await connection.collection("permissions").insertMany([
      ...Object.values(S).map((key) => ({
        key,
        moduleId: storeModuleId,
        name: key,
        enabled: true,
        isSystem: false,
        settings: {},
        source: "seed",
        retiredAt: null,
        ...base(),
      })),
      {
        key: "inventory.recover",
        moduleId: inventoryModuleId,
        name: "inventory.recover",
        enabled: true,
        isSystem: false,
        settings: {},
        source: "seed",
        retiredAt: null,
        ...base(),
      },
    ]);
    await seedReasonCategory(
      connection,
      LOTTERY_FIELD_CATEGORY_KEYS.countSaleReason,
      [
        { value: "too-busy", label: "太忙沒刷" },
        { value: "other", label: "其他" },
      ],
    );
    await seedReasonCategory(
      connection,
      LOTTERY_FIELD_CATEGORY_KEYS.recoverReason,
      [{ value: "found", label: "找到了" }],
    );
    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
    banqiao = await createOrg(connection, { name: "板橋店", parentId: tenant });
    counterBanqiao = await cashPoint(banqiao, "店內櫃台", 1);
    const game = (gameCode: string, name: string) =>
      connection.collection("lottery_games").insertOne({
        orgId: tenant,
        tenantId: tenant,
        moduleKey: "master-data",
        shareOrgs: [{ orgId: tenant, includeDescendants: true }],
        gameCode,
        name,
        unitPrice: 200,
        ticketsPerBook: 100,
        bookPrice: 20_000,
        defaultRate: 92,
        color: null,
        status: "on_sale",
        ...base(),
      });
    ({ insertedId: gameId } = await game("5164", "發大財"));
    ({ insertedId: otherGameId } = await game("5170", "大吉利"));

    const clerk = [S.view, S.sell, S.undoSale, S.split];
    wang = await storeUser([xinyi], clerk, "王小明");
    lin = await storeUser([xinyi], clerk, "林小美");
    banqiaoClerk = await storeUser([banqiao], clerk, "板橋店員");

    await shift(banqiao, counterBanqiao, banqiaoClerk.userId);
    await setMode(xinyi, "count");
  }, HOOK_TIMEOUT_MS);

  // 每個情境用新的兩台收銀點(挑張、找配對都看收銀點;不受前面情境留下的張影響)
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
    shiftA = await shift(xinyi, counterA, wang.userId);
    shiftB = await shift(xinyi, stallB, lin.userId);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await setMode(xinyi, "count");
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("依張數賣(16.4 SA1;規格 7.2)", () => {
    it("照挑張順序記已售·未對號(先拆先賣 → 本號 → 張號)、每張一筆售出、算這一班現金", async () => {
      now("10:00");
      const later = await receiveBook();
      const earlier = await receiveBook();
      // 先拆的那本(本號較大)排前面
      now("09:00");
      await split(earlier.bookId, []);
      now("09:30");
      await split(later.bookId, []);
      now("10:00");
      const before = await expectedOf(counterA);
      const row = await sellByCount(wang, 2);
      expect(row).toMatchObject({ count: 2, amount: 400, gameCode: "5164" });
      expect(await expectedOf(counterA)).toBe(before + 400);
      for (const no of ["001", "002"]) {
        const ticket = await ticketOf(earlier.bookId, no);
        expect(ticket).toMatchObject({
          status: "sold",
          unmatched: true,
          soldSource: "count",
        });
        const events = await eventsOf(ticket._id);
        const sale = events[2];
        expect(sale).toMatchObject({
          type: "sale",
          refType: "count_sale",
          refId: new Types.ObjectId(row.refId),
          to: { status: "sold", unmatched: true },
          shiftId: shiftA,
          cashEffect: "increase",
          amount: 200,
        });
        expect(ticket.saleEventId).toBe(sale?.eventId);
      }
      expect(await statusOf(later.bookId, "001")).toBe("unsold");
    });

    it("一次好幾個遊戲:同一個交易,每個遊戲各一個 refId;同遊戲兩列被擋", async () => {
      now("10:10");
      const { bookId } = await receiveBook(otherGameId);
      await split(bookId, []);
      const own = await receiveBook();
      await split(own.bookId, []);
      const data = await ok<{
        sellLotteryTicketsByCount: { items: CountSaleRow[] };
      }>(
        wang,
        SELL_BY_COUNT,
        byCountInput([
          { gameId, count: 1 },
          { gameId: otherGameId, count: 2 },
        ]),
      );
      const [first, second] = data.sellLotteryTicketsByCount.items;
      expect(first?.refId).not.toBe(second?.refId);
      expect(second).toMatchObject({ gameCode: "5170", count: 2 });
      expect(
        await errorOf(
          wang,
          SELL_BY_COUNT,
          byCountInput([
            { gameId, count: 1 },
            { gameId, count: 1 },
          ]),
        ),
      ).toMatchObject({
        reason: "COUNT_SALE_INVALID",
        problem: "duplicate_game",
      });
    });

    it("張數超過這台這個遊戲的未售 → 擋下並帶還有幾張,什麼都不寫", async () => {
      now("10:20");
      const available = await unsoldAt(stallB);
      const { bookId } = await receiveBook();
      await split(bookId, [{ cashPointId: stallB, ticketNos: range(1, 3) }]);
      const extensions = await errorOf(
        lin,
        SELL_BY_COUNT,
        byCountInput([{ gameId, count: available + 4 }], stallB),
      );
      expect(extensions).toMatchObject({
        reason: "COUNT_SALE_INVALID",
        problem: "exceeds",
        available: available + 3,
      });
      expect(await unsoldAt(stallB)).toBe(available + 3);
    });

    it("編號店與轉換中不能用(9.2)", async () => {
      now("10:30");
      const { bookId } = await receiveBook(gameId, banqiao);
      await split(bookId, [], banqiao, banqiaoClerk);
      expect(
        await errorOf(
          banqiaoClerk,
          SELL_BY_COUNT,
          byCountInput([{ gameId, count: 1 }], counterBanqiao, banqiao),
        ),
      ).toMatchObject({
        reason: "COUNT_SALE_NOT_ALLOWED",
        countMode: "numbered",
      });
      await setMode(xinyi, "converting");
      expect(
        await errorOf(
          wang,
          SELL_BY_COUNT,
          byCountInput([{ gameId, count: 1 }]),
        ),
      ).toMatchObject({
        reason: "COUNT_SALE_NOT_ALLOWED",
        countMode: "converting",
      });
    });

    it("資料庫指令數與張數無關(TX-06):依張數賣 1 張與 5 張相同", async () => {
      now("10:40");
      const { bookId } = await receiveBook();
      await split(bookId, []);
      await sellByCount(wang, 1);
      const one = await countDbCommands(() => sellByCount(wang, 1));
      const five = await countDbCommands(() => sellByCount(wang, 5));
      expect(five.total).toBe(one.total);
    });
  });

  describe("對號(16.3)", () => {
    it("M1 / 6.6 例子:B 台依張數賣 #041,A 台刷到實體 #041 → 和 A 台的配對張互換狀態 + 位置後賣出;B 班那筆不變", async () => {
      now("10:00");
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, [{ cashPointId: stallB, ticketNos: ["041"] }]);
      const cashA = await expectedOf(counterA);
      const cashB = await expectedOf(stallB);
      await sellByCount(lin, 1, stallB);
      const countSale = await ticketOf(bookId, "041");
      expect(countSale).toMatchObject({ status: "sold", unmatched: true });
      const unsoldA = await unsoldAt(counterA);
      const unsoldB = await unsoldAt(stallB);

      now("15:00");
      const [item] = await scan(wang, barcodeOf(bookNo, "041"));
      expect(item).toMatchObject({
        outcome: "sell",
        match: true,
        unmatched: true,
      });
      const row = await sell(wang, countSale);
      expect(row).toMatchObject({ matched: true, amount: 200 });

      // #041 變未售在 A 台、再賣出;配對張 #001(A 台照挑張順序第一張)接手已售·未對號在 B 台
      const sold = await ticketOf(bookId, "041");
      expect(sold).toMatchObject({
        status: "sold",
        unmatched: false,
        soldSource: "scan",
        location: { kind: "counter", cashPointId: counterA },
      });
      const partner = await ticketOf(bookId, "001");
      expect(partner).toMatchObject({
        status: "sold",
        unmatched: true,
        soldSource: "count",
        soldBy: lin.userId,
        saleEventId: countSale.saleEventId,
        location: { kind: "counter", cashPointId: stallB },
      });
      // 兩筆對號:不影響現金、金額 0、refId = 另一張;原本的依張數售出事件不改(I4)
      const countEvents = await eventsOf(countSale._id);
      const countEvent = countEvents[2];
      const after = countEvents.slice(3);
      expect(countEvent).toMatchObject({
        type: "sale",
        refType: "count_sale",
        shiftId: shiftB,
      });
      expect(after.map((event) => event.type)).toEqual(["match", "sale"]);
      expect(after[0]).toMatchObject({
        cashEffect: "none",
        amount: 0,
        refType: "ticket_match",
        refId: partner._id,
      });
      const partnerEvents = await eventsOf(partner._id);
      expect(partnerEvents.at(-1)).toMatchObject({
        type: "match",
        cashEffect: "none",
        amount: 0,
        refId: countSale._id,
        to: { status: "sold", unmatched: true },
      });
      // 各位置張數:B 台不變,A 台只少賣掉的那 1 張(I1);B 班 +200 不變,A 班 +200(I5)
      expect(await unsoldAt(stallB)).toBe(unsoldB);
      expect(await unsoldAt(counterA)).toBe(unsoldA - 1);
      expect(await expectedOf(stallB)).toBe(cashB + 200);
      expect(await expectedOf(counterA)).toBe(cashA + 200);
    });

    it("M1 同位置只換狀態;M2 同位置照挑張順序(先拆的本、可跨本)", async () => {
      now("11:00");
      const first = await receiveBook();
      const second = await receiveBook();
      now("10:50");
      await split(second.bookId, [
        { cashPointId: stallB, ticketNos: range(1, 100) },
      ]);
      now("10:55");
      await split(first.bookId, [
        { cashPointId: stallB, ticketNos: range(1, 100) },
      ]);
      now("11:00");
      // B 台依張數賣 1 張 → 先拆的 second #001
      await sellByCount(lin, 1, stallB);
      const guessed = await ticketOf(second.bookId, "001");
      expect(guessed).toMatchObject({ status: "sold", unmatched: true });
      // B 台刷到實體 first #050(未售、同位置)→ 照現況直接賣,不對號
      const [plain] = await scan(lin, barcodeOf(first.bookNo, "050"), stallB);
      expect(plain).toMatchObject({ outcome: "sell", match: false });
      // B 台刷到 second #001(系統記已售·未對號)→ 同位置的配對張:先拆的 second #002
      const [item] = await scan(lin, barcodeOf(second.bookNo, "001"), stallB);
      expect(item).toMatchObject({ outcome: "sell", match: true });
      await sell(lin, guessed, stallB);
      expect(await ticketOf(second.bookId, "002")).toMatchObject({
        status: "sold",
        unmatched: true,
        location: { kind: "counter", cashPointId: stallB },
      });
    });

    it("M3 張數店刷到「系統未售但在別台」:換位置後賣,不走移櫃並售出、不需 store.move;編號店照舊", async () => {
      now("11:10");
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, [{ cashPointId: stallB, ticketNos: ["070"] }]);
      const unsoldB = await unsoldAt(stallB);
      // 王沒有 store.move
      const [item] = await scan(wang, barcodeOf(bookNo, "070"));
      expect(item).toMatchObject({ outcome: "sell", match: true });
      const row = await sell(wang, await ticketOf(bookId, "070"));
      expect(row.matched).toBe(true);
      const sold070 = await ticketOf(bookId, "070");
      expect(sold070).toMatchObject({
        status: "sold",
        location: { kind: "counter", cashPointId: counterA },
      });
      // 配對張 #001 換到 B 台(未售),B 台張數不變;沒有「移櫃」事件
      expect(await ticketOf(bookId, "001")).toMatchObject({
        status: "unsold",
        unmatched: false,
        location: { kind: "counter", cashPointId: stallB },
      });
      expect(await unsoldAt(stallB)).toBe(unsoldB);
      expect(await typesOf(sold070._id)).not.toContain("move");

      // 編號店:別台(別人的班)、沒有 store.move → 擋下
      await setMode(xinyi, "numbered");
      const other = await receiveBook();
      await split(other.bookId, [{ cashPointId: stallB, ticketNos: ["070"] }]);
      const [numbered] = await scan(wang, barcodeOf(other.bookNo, "070"));
      expect(numbered).toMatchObject({
        outcome: "move_forbidden",
        match: false,
      });
    });

    it("M4 找不到配對:已售·未對號 → unmatched_no_partner(刷到時與售出都擋);待查·未對號 → 尋回", async () => {
      now("11:20");
      const { bookId, bookNo } = await receiveBook(otherGameId);
      // 大吉利只放 B 台;A 台沒有大吉利
      await split(bookId, [{ cashPointId: stallB, ticketNos: range(1, 100) }]);
      await sellByCount(lin, 100, stallB, otherGameId);
      const sold = await ticketOf(bookId, "001");
      const [item] = await scan(wang, barcodeOf(bookNo, "001"));
      expect(item).toMatchObject({
        outcome: "blocked",
        blockReason: "unmatched_no_partner",
        match: false,
      });
      expect(await errorOf(wang, SELL, sellInput(sold))).toMatchObject({
        reason: "TICKET_NOT_SELLABLE",
        blockReason: "unmatched_no_partner",
      });
      expect(await typesOf(sold._id)).toEqual(["purchase", "open", "sale"]);

      const other = await receiveBook(otherGameId);
      await split(other.bookId, [
        { cashPointId: stallB, ticketNos: range(1, 100) },
      ]);
      await sellByCount(lin, 99, stallB, otherGameId);
      const last = await ticketOf(other.bookId, "100");
      await investigateUnmatched(last);
      const [missing] = await scan(wang, barcodeOf(other.bookNo, "100"));
      expect(missing).toMatchObject({ outcome: "recover", match: false });
    });

    it("M5 兩台同時搶同一張配對 → 後到的重跑、挑別張,兩筆都成功", async () => {
      now("11:30");
      const { bookId } = await receiveBook();
      await split(bookId, [{ cashPointId: stallB, ticketNos: ["090", "091"] }]);
      await sellByCount(lin, 2, stallB);
      const first = await ticketOf(bookId, "090");
      const second = await ticketOf(bookId, "091");
      const results = await Promise.all([
        gql(wang, SELL, sellInput(first)),
        gql(wang, SELL, sellInput(second)),
      ]);
      expect(results.map((result) => result.errors)).toEqual([
        undefined,
        undefined,
      ]);
      const partners = await connection
        .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
        .find({ bookId, status: "sold", unmatched: true })
        .toArray();
      expect(
        partners
          .map((ticket) => ticket.ticketNo)
          .toSorted((left, right) => left.localeCompare(right)),
      ).toEqual(["001", "002"]);
    });

    it("M6 鎖定的張不對號(locked);配對不挑鎖定、未拆的本、別的遊戲、別家店", async () => {
      now("11:40");
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, [{ cashPointId: stallB, ticketNos: ["080", "081"] }]);
      await sellByCount(lin, 2, stallB);
      const locked = await ticketOf(bookId, "080");
      await connection.collection(LOTTERY_TICKETS_COLLECTION).updateOne(
        { _id: locked._id },
        {
          $set: {
            lockedBy: {
              refType: "sale_reversal",
              refId: new Types.ObjectId(),
            },
          },
        },
      );
      const [item] = await scan(wang, barcodeOf(bookNo, "080"));
      expect(item).toMatchObject({
        outcome: "blocked",
        blockReason: "locked",
        match: false,
      });
      // A 台 #001 被鎖 → 配對挑 #002
      const first = await ticketOf(bookId, "001");
      await connection.collection(LOTTERY_TICKETS_COLLECTION).updateOne(
        { _id: first._id },
        {
          $set: {
            lockedBy: { refType: "transfer", refId: new Types.ObjectId() },
          },
        },
      );
      await sell(wang, await ticketOf(bookId, "081"));
      expect(await ticketOf(bookId, "002")).toMatchObject({
        status: "sold",
        unmatched: true,
      });
      expect(await ticketOf(bookId, "001")).toMatchObject({ status: "unsold" });

      // 別的遊戲不當配對:A 台只剩大吉利、B 台的發大財全賣掉時,發大財的已售·未對號找不到配對;
      // 未拆的本(庫存)也不算
      const lonely = await receiveBook();
      await split(lonely.bookId, [
        { cashPointId: stallB, ticketNos: range(1, 100) },
      ]);
      // A 台的發大財只留被鎖的 #001
      await sellByCount(wang, (await unsoldAt(counterA)) - 1, counterA);
      await sellByCount(lin, await unsoldAt(stallB), stallB);
      const sealed = await receiveBook();
      const ownOther = await receiveBook(otherGameId);
      await split(ownOther.bookId, []);
      const guessed = await connection
        .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
        .findOne({ bookId: lonely.bookId, status: "sold", unmatched: true });
      if (guessed === null) {
        throw new Error("沒有依張數售出");
      }
      const [noPartner] = await scan(
        wang,
        barcodeOf(lonely.bookNo, guessed.ticketNo),
      );
      expect(noPartner).toMatchObject({
        outcome: "blocked",
        blockReason: "unmatched_no_partner",
      });
      expect(await statusOf(sealed.bookId, "001")).toBe("unsold");

      // 別家店的張:不跨店對號
      const elsewhere = await receiveBook(gameId, banqiao);
      await split(elsewhere.bookId, [], banqiao, banqiaoClerk);
      const [foreign] = await scan(wang, barcodeOf(elsewhere.bookNo, "001"));
      expect(foreign).toMatchObject({
        outcome: "blocked",
        blockReason: "not_this_store",
      });
    });

    it("M7 刷到記跳號或報廢的張 → 擋下(提示更正)", async () => {
      now("11:50");
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, []);
      for (const [no, status] of [
        ["010", "skipped"],
        ["011", "scrapped"],
      ] as const) {
        await connection
          .collection(LOTTERY_TICKETS_COLLECTION)
          .updateOne({ bookId, ticketNo: no }, { $set: { status } });
        const [item] = await scan(wang, barcodeOf(bookNo, no));
        expect(item).toMatchObject({
          outcome: "blocked",
          blockReason: status,
          match: false,
        });
      }
    });

    it("售出時對號的資料庫指令數(TX-06):對號賣 3 張只比 1 張多「配對張接手的值」的種類數", async () => {
      now("11:55");
      const { bookId } = await receiveBook();
      await split(bookId, [
        { cashPointId: stallB, ticketNos: ["091", "092", "093", "094"] },
      ]);
      await sellByCount(lin, 4, stallB);
      const sellAll = async (nos: string[]) => {
        const tickets = await Promise.all(
          nos.map((no) => ticketOf(bookId, no)),
        );
        return () =>
          ok(wang, SELL, {
            input: {
              orgId: String(xinyi),
              localCashPointId: String(counterA),
              tickets: tickets.map((ticket) => ({
                ticketId: String(ticket._id),
                version: ticket.version,
              })),
              source: "scan",
            },
          });
      };
      const one = await countDbCommands(await sellAll(["091"]));
      const three = await countDbCommands(await sellAll(["092", "093", "094"]));
      // 帳本依要改的值分組(TX-06):刷到的張接手的都是「A 台未售」= 同一組;配對張各自接手不同的售出事件 →
      // 多 2 張就多 2 組(多出的次數只等於多出的值的種類),其他指令數不變
      expect(three.byCommand.get("lottery_tickets.updateMany")).toBe(
        (one.byCommand.get("lottery_tickets.updateMany") ?? 0) + 2,
      );
      expect(three.total).toBe(one.total + 2);
    });

    it("M8 對號與售出同一個交易:後面失敗時什麼都不寫", async () => {
      now("12:00");
      const { bookId } = await receiveBook();
      await split(bookId, [{ cashPointId: stallB, ticketNos: ["060"] }]);
      await sellByCount(lin, 1, stallB);
      const guessed = await ticketOf(bookId, "060");
      const before = await expectedOf(counterA);
      // 交易裡鎖抽屜那一刻那一班已結帳 → 售出做不了
      jest
        .spyOn(api.app.get(StoreSalesSupport), "lockDrawer")
        .mockResolvedValue(null);
      expect(await errorOf(wang, SELL, sellInput(guessed))).toMatchObject({
        reason: "LOCAL_SHIFT_NOT_OPEN",
      });
      jest.restoreAllMocks();
      expect(await ticketOf(bookId, "060")).toMatchObject({
        status: "sold",
        unmatched: true,
        version: guessed.version,
      });
      expect(await ticketOf(bookId, "001")).toMatchObject({ status: "unsold" });
      expect(await typesOf(guessed._id)).not.toContain("match");
      expect(await expectedOf(counterA)).toBe(before);
    });
  });

  describe("撤銷(16.4)", () => {
    it("U1 刷退的票:這台刷條碼賣出 → 照張號撤", async () => {
      now("13:00");
      const { bookId } = await receiveBook();
      await split(bookId, []);
      await sell(wang, await ticketOf(bookId, "005"));
      const sold = await ticketOf(bookId, "005");
      const before = await expectedOf(counterA);
      const data = await ok<{ undoLotteryTicketSale: { item: SaleRow } }>(
        wang,
        UNDO,
        {
          input: {
            ticketId: String(sold._id),
            version: sold.version,
            orgId: String(xinyi),
            localCashPointId: String(counterA),
          },
        },
      );
      expect(data.undoLotteryTicketSale.item).toMatchObject({
        undone: true,
        matched: false,
      });
      expect(await ticketOf(bookId, "005")).toMatchObject({ status: "unsold" });
      expect(await expectedOf(counterA)).toBe(before - 200);
    });

    it("U1 7.3 例子:#043 系統記待查 → 先和這台最近一筆依張數售出(#040)對號再撤;兩張都對了", async () => {
      now("13:10");
      const { bookId } = await receiveBook();
      // 1 號台(A 台)#038~#050 記未售;其他放 B 台
      await split(bookId, [
        {
          cashPointId: stallB,
          ticketNos: [...range(1, 37), ...range(51, 100)],
        },
        { cashPointId: counterA, ticketNos: range(38, 50) },
      ]);
      const cashBefore = await expectedOf(counterA);
      // 客人挑走 #043 沒刷,系統記 #038 已售·未對號
      await sellByCount(wang, 1);
      expect(await ticketOf(bookId, "038")).toMatchObject({
        status: "sold",
        unmatched: true,
      });
      // 盤點少 1 張,系統猜 #039 待查;全店重刷:#038 配到 #040、#039 配到 #043
      await investigateUnmatched(await ticketOf(bookId, "039"));
      await swap(await ticketOf(bookId, "038"), await ticketOf(bookId, "040"));
      await swap(await ticketOf(bookId, "039"), await ticketOf(bookId, "043"));
      expect(await ticketOf(bookId, "043")).toMatchObject({
        status: "investigating",
        unmatched: true,
      });
      const unsoldA = await unsoldAt(counterA);
      // 客人退 #043
      now("13:20");
      const returned = await ticketOf(bookId, "043");
      const data = await ok<{ undoLotteryTicketSale: { item: SaleRow } }>(
        wang,
        UNDO,
        {
          input: {
            ticketId: String(returned._id),
            version: returned.version,
            orgId: String(xinyi),
            localCashPointId: String(counterA),
          },
        },
      );
      expect(data.undoLotteryTicketSale.item).toMatchObject({
        matched: true,
        undone: true,
        soldAt: taipei("13:10").toISOString(),
      });
      expect(await ticketOf(bookId, "043")).toMatchObject({
        status: "unsold",
        unmatched: false,
        location: { kind: "counter", cashPointId: counterA },
      });
      expect(await ticketOf(bookId, "040")).toMatchObject({
        status: "investigating",
        unmatched: true,
        responsibleOrgId: xinyi,
      });
      // A 台未售多回 1 張(退回的票),應有現金回到賣之前(I1、I5)
      expect(await unsoldAt(counterA)).toBe(unsoldA + 1);
      expect(await expectedOf(counterA)).toBe(cashBefore);
    });

    it("U3 退的票系統記跳號或報廢 → 擋下並提示", async () => {
      now("13:30");
      const { bookId } = await receiveBook();
      await split(bookId, []);
      await sellByCount(wang, 1);
      for (const [no, status] of [
        ["020", "skipped"],
        ["021", "scrapped"],
      ] as const) {
        await connection
          .collection(LOTTERY_TICKETS_COLLECTION)
          .updateOne({ bookId, ticketNo: no }, { $set: { status } });
        const ticket = await ticketOf(bookId, no);
        expect(
          await errorOf(wang, UNDO, {
            input: {
              ticketId: String(ticket._id),
              version: ticket.version,
              orgId: String(xinyi),
              localCashPointId: String(counterA),
            },
          }),
        ).toMatchObject({ reason: "TICKET_NOT_SELLABLE", blockReason: status });
      }
    });

    it("U4 依張數賣 3 張、客人退 1 張:刷那張只撤 1 張;沒票時「最近售出」一列 × 3 選撤 1 張;這一筆都被換走時改撤同台同遊戲最近一筆", async () => {
      now("14:00");
      const { bookId } = await receiveBook(otherGameId);
      await split(bookId, []);
      const cashBefore = await expectedOf(counterA);
      const older = await sellByCount(wang, 2, counterA, otherGameId);
      now("14:05");
      const sale = await sellByCount(wang, 3, counterA, otherGameId);
      expect(await expectedOf(counterA)).toBe(cashBefore + 1000);

      // 客人實際拿走 #050(系統記未售),退回 → 和最近一筆(這一筆)帶著的一張對號再撤
      now("14:10");
      const returned = await ticketOf(bookId, "050");
      await ok(wang, UNDO, {
        input: {
          ticketId: String(returned._id),
          version: returned.version,
          orgId: String(xinyi),
          localCashPointId: String(counterA),
        },
      });
      expect(await expectedOf(counterA)).toBe(cashBefore + 800);
      let row = await countRowOf(wang, shiftA, sale.refId);
      expect(row).toMatchObject({
        amount: 600,
        undoBlock: null,
        countSale: { count: 3, undoneCount: 1, undoableCount: 2 },
      });

      // 按多了沒有票:撤 1 張
      const data = await ok<{ undoLotteryCountSale: { item: SaleRow } }>(
        wang,
        UNDO_COUNT,
        { input: { orgId: String(xinyi), refId: sale.refId, count: 1 } },
      );
      expect(data.undoLotteryCountSale.item.countSale).toMatchObject({
        count: 3,
        undoneCount: 2,
        undoableCount: 1,
      });
      expect(await expectedOf(counterA)).toBe(cashBefore + 600);
      expect(
        await errorOf(wang, UNDO_COUNT, {
          input: { orgId: String(xinyi), refId: sale.refId, count: 2 },
        }),
      ).toMatchObject({ reason: "COUNT_UNDO_EXCEEDS", available: 1 });

      // 這一筆剩下的張被換走(補點編號確認過,不再是未對號)→ 改撤同台同遊戲最近一筆(older)
      const carriers = await connection
        .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
        .find({ bookId, status: "sold", unmatched: true })
        .toArray();
      const newest = carriers.filter(
        (ticket) => ticket.soldAt?.getTime() === taipei("14:05").getTime(),
      );
      await applyEvents(
        newest.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          type: "renumber_confirm",
          patch: { unmatched: false },
        })),
      );
      await ok(wang, UNDO_COUNT, {
        input: { orgId: String(xinyi), refId: sale.refId, count: 1 },
      });
      row = await countRowOf(wang, shiftA, older.refId);
      expect(row?.countSale).toMatchObject({ count: 2, undoneCount: 1 });
      expect(await expectedOf(counterA)).toBe(cashBefore + 400);
    });

    it("U5 售出後被對號過的張仍可當下撤銷(對號不算異動),撤的是現在帶著那筆售出的張", async () => {
      now("14:30");
      const { bookId, bookNo } = await receiveBook();
      await split(bookId, [{ cashPointId: stallB, ticketNos: ["030"] }]);
      const sale = await sellByCount(lin, 1, stallB);
      // B 台刷到實體 #030 再賣 → #030 和 B 台…沒有別張;改在 A 台刷:配對 #001 接手依張數售出
      const [item] = await scan(wang, barcodeOf(bookNo, "030"));
      expect(item?.match).toBe(true);
      await sell(wang, await ticketOf(bookId, "030"));
      const carrier = await ticketOf(bookId, "001");
      expect(carrier).toMatchObject({ status: "sold", unmatched: true });
      // 林(賣的人)在最近售出看到這一筆,顯示現在帶著它的張,可以撤
      const row = await countRowOf(lin, shiftB, sale.refId);
      expect(row).toMatchObject({
        ticketId: String(carrier._id),
        undoBlock: null,
        countSale: { undoableCount: 1 },
      });
      const cashB = await expectedOf(stallB);
      // 逐張撤銷也一樣:給帶著它的張
      await ok(lin, UNDO, {
        input: { ticketId: String(carrier._id), version: carrier.version },
      });
      expect(await ticketOf(bookId, "001")).toMatchObject({
        status: "unsold",
        unmatched: false,
        saleEventId: null,
      });
      expect(await ticketOf(bookId, "030")).toMatchObject({ status: "sold" });
      expect(await expectedOf(stallB)).toBe(cashB - 200);
    });
  });

  describe("看板與卡片(規格 13.2、13.4、14.2)", () => {
    it("看板回盤點制度與每個收銀點的遊戲合計;卡片回未對號、售出來源與未對號張數", async () => {
      now("15:00");
      const { bookId } = await receiveBook();
      await split(bookId, [{ cashPointId: stallB, ticketNos: range(1, 100) }]);
      await sellByCount(lin, 2, stallB);
      const data = await ok<{
        lotteryStoreBoard: {
          item: {
            countMode: string;
            cashPoints: {
              id: string;
              books: { remaining: number }[];
              gameTotals: {
                gameId: string;
                remaining: number;
                bookCount: number;
              }[];
            }[];
          };
        };
      }>(wang, BOARD, { orgId: String(xinyi) });
      expect(data.lotteryStoreBoard.item.countMode).toBe("count");
      const stall = data.lotteryStoreBoard.item.cashPoints.find(
        (point) => point.id === String(stallB),
      );
      const total = stall?.gameTotals.find(
        (item) => item.gameId === String(gameId),
      );
      expect(total?.remaining).toBe(await unsoldAt(stallB));
      expect(total?.bookCount).toBeGreaterThan(0);
      const card = await ok<{
        lotteryStoreBookCard: {
          item: {
            unmatchedCount: number;
            tickets: {
              ticketNo: string;
              unmatched: boolean;
              soldSource: string | null;
            }[];
          };
        };
      }>(wang, CARD, { orgId: String(xinyi), bookId: String(bookId) });
      expect(card.lotteryStoreBookCard.item.unmatchedCount).toBe(2);
      expect(card.lotteryStoreBookCard.item.tickets[0]).toMatchObject({
        ticketNo: "001",
        unmatched: true,
        soldSource: "count",
      });
    });
  });

  describe("看板卡片剩餘扣待標註(規格 14.2;使用者 11/04 定)", () => {
    it("這本在檯面上的張全在一台 → 剩餘扣掉待標註;分在兩台 → 不扣", async () => {
      now("15:05");
      // 迄號 102、標準 100 → 待標註 2;沒經拆本精靈直接放上檯面(拆過又收回的本會帶著待標註上檯面,7.5)
      const { bookId } = await receiveBook(gameId, xinyi, 102);
      const tickets = await connection
        .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
        .find({ bookId })
        .toArray();
      await applyEvents(
        tickets.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          type: "open",
          patch: {
            location: { kind: "counter", cashPointId: stallB },
          },
          cashPointId: stallB,
        })),
      );
      expect(await cardRemaining(stallB, bookId)).toBe(100);
      const last = await ticketOf(bookId, "102");
      await applyEvents([
        {
          ticketId: last._id,
          expectedVersion: last.version,
          type: "move",
          patch: { location: { kind: "counter", cashPointId: counterA } },
          cashPointId: counterA,
        },
      ]);
      expect(await cardRemaining(stallB, bookId)).toBe(101);
      expect(await cardRemaining(counterA, bookId)).toBe(1);
    });
  });

  describe("店員尋回(16.6 RC1;規格 7.9、12)", () => {
    it("有 store.recover 的店員(沒有庫存管理)可以在看板尋回;兩種權限都沒有 → FORBIDDEN", async () => {
      now("15:10");
      const { bookId } = await receiveBook();
      await split(bookId, []);
      const missing = await ticketOf(bookId, "099");
      await applyEvents([
        {
          ticketId: missing._id,
          expectedVersion: missing.version,
          type: "investigate",
          patch: { status: "investigating", responsibleOrgId: xinyi },
        },
      ]);
      const ticket = await ticketOf(bookId, "099");
      const input = {
        input: {
          orgId: String(xinyi),
          tickets: [{ ticketId: String(ticket._id), version: ticket.version }],
          reasonKey: "found",
        },
      };
      const noRecover = await storeUser([xinyi], [S.view, S.sell], "沒尋回權");
      expect(await errorOf(noRecover, RECOVER, input)).toMatchObject({
        code: "FORBIDDEN",
      });
      const clerk = await storeUser([xinyi], [S.view, S.recover], "店員尋回");
      await ok(clerk, RECOVER, input);
      expect(await ticketOf(bookId, "099")).toMatchObject({
        status: "unsold",
        location: { kind: "stock" },
      });
      // 庫存管理的尋回照舊
      const other = await ticketOf(bookId, "098");
      await applyEvents([
        {
          ticketId: other._id,
          expectedVersion: other.version,
          type: "investigate",
          patch: { status: "investigating", responsibleOrgId: xinyi },
        },
      ]);
      const inventoryUser = await storeUser(
        [xinyi],
        ["inventory.recover"],
        "庫存尋回",
        ["inventory"],
      );
      const again = await ticketOf(bookId, "098");
      await ok(inventoryUser, RECOVER, {
        input: {
          orgId: String(xinyi),
          tickets: [{ ticketId: String(again._id), version: again.version }],
          reasonKey: "found",
        },
      });
    });
  });
});
