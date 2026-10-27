import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  PURCHASE_FIELD_KEYS,
  PURCHASE_FORM_KEY,
  PURCHASE_MODULE_KEY,
  PURCHASE_SETTLEMENT_SIDE,
} from "@repo/domain/project/lottery";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import type { OperatorContext } from "../../../database/operator-context";
import {
  countDbCommands,
  expectDbCommandsAtMost,
} from "../../../database/test-support/db-commands";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import {
  type Person,
  WORKFLOW_TEST_TIMEOUT_MS,
  person,
} from "../../../workflows/test-support/workflow-fixtures";
import { LOTTERY_BANK_ACCOUNTS_COLLECTION } from "../../database/lottery-accounts/lottery-bank-account.schema";
import { LOTTERY_BANK_TRANSACTIONS_COLLECTION } from "../../database/lottery-accounts/lottery-bank-transaction.schema";
import { LOTTERY_CASH_MOVEMENTS_COLLECTION } from "../../database/lottery-accounts/lottery-cash-movement.schema";
import { LOTTERY_PERIOD_CLOSES_COLLECTION } from "../../database/lottery-accounts/lottery-period-close.schema";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import { LOTTERY_CHECKOUTS_COLLECTION } from "../../database/lottery-checkouts/lottery-checkout.schema";
import { LOTTERY_GAMES_COLLECTION } from "../../database/lottery-games/lottery-game.schema";
import { LOTTERY_BOOKS_COLLECTION } from "../../database/lottery-inventory/lottery-book.schema";
import { LOTTERY_TICKET_EVENTS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket-event.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import { LOTTERY_REDEMPTIONS_COLLECTION } from "../../database/lottery-redemptions/lottery-redemption.schema";
import { LOTTERY_STOCKTAKES_COLLECTION } from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import { LOTTERY_SHIFTS_COLLECTION } from "../../database/lottery-store/lottery-shift.schema";
import { LOTTERY_TRANSFER_RECEIPTS_COLLECTION } from "../../database/lottery-transfers/lottery-transfer-receipt.schema";
import {
  insertGame,
  seedInventoryModule,
} from "../purchase/test-support/purchase-fixtures";
import { LotteryBooksService } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

/**
 * 一家店一份營運報表的資料庫指令數上限(防退化,TX-06 延伸到交易外 N+1):整個請求的總數(含登入檢查),
 * 與本數、張數無關(實測一家店一份約 53 次)。
 */
const OPERATIONS_REPORT_COMMANDS_LIMIT = 80;

const OPERATIONS = /* GraphQL */ `
  query Operations($input: LotteryOperationsReportInput!) {
    lotteryOperationsReport(input: $input) {
      closedThrough
      canShowCost
      stores {
        orgId
        period {
          from
          to
          alignment
        }
        sales {
          scan {
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
          undo {
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
            undone
            netAmount
            cost
          }
        }
        redemption {
          valid {
            count
            amount
          }
          inStore {
            count
            amount
          }
          sent {
            count
            amount
          }
          revoked {
            count
            amount
          }
        }
        inventory {
          openingTickets
          openingCost
          purchaseBooks
          purchaseVoidBooks
          purchaseTickets
          purchaseCost
          transferInTickets
          transferInAmount
          transferOutTickets
          transferOutCost
          transferOutAmount
          transferGain
          salesTickets
          salesCost
          scrapTickets
          scrapCost
          newInvestigatingTickets
          newInvestigatingCost
          investigateRecoveredTickets
          investigateRecoveredCost
          lostRecoveredTickets
          lostRecoveredCost
          endingTickets
          endingCost
          checkTickets
          checkCost
          inTransitTickets
          inTransitAmount
          investigatingTickets
          investigatingCost
          investigatingBooks
          investigatingBookIds
          lostTickets
          lostCost
          skippedTickets
        }
        cash {
          shiftCount
          pendingShiftCount
          shiftDifference
          postClose {
            category
            count
            amount
          }
          dailyCloseCount
          vaultDifference
          movements {
            type
            count
            drawer
            vault
          }
        }
        bankAccounts {
          label
          shared
          types {
            type
            inAmount
            outAmount
            reversalCount
          }
          endingBalance
        }
        outstanding {
          items {
            kind
            count
            amount
            serialNos
          }
        }
        notes {
          skippedStocktakes {
            reason
            count
          }
          uncountedStocktakes
          uncountedBooks
          uncoveredShifts
          uncoveredShiftLabels
          priorPeriodCount
          priorPeriodAmount
          openMonths
        }
      }
    }
  }
`;

const PERIODS = /* GraphQL */ `
  query Periods($input: LotteryOperationsReportInput!) {
    lotteryOperationsReportPeriods(input: $input) {
      closedThrough
      stores {
        orgId
        from
        to
        alignment
      }
    }
  }
`;

const SHIFT_CHECKOUTS = /* GraphQL */ `
  query ShiftCheckouts($input: LotteryShiftCheckoutsReportInput!) {
    lotteryShiftCheckoutsReport(input: $input) {
      rows {
        orgId
        cashPointName
        leader
        helpers
        taskRole
        expected
        counted
        difference
        diffReason
        postClose
        postCloseEntries {
          category
          amount
          recordedAt
          priorPeriod
        }
        stocktakeMode
        skipReason
        uncountedBooks
        status
      }
    }
  }
`;

type Store = Record<string, unknown> & {
  orgId: string;
  sales: Record<string, unknown>;
  redemption: Record<string, unknown>;
  inventory: Record<string, unknown>;
  cash: Record<string, unknown>;
  outstanding: Record<string, unknown>;
  notes: Record<string, unknown>;
};

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

/** 售出事件的金額與現金影響。 */
const sale = (amount: number, extra: Record<string, unknown> = {}) => ({
  amount,
  cashEffect: "increase",
  ...extra,
});

/** 一筆修訂(完整值快照 + 當時的時間)。 */
const revisionOf = (
  revision: number,
  values: Record<string, unknown>,
  at: Date,
) => ({
  revision,
  values,
  ctx: { at, timezone: "Asia/Taipei", userId: null, orgId: null },
});

/** 清單的第 N 筆(測試資料一定有;沒有就讓測試直接失敗)。 */
function nth<Item>(list: readonly Item[], index: number): Item {
  const item = list[index];
  if (item === undefined) {
    throw new Error(`missing item ${String(index)}`);
  }
  return item;
}

const firstOf = <Item>(list: readonly Item[]): Item => nth(list, 0);

/** 調貨單的存值(單頭 + 明細;明細照表單存值的形狀)。 */
const transferValues = (
  fromId: Types.ObjectId,
  toId: Types.ObjectId,
  lines: Record<string, unknown>[],
) => ({
  from_branch: { id: String(fromId), label: "" },
  to_branch: { id: String(toId), label: "" },
  lines,
});

/** 區塊 7 某一種未結清的金額。 */
const outstandingAmount = (store: Store, kind: string): number =>
  (
    store.outstanding as { items: { kind: string; amount: number }[] }
  ).items.find((item) => item.kind === kind)?.amount ?? Number.NaN;

/**
 * 營運報表、班次結帳歷史報表(規格第 11 章;票面 P29 的驗收條件):打真的 GraphQL 端點,對真 MongoDB(TEST-07)。
 * 張、事件、班、結帳單、兌獎、流水、交易直接寫成資料(各功能的寫入已在自己的測試驗過),報表只讀。
 *
 * 組織樹:root ─ 租戶甲(含下層)─ 中山店 / 新竹店 / 台中店
 */
describe("輸出報表:營運報表、班次結帳歷史報表(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let tenant: Types.ObjectId;
  let zhongshan: Types.ObjectId;
  let hsinchu: Types.ObjectId;
  let taichung: Types.ObjectId;
  const counters = new Map<string, Types.ObjectId>();

  /** 總部管理:兩張報表 + 成本 */
  let hq: Person;
  /** 沒有 `reports.show-cost` */
  let noCost: Person;
  /** 只有班次結帳歷史報表 */
  let shiftOnly: Person;

  const gql = (
    who: Person,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> =>
    api.graphql(query, variables, { accessToken: who.token });

  async function ok<T>(
    who: Person,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const result = await gql(who, query, variables);
    expect(result.errors).toBeUndefined();
    return result.data as T;
  }

  async function operations(
    who: Person,
    input: Record<string, unknown>,
  ): Promise<{ canShowCost: boolean; stores: Store[] }> {
    const data = await ok<{
      lotteryOperationsReport: { canShowCost: boolean; stores: Store[] };
    }>(who, OPERATIONS, { input });
    return data.lotteryOperationsReport;
  }

  /** 一家店某一天的營運報表(日)。 */
  async function storeOn(date: string, orgId: Types.ObjectId): Promise<Store> {
    const result = await operations(hq, {
      ...dayOf(date),
      orgIds: [String(orgId)],
    });
    return firstOf(result.stores);
  }

  const inventoryOn = async (date: string, orgId: Types.ObjectId) => {
    const store = await storeOn(date, orgId);
    return store.inventory;
  };

  const transactions = () => api.app.get(TransactionService);
  const ledger = () => api.app.get(TicketLedgerService);

  const insert = async (
    collection: string,
    doc: Record<string, unknown>,
  ): Promise<Types.ObjectId> => {
    const { insertedId } = await connection
      .collection(collection)
      .insertOne({ tenantId: tenant, ...doc, ...base() });
    return insertedId;
  };

  async function shiftOf(input: {
    orgId: Types.ObjectId;
    openedAt: Date;
    closedAt: Date;
    openedBy: Types.ObjectId;
    checkout: Record<string, unknown>;
  }): Promise<{ shiftId: Types.ObjectId; checkoutId: Types.ObjectId }> {
    const cashPointId = counters.get(String(input.orgId));
    const shiftId = await insert(LOTTERY_SHIFTS_COLLECTION, {
      orgId: input.orgId,
      cashPointId,
      openedBy: input.openedBy,
      openedAt: input.openedAt,
      openingFloat: 0,
      openingFloatSource: "none",
      previousShiftId: null,
      openingMovementId: null,
      scheduleEntryId: null,
      scheduleTaskSnapshot: null,
      positionMismatch: null,
      closedAt: input.closedAt,
      checkoutId: null,
      drawerVersion: 0,
      label: "",
      moduleKey: "store",
    });
    const checkoutId = await insert(LOTTERY_CHECKOUTS_COLLECTION, {
      ...checkoutDoc(input.orgId, input.closedAt),
      type: "shift",
      cashPointId,
      shiftId,
      ...input.checkout,
    });
    await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .updateOne({ _id: shiftId }, { $set: { checkoutId } });
    return { shiftId, checkoutId };
  }

  function checkoutDoc(orgId: Types.ObjectId, submittedAt: Date) {
    return {
      orgId,
      status: "confirmed",
      stocktakeMode: "new",
      stocktakeId: null,
      skipReasonKey: null,
      skipReason: null,
      skipReasonNote: null,
      expectedItems: [],
      expected: 0,
      denominations: [],
      counted: 0,
      difference: 0,
      diffReasonKey: null,
      diffReason: null,
      diffReasonNote: null,
      pendingImpacts: [],
      leftForNext: 0,
      successorId: null,
      submittedBy: hq.userId,
      submittedAt,
      confirmedAt: submittedAt,
      confirmedBy: null,
      coveredFrom: null,
      coveredTo: null,
      coveredShiftIds: [],
      bankDepositAmount: 0,
      bankAccountId: null,
      bankTransactionId: null,
      bankMovementId: null,
      submissionId: new Types.ObjectId(),
      version: 0,
      moduleKey: "store",
    };
  }

  async function dailyClose(
    orgId: Types.ObjectId,
    coveredFrom: Date | null,
    coveredTo: Date,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await insert(LOTTERY_CHECKOUTS_COLLECTION, {
      ...checkoutDoc(orgId, coveredTo),
      type: "daily",
      cashPointId: null,
      shiftId: null,
      coveredFrom,
      coveredTo,
      ...extra,
    });
  }

  async function redemption(input: {
    orgId: Types.ObjectId;
    shiftId: Types.ObjectId;
    prizeAmount: number;
    redeemedAt: Date;
    status?: "in_store" | "sent" | "revoked";
    ticketNo: string;
    extra?: Record<string, unknown>;
  }): Promise<Types.ObjectId> {
    return insert(LOTTERY_REDEMPTIONS_COLLECTION, {
      serialNo: null,
      orgId: input.orgId,
      shiftId: input.shiftId,
      cashPointId: counters.get(String(input.orgId)),
      redeemedAt: input.redeemedAt,
      redeemedBy: hq.userId,
      gameCode: "5164",
      bookNo: "0056527",
      ticketNo: input.ticketNo,
      ticketLabel: `5164-056527-${input.ticketNo}`,
      rawInput: "",
      ticketId: null,
      gameId: null,
      prizeAmount: input.prizeAmount,
      status: input.status ?? "in_store",
      purchaseSubmissionId: null,
      sentAt: null,
      revokedAt: null,
      revokedBy: null,
      revokeReasonKey: null,
      revokeReason: null,
      revokeNote: null,
      replacesId: null,
      postCloseOf: null,
      revokePostCloseOf: null,
      note: null,
      version: 0,
      moduleKey: "store",
      ...input.extra,
    });
  }

  async function movement(input: {
    orgId: Types.ObjectId;
    type: string;
    from: string;
    to: string;
    amount: number;
    occurredAt: Date;
    extra?: Record<string, unknown>;
  }): Promise<void> {
    await insert(LOTTERY_CASH_MOVEMENTS_COLLECTION, {
      orgId: input.orgId,
      occurredAt: input.occurredAt,
      type: input.type,
      from: input.from,
      to: input.to,
      reason: null,
      cashPointId: null,
      shiftId: null,
      attributedShiftId: null,
      postCloseOf: null,
      amount: input.amount,
      refType: null,
      refId: null,
      refRevision: null,
      settlementSide: null,
      payee: null,
      note: null,
      reversalOf: null,
      bankTransactionId: null,
      moduleKey: "accounts",
      ...input.extra,
    });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-reports");
    connection = api.connection;
    const { insertedId: moduleId } = await connection
      .collection("modules")
      .insertOne({
        key: "reports",
        name: "輸出報表",
        parentId: null,
        ancestors: [],
        route: "reports",
        sidebarType: "link",
        order: 50,
        enabled: true,
        isSystem: false,
        icon: null,
        settings: {},
        engine: "form",
        ...base(),
      });
    await connection.collection("permissions").insertMany(
      [
        "reports.operations",
        "reports.shift-checkouts",
        "reports.export",
        "reports.show-cost",
      ].map((key) => ({
        key,
        moduleId,
        name: key,
        enabled: true,
        isSystem: false,
        settings: {},
        source: "seed",
        retiredAt: null,
        ...base(),
      })),
    );
    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    zhongshan = await createOrg(connection, {
      name: "中山店",
      parentId: tenant,
    });
    hsinchu = await createOrg(connection, { name: "新竹店", parentId: tenant });
    taichung = await createOrg(connection, {
      name: "台中店",
      parentId: tenant,
    });
    for (const [orgId, name] of [
      [zhongshan, "店內櫃台"],
      [hsinchu, "新竹櫃台"],
      [taichung, "台中櫃台"],
    ] as const) {
      counters.set(
        String(orgId),
        await insert(LOTTERY_CASH_POINTS_COLLECTION, {
          orgId,
          positionKey: "in-store-counter",
          name,
          order: 1,
          enabled: true,
          printerId: null,
          note: null,
          moduleKey: "master-data",
        }),
      );
    }
    hq = await person(api, connection, tenant, tenant, {
      moduleKeys: ["reports"],
      permissionKeys: [
        "reports.operations",
        "reports.shift-checkouts",
        "reports.show-cost",
      ],
    });
    noCost = await person(api, connection, tenant, tenant, {
      moduleKeys: ["reports"],
      permissionKeys: ["reports.operations", "reports.shift-checkouts"],
    });
    shiftOnly = await person(api, connection, tenant, tenant, {
      moduleKeys: ["reports"],
      permissionKeys: ["reports.shift-checkouts"],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("沒有 reports.operations → 營運報表 FORBIDDEN;沒有 reports.shift-checkouts → 班次結帳歷史 FORBIDDEN", async () => {
    const input = { ...dayOf("2026-10-12"), orgIds: [String(zhongshan)] };
    const result = await gql(shiftOnly, OPERATIONS, { input });
    expect(result.errors?.[0]?.extensions).toMatchObject({ code: "FORBIDDEN" });
    const periods = await gql(shiftOnly, PERIODS, { input });
    expect(periods.errors?.[0]?.extensions).toMatchObject({
      code: "FORBIDDEN",
    });
    const viewer = await person(api, connection, tenant, tenant, {
      moduleKeys: ["reports"],
      permissionKeys: ["reports.operations"],
    });
    const history = await gql(viewer, SHIFT_CHECKOUTS, { input });
    expect(history.errors?.[0]?.extensions).toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("分店數超過上限 → RANGE_TOO_LARGE(營運 50 家、班次結帳歷史 20 家);看不到的分店 → NOT_FOUND", async () => {
    const many = (count: number) =>
      Array.from({ length: count }, () => String(new Types.ObjectId()));
    const operationsResult = await gql(hq, OPERATIONS, {
      input: { ...dayOf("2026-10-12"), orgIds: many(51) },
    });
    expect(operationsResult.errors?.[0]?.extensions).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "RANGE_TOO_LARGE",
      fields: ["orgIds"],
    });
    const historyResult = await gql(hq, SHIFT_CHECKOUTS, {
      input: { ...dayOf("2026-10-12"), orgIds: many(21) },
    });
    expect(historyResult.errors?.[0]?.extensions).toMatchObject({
      reason: "RANGE_TOO_LARGE",
    });
    const tooLong = await gql(hq, OPERATIONS, {
      input: {
        periodKind: "day",
        from: taipei("2026-10-01").toISOString(),
        to: taipei("2026-10-08").toISOString(),
        orgIds: [String(zhongshan)],
      },
    });
    expect(tooLong.errors?.[0]?.extensions).toMatchObject({
      reason: "RANGE_TOO_LARGE",
    });
    const other = await createOrg(connection, { name: "別的租戶" });
    const hidden = await gql(hq, OPERATIONS, {
      input: { ...dayOf("2026-10-12"), orgIds: [String(other)] },
    });
    expect(hidden.errors?.[0]?.extensions).toMatchObject({ code: "NOT_FOUND" });
  });

  it("第 17 章第 5 題:那一班的事後更正 +1,800 列在「事後更正」(兩張報表)", async () => {
    // 週一晚班:期初 5,000;200 元的獎登記成 2,000 → 應有 3,000,實點 4,800,差額 +1,800
    const { shiftId } = await shiftOf({
      orgId: zhongshan,
      openedAt: taipei("2026-10-12", "17:00"),
      closedAt: taipei("2026-10-12", "22:00"),
      openedBy: hq.userId,
      checkout: {
        expected: 3000,
        counted: 4800,
        difference: 1800,
        diffReason: "其他",
        diffReasonNote: "兌獎金額待查",
      },
    });
    // 週二店長 [撤銷並重新登記]:撤銷 2,000 那筆(交班後撤銷)、重新登記 200(交班後新增),兩筆都算週一晚班
    const original = await redemption({
      orgId: zhongshan,
      shiftId,
      prizeAmount: 2000,
      redeemedAt: taipei("2026-10-12", "19:00"),
      status: "revoked",
      ticketNo: "031",
      extra: {
        revokedAt: taipei("2026-10-13", "10:00"),
        revokePostCloseOf: shiftId,
      },
    });
    await redemption({
      orgId: zhongshan,
      shiftId,
      prizeAmount: 200,
      redeemedAt: taipei("2026-10-13", "10:00"),
      ticketNo: "032",
      extra: { replacesId: original, postCloseOf: shiftId },
    });

    const history = await ok<{
      lotteryShiftCheckoutsReport: { rows: Record<string, unknown>[] };
    }>(hq, SHIFT_CHECKOUTS, {
      input: { ...dayOf("2026-10-12"), orgIds: [String(zhongshan)] },
    });
    expect(history.lotteryShiftCheckoutsReport.rows).toEqual([
      expect.objectContaining({
        cashPointName: "店內櫃台",
        expected: 3000,
        counted: 4800,
        difference: 1800,
        diffReason: "其他(兌獎金額待查)",
        postClose: 1800,
        // 原班的結帳快照不變;之後才記的更正逐筆另列(記錄當時、類別)
        postCloseEntries: [
          {
            category: "redemption",
            amount: -200,
            recordedAt: taipei("2026-10-13", "10:00").toISOString(),
            priorPeriod: false,
          },
          {
            category: "redemption",
            amount: 2000,
            recordedAt: taipei("2026-10-13", "10:00").toISOString(),
            priorPeriod: false,
          },
        ],
        status: "confirmed",
      }),
    ]);

    const report = await operations(hq, {
      ...dayOf("2026-10-12"),
      orgIds: [String(zhongshan)],
    });
    // 事後更正算在記錄當期:週一(10/12)的報表只有那一班的差額,週二(10/13)才出現 +1,800
    expect(report.stores[0]?.cash).toMatchObject({
      shiftCount: 1,
      shiftDifference: 1800,
      postClose: [],
    });
    const tuesday = await operations(hq, {
      ...dayOf("2026-10-13"),
      orgIds: [String(zhongshan)],
    });
    expect(firstOf(tuesday.stores).cash).toMatchObject({
      shiftCount: 0,
      postClose: [{ category: "redemption", count: 2, amount: 1800 }],
    });
    // 兌獎狀態看期末那一刻:週一期末那筆 2,000 還沒撤銷(週二才撤銷)→ 週一的日報算有效,重跑也一樣;
    // 撤銷算在發生那天(週二的事後更正)
    expect(report.stores[0]?.redemption).toMatchObject({
      valid: { count: 1, amount: 2000 },
      revoked: { count: 0, amount: 0 },
    });
  });

  it("班次結帳歷史:負責人 / 協同(從排班取得)/ 任務內容、收銀點與只看有差額的條件、盤點標示", async () => {
    const helper = await person(api, connection, zhongshan, tenant, {
      moduleKeys: ["reports"],
      permissionKeys: [],
    });
    const demandId = await insert("schedule_demands", {
      orgId: zhongshan,
      date: "2026-10-20",
      startAt: taipei("2026-10-20", "08:00"),
      endAt: taipei("2026-10-20", "16:00"),
      positionKey: "in-store-counter",
      tasks: [
        { taskId: "t1", role: "leader", taskKey: "counter-lead" },
        { taskId: "t2", role: "helper", taskKey: "counter-help" },
      ],
      templateId: null,
      source: "manual",
      moduleKey: "schedule.manage",
    });
    const entryOf = (userId: Types.ObjectId) =>
      insert("schedule_entries", {
        orgId: zhongshan,
        userId,
        date: "2026-10-20",
        startAt: taipei("2026-10-20", "08:00"),
        endAt: taipei("2026-10-20", "16:00"),
        breakMinutes: 0,
        moduleKey: "schedule.manage",
      });
    const leaderEntry = await entryOf(hq.userId);
    const helperEntry = await entryOf(helper.userId);
    for (const [entryId, taskId] of [
      [leaderEntry, "t1"],
      [helperEntry, "t2"],
    ] as const) {
      await insert("schedule_task_assignments", {
        orgId: zhongshan,
        entryId,
        demandId,
        taskId,
        source: "manual",
        autoRunId: null,
        reason: null,
        moduleKey: "schedule.manage",
      });
    }
    const { shiftId } = await shiftOf({
      orgId: zhongshan,
      openedAt: taipei("2026-10-20", "08:00"),
      closedAt: taipei("2026-10-20", "16:00"),
      openedBy: hq.userId,
      checkout: {
        difference: -100,
        stocktakeMode: "skip",
        skipReason: "人力不足",
      },
    });
    await connection.collection(LOTTERY_SHIFTS_COLLECTION).updateOne(
      { _id: shiftId },
      {
        $set: {
          scheduleEntryId: leaderEntry,
          scheduleTaskSnapshot: {
            demandId: String(demandId),
            taskId: "t1",
            role: "leader",
            taskKey: "counter-lead",
            positionKey: "in-store-counter",
          },
        },
      },
    );
    // 同一天另一班沒有差額
    await shiftOf({
      orgId: zhongshan,
      openedAt: taipei("2026-10-20", "16:00"),
      closedAt: taipei("2026-10-20", "22:00"),
      openedBy: hq.userId,
      checkout: {},
    });
    const users = await connection
      .collection("users")
      .find({ _id: { $in: [hq.userId, helper.userId] } })
      .toArray();
    const nameOf = (id: Types.ObjectId) =>
      users.find((user) => id.equals(user._id))?.name as string;
    const input = {
      ...dayOf("2026-10-20"),
      orgIds: [String(zhongshan)],
      cashPointId: String(counters.get(String(zhongshan))),
    };
    const all = await ok<{
      lotteryShiftCheckoutsReport: { rows: Record<string, unknown>[] };
    }>(hq, SHIFT_CHECKOUTS, { input });
    expect(all.lotteryShiftCheckoutsReport.rows).toHaveLength(2);
    expect(all.lotteryShiftCheckoutsReport.rows[0]).toMatchObject({
      leader: nameOf(hq.userId),
      helpers: [nameOf(helper.userId)],
      taskRole: "leader",
      stocktakeMode: "skip",
      skipReason: "人力不足",
      uncountedBooks: 0,
    });
    expect(all.lotteryShiftCheckoutsReport.rows[1]).toMatchObject({
      helpers: [],
      taskRole: null,
    });
    const onlyDiff = await ok<{
      lotteryShiftCheckoutsReport: { rows: Record<string, unknown>[] };
    }>(hq, SHIFT_CHECKOUTS, {
      input: { ...input, onlyWithDifference: true },
    });
    expect(onlyDiff.lotteryShiftCheckoutsReport.rows).toEqual([
      expect.objectContaining({ difference: -100 }),
    ]);
    const otherPoint = await ok<{
      lotteryShiftCheckoutsReport: { rows: Record<string, unknown>[] };
    }>(hq, SHIFT_CHECKOUTS, {
      input: { ...input, cashPointId: String(new Types.ObjectId()) },
    });
    expect(otherPoint.lotteryShiftCheckoutsReport.rows).toEqual([]);
  });

  it("對齊日結:中山店有日結 → 用日結的涵蓋計算期間;新竹店沒有 → 整天並標示", async () => {
    await dailyClose(
      zhongshan,
      taipei("2026-10-15", "22:05"),
      taipei("2026-10-16", "22:30"),
    );
    const input = {
      ...dayOf("2026-10-16"),
      orgIds: [String(zhongshan), String(hsinchu)],
      alignDailyClose: true,
    };
    const periods = await ok<{
      lotteryOperationsReportPeriods: {
        stores: {
          orgId: string;
          from: string;
          to: string;
          alignment: string;
        }[];
      };
    }>(hq, PERIODS, { input });
    expect(periods.lotteryOperationsReportPeriods.stores).toEqual([
      {
        orgId: String(zhongshan),
        from: taipei("2026-10-15", "22:05").toISOString(),
        to: taipei("2026-10-16", "22:30").toISOString(),
        alignment: "dailyClose",
      },
      {
        orgId: String(hsinchu),
        from: taipei("2026-10-16").toISOString(),
        to: taipei("2026-10-17").toISOString(),
        alignment: "fullDay",
      },
    ]);
    const report = await operations(hq, input);
    expect(report.stores.map((store) => store.period)).toEqual([
      expect.objectContaining({ alignment: "dailyClose" }),
      expect.objectContaining({ alignment: "fullDay" }),
    ]);
    // 不勾對齊 / 週報 → 照選的期間
    const plain = await operations(hq, {
      ...input,
      alignDailyClose: false,
    });
    expect(plain.stores[0]?.period).toMatchObject({ alignment: "period" });
  });

  describe("8 個區塊(台中店 2026-10-14)", () => {
    const day = "2026-10-14";
    let report: Store;
    let withoutCost: Store;

    beforeAll(async () => {
      const at = (time: string) => taipei(day, time);
      const game1 = await insert(LOTTERY_GAMES_COLLECTION, {
        orgId: tenant,
        gameCode: "5164",
        name: "發大財",
        unitPrice: 200,
        moduleKey: "master-data",
      });
      const game2 = await insert(LOTTERY_GAMES_COLLECTION, {
        orgId: tenant,
        gameCode: "5201",
        name: "金好運",
        unitPrice: 100,
        moduleKey: "master-data",
      });
      const book1 = await insert(LOTTERY_BOOKS_COLLECTION, {
        orgId: taichung,
        gameId: game1,
        bookKey: "5164-0000001",
        cost: 3000,
        // 迄號 21、標準 20 張:#021 是跳號(今天拆本時標註;拆本前待標註、不算庫存)
        standardTickets: 20,
        lastTicketNo: "021",
        skippedTicketNos: ["021"],
        status: "normal",
        moduleKey: "inventory",
      });
      const book2 = await insert(LOTTERY_BOOKS_COLLECTION, {
        orgId: taichung,
        gameId: game2,
        bookKey: "5201-0000002",
        cost: 900,
        moduleKey: "inventory",
      });
      const book3 = await insert(LOTTERY_BOOKS_COLLECTION, {
        orgId: hsinchu,
        gameId: game2,
        bookKey: "5201-0000003",
        cost: 900,
        moduleKey: "inventory",
      });
      let sequence = 0;
      let ticketSequence = 0;
      // 帳本每筆事件記事件前的單張成本(成本快照)
      const unitCosts = new Map<string, number>();
      const ticket = async (bookId: Types.ObjectId, unitCost: number) => {
        ticketSequence += 1;
        const ticketNo = String(ticketSequence).padStart(3, "0");
        const id = await insert(LOTTERY_TICKETS_COLLECTION, {
          orgId: taichung,
          bookId,
          ticketNo,
          ticketKey: `${String(bookId)}-${ticketNo}`,
          unitCost,
          moduleKey: "inventory",
        });
        unitCosts.set(String(id), unitCost);
        return id;
      };
      const lastState = new Map<string, Record<string, unknown>>();
      const event = async (
        ticketId: Types.ObjectId,
        bookId: Types.ObjectId,
        gameId: Types.ObjectId,
        type: string,
        when: Date,
        to: { status: string; locationKind: string; orgId?: Types.ObjectId },
        extra: Record<string, unknown> = {},
      ) => {
        sequence += 1;
        await insert(LOTTERY_TICKET_EVENTS_COLLECTION, {
          orgId: to.orgId ?? taichung,
          eventId: `${String(ticketId)}:${String(sequence)}`,
          ticketId,
          bookId,
          gameId,
          at: when,
          by: null,
          type,
          // 變動前 = 這張上一筆事件的變動後(進貨沒有前一個狀態)
          from: lastState.get(String(ticketId)) ?? null,
          to: {
            status: to.status,
            locationKind: to.locationKind,
            cashPointId: null,
            orgId: to.orgId ?? taichung,
          },
          quantity: 1,
          amount: 0,
          cost: unitCosts.get(String(ticketId)) ?? null,
          cashEffect: "none",
          cashPointId: null,
          shiftId: null,
          refType: null,
          refId: null,
          reasonKey: null,
          reasonNote: null,
          postCloseOf: null,
          moduleKey: "inventory",
          ...extra,
        });
        lastState.set(String(ticketId), {
          status: to.status,
          locationKind: to.locationKind,
          cashPointId: null,
          orgId: to.orgId ?? taichung,
        });
      };
      const unsold = { status: "unsold", locationKind: "stock" };
      const sold = { status: "sold", locationKind: "counter" };

      // 本 1(5164,成本 3,000、標準 20 張 + 待標註 1 張、單張 150):今天進貨
      const b1: Types.ObjectId[] = [];
      for (let index = 0; index < 21; index += 1) {
        const id = await ticket(book1, 150);
        b1.push(id);
        await event(id, book1, game1, "purchase", at("09:00"), unsold);
      }
      const [t1, t2, t3, t4, t5] = b1 as [
        Types.ObjectId,
        Types.ObjectId,
        Types.ObjectId,
        Types.ObjectId,
        Types.ObjectId,
      ];
      // 銷售:刷條碼 #1 #2 #5(#5 當下撤銷)、手動 #3(刷不到條碼)、盤點補登 #4
      await event(t1, book1, game1, "sale", at("10:00"), sold, sale(200));
      await event(t2, book1, game1, "sale", at("10:05"), sold, sale(200));
      await event(
        t3,
        book1,
        game1,
        "sale",
        at("10:10"),
        sold,
        sale(200, { reasonKey: "scan-failed" }),
      );
      await event(
        t4,
        book1,
        game1,
        "sale_stocktake",
        at("10:15"),
        sold,
        sale(200),
      );
      await event(t5, book1, game1, "sale", at("10:20"), sold, sale(200));
      await event(t5, book1, game1, "sale_undo", at("10:21"), unsold, {
        amount: 200,
        cashEffect: "decrease",
      });
      // 拆本標跳號 #21(不計成本)、報廢 #19(成本快照 150)、#18 待查 → 遺失、#17 待查 → 尋回、待查 #16
      await event(nth(b1, 20), book1, game1, "skip", at("11:00"), {
        status: "skipped",
        locationKind: "stock",
      });
      await event(
        nth(b1, 18),
        book1,
        game1,
        "scrap",
        at("11:05"),
        { status: "scrapped", locationKind: "stock" },
        { cost: 150 },
      );
      const investigating = { status: "investigating", locationKind: "stock" };
      await event(
        nth(b1, 17),
        book1,
        game1,
        "investigate",
        at("11:06"),
        investigating,
      );
      await event(nth(b1, 17), book1, game1, "lose", at("11:10"), {
        status: "lost",
        locationKind: "stock",
      });
      await event(
        nth(b1, 16),
        book1,
        game1,
        "investigate",
        at("11:07"),
        investigating,
      );
      await event(nth(b1, 16), book1, game1, "recover", at("11:15"), unsold);
      await event(nth(b1, 15), book1, game1, "investigate", at("11:20"), {
        status: "investigating",
        locationKind: "stock",
      });

      // 本 2(5201,成本 900、10 張、單張 90):10/1 進貨;今天賣 1 張、調出 2 張給中山店
      const b2: Types.ObjectId[] = [];
      for (let index = 0; index < 10; index += 1) {
        const id = await ticket(book2, 90);
        b2.push(id);
        await event(
          id,
          book2,
          game2,
          "purchase",
          taipei("2026-10-01", "09:00"),
          unsold,
        );
      }
      await event(
        nth(b2, 0),
        book2,
        game2,
        "sale",
        at("12:00"),
        sold,
        sale(100),
      );
      // 調貨單(選張 #023 #024,金額 240、率 100 → 一張 120)
      const { insertedId: transferId } = await connection
        .collection("form_submissions")
        .insertOne({
          orgId: taichung,
          tenantId: tenant,
          moduleKey: "purchasing.transfer",
          formKey: "transfer",
          version: 1,
          values: transferValues(taichung, zhongshan, [
            {
              rowId: "r1",
              book: { id: String(book2) },
              mode: { id: "partial" },
              ticket_nos: "023-024",
              tickets: 2,
              amount: 240,
              rate: 100,
            },
          ]),
          summary: null,
          status: "completed",
          revision: 1,
          revisions: [],
          editVersion: 1,
          touched: [],
          clientRequestId: String(new Types.ObjectId()),
          serialNo: "T-0100",
          submittedAt: at("12:30"),
          currentInstanceId: null,
          blocked: false,
          ...base(),
        });
      const transferRef = { refType: "transfer", refId: transferId };
      for (const id of [b2[1], b2[2]] as Types.ObjectId[]) {
        await event(
          id,
          book2,
          game2,
          "transfer_out",
          at("13:00"),
          { status: "unsold", locationKind: "in_transit" },
          // 出貨當時的調貨金額快照(一張 120)
          { ...transferRef, amount: 120 },
        );
        await event(
          id,
          book2,
          game2,
          "transfer_in",
          at("15:00"),
          { ...unsold, orgId: zhongshan },
          {
            ...transferRef,
            from: {
              status: "unsold",
              locationKind: "in_transit",
              cashPointId: null,
              orgId: taichung,
            },
          },
        );
      }
      await insert(LOTTERY_TRANSFER_RECEIPTS_COLLECTION, {
        orgId: zhongshan,
        fromOrgId: taichung,
        submissionId: transferId,
        rowId: "r1",
        bookId: book2,
        purchaseAmount: 240,
        tickets: [b2[1], b2[2]].map((ticketId) => ({ ticketId, unitCost: 90 })),
        receivedBy: hq.userId,
        receivedAt: at("15:00"),
        moduleKey: "purchasing.transfer",
      });
      // 從新竹店調入 3 張(調入後單張 100)
      const incoming: Types.ObjectId[] = [];
      for (let index = 0; index < 3; index += 1) {
        const id = await ticket(book3, 100);
        incoming.push(id);
        await event(id, book3, game2, "transfer_in", at("16:00"), unsold);
      }
      await insert(LOTTERY_TRANSFER_RECEIPTS_COLLECTION, {
        orgId: taichung,
        fromOrgId: hsinchu,
        submissionId: new Types.ObjectId(),
        rowId: "r1",
        bookId: book3,
        purchaseAmount: 300,
        tickets: incoming.map((ticketId) => ({ ticketId, unitCost: 80 })),
        receivedBy: hq.userId,
        receivedAt: at("16:00"),
        moduleKey: "purchasing.transfer",
      });

      // 張的現況 = 最後一筆事件的變動後(報表的期末庫存從現況往回推);調到中山店的兩張調入後單張成本 120
      const finals = await connection
        .collection(LOTTERY_TICKET_EVENTS_COLLECTION)
        .aggregate<{
          _id: Types.ObjectId;
          last: { status: string; locationKind: string; orgId: Types.ObjectId };
        }>([
          { $sort: { at: 1, _id: 1 } },
          { $group: { _id: "$ticketId", last: { $last: "$to" } } },
        ])
        .toArray();
      for (const final of finals) {
        await connection.collection(LOTTERY_TICKETS_COLLECTION).updateOne(
          { _id: final._id },
          {
            $set: {
              status: final.last.status,
              location: { kind: final.last.locationKind, cashPointId: null },
              orgId: final.last.orgId,
            },
          },
        );
      }
      await connection
        .collection(LOTTERY_TICKETS_COLLECTION)
        .updateMany(
          { _id: { $in: [nth(b2, 1), nth(b2, 2)] } },
          { $set: { unitCost: 120 } },
        );

      // 兌獎:店內持有 500、已送兌 300、已撤銷 1,000(另列)
      const { shiftId } = await shiftOf({
        orgId: taichung,
        openedAt: at("08:00"),
        closedAt: at("20:00"),
        openedBy: hq.userId,
        checkout: {
          expected: 5000,
          counted: 4900,
          difference: -100,
          diffReason: "找錯錢",
          stocktakeMode: "skip",
          skipReasonKey: "short-staffed",
          skipReason: "人力不足",
        },
      });
      await redemption({
        orgId: taichung,
        shiftId,
        prizeAmount: 500,
        redeemedAt: at("12:30"),
        ticketNo: "101",
      });
      await redemption({
        orgId: taichung,
        shiftId,
        prizeAmount: 300,
        redeemedAt: at("12:40"),
        status: "sent",
        ticketNo: "102",
        extra: { sentAt: at("13:30") },
      });
      await redemption({
        orgId: taichung,
        shiftId,
        prizeAmount: 1000,
        redeemedAt: at("12:50"),
        status: "revoked",
        ticketNo: "103",
        extra: { revokedAt: at("12:55") },
      });

      // 現金:第二班(沒被日結涵蓋;盤點 2 本未盤)、日結(涵蓋第一班,小金庫差異 +50)
      const stocktakeId = await insert(LOTTERY_STOCKTAKES_COLLECTION, {
        orgId: taichung,
        type: "shift",
        status: "pending",
        scopeCashPointId: null,
        startedAt: at("21:50"),
        submittedAt: at("21:55"),
        submissionId: new Types.ObjectId(),
        summary: { books: 3, uncountedCount: 2 },
        moduleKey: "store",
      });
      await shiftOf({
        orgId: taichung,
        openedAt: at("20:00"),
        closedAt: at("22:00"),
        openedBy: hq.userId,
        checkout: { stocktakeId },
      });
      await dailyClose(taichung, null, at("21:30"), {
        difference: 50,
        coveredShiftIds: [shiftId],
      });
      const cash = (
        type: string,
        from: string,
        to: string,
        amount: number,
        extra: Record<string, unknown> = {},
      ) =>
        movement({
          orgId: taichung,
          type,
          from,
          to,
          amount,
          occurredAt: at("18:00"),
          extra,
        });
      await cash("deposit", "drawer", "vault", 2000);
      await cash("deposit", "vault", "drawer", 500); // 沖正
      await cash("bank_deposit", "vault", "bank", 1000);
      await cash("refund", "drawer", "external", 200);
      await cash("transfer_out", "vault", "external", 300);
      await cash("transfer_in", "external", "vault", 120);
      // 事後更正:第一班交班後完成的撤銷售出申請,退款 150
      await cash("refund", "drawer", "external", 150, {
        postCloseOf: shiftId,
      });

      // 銀行:共用帳戶,本店存入 1,000、進貨支出 3,000;中山店另有一筆收 500(只算進期末餘額)
      const accountId = await insert(LOTTERY_BANK_ACCOUNTS_COLLECTION, {
        orgId: tenant,
        bankCode: "004",
        accountNo: "0001234512345",
        accountName: "台灣銀行",
        label: "台灣銀行 末 12345",
        openingBalance: 10_000,
        openingDate: taipei("2026-09-01"),
        status: "active",
        shareOrgs: [{ orgId: tenant, includeDescendants: true }],
        moduleKey: "accounts",
      });
      const bank = (
        branchOrgId: Types.ObjectId,
        type: string,
        direction: string,
        amount: number,
      ) =>
        insert(LOTTERY_BANK_TRANSACTIONS_COLLECTION, {
          orgId: tenant,
          accountId,
          occurredAt: at("14:00"),
          type,
          direction,
          amount,
          branchOrgId,
          refType: null,
          refId: null,
          refRevision: null,
          settlementSide: null,
          reversalOf: null,
          summary: null,
          handler: null,
          note: null,
          moduleKey: "accounts",
        });
      await bank(taichung, "deposit", "in", 1000);
      await bank(taichung, "purchase_expense", "out", 3000);
      await bank(zhongshan, "deposit", "in", 500);

      // 未結清:審核中的進貨單,應付 5,000(總部 10/15 才付)
      const { insertedId: purchaseId } = await connection
        .collection("form_submissions")
        .insertOne({
          orgId: tenant,
          tenantId: tenant,
          moduleKey: PURCHASE_MODULE_KEY,
          formKey: PURCHASE_FORM_KEY,
          version: 1,
          values: {
            [PURCHASE_FIELD_KEYS.branch]: {
              id: String(taichung),
              label: "台中店",
            },
            [PURCHASE_FIELD_KEYS.deductedAmount]: 5000,
          },
          summary: null,
          status: "reviewing",
          revision: 1,
          revisions: [
            revisionOf(
              1,
              {
                [PURCHASE_FIELD_KEYS.branch]: {
                  id: String(taichung),
                  label: "台中店",
                },
                [PURCHASE_FIELD_KEYS.deductedAmount]: 5000,
              },
              at("09:30"),
            ),
          ],
          editVersion: 1,
          touched: [],
          clientRequestId: String(new Types.ObjectId()),
          serialNo: "P-0001",
          submittedAt: at("09:30"),
          currentInstanceId: null,
          blocked: false,
          ...base(),
        });
      await insert(LOTTERY_BANK_TRANSACTIONS_COLLECTION, {
        orgId: tenant,
        accountId,
        occurredAt: taipei("2026-10-15", "10:00"),
        type: "purchase_expense",
        direction: "out",
        amount: 5000,
        branchOrgId: taichung,
        refType: PURCHASE_MODULE_KEY,
        refId: purchaseId,
        refRevision: 1,
        settlementSide: PURCHASE_SETTLEMENT_SIDE,
        reversalOf: null,
        summary: null,
        handler: null,
        note: null,
        moduleKey: "accounts",
      });

      const input = { ...dayOf(day), orgIds: [String(taichung)] };
      const full = await operations(hq, input);
      const limited = await operations(noCost, input);
      report = firstOf(full.stores);
      withoutCost = firstOf(limited.stores);
    });

    it("區塊 1 銷售:刷條碼、手動(依原因)、盤點補登、撤銷、淨銷售;依遊戲展開", () => {
      expect(report.sales).toMatchObject({
        scan: { count: 4, amount: 700 },
        manual: [{ reasonKey: "scan-failed", count: 1, amount: 200 }],
        stocktake: { count: 1, amount: 200 },
        undo: { count: 1, amount: 200 },
        net: { count: 5, amount: 900 },
        games: [
          { gameCode: "5164", sold: 5, undone: 1, netAmount: 800, cost: 600 },
          { gameCode: "5201", sold: 1, undone: 0, netAmount: 100, cost: 90 },
        ],
      });
    });

    it("區塊 2 毛利:已售張數的單張成本合計(售出 − 撤銷);沒有 show-cost → null", () => {
      expect(report.sales.cost).toBe(690);
      expect(withoutCost.sales.cost).toBeNull();
      expect(
        (withoutCost.sales.games as { cost: number | null }[]).every(
          (game) => game.cost === null,
        ),
      ).toBe(true);
    });

    it("區塊 3 兌獎:有效的扣掉已撤銷;店內持有 / 已送兌;已撤銷另列", () => {
      expect(report.redemption).toEqual({
        valid: { count: 2, amount: 800 },
        inStore: { count: 1, amount: 500 },
        sent: { count: 1, amount: 300 },
        revoked: { count: 1, amount: 1000 },
      });
    });

    it("區塊 4 庫存異動:期初 + 進貨 + 調入 − 調出 − 淨銷售 − 報廢 − 新增待查 + 待查轉回 = 期末,核對 0;待標註不算庫存", () => {
      expect(report.inventory).toMatchObject({
        // 期初:本 2 的 10 張(10/1 進貨)
        openingTickets: 10,
        openingCost: 900,
        // 本 1 點收 21 張,待標註 1 張不算 → 標準 20 張、3,000
        purchaseBooks: 1,
        purchaseVoidBooks: 0,
        purchaseTickets: 20,
        purchaseCost: 3000,
        transferInTickets: 3,
        transferInAmount: 300,
        // 調出看出貨時間(13:00):原成本 90 × 2、調貨金額 120 × 2
        transferOutTickets: 2,
        transferOutCost: 180,
        transferOutAmount: 240,
        transferGain: 60,
        salesTickets: 5,
        salesCost: 690,
        scrapTickets: 1,
        scrapCost: 150,
        // 新增待查:#18、#17、#16;#17 待查轉回
        newInvestigatingTickets: 3,
        newInvestigatingCost: 450,
        investigateRecoveredTickets: 1,
        investigateRecoveredCost: 150,
        lostRecoveredTickets: 0,
        lostRecoveredCost: 0,
        // 本 1:20 − 已售 4 − 報廢 − 遺失 − 待查 = 13(× 150);本 2:10 − 1 − 調出 2 = 7(× 90);調入 3(× 100)
        endingTickets: 23,
        endingCost: 13 * 150 + 7 * 90 + 3 * 100,
        checkTickets: 0,
        checkCost: 0,
        // 不在加減裡、另外列的
        inTransitTickets: 0,
        inTransitAmount: 0,
        investigatingTickets: 1,
        investigatingCost: 150,
        investigatingBooks: 1,
        lostTickets: 1,
        lostCost: 150,
        skippedTickets: 1,
      });
      expect(withoutCost.inventory).toMatchObject({
        openingCost: null,
        purchaseCost: null,
        transferInAmount: null,
        transferOutCost: null,
        transferOutAmount: null,
        transferGain: null,
        salesCost: null,
        scrapCost: null,
        newInvestigatingCost: null,
        endingCost: null,
        checkCost: null,
        inTransitAmount: null,
        investigatingCost: null,
        lostCost: null,
        // 張數照樣有
        endingTickets: 23,
        transferOutTickets: 2,
        checkTickets: 0,
      });
    });

    it("區塊 5 現金:5a 各班結帳差額、事後更正(依原因類別)、日結小金庫差額;5b 現金移動分抽屜 / 小金庫(沖正反向)", () => {
      expect(report.cash).toEqual({
        shiftCount: 2,
        pendingShiftCount: 0,
        shiftDifference: -100,
        postClose: [{ category: "refund", count: 1, amount: -150 }],
        dailyCloseCount: 1,
        vaultDifference: 50,
        movements: [
          // 投庫 2,000、沖正 500(小金庫 → 抽屜)
          { type: "deposit", count: 2, drawer: -1500, vault: 1500 },
          { type: "withdraw", count: 0, drawer: 0, vault: 0 },
          { type: "bank_deposit", count: 1, drawer: 0, vault: -1000 },
          // 事後更正那筆 150 在 5a,不重複列
          { type: "refund", count: 1, drawer: -200, vault: 0 },
          { type: "transfer_out", count: 1, drawer: 0, vault: -300 },
          { type: "transfer_in", count: 1, drawer: 0, vault: 120 },
          { type: "correction", count: 0, drawer: 0, vault: 0 },
        ],
      });
    });

    it("區塊 6 銀行:只算歸屬本店的交易、同類型合一列;期末餘額是整個帳戶(共用)", () => {
      expect(report.bankAccounts).toEqual([
        {
          label: "台灣銀行 末 12345",
          shared: true,
          types: [
            {
              type: "deposit",
              inAmount: 1000,
              outAmount: 0,
              reversalCount: 0,
            },
            {
              type: "purchase_expense",
              inAmount: 0,
              outAmount: 3000,
              reversalCount: 0,
            },
          ],
          endingBalance: 10_000 + 1000 - 3000 + 500,
        },
      ]);
    });

    it("區塊 7 未結清:期末時的待付進貨款與單號(期末之後才付的不算進期末);付了之後那天的期末是 0", async () => {
      expect(report.outstanding).toEqual({
        items: [
          {
            kind: "purchaseToPay",
            count: 1,
            amount: 5000,
            serialNos: ["P-0001"],
          },
          ...[
            "purchaseToRefund",
            "transferToReceive",
            "transferToPay",
            "transferPayerRefund",
            "transferPayeeRefund",
          ].map((kind) => ({ kind, count: 0, amount: 0, serialNos: [] })),
        ],
      });
      const before = await operations(hq, {
        ...dayOf("2026-10-13"),
        orgIds: [String(taichung)],
      });
      // 10/13 期末:進貨單還沒送出
      expect(outstandingAmount(firstOf(before.stores), "purchaseToPay")).toBe(
        0,
      );
      const after = await operations(hq, {
        ...dayOf("2026-10-15"),
        orgIds: [String(taichung)],
      });
      expect(outstandingAmount(firstOf(after.stores), "purchaseToPay")).toBe(0);
    });

    it("期末庫存從現況往回推:期末之後的售出 / 調出 / 進貨都還原;成本用那一刻的成本快照(之後調走改了單張成本也不變)", async () => {
      // 10/13 期末:只有本 2 的 10 張(10/14 才進貨的本 1、調入的 3 張都還不存在 / 不在這家店);
      // 調到中山店的兩張現在單張 120,期末當時是 90
      const before = await operations(hq, {
        ...dayOf("2026-10-13"),
        orgIds: [String(taichung)],
      });
      expect(firstOf(before.stores).inventory).toMatchObject({
        endingTickets: 10,
        endingCost: 900,
        investigatingBooks: 0,
        checkTickets: 0,
        checkCost: 0,
      });
      // 10/15 期初 = 10/14 期末
      const next = await operations(hq, {
        ...dayOf("2026-10-15"),
        orgIds: [String(taichung)],
      });
      expect(firstOf(next.stores).inventory).toMatchObject({
        openingTickets: 23,
        openingCost: 13 * 150 + 7 * 90 + 3 * 100,
        investigatingTickets: 1,
      });
    });

    it("區塊 8 註記:跳過盤點與原因、N 本未盤、沒有被日結涵蓋計算的班、尚未關帳", () => {
      expect(report.notes).toEqual({
        skippedStocktakes: [{ reason: "人力不足", count: 1 }],
        uncountedStocktakes: 1,
        uncountedBooks: 2,
        uncoveredShifts: 1,
        uncoveredShiftLabels: [""],
        priorPeriodCount: 0,
        priorPeriodAmount: 0,
        openMonths: ["2026-10"],
      });
    });
  });

  it("關帳後:已關帳月份的班在關帳後才記的事後更正不算進那一班,歸到記錄當月的前期更正", async () => {
    // 9 月(已關帳,10/3 關)新竹店的一班;10/5 才完成現金更正(+300,事後更正)
    const { shiftId } = await shiftOf({
      orgId: hsinchu,
      openedAt: taipei("2026-09-30", "17:00"),
      closedAt: taipei("2026-09-30", "22:00"),
      openedBy: hq.userId,
      checkout: { difference: 300 },
    });
    await insert(LOTTERY_PERIOD_CLOSES_COLLECTION, {
      orgId: tenant,
      month: "2026-09",
      periodStart: taipei("2026-09-01"),
      periodEnd: taipei("2026-10-01"),
      closedAt: taipei("2026-10-03", "10:00"),
      closedBy: hq.userId,
      note: null,
      snapshot: { bankAccounts: [], stores: [] },
      moduleKey: "accounts",
    });
    await movement({
      orgId: hsinchu,
      type: "correction_increase",
      from: "external",
      to: "drawer",
      amount: 300,
      occurredAt: taipei("2026-10-05", "11:00"),
      extra: { postCloseOf: shiftId, shiftId },
    });
    const september = await operations(hq, {
      periodKind: "day",
      from: taipei("2026-09-30").toISOString(),
      to: taipei("2026-10-01").toISOString(),
      orgIds: [String(hsinchu)],
    });
    expect(september.stores[0]?.cash).toMatchObject({
      shiftDifference: 300,
      postClose: [],
    });
    expect(september.stores[0]?.notes).toMatchObject({ openMonths: [] });
    const october = await operations(hq, {
      ...dayOf("2026-10-05"),
      orgIds: [String(hsinchu)],
    });
    expect(october.stores[0]?.notes).toMatchObject({
      priorPeriodCount: 1,
      priorPeriodAmount: 300,
      openMonths: ["2026-10"],
    });
    // 記錄當期照算進事後更正,前期更正只是另外標出
    expect(october.stores[0]?.cash).toMatchObject({
      postClose: [{ category: "cashCorrection", count: 1, amount: 300 }],
    });
    // 班次結帳歷史:9/30 那一班的差額照結帳快照,10/5 的更正另列並標前期更正
    const history = await ok<{
      lotteryShiftCheckoutsReport: { rows: Record<string, unknown>[] };
    }>(hq, SHIFT_CHECKOUTS, {
      input: {
        periodKind: "day",
        from: taipei("2026-09-30").toISOString(),
        to: taipei("2026-10-01").toISOString(),
        orgIds: [String(hsinchu)],
      },
    });
    expect(history.lotteryShiftCheckoutsReport.rows).toEqual([
      expect.objectContaining({
        difference: 300,
        postClose: 300,
        postCloseEntries: [
          {
            category: "cashCorrection",
            amount: 300,
            recordedAt: taipei("2026-10-05", "11:00").toISOString(),
            priorPeriod: true,
          },
        ],
      }),
    ]);
    const data = await ok<{
      lotteryOperationsReport: { closedThrough: string | null };
    }>(hq, OPERATIONS, {
      input: { ...dayOf("2026-10-05"), orgIds: [String(hsinchu)] },
    });
    expect(data.lotteryOperationsReport.closedThrough).toBe("2026-09");
  });

  it("前期更正:撤銷的原售出、銀行沖正的原交易在已關帳月份(9 月,10/3 關帳)→ 記在 10/6 的前期更正", async () => {
    const ticketId = new Types.ObjectId();
    const bookId = new Types.ObjectId();
    const gameId = new Types.ObjectId();
    const ticketEvent = (type: string, at: Date, version: number) =>
      insert(LOTTERY_TICKET_EVENTS_COLLECTION, {
        orgId: hsinchu,
        eventId: `${String(ticketId)}:${String(version)}`,
        ticketId,
        bookId,
        gameId,
        at,
        by: null,
        type,
        from: null,
        to: {
          status: type === "sale" ? "sold" : "unsold",
          locationKind: "counter",
          cashPointId: null,
          orgId: hsinchu,
        },
        quantity: 1,
        amount: 200,
        cost: null,
        cashEffect: "none",
        cashPointId: null,
        shiftId: null,
        refType: null,
        refId: null,
        reasonKey: null,
        reasonNote: null,
        postCloseOf: null,
        moduleKey: "inventory",
      });
    await ticketEvent("sale", taipei("2026-09-29", "10:00"), 2);
    await ticketEvent("sale_undo", taipei("2026-10-06", "10:00"), 3);
    const accountId = await insert(LOTTERY_BANK_ACCOUNTS_COLLECTION, {
      orgId: tenant,
      bankCode: "812",
      accountNo: "0009999900001",
      accountName: "台新銀行",
      label: "台新銀行 末 00001",
      openingBalance: 0,
      openingDate: taipei("2026-09-01"),
      status: "active",
      shareOrgs: [{ orgId: hsinchu, includeDescendants: false }],
      moduleKey: "accounts",
    });
    const bankRow = (extra: Record<string, unknown>) =>
      insert(LOTTERY_BANK_TRANSACTIONS_COLLECTION, {
        orgId: tenant,
        accountId,
        type: "deposit",
        amount: 1000,
        branchOrgId: hsinchu,
        refType: null,
        refId: null,
        refRevision: null,
        settlementSide: null,
        reversalOf: null,
        summary: null,
        handler: null,
        note: null,
        moduleKey: "accounts",
        ...extra,
      });
    const original = await bankRow({
      occurredAt: taipei("2026-09-28", "14:00"),
      direction: "in",
    });
    await bankRow({
      occurredAt: taipei("2026-10-06", "14:00"),
      direction: "out",
      reversalOf: original,
    });
    const report = await operations(hq, {
      ...dayOf("2026-10-06"),
      orgIds: [String(hsinchu)],
    });
    expect(firstOf(report.stores).notes).toMatchObject({
      priorPeriodCount: 2,
      // 撤銷 9 月的售出 −200、沖正 9 月的存入 −1,000
      priorPeriodAmount: -1200,
    });
  });

  it("未結清:期末之後才駁回的進貨單,期末照算(駁回時間 = 流程實例結束時間)", async () => {
    const purchase = async (
      amount: number,
      submittedAt: Date,
      finishedAt: Date,
    ) => {
      const instanceId = await insert("workflow_instances", {
        orgId: tenant,
        submissionId: new Types.ObjectId(),
        revision: 1,
        status: "rejected",
        finishedAt,
        moduleKey: PURCHASE_MODULE_KEY,
      });
      await connection.collection("form_submissions").insertOne({
        orgId: tenant,
        tenantId: tenant,
        moduleKey: PURCHASE_MODULE_KEY,
        formKey: PURCHASE_FORM_KEY,
        version: 1,
        values: {
          [PURCHASE_FIELD_KEYS.branch]: {
            id: String(hsinchu),
            label: "新竹店",
          },
          [PURCHASE_FIELD_KEYS.deductedAmount]: amount,
        },
        summary: null,
        status: "rejected",
        revision: 1,
        revisions: [
          revisionOf(
            1,
            {
              [PURCHASE_FIELD_KEYS.branch]: {
                id: String(hsinchu),
                label: "新竹店",
              },
              [PURCHASE_FIELD_KEYS.deductedAmount]: amount,
            },
            submittedAt,
          ),
        ],
        editVersion: 1,
        touched: [],
        clientRequestId: String(new Types.ObjectId()),
        serialNo: null,
        submittedAt,
        currentInstanceId: instanceId,
        blocked: false,
        ...base(),
      });
    };
    // 10/25 送出、10/26 才駁回 → 10/25 期末待付 700;當天就駁回的 50 不算
    await purchase(
      700,
      taipei("2026-10-25", "10:00"),
      taipei("2026-10-26", "10:00"),
    );
    await purchase(
      50,
      taipei("2026-10-25", "10:00"),
      taipei("2026-10-25", "12:00"),
    );
    const day25 = await operations(hq, {
      ...dayOf("2026-10-25"),
      orgIds: [String(hsinchu)],
    });
    expect(outstandingAmount(firstOf(day25.stores), "purchaseToPay")).toBe(700);
    const day26 = await operations(hq, {
      ...dayOf("2026-10-26"),
      orgIds: [String(hsinchu)],
    });
    expect(outstandingAmount(firstOf(day26.stores), "purchaseToPay")).toBe(0);
  });

  it("未結清:應付照期末當時的修訂(10/5 送出 10,000、10/20 改成 9,500)", async () => {
    const chiayi = await createOrg(connection, {
      name: "嘉義店",
      parentId: tenant,
    });
    const valuesOf = (amount: number) => ({
      [PURCHASE_FIELD_KEYS.branch]: { id: String(chiayi), label: "嘉義店" },
      [PURCHASE_FIELD_KEYS.deductedAmount]: amount,
    });
    await connection.collection("form_submissions").insertOne({
      orgId: tenant,
      tenantId: tenant,
      moduleKey: PURCHASE_MODULE_KEY,
      formKey: PURCHASE_FORM_KEY,
      version: 1,
      values: valuesOf(9500),
      summary: null,
      status: "reviewing",
      revision: 2,
      revisions: [
        revisionOf(1, valuesOf(10_000), taipei("2026-10-05", "10:00")),
        revisionOf(2, valuesOf(9500), taipei("2026-10-20", "10:00")),
      ],
      editVersion: 2,
      touched: [],
      clientRequestId: String(new Types.ObjectId()),
      serialNo: null,
      submittedAt: taipei("2026-10-05", "10:00"),
      currentInstanceId: null,
      blocked: false,
      ...base(),
    });
    const toPayOn = async (date: string) => {
      const result = await operations(hq, {
        ...dayOf(date),
        orgIds: [String(chiayi)],
      });
      return outstandingAmount(firstOf(result.stores), "purchaseToPay");
    };
    expect(await toPayOn("2026-10-10")).toBe(10_000);
    expect(await toPayOn("2026-10-21")).toBe(9500);
  });

  it("同一個租戶、看不到的分店 → NOT_FOUND", async () => {
    const storeOnly = await person(api, connection, zhongshan, tenant, {
      moduleKeys: ["reports"],
      permissionKeys: ["reports.operations"],
    });
    const result = await gql(storeOnly, OPERATIONS, {
      input: { ...dayOf("2026-10-06"), orgIds: [String(hsinchu)] },
    });
    expect(result.errors?.[0]?.extensions).toMatchObject({ code: "NOT_FOUND" });
    const own = await gql(storeOnly, OPERATIONS, {
      input: { ...dayOf("2026-10-06"), orgIds: [String(zhongshan)] },
    });
    expect(own.errors).toBeUndefined();
  });

  it("調貨:調出看出貨時間(跨日 → 出貨那天調出、期末在途);點收那天調入;作廢那天兩邊反向算回", async () => {
    const kaohsiung = await createOrg(connection, {
      name: "高雄店",
      parentId: tenant,
    });
    const bookId = new Types.ObjectId();
    const gameId = new Types.ObjectId();
    const { insertedId: submissionId } = await connection
      .collection("form_submissions")
      .insertOne({
        orgId: kaohsiung,
        tenantId: tenant,
        moduleKey: "purchasing.transfer",
        formKey: "transfer",
        version: 1,
        values: transferValues(kaohsiung, zhongshan, [
          {
            rowId: "r1",
            book: { id: String(bookId) },
            mode: { id: "partial" },
            ticket_nos: "001-002",
            tickets: 2,
            amount: 240,
            rate: 100,
          },
        ]),
        summary: null,
        status: "voided",
        revision: 1,
        revisions: [],
        editVersion: 1,
        touched: [],
        clientRequestId: String(new Types.ObjectId()),
        serialNo: "T-0001",
        submittedAt: taipei("2026-10-19", "10:00"),
        voidedAt: taipei("2026-10-21", "10:00"),
        currentInstanceId: null,
        blocked: false,
        ...base(),
      });
    const ticketIds: Types.ObjectId[] = [];
    for (const ticketNo of ["001", "002"]) {
      ticketIds.push(
        await insert(LOTTERY_TICKETS_COLLECTION, {
          orgId: kaohsiung,
          bookId,
          gameId,
          ticketNo,
          ticketKey: `${String(bookId)}-${ticketNo}`,
          status: "unsold",
          location: { kind: "stock", cashPointId: null },
          unitCost: 90,
          moduleKey: "inventory",
        }),
      );
    }
    const state = (orgId: Types.ObjectId, locationKind: string) => ({
      status: "unsold",
      locationKind,
      cashPointId: null,
      orgId,
    });
    let version = 0;
    const transferEvent = (
      ticketId: Types.ObjectId,
      type: string,
      at: Date,
      from: ReturnType<typeof state> | null,
      to: ReturnType<typeof state>,
      cost: number,
      amount = 0,
    ) => {
      version += 1;
      return insert(LOTTERY_TICKET_EVENTS_COLLECTION, {
        orgId: to.orgId,
        eventId: `${String(ticketId)}:${String(version)}`,
        ticketId,
        bookId,
        gameId,
        at,
        by: null,
        type,
        from,
        to,
        quantity: 1,
        amount,
        cost,
        cashEffect: "none",
        cashPointId: null,
        shiftId: null,
        refType: "transfer",
        refId: submissionId,
        reasonKey: null,
        reasonNote: null,
        postCloseOf: null,
        moduleKey: "inventory",
      });
    };
    for (const ticketId of ticketIds) {
      // 10/1 進貨;10/19 出貨(在途)、10/20 中山店點收(調入後單張 120)、10/21 作廢回高雄店
      await transferEvent(
        ticketId,
        "purchase",
        taipei("2026-10-01", "09:00"),
        null,
        state(kaohsiung, "stock"),
        90,
      );
      await transferEvent(
        ticketId,
        "transfer_out",
        taipei("2026-10-19", "15:00"),
        state(kaohsiung, "stock"),
        state(kaohsiung, "in_transit"),
        90,
        // 出貨當時的調貨金額快照
        120,
      );
      await transferEvent(
        ticketId,
        "transfer_in",
        taipei("2026-10-20", "10:00"),
        state(kaohsiung, "in_transit"),
        state(zhongshan, "stock"),
        90,
      );
      await transferEvent(
        ticketId,
        "transfer_out",
        taipei("2026-10-21", "10:00"),
        state(zhongshan, "stock"),
        state(zhongshan, "in_transit"),
        120,
      );
      await transferEvent(
        ticketId,
        "transfer_in",
        taipei("2026-10-21", "10:00"),
        state(zhongshan, "in_transit"),
        state(kaohsiung, "stock"),
        120,
      );
    }
    await insert(LOTTERY_TRANSFER_RECEIPTS_COLLECTION, {
      orgId: zhongshan,
      fromOrgId: kaohsiung,
      submissionId,
      rowId: "r1",
      bookId,
      purchaseAmount: 240,
      tickets: ticketIds.map((ticketId) => ({ ticketId, unitCost: 90 })),
      receivedBy: hq.userId,
      receivedAt: taipei("2026-10-20", "10:00"),
      moduleKey: "purchasing.transfer",
    });
    // 10/19 出貨:高雄店調出 2 張(原成本 180、調貨金額 240),期末在途 2 張 · 240,核對 0
    expect(await inventoryOn("2026-10-19", kaohsiung)).toMatchObject({
      openingTickets: 2,
      transferOutTickets: 2,
      transferOutCost: 180,
      transferOutAmount: 240,
      transferGain: 60,
      endingTickets: 0,
      inTransitTickets: 2,
      inTransitAmount: 240,
      checkTickets: 0,
      checkCost: 0,
    });
    // 10/20 點收:高雄店沒有調出(在途結束),中山店調入
    expect(await inventoryOn("2026-10-20", kaohsiung)).toMatchObject({
      transferOutTickets: 0,
      inTransitTickets: 0,
      checkTickets: 0,
    });
    expect(await inventoryOn("2026-10-20", zhongshan)).toMatchObject({
      transferInTickets: 2,
      transferInAmount: 240,
      checkTickets: 0,
      checkCost: 0,
    });
    // 10/21 作廢:高雄店調出反向(原成本用點收記的調入前成本 90)、中山店調入反向
    expect(await inventoryOn("2026-10-21", kaohsiung)).toMatchObject({
      transferOutTickets: -2,
      transferOutCost: -180,
      transferOutAmount: -240,
      transferGain: -60,
      endingTickets: 2,
      endingCost: 180,
      checkTickets: 0,
      checkCost: 0,
    });
    expect(await inventoryOn("2026-10-21", zhongshan)).toMatchObject({
      transferInTickets: -2,
      transferInAmount: -240,
      checkTickets: 0,
      checkCost: 0,
    });
    // 沒有 show-cost:調入 / 調出 / 在途的調貨金額也隱藏(只剩張數)
    const limited = await operations(noCost, {
      ...dayOf("2026-10-19"),
      orgIds: [String(kaohsiung)],
    });
    expect(firstOf(limited.stores).inventory).toMatchObject({
      transferOutTickets: 2,
      transferOutAmount: null,
      inTransitTickets: 2,
      inTransitAmount: null,
    });
  });

  it("對齊日結:同一天有兩張日結 → 起點取最早那張的起點、終點取最後一張的終點", async () => {
    const tainan = await createOrg(connection, {
      name: "台南店",
      parentId: tenant,
    });
    await dailyClose(
      tainan,
      taipei("2026-10-17", "21:00"),
      taipei("2026-10-18", "12:00"),
    );
    await dailyClose(
      tainan,
      taipei("2026-10-18", "12:00"),
      taipei("2026-10-18", "22:00"),
    );
    const periods = await ok<{
      lotteryOperationsReportPeriods: {
        stores: { from: string; to: string; alignment: string }[];
      };
    }>(hq, PERIODS, {
      input: {
        ...dayOf("2026-10-18"),
        orgIds: [String(tainan)],
        alignDailyClose: true,
      },
    });
    expect(periods.lotteryOperationsReportPeriods.stores).toEqual([
      expect.objectContaining({
        from: taipei("2026-10-17", "21:00").toISOString(),
        to: taipei("2026-10-18", "22:00").toISOString(),
        alignment: "dailyClose",
      }),
    ]);
  });
  /**
   * 待標註的跳號(使用者 10/27 定案甲):一款 200 元、標準 100 張、迄號 101(待標註 1 張)、本成本 18,400
   * (單張 184)的本,實際存在 100 張。進貨點收用真的 `createBook`,拆本 / 售出 / 撤銷 / 作廢 / 調貨 / 待查 /
   * 遺失用真的帳本(`TicketLedgerService`,與各功能寫的事件相同);報表每一步都以 100 張 / 18,400 計,核對 0。
   */
  describe("真的進貨點收與帳本:待標註的跳號不算庫存(S1–S5)、重跑舊報表數字不變", () => {
    let chianan: Types.ObjectId;
    let yunlin: Types.ObjectId;
    let skipGame: Types.ObjectId;
    let bookSequence = 0;

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

    interface TicketDoc {
      _id: Types.ObjectId;
      ticketNo: string;
      version: number;
      status: string;
    }
    const ticketsOf = (bookId: Types.ObjectId) =>
      connection
        .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
        .find({ bookId })
        .sort({ ticketNo: 1 })
        .toArray();

    /** 進貨點收一本(真的 `createBook`):迄號 101、成本 18,400。 */
    async function purchase(
      orgId: Types.ObjectId,
      at: Date,
    ): Promise<Types.ObjectId> {
      bookSequence += 1;
      const { book } = await transactions().withTransaction((session) =>
        api.app
          .get(LotteryBooksService)
          .createBook(session, storeOperator(orgId), {
            orgId,
            gameId: skipGame,
            bookNo: String(700_000 + bookSequence),
            lastTicketNo: 101,
            rate: 92,
            cost: 18_400,
            at,
          }),
      );
      return book._id;
    }

    /** 一批張寫同一種事件(真的帳本)。 */
    async function apply(
      context: Parameters<TicketLedgerService["applyTicketEvents"]>[1],
      tickets: readonly TicketDoc[],
      input: Omit<
        Parameters<TicketLedgerService["applyTicketEvents"]>[2][number],
        "ticketId" | "expectedVersion"
      >,
    ): Promise<void> {
      await transactions().withTransaction((session) =>
        ledger().applyTicketEvents(
          session,
          context,
          tickets.map((ticket) => ({
            ticketId: ticket._id,
            expectedVersion: ticket.version,
            ...input,
          })),
        ),
      );
    }

    /** 這本符合條件的張(最多 `limit` 張)。 */
    const ticketsWhere = async (
      bookId: Types.ObjectId,
      predicate: (ticket: TicketDoc) => boolean,
      limit = Number.POSITIVE_INFINITY,
    ) => {
      const tickets = await ticketsOf(bookId);
      return tickets.filter((ticket) => predicate(ticket)).slice(0, limit);
    };

    beforeAll(async () => {
      await seedInventoryModule(connection);
      chianan = await createOrg(connection, {
        name: "嘉南店",
        parentId: tenant,
      });
      yunlin = await createOrg(connection, {
        name: "雲林店",
        parentId: tenant,
      });
      skipGame = await insertGame(connection, tenant, {
        gameCode: "5301",
        name: "跳號測試",
        unitPrice: 200,
        ticketsPerBook: 100,
      });
    });

    it("S1 進貨點收(未拆):進貨 100 張 · 18,400、期末 100 張 · 18,400;S4 隔天拆本標 #050 跳號、賣 10 張 → 期末 90 · 16,560;重跑前一天不變", async () => {
      const bookId = await purchase(chianan, taipei("2026-11-01", "09:00"));
      const day1 = await inventoryOn("2026-11-01", chianan);
      expect(day1).toMatchObject({
        purchaseBooks: 1,
        purchaseTickets: 100,
        purchaseCost: 18_400,
        endingTickets: 100,
        endingCost: 18_400,
        checkTickets: 0,
        checkCost: 0,
      });
      // 拆本:#050 標跳號、其餘移到檯面;賣 10 張
      const tickets = await ticketsOf(bookId);
      const skip = tickets.filter((ticket) => ticket.ticketNo === "050");
      await apply({ operator: storeOperator(chianan) }, skip, {
        type: "skip",
        at: taipei("2026-11-02", "10:00"),
        patch: { status: "skipped" },
      });
      const cashPointId = new Types.ObjectId();
      const others = await ticketsWhere(
        bookId,
        (ticket) => ticket.status === "unsold",
      );
      await apply({ operator: storeOperator(chianan) }, others, {
        type: "open",
        at: taipei("2026-11-02", "10:01"),
        patch: { location: { kind: "counter", cashPointId } },
      });
      const sold = await ticketsWhere(
        bookId,
        (ticket) => ticket.status === "unsold",
        10,
      );
      await apply({ operator: storeOperator(chianan) }, sold, {
        type: "sale",
        at: taipei("2026-11-02", "11:00"),
        amount: 200,
        cashEffect: "increase",
        cashPointId,
        patch: {
          status: "sold",
          sold: { at: taipei("2026-11-02", "11:00"), source: "scan" },
        },
      });
      const day2 = await inventoryOn("2026-11-02", chianan);
      expect(day2).toMatchObject({
        openingTickets: 100,
        openingCost: 18_400,
        salesTickets: 10,
        salesCost: 1840,
        // 跳號不在加減裡、不計成本
        skippedTickets: 1,
        endingTickets: 90,
        endingCost: 16_560,
        checkTickets: 0,
        checkCost: 0,
      });
      // 重跑前一天:拆本之後仍是 100 張 · 18,400
      expect(await inventoryOn("2026-11-01", chianan)).toEqual(day1);

      // S5:撤銷 10 張售出、作廢進貨單(每張寫進貨作廢、本 → 已撤銷)→ 期末排除已撤銷的本
      const undo = await ticketsWhere(
        bookId,
        (ticket) => ticket.status === "sold",
      );
      await apply({ operator: storeOperator(chianan) }, undo, {
        type: "sale_undo",
        at: taipei("2026-11-03", "10:00"),
        amount: 200,
        cashEffect: "decrease",
        patch: { status: "unsold", sold: null },
      });
      await apply(
        { operator: null, crossStoreTenantId: tenant },
        await ticketsOf(bookId),
        { type: "purchase_void", at: taipei("2026-11-03", "11:00"), patch: {} },
      );
      await connection
        .collection(LOTTERY_BOOKS_COLLECTION)
        .updateOne({ _id: bookId }, { $set: { status: "revoked" } });
      expect(await inventoryOn("2026-11-03", chianan)).toMatchObject({
        openingTickets: 90,
        purchaseBooks: -1,
        purchaseVoidBooks: 1,
        purchaseTickets: -100,
        purchaseCost: -18_400,
        salesTickets: -10,
        salesCost: -1840,
        endingTickets: 0,
        endingCost: 0,
        checkTickets: 0,
        checkCost: 0,
      });
      // 重跑:作廢前那兩天不變
      expect(await inventoryOn("2026-11-02", chianan)).toEqual(day2);
    });

    it("S5 沒動過的未拆本同一天進貨、作廢:進貨 0 本 · 0 張、期末 0", async () => {
      const bookId = await purchase(chianan, taipei("2026-11-04", "09:00"));
      await apply(
        { operator: null, crossStoreTenantId: tenant },
        await ticketsOf(bookId),
        { type: "purchase_void", at: taipei("2026-11-04", "15:00"), patch: {} },
      );
      await connection
        .collection(LOTTERY_BOOKS_COLLECTION)
        .updateOne({ _id: bookId }, { $set: { status: "revoked" } });
      expect(await inventoryOn("2026-11-04", chianan)).toMatchObject({
        purchaseBooks: 0,
        purchaseVoidBooks: 1,
        purchaseTickets: 0,
        purchaseCost: 0,
        endingTickets: 0,
        endingCost: 0,
        checkTickets: 0,
        checkCost: 0,
      });
    });

    it("S2 未拆整本調貨(單上 100 張、調貨金額 20,000 → 單張 200):出貨那天調出 100 · 原成本 18,400、損益 1,600、期末在途;收貨店調入 100 · 20,000,拆本後不掉成本", async () => {
      const bookId = await purchase(chianan, taipei("2026-11-05", "09:00"));
      const { insertedId: transferId } = await connection
        .collection("form_submissions")
        .insertOne({
          orgId: chianan,
          tenantId: tenant,
          moduleKey: "purchasing.transfer",
          formKey: "transfer",
          version: 1,
          values: transferValues(chianan, yunlin, [
            {
              rowId: "r1",
              book: { id: String(bookId) },
              mode: { id: "whole" },
              ticket_nos: "001-100",
              tickets: 100,
              amount: 20_000,
              rate: 100,
            },
          ]),
          summary: null,
          status: "completed",
          revision: 1,
          revisions: [],
          editVersion: 1,
          touched: [],
          clientRequestId: String(new Types.ObjectId()),
          serialNo: "T-0901",
          submittedAt: taipei("2026-11-06", "09:00"),
          currentInstanceId: null,
          blocked: false,
          ...base(),
        });
      const ref = { refType: "transfer", refId: transferId };
      await apply(
        { operator: null, crossStoreTenantId: tenant },
        await ticketsOf(bookId),
        {
          type: "transfer_out",
          at: taipei("2026-11-06", "10:00"),
          patch: { location: { kind: "in_transit", cashPointId: null } },
          // 出貨當時的調貨金額快照(20,000 ÷ 100)
          amount: 200,
          ...ref,
        },
      );
      const shipped = await inventoryOn("2026-11-06", chianan);
      expect(shipped).toMatchObject({
        openingTickets: 100,
        openingCost: 18_400,
        transferOutTickets: 100,
        transferOutCost: 18_400,
        transferOutAmount: 20_000,
        transferGain: 1600,
        endingTickets: 0,
        inTransitTickets: 100,
        inTransitAmount: 20_000,
        checkTickets: 0,
        checkCost: 0,
      });
      // 收貨店點收:每張單張成本 = 20,000 ÷ 100 = 200(點收紀錄記 101 張的調入前成本)
      const inTransit = await ticketsOf(bookId);
      await apply(
        {
          operator: null,
          crossStoreTenantId: tenant,
          systemActorId: hq.userId,
        },
        inTransit,
        {
          type: "transfer_in",
          at: taipei("2026-11-07", "10:00"),
          patch: {
            orgId: yunlin,
            location: { kind: "stock", cashPointId: null },
            unitCost: 200,
          },
          ...ref,
        },
      );
      await insert(LOTTERY_TRANSFER_RECEIPTS_COLLECTION, {
        orgId: yunlin,
        fromOrgId: chianan,
        submissionId: transferId,
        rowId: "r1",
        bookId,
        purchaseAmount: 20_000,
        tickets: inTransit.map((ticket) => ({
          ticketId: ticket._id,
          unitCost: 184,
        })),
        receivedBy: hq.userId,
        receivedAt: taipei("2026-11-07", "10:00"),
        moduleKey: "purchasing.transfer",
      });
      expect(await inventoryOn("2026-11-07", yunlin)).toMatchObject({
        transferInTickets: 100,
        transferInAmount: 20_000,
        endingTickets: 100,
        endingCost: 20_000,
        checkTickets: 0,
        checkCost: 0,
      });
      // 隔天出貨店那一天的在途已結束;收貨店拆本標 #050 跳號 → 成本不掉
      expect(await inventoryOn("2026-11-07", chianan)).toMatchObject({
        transferOutTickets: 0,
        inTransitTickets: 0,
        checkTickets: 0,
      });
      await apply(
        { operator: storeOperator(yunlin) },
        await ticketsWhere(bookId, (ticket) => ticket.ticketNo === "050"),
        {
          type: "skip",
          at: taipei("2026-11-08", "10:00"),
          patch: { status: "skipped" },
        },
      );
      expect(await inventoryOn("2026-11-08", yunlin)).toMatchObject({
        openingTickets: 100,
        openingCost: 20_000,
        skippedTickets: 1,
        endingTickets: 100,
        endingCost: 20_000,
        checkTickets: 0,
        checkCost: 0,
      });
      // 重跑出貨那天:數字不變
      expect(await inventoryOn("2026-11-06", chianan)).toEqual(shipped);
    });

    it("S3 未拆的本盤點找不到 → 新增待查 100 · 18,400;確認遺失 100 · 18,400(不在加減裡)", async () => {
      const bookId = await purchase(chianan, taipei("2026-11-09", "09:00"));
      await apply(
        { operator: storeOperator(chianan) },
        await ticketsOf(bookId),
        {
          type: "investigate",
          at: taipei("2026-11-10", "10:00"),
          patch: { status: "investigating", responsibleOrgId: chianan },
          refType: "stocktake",
          refId: new Types.ObjectId(),
        },
      );
      expect(await inventoryOn("2026-11-10", chianan)).toMatchObject({
        openingTickets: 100,
        newInvestigatingTickets: 100,
        newInvestigatingCost: 18_400,
        endingTickets: 0,
        investigatingTickets: 100,
        investigatingCost: 18_400,
        investigatingBooks: 1,
        checkTickets: 0,
        checkCost: 0,
      });
      await apply(
        { operator: storeOperator(chianan) },
        await ticketsOf(bookId),
        {
          type: "lose",
          at: taipei("2026-11-11", "10:00"),
          patch: { status: "lost" },
          refType: "stocktake",
          refId: new Types.ObjectId(),
        },
      );
      expect(await inventoryOn("2026-11-11", chianan)).toMatchObject({
        lostTickets: 100,
        lostCost: 18_400,
        investigatingTickets: 0,
        endingTickets: 0,
        checkTickets: 0,
        checkCost: 0,
      });
    });

    it("一份報表的資料庫指令數與本數無關(防退化,TX-06 延伸到交易外):1 本與 6 本(進貨、售出、待查)相同", async () => {
      const kinmen = await createOrg(connection, {
        name: "金門店",
        parentId: tenant,
      });
      const day = "2026-11-28";
      const setUp = async (books: number) => {
        for (let index = 0; index < books; index += 1) {
          const bookId = await purchase(kinmen, taipei(day, "09:00"));
          // 先拆本標跳號(待標註的跳號只算到拆本前;部分處理未拆本見文件「S1」)
          await apply(
            { operator: storeOperator(kinmen) },
            await ticketsWhere(bookId, (ticket) => ticket.ticketNo === "101"),
            {
              type: "skip",
              at: taipei(day, "10:00"),
              patch: { status: "skipped" },
            },
          );
          const sold = await ticketsWhere(
            bookId,
            (ticket) => ticket.status === "unsold",
            2,
          );
          await apply({ operator: storeOperator(kinmen) }, sold, {
            type: "investigate",
            at: taipei(day, "12:00"),
            patch: { status: "investigating", responsibleOrgId: kinmen },
          });
        }
      };
      const countOf = async () => {
        const counted = await countDbCommands(() => storeOn(day, kinmen));
        return counted;
      };
      await setUp(1);
      // 第一次查詢會讀一些之後有快取的東西(登入、欄位選項),先暖身
      await storeOn(day, kinmen);
      const one = await countOf();
      await setUp(5);
      const six = await countOf();
      expect(six.result.inventory).toMatchObject({
        purchaseTickets: 600,
        newInvestigatingTickets: 12,
        checkTickets: 0,
      });
      expect(six.total).toBe(one.total);
      expectDbCommandsAtMost(six, OPERATIONS_REPORT_COMMANDS_LIMIT, "營運報表");
    });

    it("重跑舊報表數字不變(審查 R1–R6):之後退回重送結帳 / 日結、送兌退回又重送、駁回盤點單、在途列被刪 → 重跑相同", async () => {
      const penghu = await createOrg(connection, {
        name: "澎湖店",
        parentId: tenant,
      });
      counters.set(
        String(penghu),
        await insert(LOTTERY_CASH_POINTS_COLLECTION, {
          orgId: penghu,
          positionKey: "in-store-counter",
          name: "澎湖櫃台",
          order: 1,
          enabled: true,
          printerId: null,
          note: null,
          moduleKey: "master-data",
        }),
      );
      const day = "2026-11-25";
      const at = (time: string) => taipei(day, time);
      const later = "2026-11-26";
      const next = (time: string) => taipei(later, time);
      const attempt = (
        submittedAt: Date,
        difference: number,
        coveredShiftIds: Types.ObjectId[] = [],
      ) => ({
        submittedAt,
        returnedAt: null,
        difference,
        stocktakeMode: "new",
        skipReason: null,
        coveredShiftIds,
      });
      // R1:交班結帳期末時待審核(差額 −50)
      const { shiftId, checkoutId } = await shiftOf({
        orgId: penghu,
        openedAt: at("08:00"),
        closedAt: at("20:00"),
        openedBy: hq.userId,
        checkout: {
          status: "pending",
          confirmedAt: null,
          difference: -50,
          firstSubmittedAt: at("20:00"),
          attempts: [attempt(at("20:00"), -50)],
        },
      });
      // R2:日結期末前送出(小金庫差額 70),涵蓋那一班
      await dailyClose(penghu, null, at("21:30"), {
        status: "pending",
        confirmedAt: null,
        difference: 70,
        coveredShiftIds: [shiftId],
        firstSubmittedAt: at("21:30"),
        attempts: [attempt(at("21:30"), 70, [shiftId])],
      });
      // R3:兌獎期末前已送兌
      const purchaseRef = new Types.ObjectId();
      const sentId = await redemption({
        orgId: penghu,
        shiftId,
        prizeAmount: 500,
        redeemedAt: at("12:00"),
        status: "sent",
        ticketNo: "301",
        extra: {
          purchaseSubmissionId: purchaseRef,
          sentAt: at("13:00"),
          sentHistory: [
            {
              sentAt: at("13:00"),
              releasedAt: null,
              purchaseSubmissionId: purchaseRef,
            },
          ],
        },
      });
      // R5:盤點單期末待審核、2 本未盤
      const stocktakeId = await insert(LOTTERY_STOCKTAKES_COLLECTION, {
        orgId: penghu,
        type: "shift",
        status: "pending",
        scopeCashPointId: null,
        startedAt: at("14:50"),
        submittedAt: at("15:00"),
        closedAt: null,
        submissionId: new Types.ObjectId(),
        summary: { books: 3, uncountedCount: 2 },
        moduleKey: "store",
      });
      // R5b:另一張盤點單期末待審核、4 本未盤(之後退回、重送剩 1 本)
      const resubmittedStocktake = await insert(LOTTERY_STOCKTAKES_COLLECTION, {
        orgId: penghu,
        type: "shift",
        status: "pending",
        scopeCashPointId: null,
        startedAt: at("15:50"),
        submittedAt: at("16:00"),
        closedAt: null,
        firstSubmittedAt: at("16:00"),
        attempts: [
          { submittedAt: at("16:00"), closedAt: null, uncountedCount: 4 },
        ],
        submissionId: new Types.ObjectId(),
        summary: { books: 5, uncountedCount: 4 },
        moduleKey: "store",
      });
      // R6:整本調貨期末在途(出貨事件記調貨金額快照 200 × 100)
      const bookId = await purchase(penghu, at("09:00"));
      const lineValues = transferValues(penghu, yunlin, [
        {
          rowId: "r1",
          book: { id: String(bookId) },
          mode: { id: "whole" },
          ticket_nos: "001-101",
          tickets: 100,
          amount: 20_000,
          rate: 100,
        },
      ]);
      const { insertedId: transferId } = await connection
        .collection("form_submissions")
        .insertOne({
          orgId: penghu,
          tenantId: tenant,
          moduleKey: "purchasing.transfer",
          formKey: "transfer",
          version: 1,
          values: lineValues,
          summary: null,
          status: "reviewing",
          revision: 1,
          revisions: [revisionOf(1, lineValues, at("10:00"))],
          editVersion: 1,
          touched: [],
          clientRequestId: String(new Types.ObjectId()),
          serialNo: "T-0925",
          submittedAt: at("10:00"),
          currentInstanceId: null,
          blocked: false,
          ...base(),
        });
      await apply(
        { operator: null, crossStoreTenantId: tenant },
        await ticketsOf(bookId),
        {
          type: "transfer_out",
          at: at("11:00"),
          patch: { location: { kind: "in_transit", cashPointId: null } },
          amount: 200,
          refType: "transfer",
          refId: transferId,
        },
      );

      const before = await storeOn(day, penghu);
      expect(before.cash).toMatchObject({
        shiftCount: 1,
        pendingShiftCount: 1,
        shiftDifference: -50,
        dailyCloseCount: 1,
        vaultDifference: 70,
      });
      expect(before.redemption).toMatchObject({
        sent: { count: 1, amount: 500 },
      });
      expect(before.notes).toMatchObject({
        uncoveredShifts: 0,
        uncountedStocktakes: 2,
        uncountedBooks: 2 + 4,
      });
      expect(before.inventory).toMatchObject({
        transferOutTickets: 100,
        transferOutAmount: 20_000,
        transferGain: 1600,
        inTransitTickets: 100,
        inTransitAmount: 20_000,
        checkTickets: 0,
        checkCost: 0,
      });

      // 11/26:各項目照那支 service 實際寫的欄位
      // R1 結帳單退回(`markReturned`)再重送(重送改寫送出時間與差額、加一次送出)
      const checkouts = connection.collection(LOTTERY_CHECKOUTS_COLLECTION);
      await checkouts.updateOne(
        { _id: checkoutId },
        {
          $set: {
            status: "returned",
            returnedAt: next("09:00"),
            "attempts.0.returnedAt": next("09:00"),
          },
        },
      );
      await checkouts.updateOne(
        { _id: checkoutId },
        {
          $set: {
            status: "pending",
            submittedAt: next("10:00"),
            returnedAt: null,
            difference: 999,
            attempts: [
              { ...attempt(at("20:00"), -50), returnedAt: next("09:00") },
              attempt(next("10:00"), 999),
            ],
          },
        },
      );
      // R2 日結退回再重送(涵蓋的班重算成空的、差額 0)
      await checkouts.updateOne(
        { orgId: penghu, type: "daily" },
        {
          $set: {
            status: "returned",
            returnedAt: next("09:00"),
            "attempts.0.returnedAt": next("09:00"),
          },
        },
      );
      await checkouts.updateOne(
        { orgId: penghu, type: "daily" },
        {
          $set: {
            status: "pending",
            submittedAt: next("10:00"),
            returnedAt: null,
            difference: 0,
            coveredShiftIds: [],
            attempts: [
              {
                ...attempt(at("21:30"), 70, [shiftId]),
                returnedAt: next("09:00"),
              },
              attempt(next("10:00"), 0),
            ],
          },
        },
      );
      // R3 進貨單退回(`release`)、R4 重送(`markSent` 再記一段送兌)
      const redemptions = connection.collection(LOTTERY_REDEMPTIONS_COLLECTION);
      await redemptions.updateOne(
        { _id: sentId },
        {
          $set: {
            status: "in_store",
            purchaseSubmissionId: null,
            sentAt: null,
            "sentHistory.0.releasedAt": next("09:00"),
          },
        },
      );
      await redemptions.updateOne(
        { _id: sentId },
        {
          $set: {
            status: "sent",
            purchaseSubmissionId: purchaseRef,
            sentAt: next("10:00"),
            sentHistory: [
              {
                sentAt: at("13:00"),
                releasedAt: next("09:00"),
                purchaseSubmissionId: purchaseRef,
              },
              {
                sentAt: next("10:00"),
                releasedAt: null,
                purchaseSubmissionId: purchaseRef,
              },
            ],
          },
        },
      );
      // R5 盤點單駁回(`markStatus`)
      await connection
        .collection(LOTTERY_STOCKTAKES_COLLECTION)
        .updateOne(
          { _id: stocktakeId },
          { $set: { status: "rejected", closedAt: next("09:00") } },
        );
      // R5b 盤點單退回(`markStatus`)再重送(`submitStocktakeDraft` 改寫送出時間與彙總、加一次送出)
      await connection.collection(LOTTERY_STOCKTAKES_COLLECTION).updateOne(
        { _id: resubmittedStocktake },
        {
          $set: {
            status: "pending",
            submittedAt: next("10:00"),
            closedAt: null,
            summary: { books: 5, uncountedCount: 1 },
            attempts: [
              {
                submittedAt: at("16:00"),
                closedAt: next("09:00"),
                uncountedCount: 4,
              },
              { submittedAt: next("10:00"), closedAt: null, uncountedCount: 1 },
            ],
          },
        },
      );
      // R6 退回重送、把在途那一列刪掉(單上沒有那一列了;那幾張變待查)
      await connection
        .collection("form_submissions")
        .updateOne(
          { _id: transferId },
          { $set: { values: transferValues(penghu, yunlin, []) } },
        );
      await apply(
        { operator: null, crossStoreTenantId: tenant },
        await ticketsOf(bookId),
        {
          type: "investigate",
          at: next("11:00"),
          patch: { status: "investigating", responsibleOrgId: penghu },
          refType: "transfer",
          refId: transferId,
        },
      );

      expect(await storeOn(day, penghu)).toEqual(before);
      // 變化算在發生那天:調出反向、新增待查,核對 0
      const nextDay = await storeOn(later, penghu);
      expect(nextDay.inventory).toMatchObject({
        transferOutTickets: -100,
        transferOutAmount: -20_000,
        newInvestigatingTickets: 100,
        newInvestigatingCost: 18_400,
        investigatingTickets: 100,
        checkTickets: 0,
        checkCost: 0,
      });
      expect(nextDay.cash).toMatchObject({
        shiftCount: 0,
        dailyCloseCount: 0,
      });
    });

    it("S3d 未拆的本整本待查 → 全部尋回、分到兩家店(嘉南 50 / 雲林 51):待標註只在張數多的雲林扣一次 → 兩店期末合計 100、核對都是 0", async () => {
      const bookId = await purchase(chianan, taipei("2026-11-16", "09:00"));
      await apply(
        { operator: storeOperator(chianan) },
        await ticketsOf(bookId),
        {
          type: "investigate",
          at: taipei("2026-11-16", "10:00"),
          patch: { status: "investigating", responsibleOrgId: chianan },
          refType: "stocktake",
          refId: new Types.ObjectId(),
        },
      );
      const all = await ticketsOf(bookId);
      await apply({ operator: storeOperator(chianan) }, all.slice(0, 50), {
        type: "recover",
        at: taipei("2026-11-17", "10:00"),
        patch: {
          status: "unsold",
          location: { kind: "stock", cashPointId: null },
          responsibleOrgId: null,
        },
        reasonKey: "found",
      });
      await apply(
        { operator: storeOperator(yunlin), crossStoreTenantId: tenant },
        await ticketsWhere(
          bookId,
          (ticket) => ticket.status === "investigating",
        ),
        {
          type: "recover",
          at: taipei("2026-11-17", "11:00"),
          patch: {
            status: "unsold",
            location: { kind: "stock", cashPointId: null },
            responsibleOrgId: null,
            orgId: yunlin,
          },
          reasonKey: "found",
        },
      );
      const a = await inventoryOn("2026-11-17", chianan);
      const b = await inventoryOn("2026-11-17", yunlin);
      // 兩店都還有前面情境的本:看這一天的變化(這本 11/17 期初 0:整本待查中)
      expect({
        chianan: Number(a.endingTickets) - Number(a.openingTickets),
        yunlin: Number(b.endingTickets) - Number(b.openingTickets),
        checkA: a.checkTickets,
        checkB: b.checkTickets,
      }).toEqual({ chianan: 50, yunlin: 50, checkA: 0, checkB: 0 });
      // 隔天的期初也照同一個規則(= 前一天期末)、核對 0
      const nextA = await inventoryOn("2026-11-18", chianan);
      const nextB = await inventoryOn("2026-11-18", yunlin);
      expect([
        nextA.openingTickets,
        nextB.openingTickets,
        nextA.checkTickets,
        nextB.checkTickets,
      ]).toEqual([a.endingTickets, b.endingTickets, 0, 0]);
    });

    it("S3c 未拆的本整本待查 → 尋回 3 張 → 其餘 98 張確認遺失:確認遺失 97(待標註一本只扣一次)、期末待查 0、核對 0", async () => {
      const bookId = await purchase(chianan, taipei("2026-11-14", "09:00"));
      await apply(
        { operator: storeOperator(chianan) },
        await ticketsOf(bookId),
        {
          type: "investigate",
          at: taipei("2026-11-14", "10:00"),
          patch: { status: "investigating", responsibleOrgId: chianan },
          refType: "stocktake",
          refId: new Types.ObjectId(),
        },
      );
      const all = await ticketsOf(bookId);
      await apply({ operator: storeOperator(chianan) }, all.slice(0, 3), {
        type: "recover",
        at: taipei("2026-11-15", "10:00"),
        patch: {
          status: "unsold",
          location: { kind: "stock", cashPointId: null },
          responsibleOrgId: null,
        },
        reasonKey: "found",
      });
      const rest = await ticketsWhere(
        bookId,
        (ticket) => ticket.status === "investigating",
      );
      await apply({ operator: storeOperator(chianan) }, rest, {
        type: "lose",
        at: taipei("2026-11-15", "11:00"),
        patch: { status: "lost" },
        refType: "stocktake",
        refId: new Types.ObjectId(),
      });
      const day = await inventoryOn("2026-11-15", chianan);
      expect(day).toMatchObject({
        lostTickets: 97,
        investigatingTickets: 0,
        checkTickets: 0,
      });
      expect(day.lostCost).toBeCloseTo(97 * 184, 6);
    });

    it("S3b 未拆的本整本待查後只處理一部分(2 張確認遺失、3 張跨店尋回):待標註那張仍算在還待查的那組 → 期末待查 95(還有待標註就扣;使用者 10/27 定案 M1)", async () => {
      const bookId = await purchase(chianan, taipei("2026-11-12", "09:00"));
      await apply(
        { operator: storeOperator(chianan) },
        await ticketsOf(bookId),
        {
          type: "investigate",
          at: taipei("2026-11-12", "10:00"),
          patch: { status: "investigating", responsibleOrgId: chianan },
          refType: "stocktake",
          refId: new Types.ObjectId(),
        },
      );
      const [first, second, ...rest] = await ticketsOf(bookId);
      if (first === undefined || second === undefined) {
        throw new Error("沒有張");
      }
      await apply({ operator: storeOperator(chianan) }, [first, second], {
        type: "lose",
        at: taipei("2026-11-13", "10:00"),
        patch: { status: "lost" },
        refType: "stocktake",
        refId: new Types.ObjectId(),
      });
      await apply(
        { operator: storeOperator(yunlin), crossStoreTenantId: tenant },
        rest.slice(0, 3),
        {
          type: "recover",
          at: taipei("2026-11-13", "11:00"),
          patch: {
            status: "unsold",
            location: { kind: "stock", cashPointId: null },
            responsibleOrgId: null,
            orgId: yunlin,
          },
          reasonKey: "found",
        },
      );
      const day = await inventoryOn("2026-11-13", chianan);
      expect(day).toMatchObject({
        investigatingTickets: 95,
        investigatingBooks: 1,
      });
      expect(day.investigatingCost).toBeCloseTo(95 * 184, 6);
    });

    it("重跑舊報表數字不變:11/20 做一份報表 → 11/21 撤銷兌獎、送兌、退回結帳、補日結、核准、調走期末的張 → 重跑 11/20 完全相同", async () => {
      const pingtung = await createOrg(connection, {
        name: "屏東店",
        parentId: tenant,
      });
      const pingtungCounter = await insert(LOTTERY_CASH_POINTS_COLLECTION, {
        orgId: pingtung,
        positionKey: "in-store-counter",
        name: "屏東櫃台",
        order: 1,
        enabled: true,
        printerId: null,
        note: null,
        moduleKey: "master-data",
      });
      counters.set(String(pingtung), pingtungCounter);
      const day = "2026-11-20";
      const at = (time: string) => taipei(day, time);
      const next = (time: string) => taipei("2026-11-21", time);
      // 庫存:進貨 1 本(迄號 101)、拆本標跳號、賣 2 張
      const bookId = await purchase(pingtung, at("09:00"));
      await apply(
        { operator: storeOperator(pingtung) },
        await ticketsWhere(bookId, (ticket) => ticket.ticketNo === "101"),
        { type: "skip", at: at("09:30"), patch: { status: "skipped" } },
      );
      const sold = await ticketsWhere(
        bookId,
        (ticket) => ticket.status === "unsold",
        2,
      );
      await apply({ operator: storeOperator(pingtung) }, sold, {
        type: "sale",
        at: at("11:00"),
        amount: 200,
        cashEffect: "increase",
        patch: { status: "sold", sold: { at: at("11:00"), source: "scan" } },
      });
      // 兌獎:兩筆店內持有(之後一筆撤銷、一筆送兌)
      const { shiftId: shiftA } = await shiftOf({
        orgId: pingtung,
        openedAt: at("08:00"),
        closedAt: at("20:00"),
        openedBy: hq.userId,
        checkout: { status: "pending", confirmedAt: null, difference: -50 },
      });
      const revokeLater = await redemption({
        orgId: pingtung,
        shiftId: shiftA,
        prizeAmount: 500,
        redeemedAt: at("12:00"),
        ticketNo: "201",
      });
      const sendLater = await redemption({
        orgId: pingtung,
        shiftId: shiftA,
        prizeAmount: 300,
        redeemedAt: at("12:10"),
        ticketNo: "202",
      });
      // 結帳:B 待審核(之後才退回)、C 期末前已退回(不算)
      const { checkoutId: checkoutB } = await shiftOf({
        orgId: pingtung,
        openedAt: at("12:00"),
        closedAt: at("21:00"),
        openedBy: hq.userId,
        checkout: { status: "pending", confirmedAt: null, difference: 30 },
      });
      await shiftOf({
        orgId: pingtung,
        openedAt: at("13:00"),
        closedAt: at("19:00"),
        openedBy: hq.userId,
        checkout: {
          status: "returned",
          confirmedAt: null,
          returnedAt: at("22:00"),
          difference: 999,
        },
      });
      // 銀行:存入 1,000 又沖正 → 同一類型一列,含沖正 1 筆
      const accountId = await insert(LOTTERY_BANK_ACCOUNTS_COLLECTION, {
        orgId: pingtung,
        bankCode: "006",
        accountNo: "0001111122222",
        accountName: "合作金庫",
        label: "合庫 末 22222",
        openingBalance: 0,
        openingDate: taipei("2026-11-01"),
        status: "active",
        shareOrgs: [{ orgId: pingtung, includeDescendants: false }],
        moduleKey: "accounts",
      });
      const bankRow = (extra: Record<string, unknown>) =>
        insert(LOTTERY_BANK_TRANSACTIONS_COLLECTION, {
          orgId: tenant,
          accountId,
          occurredAt: at("15:00"),
          type: "deposit",
          amount: 1000,
          branchOrgId: pingtung,
          refType: null,
          refId: null,
          refRevision: null,
          settlementSide: null,
          reversalOf: null,
          summary: null,
          handler: null,
          note: null,
          moduleKey: "accounts",
          ...extra,
        });
      const deposit = await bankRow({ direction: "in" });
      await bankRow({ direction: "out", reversalOf: deposit });
      // 未結清:屏東店是收貨店,前一天已點收 240、今天付了 300 → 調貨待退(收貨店多付)60
      const transferValuesOf = transferValues(hsinchu, pingtung, [
        {
          rowId: "r1",
          book: { id: String(new Types.ObjectId()) },
          mode: { id: "partial" },
          ticket_nos: "001-002",
          tickets: 2,
          amount: 240,
          rate: 100,
        },
      ]);
      const { insertedId: transferId } = await connection
        .collection("form_submissions")
        .insertOne({
          orgId: hsinchu,
          tenantId: tenant,
          moduleKey: "purchasing.transfer",
          formKey: "transfer",
          version: 1,
          values: transferValuesOf,
          summary: null,
          status: "completed",
          revision: 1,
          revisions: [
            revisionOf(1, transferValuesOf, taipei("2026-11-19", "08:30")),
          ],
          editVersion: 1,
          touched: [],
          clientRequestId: String(new Types.ObjectId()),
          serialNo: "T-0920",
          submittedAt: taipei("2026-11-19", "08:30"),
          currentInstanceId: null,
          blocked: false,
          ...base(),
        });
      await insert(LOTTERY_TRANSFER_RECEIPTS_COLLECTION, {
        orgId: pingtung,
        fromOrgId: hsinchu,
        submissionId: transferId,
        rowId: "r1",
        bookId: new Types.ObjectId(),
        purchaseAmount: 240,
        // 選張的列逐張點收:點收紀錄記搬進來的張(已點收張數照它算)
        tickets: ["001", "002"].map((ticketNo) => ({
          ticketId: new Types.ObjectId(),
          unitCost: 100,
          ticketNo,
        })),
        receivedBy: hq.userId,
        // 前一天點收(不算這天的調入),期末時已點收 240
        receivedAt: taipei("2026-11-19", "10:00"),
        moduleKey: "purchasing.transfer",
      });
      await bankRow({
        type: "transfer_expense",
        direction: "out",
        amount: 300,
        occurredAt: at("16:00"),
        refType: "purchasing.transfer",
        refId: transferId,
        refRevision: 1,
        settlementSide: "receiver",
      });

      const before = await storeOn(day, pingtung);
      expect(before.redemption).toMatchObject({
        valid: { count: 2, amount: 800 },
        inStore: { count: 2, amount: 800 },
        sent: { count: 0, amount: 0 },
        revoked: { count: 0, amount: 0 },
      });
      // 結帳差額只算期末時有效的:A、B(待審核)算,C 期末前已退回不算
      expect(before.cash).toMatchObject({
        shiftCount: 2,
        pendingShiftCount: 2,
        shiftDifference: -50 + 30,
      });
      expect(before.notes).toMatchObject({ uncoveredShifts: 2 });
      // 只看這家店自己的帳戶(租戶共用的帳戶也會列,不在這裡比)
      expect(before.bankAccounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "合庫 末 22222",
            types: [
              {
                type: "deposit",
                inAmount: 1000,
                outAmount: 1000,
                reversalCount: 1,
              },
              {
                type: "transfer_expense",
                inAmount: 0,
                outAmount: 300,
                reversalCount: 0,
              },
            ],
          }),
        ]),
      );
      expect(
        (
          before.outstanding as {
            items: { kind: string; amount: number; serialNos: string[] }[];
          }
        ).items.find((item) => item.kind === "transferPayerRefund"),
      ).toMatchObject({ amount: 60, serialNos: ["T-0920"] });
      expect(before.inventory).toMatchObject({
        purchaseTickets: 100,
        salesTickets: 2,
        endingTickets: 98,
        endingCost: 98 * 184,
        checkTickets: 0,
        checkCost: 0,
      });

      // 11/21:撤銷一筆兌獎、送兌另一筆、退回 B、核准 A、補日結涵蓋 A B、把期末的張調走(單張成本改 300)
      await connection
        .collection(LOTTERY_REDEMPTIONS_COLLECTION)
        .updateOne(
          { _id: revokeLater },
          { $set: { status: "revoked", revokedAt: next("09:00") } },
        );
      await connection
        .collection(LOTTERY_REDEMPTIONS_COLLECTION)
        .updateOne(
          { _id: sendLater },
          { $set: { status: "sent", sentAt: next("09:10") } },
        );
      await connection
        .collection(LOTTERY_CHECKOUTS_COLLECTION)
        .updateOne(
          { _id: checkoutB },
          { $set: { status: "returned", returnedAt: next("09:20") } },
        );
      await connection
        .collection(LOTTERY_CHECKOUTS_COLLECTION)
        .updateOne(
          { shiftId: shiftA },
          { $set: { status: "confirmed", confirmedAt: next("09:30") } },
        );
      const shiftIds = await connection
        .collection(LOTTERY_CHECKOUTS_COLLECTION)
        .find({ orgId: pingtung, type: "shift" })
        .map((row) => row.shiftId as Types.ObjectId)
        .toArray();
      await dailyClose(pingtung, null, next("10:00"), {
        coveredShiftIds: shiftIds,
      });
      const moving = await ticketsWhere(
        bookId,
        (ticket) => ticket.status === "unsold",
      );
      await apply(
        {
          operator: null,
          crossStoreTenantId: tenant,
          systemActorId: hq.userId,
        },
        moving,
        {
          type: "transfer_in",
          at: next("11:00"),
          patch: {
            orgId: hsinchu,
            location: { kind: "stock", cashPointId: null },
            unitCost: 300,
          },
        },
      );

      const after = await storeOn(day, pingtung);
      expect(after).toEqual(before);
      // 變化算在發生當天
      const nextDay = await storeOn("2026-11-21", pingtung);
      expect(nextDay.notes).toMatchObject({ uncoveredShifts: 0 });
      expect(nextDay.inventory).toMatchObject({
        openingTickets: 98,
        endingTickets: 0,
      });
    });
  });
});
