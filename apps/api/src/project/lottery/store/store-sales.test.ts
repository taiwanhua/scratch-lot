import {
  afterAll,
  afterEach,
  beforeAll,
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
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import {
  TransactionService,
  currentSession,
} from "../../../database/transaction";
import { PASSWORD, login } from "../../../fields/test-support/fixtures";
import { createRole } from "../../../permission/test-support/fixtures";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import {
  LOTTERY_SHIFTS_COLLECTION,
  LotteryShift,
} from "../../database/lottery-store/lottery-shift.schema";
import { seedReasonCategory } from "../test-support/master-data-fixtures";
import { LotteryBooksService } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import { StoreClock } from "./store-clock";
import { StoreSalesSupport } from "./store-sales-support";

// ---- GraphQL ----

const SCAN = /* GraphQL */ `
  query Scan($input: LotteryStoreScanInput!) {
    lotteryStoreScan(input: $input) {
      items {
        ticketId
        version
        gameCode
        ticketNo
        status
        outcome
        blockReason
        soldAt
        pendingSkipCount
        cashPoint {
          id
          name
        }
        counterShiftOwner {
          id
          name
        }
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
  cashPoint { id name }
  shiftId
  undone
  undoBlock
`;

const SELL = /* GraphQL */ `
  mutation Sell($input: SellLotteryTicketsInput!) {
    sellLotteryTickets(input: $input) { items { ${SALE_FIELDS} } }
  }
`;

const UNDO = /* GraphQL */ `
  mutation Undo($input: LotteryStoreTicketRefInput!) {
    undoLotteryTicketSale(input: $input) { item { ${SALE_FIELDS} } }
  }
`;

const SALE = /* GraphQL */ `
  query Sale($ticketId: ID!) {
    lotteryStoreSale(ticketId: $ticketId) { item { ${SALE_FIELDS} } }
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
        cashPoints {
          id
          shift {
            id
            expectedCash
            soldCount
          }
          books {
            bookId
            remaining
            total
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
        pendingSkipCount
        unopened
        tickets {
          id
          ticketNo
          version
          status
          locationKind
          cashPoint {
            id
          }
          soldShiftId
        }
      }
    }
  }
`;

const UNOPENED = /* GraphQL */ `
  query Unopened($orgId: ID!) {
    lotteryStoreUnopenedBooks(orgId: $orgId) {
      items {
        bookId
        bookNo
        ticketCount
        pendingSkipCount
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

const MOVE = /* GraphQL */ `
  mutation Move($input: MoveLotteryTicketsInput!) {
    moveLotteryTickets(input: $input) {
      count
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

// ---- 型別 ----

interface StoreUser {
  userId: Types.ObjectId;
  token: string;
}

interface ScanRow {
  ticketId: string;
  version: number;
  gameCode: string;
  ticketNo: string;
  status: string;
  outcome: string;
  blockReason: string | null;
  soldAt: string | null;
  pendingSkipCount: number;
  cashPoint: { id: string; name: string } | null;
  counterShiftOwner: { id: string; name: string } | null;
}

interface SaleRow {
  ticketId: string;
  version: number;
  ticketKey: string;
  amount: number;
  soldAt: string;
  cashPoint: { id: string; name: string };
  shiftId: string;
  undone: boolean;
  undoBlock: string | null;
}

interface TicketDoc {
  _id: Types.ObjectId;
  ticketNo: string;
  status: string;
  version: number;
  location: { kind: string; cashPointId: Types.ObjectId | null };
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

/**
 * 店面(二):刷到時、售出(錢算在哪一班)、當下撤銷、展開卡片、拆本、移櫃 / 收回(規格 6.2–6.4、3.3、第 17 章第 3 題):
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);「現在」由 `StoreClock` 注入。每張 200 元。
 *
 * 組織樹:root ─ 租戶甲 ─┬─ 信義店(店內櫃台、店外攤位、彩券機旁)
 *                        └─ 板橋店(店內櫃台)
 * 班:王 開店內櫃台(期初 5,000)、林 開店外攤位、王 也開彩券機旁(自己開兩班)。
 */
describe("店面(二):銷售、當下撤銷、拆本、移櫃(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let banqiao: Types.ObjectId;
  let counter: Types.ObjectId;
  let stall: Types.ObjectId;
  let machine: Types.ObjectId;
  let counterB: Types.ObjectId;
  let gameId: Types.ObjectId;
  let otherGameId: Types.ObjectId;

  /** 店員:銷售、當下撤銷、拆本、移櫃 */
  let wang: StoreUser;
  /** 店員:銷售、撤銷、拆本(沒有移櫃) */
  let lin: StoreUser;
  /** 板橋店的人 */
  let banqiaoClerk: StoreUser;

  let counterShift: Types.ObjectId;
  let stallShift: Types.ObjectId;
  let machineShift: Types.ObjectId;

  let sequence = 0;
  let bookSequence = 56_000;

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
  ): Promise<StoreUser> {
    sequence += 1;
    const account = `store-sales-${String(sequence)}`;
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
      moduleKeys: ["store"],
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

  /** 點收一本到信義店(標準 100 張;`lastTicketNo` 大於 100 → 有待標註)。 */
  async function receiveBook(
    lastTicketNo = 100,
    game = gameId,
    bookNo?: string,
    orgId = xinyi,
  ): Promise<{ bookId: Types.ObjectId; bookNo: string }> {
    bookSequence += 1;
    const no = bookNo ?? String(bookSequence).padStart(6, "0");
    const { book } = await api.app
      .get(TransactionService)
      .withTransaction((session) =>
        api.app
          .get(LotteryBooksService)
          .createBook(session, storeOperator(orgId), {
            orgId,
            gameId: game,
            bookNo: no,
            lastTicketNo,
            rate: 92,
            cost: 18_400,
          }),
      );
    return { bookId: book._id, bookNo: book.bookNo };
  }

  async function ticketsOf(bookId: Types.ObjectId): Promise<TicketDoc[]> {
    return connection
      .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
      .find({ bookId })
      .sort({ ticketNo: 1 })
      .toArray();
  }

  async function ticketOf(
    bookId: Types.ObjectId,
    ticketNo: string,
  ): Promise<TicketDoc> {
    const all = await ticketsOf(bookId);
    const found = all.find((ticket) => ticket.ticketNo === ticketNo);
    if (found === undefined) {
      throw new Error(`沒有 #${ticketNo}`);
    }
    return found;
  }

  /** 整本拆到一個收銀點(經 api,寫「拆本」事件)。 */
  async function openTo(
    bookId: Types.ObjectId,
    cashPointId: Types.ObjectId,
  ): Promise<void> {
    const nos = await ticketNosOf(bookId);
    await ok(wang, SPLIT, {
      input: {
        orgId: String(xinyi),
        bookId: String(bookId),
        skippedTicketNos: [],
        assignments: [{ cashPointId: String(cashPointId), ticketNos: nos }],
      },
    });
  }

  async function scan(
    user: StoreUser,
    code: string,
    local: Types.ObjectId | null = counter,
  ): Promise<ScanRow[]> {
    const data = await ok<{ lotteryStoreScan: { items: ScanRow[] } }>(
      user,
      SCAN,
      {
        input: {
          orgId: String(xinyi),
          code,
          localCashPointId: local === null ? null : String(local),
        },
      },
    );
    return data.lotteryStoreScan.items;
  }

  function sellInput(
    ticket: { _id: Types.ObjectId; version: number },
    extra: Record<string, unknown> = {},
    local = counter,
  ) {
    return {
      input: {
        orgId: String(xinyi),
        localCashPointId: String(local),
        tickets: [{ ticketId: String(ticket._id), version: ticket.version }],
        source: "scan",
        ...extra,
      },
    };
  }

  async function sell(
    user: StoreUser,
    ticket: TicketDoc,
    extra: Record<string, unknown> = {},
    local = counter,
  ): Promise<SaleRow> {
    const data = await ok<{ sellLotteryTickets: { items: SaleRow[] } }>(
      user,
      SELL,
      sellInput(ticket, extra, local),
    );
    const [row] = data.sellLotteryTickets.items;
    if (row === undefined) {
      throw new Error("沒有售出");
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

  async function ticketNosOf(bookId: Types.ObjectId): Promise<string[]> {
    const all = await ticketsOf(bookId);
    return all.map((ticket) => ticket.ticketNo);
  }

  async function eventTypesOf(ticketId: Types.ObjectId): Promise<string[]> {
    const events = await eventsOf(ticketId);
    return events.map((event) => event.type);
  }

  async function eventsOf(ticketId: Types.ObjectId) {
    return connection
      .collection<{ type: string; shiftId: Types.ObjectId | null }>(
        "lottery_ticket_events",
      )
      .find({ ticketId })
      .sort({ at: 1, _id: 1 })
      .toArray();
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-store-sales");
    connection = api.connection;
    await api.app
      .get<Model<LotteryShift>>(getModelToken(LotteryShift.name))
      .init();
    const { insertedId: storeModuleId } = await connection
      .collection("modules")
      .insertOne({
        key: "store",
        name: "店面管理",
        parentId: null,
        ancestors: [],
        route: "store",
        sidebarType: "link",
        order: 10,
        enabled: true,
        isSystem: false,
        icon: null,
        settings: {},
        engine: "fixed",
        ...base(),
      });
    await connection.collection("permissions").insertMany(
      Object.values(S).map((key) => ({
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
    );
    await seedReasonCategory(
      connection,
      LOTTERY_FIELD_CATEGORY_KEYS.manualSaleReason,
      [
        { value: "scan-failed", label: "刷不到條碼" },
        { value: "system-backfill", label: "系統異常補登" },
        { value: "other", label: "其他" },
      ],
    );
    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
    banqiao = await createOrg(connection, { name: "板橋店", parentId: tenant });
    counter = await cashPoint(xinyi, "店內櫃台", 1);
    stall = await cashPoint(xinyi, "店外攤位", 2);
    machine = await cashPoint(xinyi, "彩券機旁", 3);
    counterB = await cashPoint(banqiao, "店內櫃台", 1);
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
    wang = await storeUser([xinyi], [...clerk, S.move], "王小明");
    lin = await storeUser([xinyi], clerk, "林小美");
    banqiaoClerk = await storeUser([banqiao], [...clerk, S.move], "板橋店員");

    counterShift = await shift(xinyi, counter, wang.userId);
    stallShift = await shift(xinyi, stall, lin.userId);
    machineShift = await shift(xinyi, machine, wang.userId);
    await shift(banqiao, counterB, banqiaoClerk.userId);
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("錢算在哪一班(規格 6.3)", () => {
    it("本機收銀點檯面 → 本機收銀點的班,應有現金增加", async () => {
      now("10:00");
      const { bookId, bookNo } = await receiveBook();
      await openTo(bookId, counter);
      const before = await expectedOf(counter);
      const [item] = await scan(wang, barcodeOf(bookNo, "012"));
      expect(item).toMatchObject({ outcome: "sell", ticketNo: "012" });
      const row = await sell(wang, await ticketOf(bookId, "012"));
      expect(row).toMatchObject({
        amount: 200,
        shiftId: String(counterShift),
        cashPoint: { id: String(counter), name: "店內櫃台" },
        undoBlock: null,
      });
      expect(row.ticketKey).toBe(`5164-${bookNo.slice(1)}-012`);
      expect(await expectedOf(counter)).toBe(before + 200);
    });

    it("別的收銀點檯面、那一班是自己開的 → 直接算那一班,不移櫃", async () => {
      now("10:05");
      const { bookId, bookNo } = await receiveBook();
      await openTo(bookId, machine);
      const before = await expectedOf(machine);
      const [item] = await scan(wang, barcodeOf(bookNo, "001"));
      expect(item).toMatchObject({
        outcome: "sell_other_mine",
        cashPoint: { name: "彩券機旁" },
        counterShiftOwner: { name: "王小明" },
      });
      const ticket = await ticketOf(bookId, "001");
      const row = await sell(wang, ticket);
      expect(row.shiftId).toBe(String(machineShift));
      expect(await expectedOf(machine)).toBe(before + 200);
      // 沒有移櫃:張還在彩券機旁、只有拆本 + 售出
      const after = await ticketOf(bookId, "001");
      expect(String(after.location.cashPointId)).toBe(String(machine));
      expect(await eventTypesOf(ticket._id)).toEqual([
        "purchase",
        "open",
        "sale",
      ]);
    });

    it("別的收銀點檯面(別人的班)→ 確認後寫「移櫃」+「售出」,算本機收銀點的班", async () => {
      now("10:10");
      const { bookId, bookNo } = await receiveBook();
      await openTo(bookId, stall);
      const [item] = await scan(wang, barcodeOf(bookNo, "005"));
      expect(item).toMatchObject({
        outcome: "move_and_sell",
        counterShiftOwner: { name: "林小美" },
      });
      const ticket = await ticketOf(bookId, "005");
      expect(await errorOf(wang, SELL, sellInput(ticket))).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "MOVE_CONFIRM_REQUIRED",
      });
      const counterBefore = await expectedOf(counter);
      const stallBefore = await expectedOf(stall);
      const row = await sell(wang, ticket, { confirmMove: true });
      expect(row.shiftId).toBe(String(counterShift));
      expect(await expectedOf(counter)).toBe(counterBefore + 200);
      expect(await expectedOf(stall)).toBe(stallBefore);
      const events = await eventsOf(ticket._id);
      expect(events.map((event) => event.type)).toEqual([
        "purchase",
        "open",
        "move",
        "sale",
      ]);
      expect(String(events.at(-1)?.shiftId)).toBe(String(counterShift));
    });
  });

  describe("刷到時(規格 6.3)", () => {
    let bookId: Types.ObjectId;
    let bookNo: string;

    beforeAll(async () => {
      ({ bookId, bookNo } = await receiveBook());
      await openTo(bookId, counter);
    });

    it("本號在本店對到兩款遊戲 → 兩筆(選遊戲);背面編號帶遊戲代號 → 只有那一款", async () => {
      now("11:00");
      const other = await receiveBook(100, otherGameId, bookNo.slice(1));
      await openTo(other.bookId, counter);
      const items = await scan(wang, barcodeOf(bookNo, "020"));
      expect(items.map((item) => [item.gameCode, item.outcome])).toEqual([
        ["5164", "sell"],
        ["5170", "sell"],
      ]);
      const back = await scan(wang, `5170-1-${bookNo.slice(1)}-020-0-6`);
      expect(back.map((item) => item.gameCode)).toEqual(["5170"]);
    });

    it("不是本店的刮刮樂 → 擋下", async () => {
      now("11:00");
      const other = await receiveBook(100, gameId, undefined, banqiao);
      const items = await scan(wang, barcodeOf(other.bookNo, "001"));
      expect(items).toMatchObject([
        { outcome: "blocked", blockReason: "not_this_store" },
      ]);
      expect(
        await errorOf(
          wang,
          SELL,
          sellInput(await ticketOf(other.bookId, "001")),
        ),
      ).toMatchObject({
        reason: "TICKET_NOT_SELLABLE",
        blockReason: "not_this_store",
      });
    });

    it("已售 → 擋下並帶售出時間", async () => {
      now("11:01");
      await sell(wang, await ticketOf(bookId, "030"));
      const [item] = await scan(wang, barcodeOf(bookNo, "030"));
      expect(item).toMatchObject({ outcome: "blocked", blockReason: "sold" });
      expect(item?.soldAt).toBe(taipei("11:01").toISOString());
    });

    it.each([
      ["跳號", { status: "skipped" }, "skipped"],
      ["報廢", { status: "scrapped" }, "scrapped"],
      [
        "鎖定",
        { lockedBy: { refType: "transfer", refId: new Types.ObjectId() } },
        "locked",
      ],
    ])("%s → 擋下", async (_label, patch, reason) => {
      now("11:02");
      const fresh = await receiveBook();
      await openTo(fresh.bookId, counter);
      const ticket = await ticketOf(fresh.bookId, "040");
      await connection
        .collection(LOTTERY_TICKETS_COLLECTION)
        .updateOne({ _id: ticket._id }, { $set: patch });
      const [item] = await scan(wang, barcodeOf(fresh.bookNo, "040"));
      expect(item).toMatchObject({ outcome: "blocked", blockReason: reason });
      expect(
        await errorOf(
          wang,
          SELL,
          sellInput(await ticketOf(fresh.bookId, "040")),
        ),
      ).toMatchObject({ reason: "TICKET_NOT_SELLABLE", blockReason: reason });
    });

    it("未拆的本 → 詢問拆本(帶待標註張數)", async () => {
      now("11:03");
      const fresh = await receiveBook(102);
      const [item] = await scan(wang, barcodeOf(fresh.bookNo, "001"));
      expect(item).toMatchObject({ outcome: "unopened", pendingSkipCount: 2 });
    });

    it("待查(在別家店)→ 提示尋回", async () => {
      now("11:04");
      const other = await receiveBook(100, gameId, undefined, banqiao);
      const ticket = await ticketOf(other.bookId, "009");
      await connection
        .collection(LOTTERY_TICKETS_COLLECTION)
        .updateOne(
          { _id: ticket._id },
          { $set: { status: "investigating", responsibleOrgId: banqiao } },
        );
      const [item] = await scan(wang, barcodeOf(other.bookNo, "009"));
      expect(item).toMatchObject({
        outcome: "recover",
        status: "investigating",
      });
    });

    it("沒有本機收銀點 → 只顯示資訊;看不懂的碼 → 沒有結果", async () => {
      now("11:05");
      const [item] = await scan(wang, barcodeOf(bookNo, "050"), null);
      expect(item?.outcome).toBe("info_only");
      expect(await scan(wang, "hello")).toEqual([]);
    });
  });

  describe("當下撤銷(規格 6.3)", () => {
    let bookId: Types.ObjectId;

    beforeAll(async () => {
      ({ bookId } = await receiveBook());
      await openTo(bookId, counter);
    });

    async function undoError(user: StoreUser, ticketNo: string) {
      const ticket = await ticketOf(bookId, ticketNo);
      return errorOf(user, UNDO, {
        input: { ticketId: String(ticket._id), version: ticket.version },
      });
    }

    it("符合條件 → 寫「撤銷」,應有現金減少;[最近售出] 那一筆顯示已撤銷", async () => {
      now("12:00");
      await sell(wang, await ticketOf(bookId, "001"));
      const before = await expectedOf(counter);
      now("12:29");
      const ticket = await ticketOf(bookId, "001");
      const data = await ok<{ undoLotteryTicketSale: { item: SaleRow } }>(
        wang,
        UNDO,
        { input: { ticketId: String(ticket._id), version: ticket.version } },
      );
      expect(data.undoLotteryTicketSale.item).toMatchObject({
        undone: true,
        undoBlock: "already_undone",
      });
      expect(await expectedOf(counter)).toBe(before - 200);
      const undone = await ticketOf(bookId, "001");
      expect(undone.status).toBe("unsold");
      const recent = await ok<{
        lotteryStoreRecentSales: { items: SaleRow[] };
      }>(wang, RECENT, { shiftId: String(counterShift) });
      expect(
        recent.lotteryStoreRecentSales.items.find(
          (row) => row.ticketId === String(ticket._id),
        ),
      ).toMatchObject({ undone: true });
    });

    it("同一張 賣出 → 撤銷 → 再賣出:當下撤銷看的是最新那次售出(可以再撤銷一次)", async () => {
      now("12:00");
      await sell(wang, await ticketOf(bookId, "009"));
      now("12:05");
      const first = await ticketOf(bookId, "009");
      await ok(wang, UNDO, {
        input: { ticketId: String(first._id), version: first.version },
      });
      now("12:10");
      await sell(wang, await ticketOf(bookId, "009"));
      now("12:15");
      const again = await ticketOf(bookId, "009");
      const data = await ok<{ undoLotteryTicketSale: { item: SaleRow } }>(
        wang,
        UNDO,
        { input: { ticketId: String(again._id), version: again.version } },
      );
      expect(data.undoLotteryTicketSale.item).toMatchObject({
        undone: true,
        undoBlock: "already_undone",
      });
      const undone = await ticketOf(bookId, "009");
      expect(undone.status).toBe("unsold");
    });

    it("31 分鐘 → 改送申請", async () => {
      now("12:00");
      await sell(wang, await ticketOf(bookId, "002"));
      now("12:31");
      expect(await undoError(wang, "002")).toMatchObject({
        reason: "UNDO_NOT_ALLOWED",
        undoBlock: "expired",
      });
      const ticket = await ticketOf(bookId, "002");
      const sale = await ok<{ lotteryStoreSale: { item: SaleRow } }>(
        wang,
        SALE,
        { ticketId: String(ticket._id) },
      );
      expect(sale.lotteryStoreSale.item.undoBlock).toBe("expired");
    });

    it("不是自己賣的 → 改送申請", async () => {
      now("12:00");
      await sell(lin, await ticketOf(bookId, "003"));
      expect(await undoError(wang, "003")).toMatchObject({
        undoBlock: "not_mine",
      });
    });

    it("之後有移櫃 → 改送申請", async () => {
      now("12:00");
      await sell(wang, await ticketOf(bookId, "004"));
      const ticket = await ticketOf(bookId, "004");
      await api.app.get(TransactionService).withTransaction((session) =>
        api.app
          .get(TicketLedgerService)
          .applyTicketEvents(session, { operator: storeOperator(xinyi) }, [
            {
              ticketId: ticket._id,
              expectedVersion: ticket.version,
              type: "move",
              patch: { location: { kind: "counter", cashPointId: stall } },
            },
          ]),
      );
      expect(await undoError(wang, "004")).toMatchObject({
        undoBlock: "changed",
      });
    });

    it("班已結帳 → 改送申請", async () => {
      now("12:00");
      const { bookId: own } = await receiveBook();
      const point = await cashPoint(xinyi, "臨時櫃", 9);
      await openTo(own, point);
      const temp = await shift(xinyi, point, wang.userId);
      const row = await sell(wang, await ticketOf(own, "001"), {}, point);
      expect(row.shiftId).toBe(String(temp));
      await connection
        .collection(LOTTERY_SHIFTS_COLLECTION)
        .updateOne({ _id: temp }, { $set: { closedAt: taipei("12:05") } });
      const ticket = await ticketOf(own, "001");
      expect(
        await errorOf(wang, UNDO, {
          input: { ticketId: String(ticket._id), version: ticket.version },
        }),
      ).toMatchObject({ undoBlock: "shift_closed" });
    });

    it("版本由伺服器從售出事件推:畫面傳來的版本不影響;檢查之後到寫入之前有人移櫃 → 擋下", async () => {
      now("12:00");
      await sell(wang, await ticketOf(bookId, "007"));
      const sold = await ticketOf(bookId, "007");
      // 畫面帶了錯的版本也照樣撤銷(用的是售出那一版)
      await ok(wang, UNDO, {
        input: { ticketId: String(sold._id), version: 999 },
      });
      const undone = await ticketOf(bookId, "007");
      expect(undone.status).toBe("unsold");

      await sell(wang, await ticketOf(bookId, "008"));
      const ticket = await ticketOf(bookId, "008");
      const support = api.app.get(StoreSalesSupport);
      const original = support.lockDrawer.bind(support);
      // 撤銷的條件檢查已通過,交易裡鎖住抽屜的那一刻有人把這張移櫃
      jest
        .spyOn(support, "lockDrawer")
        .mockImplementationOnce(async (operator, shiftId) => {
          const session = currentSession();
          if (session === undefined) {
            throw new Error("要在交易裡");
          }
          await api.app
            .get(TicketLedgerService)
            .applyTicketEvents(session, { operator: storeOperator(xinyi) }, [
              {
                ticketId: ticket._id,
                expectedVersion: ticket.version,
                type: "move",
                patch: { location: { kind: "counter", cashPointId: stall } },
              },
            ]);
          return original(operator, shiftId);
        });
      const before = await expectedOf(counter);
      expect(
        await errorOf(wang, UNDO, {
          input: { ticketId: String(ticket._id), version: ticket.version },
        }),
      ).toMatchObject({ code: "CONFLICT" });
      const after = await ticketOf(bookId, "008");
      expect(after.status).toBe("sold");
      expect(await expectedOf(counter)).toBe(before);
    });

    it("沒有 store.undo-sale → FORBIDDEN", async () => {
      now("12:00");
      const noUndo = await storeUser([xinyi], [S.view, S.sell], "沒撤銷權");
      await sell(noUndo, await ticketOf(bookId, "006"));
      expect(await undoError(noUndo, "006")).toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  it("第 17 章第 3 題(看板一側):同一張同時兩次售出 → 只有一次成功,失敗方看到售出時間", async () => {
    now("13:00");
    const { bookId } = await receiveBook();
    await openTo(bookId, counter);
    const ticket = await ticketOf(bookId, "012");
    const before = await expectedOf(counter);
    const results = await Promise.all([
      gql(wang, SELL, sellInput(ticket)),
      gql(lin, SELL, sellInput(ticket)),
    ]);
    const succeeded = results.filter((result) => result.errors === undefined);
    const failed = results.filter((result) => result.errors !== undefined);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.errors?.[0]?.extensions).toMatchObject({
      reason: "ALREADY_SOLD",
      soldAt: taipei("13:00").toISOString(),
    });
    expect(await expectedOf(counter)).toBe(before + 200);
    const types = await eventTypesOf(ticket._id);
    expect(types.filter((type) => type === "sale")).toHaveLength(1);
  });

  describe("拆本(規格 6.4)", () => {
    it("先選要拆的本:本店還沒拆的本(待標註張數)", async () => {
      const { bookId } = await receiveBook(102);
      const data = await ok<{
        lotteryStoreUnopenedBooks: {
          items: {
            bookId: string;
            ticketCount: number;
            pendingSkipCount: number;
          }[];
        };
      }>(lin, UNOPENED, { orgId: String(xinyi) });
      expect(
        data.lotteryStoreUnopenedBooks.items.find(
          (item) => item.bookId === String(bookId),
        ),
      ).toMatchObject({ ticketCount: 102, pendingSkipCount: 2 });
    });

    it("跳號沒點滿 / 沒分完 → 擋下;點滿、分放兩個收銀點 → 寫「跳號」「拆本」,跳號不算庫存", async () => {
      now("14:00");
      const { bookId } = await receiveBook(102);
      const nos = await ticketNosOf(bookId);
      const rest = nos.filter((no) => no !== "037" && no !== "064");
      const input = (
        skippedTicketNos: string[],
        assignments: { cashPointId: string; ticketNos: string[] }[],
      ) => ({
        input: {
          orgId: String(xinyi),
          bookId: String(bookId),
          skippedTicketNos,
          assignments,
        },
      });
      expect(
        await errorOf(
          lin,
          SPLIT,
          input(["037"], [{ cashPointId: String(counter), ticketNos: rest }]),
        ),
      ).toMatchObject({
        reason: "SPLIT_PLAN_INVALID",
        problem: "skip_count_mismatch",
      });
      expect(
        await errorOf(
          lin,
          SPLIT,
          input(
            ["037", "064"],
            [{ cashPointId: String(counter), ticketNos: rest.slice(0, 50) }],
          ),
        ),
      ).toMatchObject({ reason: "SPLIT_PLAN_INVALID", problem: "unassigned" });
      // 林沒有 store.move:拆本分放到多個收銀點算拆本,照樣可以
      await ok(
        lin,
        SPLIT,
        input(
          ["037", "064"],
          [
            { cashPointId: String(stall), ticketNos: rest.slice(0, 49) },
            { cashPointId: String(counter), ticketNos: rest.slice(49) },
          ],
        ),
      );
      const tickets = await ticketsOf(bookId);
      expect(
        tickets
          .filter((ticket) => ticket.status === "skipped")
          .map((t) => t.ticketNo),
      ).toEqual(["037", "064"]);
      const board = await ok<{
        lotteryStoreBoard: {
          item: {
            cashPoints: {
              id: string;
              books: { bookId: string; remaining: number; total: number }[];
            }[];
          };
        };
      }>(lin, BOARD, { orgId: String(xinyi) });
      const cards = board.lotteryStoreBoard.item.cashPoints.flatMap((point) =>
        point.books
          .filter((book) => book.bookId === String(bookId))
          .map((book) => [point.id, book.total]),
      );
      expect(cards).toEqual([
        [String(counter), 51],
        [String(stall), 49],
      ]);
      expect(
        await errorOf(
          lin,
          SPLIT,
          input([], [{ cashPointId: String(counter), ticketNos: rest }]),
        ),
      ).toMatchObject({ reason: "BOOK_ALREADY_OPENED" });
      const card = await ok<{
        lotteryStoreBookCard: {
          item: { unopened: boolean; tickets: { ticketNo: string }[] };
        };
      }>(lin, CARD, { orgId: String(xinyi), bookId: String(bookId) });
      expect(card.lotteryStoreBookCard.item.unopened).toBe(false);
      expect(card.lotteryStoreBookCard.item.tickets).toHaveLength(100);
    });
  });

  describe("移櫃情境表(規格 3.3)", () => {
    it("有 store.move、刷到別人的班的檯面 → 移櫃 + 售出,錢算本機收銀點", async () => {
      now("15:00");
      const { bookId, bookNo } = await receiveBook();
      await openTo(bookId, stall);
      const [item] = await scan(wang, barcodeOf(bookNo, "001"));
      expect(item?.outcome).toBe("move_and_sell");
      const row = await sell(wang, await ticketOf(bookId, "001"), {
        confirmMove: true,
      });
      expect(row.cashPoint.name).toBe("店內櫃台");
    });

    it("沒有 store.move、同上 → 擋下,不寫任何事件", async () => {
      now("15:00");
      const { bookId, bookNo } = await receiveBook();
      await openTo(bookId, machine);
      const [item] = await scan(lin, barcodeOf(bookNo, "001"), stall);
      expect(item?.outcome).toBe("move_forbidden");
      const ticket = await ticketOf(bookId, "001");
      expect(
        await errorOf(
          lin,
          SELL,
          sellInput(ticket, { confirmMove: true }, stall),
        ),
      ).toMatchObject({ code: "FORBIDDEN", reason: "MOVE_NOT_ALLOWED" });
      expect(await eventTypesOf(ticket._id)).toEqual(["purchase", "open"]);
    });

    it("別的收銀點的班是自己開的 → 直接算那一班,不需要 store.move", async () => {
      now("15:00");
      const { bookId } = await receiveBook();
      await openTo(bookId, stall);
      // 林在店外攤位開班;本機收銀點是店內櫃台(王的班)也照樣算店外攤位
      const row = await sell(lin, await ticketOf(bookId, "002"));
      expect(row.shiftId).toBe(String(stallShift));
    });

    it("拆本時分放到多個收銀點 → 有 store.split 就能做(見拆本測試)", async () => {
      const { bookId } = await receiveBook();
      const nos = await ticketNosOf(bookId);
      await ok(lin, SPLIT, {
        input: {
          orgId: String(xinyi),
          bookId: String(bookId),
          skippedTicketNos: [],
          assignments: [
            { cashPointId: String(counter), ticketNos: nos.slice(0, 50) },
            { cashPointId: String(machine), ticketNos: nos.slice(50) },
          ],
        },
      });
    });

    it("[移櫃] [收回] 要 store.move;有的人寫「移櫃」「收回」事件", async () => {
      now("15:10");
      const { bookId, bookNo } = await receiveBook();
      await openTo(bookId, counter);
      const ticket = await ticketOf(bookId, "010");
      const ref = { ticketId: String(ticket._id), version: ticket.version };
      expect(
        await errorOf(lin, MOVE, {
          input: {
            orgId: String(xinyi),
            tickets: [ref],
            toCashPointId: String(stall),
          },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
      expect(
        await errorOf(lin, RECALL, {
          input: { orgId: String(xinyi), tickets: [ref] },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
      await ok(wang, MOVE, {
        input: {
          orgId: String(xinyi),
          tickets: [ref],
          toCashPointId: String(stall),
        },
      });
      const moved = await ticketOf(bookId, "010");
      expect(String(moved.location.cashPointId)).toBe(String(stall));
      await ok(wang, RECALL, {
        input: {
          orgId: String(xinyi),
          tickets: [{ ticketId: String(moved._id), version: moved.version }],
        },
      });
      const recalled = await ticketOf(bookId, "010");
      expect(recalled.location.kind).toBe("stock");
      expect(await eventTypesOf(ticket._id)).toEqual([
        "purchase",
        "open",
        "move",
        "recall",
      ]);
      // 收回的張在庫存(這本已經拆了)→ 刷到時擋下
      const [item] = await scan(wang, barcodeOf(bookNo, "010"));
      expect(item).toMatchObject({
        outcome: "blocked",
        blockReason: "in_stock",
      });
    });
  });

  it("讀不到遊戲(面額不明)→ 擋下,不以 0 元售出", async () => {
    now("16:30");
    const { insertedId: hiddenGame } = await connection
      .collection("lottery_games")
      .insertOne({
        orgId: tenant,
        tenantId: tenant,
        moduleKey: "master-data",
        shareOrgs: [{ orgId: tenant, includeDescendants: true }],
        gameCode: "5999",
        name: "下架遊戲",
        unitPrice: 300,
        ticketsPerBook: 100,
        bookPrice: 30_000,
        defaultRate: 92,
        color: null,
        status: "on_sale",
        ...base(),
      });
    const { bookId } = await receiveBook(100, hiddenGame);
    await openTo(bookId, counter);
    await connection
      .collection("lottery_games")
      .updateOne({ _id: hiddenGame }, { $set: { deletedAt: new Date() } });
    const ticket = await ticketOf(bookId, "001");
    expect(await errorOf(wang, SELL, sellInput(ticket))).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "GAME_NOT_FOUND",
    });
    const still = await ticketOf(bookId, "001");
    expect(still.status).toBe("unsold");
  });

  it("手動標記售出:原因必選;本班售出在卡片標 soldShiftId", async () => {
    now("16:00");
    const { bookId } = await receiveBook();
    await openTo(bookId, counter);
    const ticket = await ticketOf(bookId, "080");
    expect(
      await errorOf(wang, SELL, sellInput(ticket, { source: "manual" })),
    ).toMatchObject({ code: "VALIDATION_FAILED" });
    await sell(wang, ticket, {
      source: "manual",
      reasonKey: "scan-failed",
    });
    const card = await ok<{
      lotteryStoreBookCard: {
        item: { tickets: { ticketNo: string; soldShiftId: string | null }[] };
      };
    }>(wang, CARD, { orgId: String(xinyi), bookId: String(bookId) });
    expect(
      card.lotteryStoreBookCard.item.tickets.find(
        (item) => item.ticketNo === "080",
      )?.soldShiftId,
    ).toBe(String(counterShift));
    // 別家店的人看不到這家店
    expect(
      await errorOf(banqiaoClerk, CARD, {
        orgId: String(xinyi),
        bookId: String(bookId),
      }),
    ).toMatchObject({ code: "NOT_FOUND" });
  });
});
