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
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
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

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

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
          purchaseBooks
          purchaseTickets
          purchaseCost
          transferInTickets
          transferInAmount
          transferOutTickets
          transferOutAmount
          transferGain
          scrapTickets
          scrapCost
          lostTickets
          lostCost
          recoveredTickets
          recoveredCost
          skippedTickets
          endingTickets
          endingCost
          investigatingBooks
        }
        cash {
          shiftCount
          shiftDifference
          postClose {
            category
            count
            amount
          }
          refund
          transferExpense
          transferIncome
          deposit
          bankDeposit
          dailyCloseCount
          vaultDifference
        }
        bankAccounts {
          label
          shared
          types {
            type
            direction
            amount
          }
          endingBalance
        }
        outstanding {
          purchaseToPay
          purchaseToRefund
          transferToReceive
          transferToPay
        }
        notes {
          skippedStocktakes {
            reason
            count
          }
          uncountedStocktakes
          uncountedBooks
          uncoveredShifts
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
  inventory: Record<string, unknown>;
  cash: Record<string, unknown>;
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

/** 清單的第 N 筆(測試資料一定有;沒有就讓測試直接失敗)。 */
function nth<Item>(list: readonly Item[], index: number): Item {
  const item = list[index];
  if (item === undefined) {
    throw new Error(`missing item ${String(index)}`);
  }
  return item;
}

const firstOf = <Item>(list: readonly Item[]): Item => nth(list, 0);

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
        // 原班的結帳快照不變;之後的更正逐筆另列(記錄當時、類別)
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
    // 兌獎區塊只算有效的;被撤銷的 2,000 另列(重新登記的 200 在週二)
    expect(report.stores[0]?.redemption).toMatchObject({
      valid: { count: 0, amount: 0 },
      revoked: { count: 1, amount: 2000 },
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
      const ticket = (bookId: Types.ObjectId, unitCost: number) => {
        ticketSequence += 1;
        const ticketNo = String(ticketSequence).padStart(3, "0");
        return insert(LOTTERY_TICKETS_COLLECTION, {
          orgId: taichung,
          bookId,
          ticketNo,
          ticketKey: `${String(bookId)}-${ticketNo}`,
          unitCost,
          moduleKey: "inventory",
        });
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

      // 本 1(5164,成本 3,000、20 張、單張 150):今天進貨
      const b1: Types.ObjectId[] = [];
      for (let index = 0; index < 20; index += 1) {
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
      // 跳號 #20(不計成本)、報廢 #19(成本快照 150)、遺失 #18、尋回 #17、待查 #16
      await event(nth(b1, 19), book1, game1, "skip", at("11:00"), {
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
      await event(nth(b1, 17), book1, game1, "lose", at("11:10"), {
        status: "lost",
        locationKind: "stock",
      });
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
      for (const id of [b2[1], b2[2]] as Types.ObjectId[]) {
        await event(id, book2, game2, "transfer_out", at("13:00"), {
          status: "unsold",
          locationKind: "in_transit",
        });
        await event(
          id,
          book2,
          game2,
          "transfer_in",
          at("15:00"),
          { ...unsold, orgId: zhongshan },
          {
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
        submissionId: new Types.ObjectId(),
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

      // 銀行:共用帳戶,本店存入 1,000、批貨支出 3,000;中山店另有一筆收 500(只算進期末餘額)
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
          revisions: [],
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

    it("區塊 4 庫存異動:進貨、調入 / 調出、調貨損益 = 調貨金額 − 原成本、報廢 / 遺失 / 尋回、跳號不計成本、期末庫存、待查", () => {
      expect(report.inventory).toEqual({
        purchaseBooks: 1,
        purchaseTickets: 20,
        purchaseCost: 3000,
        transferInTickets: 3,
        transferInAmount: 300,
        transferOutTickets: 2,
        transferOutAmount: 240,
        // 240 − 原成本 90 × 2
        transferGain: 60,
        scrapTickets: 1,
        scrapCost: 150,
        lostTickets: 1,
        lostCost: 150,
        recoveredTickets: 1,
        recoveredCost: 150,
        skippedTickets: 1,
        // 本 1:20 − 已售 4 − 跳號 − 報廢 − 遺失 − 待查 = 12(× 150);本 2:10 − 1 − 調出 2 = 7(× 90);調入 3(× 100)
        endingTickets: 22,
        endingCost: 12 * 150 + 7 * 90 + 3 * 100,
        investigatingBooks: 1,
      });
      expect(withoutCost.inventory).toMatchObject({
        purchaseCost: null,
        transferGain: null,
        scrapCost: null,
        lostCost: null,
        recoveredCost: null,
        endingCost: null,
        // 張數照樣有
        endingTickets: 22,
      });
    });

    it("區塊 5 現金:各班差額、事後更正(依原因類別)、退貨退款、調貨、投庫(扣沖正)、存銀行、日結小金庫差異", () => {
      expect(report.cash).toEqual({
        shiftCount: 2,
        shiftDifference: -100,
        postClose: [{ category: "refund", count: 1, amount: -150 }],
        refund: 200,
        transferExpense: 300,
        transferIncome: 120,
        deposit: 1500,
        bankDeposit: 1000,
        dailyCloseCount: 1,
        vaultDifference: 50,
      });
    });

    it("區塊 6 銀行:只算歸屬本店的交易、依類型合計;期末餘額是整個帳戶(共用)", () => {
      expect(report.bankAccounts).toEqual([
        {
          label: "台灣銀行 末 12345",
          shared: true,
          types: [
            { type: "deposit", direction: "in", amount: 1000 },
            { type: "purchase_expense", direction: "out", amount: 3000 },
          ],
          endingBalance: 10_000 + 1000 - 3000 + 500,
        },
      ]);
    });

    it("區塊 7 未結清:期末時的待付批貨款(期末之後才付的不算進期末);付了之後那天的期末是 0", async () => {
      expect(report.outstanding).toEqual({
        purchaseToPay: 5000,
        purchaseToRefund: 0,
        transferToReceive: 0,
        transferToPay: 0,
      });
      const before = await operations(hq, {
        ...dayOf("2026-10-13"),
        orgIds: [String(taichung)],
      });
      // 10/13 期末:進貨單還沒送出
      expect(firstOf(before.stores).outstanding).toMatchObject({
        purchaseToPay: 0,
      });
      const after = await operations(hq, {
        ...dayOf("2026-10-15"),
        orgIds: [String(taichung)],
      });
      expect(firstOf(after.stores).outstanding).toMatchObject({
        purchaseToPay: 0,
      });
    });

    it("期末庫存從現況往回推:期末之後的售出 / 調出 / 進貨都還原;期末之後調走的張用點收記的調入前成本", async () => {
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
      });
    });

    it("區塊 8 註記:跳過盤點與原因、N 本未盤、沒有被日結涵蓋計算的班、尚未關帳", () => {
      expect(report.notes).toEqual({
        skippedStocktakes: [{ reason: "人力不足", count: 1 }],
        uncountedStocktakes: 1,
        uncountedBooks: 2,
        uncoveredShifts: 1,
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
        revisions: [],
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
    expect(firstOf(day25.stores).outstanding).toMatchObject({
      purchaseToPay: 700,
    });
    const day26 = await operations(hq, {
      ...dayOf("2026-10-26"),
      orgIds: [String(hsinchu)],
    });
    expect(firstOf(day26.stores).outstanding).toMatchObject({
      purchaseToPay: 0,
    });
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

  it("調貨單作廢:點收那天算調出,作廢那天反向算回(調入、調出、調貨損益)", async () => {
    const kaohsiung = await createOrg(connection, {
      name: "高雄店",
      parentId: tenant,
    });
    const { insertedId: submissionId } = await connection
      .collection("form_submissions")
      .insertOne({
        orgId: kaohsiung,
        tenantId: tenant,
        moduleKey: "purchasing.transfer",
        formKey: "transfer",
        version: 1,
        values: {
          from_branch: { id: String(kaohsiung), label: "高雄店" },
          to_branch: { id: String(zhongshan), label: "中山店" },
          lines: [],
        },
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
    await insert(LOTTERY_TRANSFER_RECEIPTS_COLLECTION, {
      orgId: zhongshan,
      fromOrgId: kaohsiung,
      submissionId,
      rowId: "r1",
      bookId: new Types.ObjectId(),
      purchaseAmount: 240,
      tickets: [
        { ticketId: new Types.ObjectId(), unitCost: 90 },
        { ticketId: new Types.ObjectId(), unitCost: 90 },
      ],
      receivedBy: hq.userId,
      receivedAt: taipei("2026-10-20", "10:00"),
      moduleKey: "purchasing.transfer",
    });
    const dayReport = async (date: string, orgId: Types.ObjectId) => {
      const result = await operations(hq, {
        ...dayOf(date),
        orgIds: [String(orgId)],
      });
      return firstOf(result.stores).inventory;
    };
    expect(await dayReport("2026-10-20", kaohsiung)).toMatchObject({
      transferOutTickets: 2,
      transferOutAmount: 240,
      transferGain: 60,
    });
    expect(await dayReport("2026-10-21", kaohsiung)).toMatchObject({
      transferOutTickets: -2,
      transferOutAmount: -240,
      transferGain: -60,
    });
    expect(await dayReport("2026-10-21", zhongshan)).toMatchObject({
      transferInTickets: -2,
      transferInAmount: -240,
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
});
