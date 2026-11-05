import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

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
import { LOTTERY_PERIOD_CLOSES_COLLECTION } from "../../database/lottery-accounts/lottery-period-close.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import { LOTTERY_STORE_COUNT_MODES_COLLECTION } from "../../database/lottery-settings/lottery-store-count-mode.schema";
import {
  insertGame,
  seedInventoryModule,
} from "../purchase/test-support/purchase-fixtures";
import { matchEventsOf } from "../store/store-matching";
import { LotteryBooksService } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const OPERATIONS = /* GraphQL */ `
  query Operations($input: LotteryOperationsReportInput!) {
    lotteryOperationsReport(input: $input) {
      stores {
        orgId
        estimated
        sales {
          scan {
            count
            amount
          }
          countSale {
            count
            amount
          }
          manual {
            reasonKey
            count
            amount
          }
          stocktake {
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
            cost
          }
        }
        inventory {
          openingTickets
          openingCost
          salesTickets
          salesCost
          scrapTickets
          scrapCost
          scrapUndoTickets
          scrapUndoCost
          matchCostAdjustCost
          newInvestigatingTickets
          newInvestigatingCost
          endingTickets
          endingCost
          checkTickets
          checkCost
          investigatingTickets
          investigatingCost
          investigatingUnmatchedTickets
          lostTickets
          lostCost
        }
        notes {
          countMode {
            modeAtStart
            since
            modeAtEnd
            changes {
              at
              from
              to
            }
            renumberAts
            daysSinceRenumber
            monthEndUnrenumbered
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

interface TicketDoc {
  _id: Types.ObjectId;
  ticketNo: string;
  version: number;
  status: string;
  unmatched: boolean;
}

interface Store {
  orgId: string;
  estimated: boolean;
  sales: Record<string, unknown> & { cost: number | null };
  inventory: Record<string, number | null>;
  notes: { countMode: Record<string, unknown> | null };
}

/**
 * 張數店的營運報表(張數店規格第 11 節、16.9 RP1–RP4;真帳本 + 真 MongoDB):依張數賣歸到「依張數標記售出」、
 * 對號的成本差、撤銷報廢、估算與區塊 8 的盤點制度註記。每個情境結束核對 `checkCost` = 0(16.1 I5)。
 */
describe("營運報表:張數店(RP1–RP4)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let tenant: Types.ObjectId;
  /** 張數店(10/01 起) */
  let countStore: Types.ObjectId;
  /** 編號店(沒有盤點制度那一筆) */
  let numberedStore: Types.ObjectId;
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

  async function report(input: Record<string, unknown>): Promise<Store[]> {
    const result: GraphqlResult = await api.graphql(
      OPERATIONS,
      { input },
      { accessToken: hq.token },
    );
    expect(result.errors).toBeUndefined();
    return (result.data as { lotteryOperationsReport: { stores: Store[] } })
      .lotteryOperationsReport.stores;
  }

  async function storeOn(date: string, orgId: Types.ObjectId): Promise<Store> {
    const [store] = await report({ ...dayOf(date), orgIds: [String(orgId)] });
    if (store === undefined) {
      throw new Error("no store in report");
    }
    return store;
  }

  /** 進貨點收一本(真的 `createBook`):100 張(#001–#100)、成本 `cost`(單張 = cost ÷ 100)。 */
  async function purchase(
    orgId: Types.ObjectId,
    cost: number,
    at: Date,
  ): Promise<Types.ObjectId> {
    bookSequence += 1;
    const { book } = await transactions().withTransaction((session) =>
      api.app
        .get(LotteryBooksService)
        .createBook(session, storeOperator(orgId), {
          orgId,
          gameId: game,
          bookNo: String(800_000 + bookSequence),
          lastTicketNo: 100,
          rate: 92,
          cost,
          at,
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

  const ticketsWhere = async (
    bookId: Types.ObjectId,
    predicate: (ticket: TicketDoc) => boolean,
    limit = Number.POSITIVE_INFINITY,
  ) => {
    const tickets = await ticketsOf(bookId);
    return tickets.filter((ticket) => predicate(ticket)).slice(0, limit);
  };

  /** 一批張寫同一種事件(真的帳本)。 */
  async function apply(
    orgId: Types.ObjectId,
    tickets: readonly TicketDoc[],
    input: Omit<
      Parameters<TicketLedgerService["applyTicketEvents"]>[2][number],
      "ticketId" | "expectedVersion"
    >,
  ): Promise<void> {
    await transactions().withTransaction((session) =>
      ledger().applyTicketEvents(
        session,
        { operator: storeOperator(orgId) },
        tickets.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          ...input,
        })),
      ),
    );
  }

  /** 拆本:整本移到檯面(本機收銀點)。 */
  async function open(orgId: Types.ObjectId, bookId: Types.ObjectId, at: Date) {
    await apply(orgId, await ticketsOf(bookId), {
      type: "open",
      at,
      patch: { location: { kind: "counter", cashPointId: counter } },
    });
  }

  /** 售出(`extra` 給依張數賣的 refType / 原因與未對號)。 */
  async function sell(
    orgId: Types.ObjectId,
    tickets: readonly TicketDoc[],
    at: Date,
    extra: {
      type?: "sale" | "sale_stocktake";
      source?: "scan" | "manual" | "stocktake" | "count";
      refType?: string;
      reasonKey?: string;
      unmatched?: boolean;
    } = {},
  ) {
    await apply(orgId, tickets, {
      type: extra.type ?? "sale",
      at,
      amount: 200,
      cashEffect: "increase",
      cashPointId: counter,
      refType: extra.refType ?? null,
      refId: extra.refType === undefined ? null : new Types.ObjectId(),
      reasonKey: extra.reasonKey ?? null,
      patch: {
        status: "sold",
        sold: { at, source: extra.source ?? "scan" },
        ...(extra.unmatched === true && { unmatched: true }),
      },
    });
  }

  /** 對號(真的 `matchEventsOf` + 帳本):刷到的張和配對張互換狀態 + 位置。 */
  async function match(
    orgId: Types.ObjectId,
    scanned: TicketDoc,
    partner: TicketDoc,
    at: Date,
  ) {
    const read = (id: Types.ObjectId) =>
      connection.collection(LOTTERY_TICKETS_COLLECTION).findOne({ _id: id });
    const [scannedRecord, partnerRecord] = await Promise.all([
      read(scanned._id),
      read(partner._id),
    ]);
    await transactions().withTransaction((session) =>
      ledger().applyTicketEvents(
        session,
        { operator: storeOperator(orgId) },
        matchEventsOf(
          scannedRecord as unknown as Parameters<typeof matchEventsOf>[0],
          partnerRecord as unknown as Parameters<typeof matchEventsOf>[1],
          at,
        ),
      ),
    );
  }

  const one = async (bookId: Types.ObjectId, ticketNo: string) => {
    const [ticket] = await ticketsWhere(
      bookId,
      (item) => item.ticketNo === ticketNo,
    );
    if (ticket === undefined) {
      throw new Error(`no ticket ${ticketNo}`);
    }
    return ticket;
  };

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-reports-count");
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
    countStore = await createOrg(connection, {
      name: "中山店",
      parentId: tenant,
    });
    numberedStore = await createOrg(connection, {
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
    // 中山店 10/01 從編號改成張數(分店那一筆的歷程,5.6)
    await connection
      .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .insertOne({
        orgId: countStore,
        tenantId: tenant,
        mode: "count",
        since: taipei("2026-10-01", "09:00"),
        lastRenumberAt: null,
        lastRenumberStocktakeId: null,
        history: [
          {
            from: "numbered",
            to: "count",
            at: taipei("2026-10-01", "09:00"),
            by: null,
            cause: "setting",
            stocktakeId: null,
          },
        ],
        movePauses: [],
        stocktakeSessions: [],
        version: 0,
        moduleKey: "store",
        ...base(),
      });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("RP2 撤銷報廢:報廢那個月(已關帳)不變;撤銷的那天加一列「撤銷報廢」扣回報廢損失,核對 0", async () => {
    const bookId = await purchase(
      countStore,
      18_400,
      taipei("2026-10-19", "09:00"),
    );
    const scrapped = [await one(bookId, "001")];
    await apply(countStore, scrapped, {
      type: "scrap",
      at: taipei("2026-10-20", "10:00"),
      reasonKey: "damaged",
      patch: { status: "scrapped" },
    });
    const october = await storeOn("2026-10-20", countStore);
    expect(october.inventory).toMatchObject({
      scrapTickets: 1,
      scrapCost: 184,
      scrapUndoTickets: 0,
      scrapUndoCost: 0,
      endingTickets: 99,
      checkTickets: 0,
      checkCost: 0,
    });
    // 10 月關帳(月底補點編號:張數店、沒補點 → 只提醒的店被放行)
    await connection.collection(LOTTERY_PERIOD_CLOSES_COLLECTION).insertOne({
      orgId: tenant,
      tenantId: tenant,
      month: "2026-10",
      periodStart: taipei("2026-10-01"),
      periodEnd: taipei("2026-11-01"),
      closedAt: taipei("2026-11-01", "10:00"),
      closedBy: hq.userId,
      note: null,
      snapshot: {
        bankAccounts: [],
        stores: [
          {
            orgId: countStore,
            name: "中山店",
            vault: 0,
            drawers: [],
            uncoveredShifts: [],
            renumber: {
              mode: "count",
              required: false,
              done: false,
              lastRenumberAt: null,
            },
          },
        ],
      },
      moduleKey: "accounts",
      ...base(),
    });
    await apply(
      countStore,
      await ticketsOf(bookId).then((all) => all.slice(0, 1)),
      {
        type: "scrap_undo",
        at: taipei("2026-11-04", "10:00"),
        reasonKey: "wrong-ticket",
        patch: { status: "unsold" },
      },
    );
    const november = await storeOn("2026-11-04", countStore);
    expect(november.inventory).toMatchObject({
      openingTickets: 99,
      openingCost: 99 * 184,
      scrapTickets: 0,
      scrapUndoTickets: 1,
      scrapUndoCost: 184,
      endingTickets: 100,
      endingCost: 18_400,
      checkTickets: 0,
      checkCost: 0,
    });
    // 已關帳的 10/20 重跑不變
    expect(await storeOn("2026-10-20", countStore)).toEqual(october);
  });

  it("RP3 依張數賣歸到「依張數標記售出」(帶原因也不混進手動);手動照原因、盤點 [算售出] 算盤點補登", async () => {
    const bookId = await purchase(
      countStore,
      18_400,
      taipei("2026-11-01", "09:00"),
    );
    await open(countStore, bookId, taipei("2026-11-02", "08:00"));
    const unsold = (n: number) =>
      ticketsWhere(bookId, (ticket) => ticket.status === "unsold", n);
    await sell(countStore, await unsold(3), taipei("2026-11-02", "10:00"), {
      source: "count",
      refType: "count_sale",
      reasonKey: "too-busy",
      unmatched: true,
    });
    await sell(countStore, await unsold(1), taipei("2026-11-02", "11:00"), {
      source: "manual",
      reasonKey: "missed",
    });
    await sell(countStore, await unsold(1), taipei("2026-11-02", "12:00"), {
      type: "sale_stocktake",
      source: "stocktake",
      refType: "stocktake",
      unmatched: true,
    });
    await sell(countStore, await unsold(1), taipei("2026-11-02", "13:00"));
    const store = await storeOn("2026-11-02", countStore);
    expect(store.sales).toMatchObject({
      scan: { count: 1, amount: 200 },
      countSale: { count: 3, amount: 600 },
      manual: [{ reasonKey: "missed", count: 1, amount: 200 }],
      stocktake: { count: 1, amount: 200 },
      net: { count: 6, amount: 1200 },
      cost: 6 * 184,
    });
    expect(store.inventory).toMatchObject({
      salesTickets: 6,
      checkTickets: 0,
      checkCost: 0,
    });
    // RP4:這一期有系統預設帶入的張、沒有補點編號 → 估算;區塊 8 列盤點制度
    expect(store.estimated).toBe(true);
    expect(store.notes.countMode).toEqual({
      modeAtStart: "count",
      since: taipei("2026-10-01", "09:00").toISOString(),
      modeAtEnd: "count",
      changes: [],
      renumberAts: [],
      daysSinceRenumber: null,
      monthEndUnrenumbered: [],
    });
  });

  it("RP1 對號:配對張接手已售 → 差額換進已售成本、調整列 0;接手待查 → 差額列在對號成本調整;核對都是 0", async () => {
    const cheap = await purchase(
      countStore,
      18_400,
      taipei("2026-11-05", "09:00"),
    );
    const dear = await purchase(
      countStore,
      20_000,
      taipei("2026-11-05", "09:00"),
    );
    await open(countStore, cheap, taipei("2026-11-05", "09:30"));
    await open(countStore, dear, taipei("2026-11-05", "09:30"));
    // 11/05:依張數賣挑到 cheap #001(184);待查·未對號挑到 cheap #002(184)
    await sell(
      countStore,
      [await one(cheap, "001")],
      taipei("2026-11-05", "10:00"),
      {
        source: "count",
        refType: "count_sale",
        reasonKey: "too-busy",
        unmatched: true,
      },
    );
    await apply(countStore, [await one(cheap, "002")], {
      type: "investigate",
      at: taipei("2026-11-05", "11:00"),
      refType: "stocktake",
      refId: new Types.ObjectId(),
      patch: {
        status: "investigating",
        responsibleOrgId: countStore,
        unmatched: true,
      },
    });
    const before = await storeOn("2026-11-05", countStore);
    expect(before.inventory).toMatchObject({ checkTickets: 0, checkCost: 0 });

    // 11/06:刷到 cheap #001 實體 → 和 dear #001(200)對號;刷到 cheap #002 → 和 dear #002 對號
    await match(
      countStore,
      await one(cheap, "001"),
      await one(dear, "001"),
      taipei("2026-11-06", "10:00"),
    );
    await match(
      countStore,
      await one(cheap, "002"),
      await one(dear, "002"),
      taipei("2026-11-06", "10:05"),
    );
    const day = await storeOn("2026-11-06", countStore);
    expect(day.sales).toMatchObject({
      net: { count: 0, amount: 0 },
      // 已售成本換成配對張的:+200 − 184
      cost: 16,
      games: [{ gameCode: "5164", sold: 0, cost: 16 }],
    });
    expect(day.inventory).toMatchObject({
      salesTickets: 0,
      salesCost: 16,
      // 待查那一對:在手上 +184 − 200
      matchCostAdjustCost: -16,
      investigatingTickets: 1,
      investigatingCost: 200,
      investigatingUnmatchedTickets: 1,
      checkTickets: 0,
      checkCost: 0,
    });
    // 對號的差額記在發生的那一期:前一天重跑不變
    expect(await storeOn("2026-11-05", countStore)).toEqual(before);
    // 對號接手狀態的配對張仍是未對號 → 估算
    expect(day.estimated).toBe(true);
  });

  it("RP4 估算:補點編號核准不早於最後一筆未對號事件 → 不是估算;註記補點次數、距上次補點天數;月報列月底未補點編號;編號店沒有這些", async () => {
    const bookId = await purchase(
      countStore,
      18_400,
      taipei("2026-11-07", "09:00"),
    );
    await open(countStore, bookId, taipei("2026-11-08", "08:00"));
    await sell(
      countStore,
      [await one(bookId, "001")],
      taipei("2026-11-08", "10:00"),
      {
        source: "count",
        refType: "count_sale",
        reasonKey: "too-busy",
        unmatched: true,
      },
    );
    const sold = await storeOn("2026-11-08", countStore);
    expect(sold.estimated).toBe(true);
    // 11/08 22:00 補點編號核准(沒改制度:歷程 from = to)
    await connection
      .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .updateOne({ orgId: countStore }, {
        $push: {
          history: {
            from: "count",
            to: "count",
            at: taipei("2026-11-08", "22:00"),
            by: hq.userId,
            cause: "renumber_approved",
            stocktakeId: new Types.ObjectId(),
          },
        },
        $set: { lastRenumberAt: taipei("2026-11-08", "22:00") },
      } as never);
    const renumbered = await storeOn("2026-11-08", countStore);
    expect(renumbered.estimated).toBe(false);
    expect(renumbered.notes.countMode).toMatchObject({
      renumberAts: [taipei("2026-11-08", "22:00").toISOString()],
      daysSinceRenumber: 0,
    });
    // 之後一期這家店全部都刷 → 不是估算;距上次補點 2 天
    expect(await storeOn("2026-11-10", countStore)).toMatchObject({
      estimated: false,
      notes: { countMode: { renumberAts: [], daysSinceRenumber: 2 } },
    });
    // 10 月月報:10 月關帳時月底沒補點(放行的店)→ 月底未補點編號;10 月有依張數賣嗎?沒有 → 不是估算
    const [october] = await report({
      periodKind: "month",
      from: taipei("2026-10-01").toISOString(),
      to: taipei("2026-11-01").toISOString(),
      orgIds: [String(countStore)],
    });
    expect(october?.notes.countMode).toMatchObject({
      modeAtStart: "numbered",
      changes: [
        {
          at: taipei("2026-10-01", "09:00").toISOString(),
          from: "numbered",
          to: "count",
        },
      ],
      monthEndUnrenumbered: ["2026-10"],
    });
    expect(october?.estimated).toBe(false);
    // 編號店:不標估算、沒有盤點制度註記(畫面不變)
    expect(await storeOn("2026-11-08", numberedStore)).toMatchObject({
      estimated: false,
      notes: { countMode: null },
    });
  });
});
