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

import {
  CASH_CORRECTION_FORM_KEY,
  SALE_REVERSAL_FORM_KEY,
} from "@repo/domain/project/lottery";
import { ACCOUNTS_PERMISSIONS as A } from "@repo/domain/project/lottery-accounts";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import {
  NotificationService,
  type NotifyInput,
} from "../../../notifications/notification.service";
import {
  type Person,
  WORKFLOW_TEST_TIMEOUT_MS,
  person,
} from "../../../workflows/test-support/workflow-fixtures";
import {
  AppendOnlyLedgerError,
  LotteryBankTransactionsRepository,
  LotteryCashMovementsRepository,
  LotteryPeriodClosesRepository,
} from "../../database/lottery-accounts/lottery-accounts.repositories";
import { LOTTERY_BANK_ACCOUNTS_COLLECTION } from "../../database/lottery-accounts/lottery-bank-account.schema";
import { LOTTERY_BANK_TRANSACTIONS_COLLECTION } from "../../database/lottery-accounts/lottery-bank-transaction.schema";
import { LOTTERY_CASH_MOVEMENTS_COLLECTION } from "../../database/lottery-accounts/lottery-cash-movement.schema";
import {
  LOTTERY_PERIOD_CLOSES_COLLECTION,
  LotteryPeriodClose,
} from "../../database/lottery-accounts/lottery-period-close.schema";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import { LOTTERY_CHECKOUTS_COLLECTION } from "../../database/lottery-checkouts/lottery-checkout.schema";
import { LOTTERY_SHIFTS_COLLECTION } from "../../database/lottery-store/lottery-shift.schema";
import { PeriodLock } from "../accounts/period-lock";
import { StoreClock } from "../store/store-clock";
import {
  PERIOD_CLOSE_OVERDUE_JOB_KEY,
  PeriodCloseRemindersService,
} from "./period-close-reminders.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const LIST = /* GraphQL */ `
  query List {
    lotteryPeriodCloses {
      items {
        month
        status
        closedAt
        closedBy {
          id
        }
        canClose
      }
      closableMonth
    }
  }
`;

const CHECK = /* GraphQL */ `
  query Check($month: String!) {
    lotteryPeriodCloseCheck(month: $month) {
      month
      openShifts {
        orgName
        label
      }
      pendingDocuments {
        kind
        serialNo
        shiftLabel
      }
      snapshot {
        bankAccounts {
          label
          balance
        }
        stores {
          name
          vault
          drawerTotal
          drawers {
            name
            amount
            spanningShiftLabel
          }
          uncoveredShifts {
            label
          }
        }
      }
      canClose
    }
  }
`;

const CLOSE = /* GraphQL */ `
  mutation Close($input: CloseLotteryPeriodInput!) {
    closeLotteryPeriod(input: $input) {
      month
      closedBy {
        id
      }
    }
  }
`;

const SNAPSHOT = /* GraphQL */ `
  query Snapshot($month: String!) {
    lotteryPeriodClose(month: $month) {
      month
      snapshot {
        bankAccounts {
          balance
        }
        stores {
          vault
          uncoveredShifts {
            label
          }
        }
      }
    }
  }
`;

interface CheckData {
  lotteryPeriodCloseCheck: {
    month: string;
    openShifts: { orgName: string; label: string }[];
    pendingDocuments: {
      kind: string;
      serialNo: string | null;
      shiftLabel: string | null;
    }[];
    snapshot: {
      bankAccounts: { label: string; balance: number }[];
      stores: {
        name: string;
        vault: number;
        drawerTotal: number;
        drawers: {
          name: string;
          amount: number | null;
          spanningShiftLabel: string | null;
        }[];
        uncoveredShifts: { label: string }[];
      }[];
    };
    canClose: boolean;
  };
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

/** 台北時間 `YYYY-MM-DD HH:mm(:ss.SSS)`。 */
const taipei = (date: string, time: string) =>
  new Date(`${date}T${time}+08:00`);

function now(date: string, time: string): void {
  jest.spyOn(StoreClock.prototype, "now").mockReturnValue(taipei(date, time));
}

/**
 * 關帳(規格 10.4、3.4;票面 P28 的驗收條件):打真的 GraphQL 端點,對真 MongoDB(TEST-07);「現在」由 `StoreClock`
 * 注入。班、結帳單、單據與帳本直接寫成資料(各功能的寫入已在自己的測試驗過)。
 *
 * 組織樹:root ─ 租戶甲(2026-09-10 開始使用、含下層)─ 中山店(店內櫃台)
 */
describe("關帳(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let tenant: Types.ObjectId;
  let store: Types.ObjectId;
  let counter: Types.ObjectId;
  let account: Types.ObjectId;

  /** 總部管理:持有 `accounts.close-period` */
  let closer: Person;
  /** 店長:只有 `accounts.view-cash`(沒有關帳) */
  let manager: Person;

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

  async function errorOf(
    who: Person,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<Record<string, unknown> | undefined> {
    const result = await gql(who, query, variables);
    return result.errors?.[0]?.extensions;
  }

  const close = (month: string, confirmMonth = month) =>
    gql(closer, CLOSE, { input: { month, confirmMonth, note: null } });

  /** [關帳] 擋下時的錯誤(`extensions`)。 */
  async function closeError(month: string, confirmMonth = month) {
    const result = await close(month, confirmMonth);
    return result.errors?.[0]?.extensions;
  }

  async function check(month: string) {
    const data = await ok<CheckData>(closer, CHECK, { month });
    return data.lotteryPeriodCloseCheck;
  }

  /** 一班:`closedAt = null` = 還開著;已結束的附一張結帳單(狀態看情境,留給下一班 `leftForNext`)。 */
  async function shiftOf(
    label: string,
    openedAt: Date,
    closedAt: Date | null,
    status: "pending" | "confirmed" | "returned" = "confirmed",
    leftForNext = 0,
  ): Promise<{ shiftId: Types.ObjectId; submissionId: Types.ObjectId }> {
    const submissionId = new Types.ObjectId();
    const { insertedId: shiftId } = await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .insertOne({
        orgId: store,
        tenantId: tenant,
        cashPointId: counter,
        openedBy: closer.userId,
        openedAt,
        openingFloat: 0,
        openingFloatSource: "none",
        previousShiftId: null,
        openingMovementId: null,
        scheduleEntryId: null,
        scheduleTaskSnapshot: null,
        positionMismatch: null,
        closedAt: null,
        checkoutId: null,
        drawerVersion: 0,
        label,
        moduleKey: "store",
        ...base(),
      });
    if (closedAt !== null) {
      const { insertedId: checkoutId } = await connection
        .collection(LOTTERY_CHECKOUTS_COLLECTION)
        .insertOne(
          checkoutDoc({
            type: "shift",
            status,
            shiftId,
            submittedAt: closedAt,
            leftForNext,
            submissionId,
          }),
        );
      await connection
        .collection(LOTTERY_SHIFTS_COLLECTION)
        .updateOne({ _id: shiftId }, { $set: { closedAt, checkoutId } });
    }
    return { shiftId, submissionId };
  }

  function checkoutDoc(input: {
    type: "shift" | "daily";
    status: "pending" | "confirmed" | "returned";
    shiftId: Types.ObjectId | null;
    submittedAt: Date;
    leftForNext?: number;
    coveredFrom?: Date | null;
    coveredTo?: Date | null;
    submissionId?: Types.ObjectId;
  }) {
    return {
      orgId: store,
      tenantId: tenant,
      type: input.type,
      status: input.status,
      cashPointId: input.type === "shift" ? counter : null,
      shiftId: input.shiftId,
      stocktakeMode: "skip",
      stocktakeId: null,
      skipReasonKey: "short-staffed",
      skipReason: "人力不足",
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
      leftForNext: input.leftForNext ?? 0,
      successorId: null,
      submittedBy: closer.userId,
      submittedAt: input.submittedAt,
      confirmedAt: input.status === "confirmed" ? input.submittedAt : null,
      confirmedBy: null,
      coveredFrom: input.coveredFrom ?? null,
      coveredTo: input.coveredTo ?? null,
      coveredShiftIds: [],
      bankDepositAmount: 0,
      bankAccountId: null,
      bankTransactionId: null,
      bankMovementId: null,
      submissionId: input.submissionId ?? new Types.ObjectId(),
      version: 0,
      moduleKey: "store",
      ...base(),
    };
  }

  /** 店面的兩張表單(直接寫成提交;只讀狀態、存值、單號、送出時間)。 */
  async function storeForm(
    formKey: string,
    status: string,
    values: Record<string, unknown>,
    serialNo: string,
    submittedAt: Date,
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection("form_submissions")
      .insertOne({
        orgId: store,
        tenantId: tenant,
        moduleKey: "store",
        formKey,
        version: 1,
        values,
        summary: null,
        status,
        revision: 1,
        revisions: [],
        editVersion: 1,
        touched: [],
        clientRequestId: String(new Types.ObjectId()),
        serialNo,
        submittedAt,
        currentInstanceId: null,
        blocked: false,
        ...base(),
      });
    return insertedId;
  }

  async function setStatus(
    collection: string,
    id: Types.ObjectId,
    filter: "submissionId" | "_id",
    status: string,
  ): Promise<void> {
    await connection
      .collection(collection)
      .updateOne({ [filter]: id }, { $set: { status } });
  }

  async function bankTransaction(
    direction: "in" | "out",
    amount: number,
    occurredAt: Date,
  ): Promise<void> {
    await connection
      .collection(LOTTERY_BANK_TRANSACTIONS_COLLECTION)
      .insertOne({
        orgId: tenant,
        tenantId: tenant,
        accountId: account,
        occurredAt,
        type: direction === "in" ? "deposit" : "withdrawal",
        direction,
        amount,
        branchOrgId: null,
        refType: null,
        refId: null,
        refRevision: null,
        settlementSide: null,
        reversalOf: null,
        summary: null,
        handler: null,
        note: null,
        moduleKey: "accounts",
        ...base(),
      });
  }

  async function vaultMovement(amount: number, occurredAt: Date) {
    await connection.collection(LOTTERY_CASH_MOVEMENTS_COLLECTION).insertOne({
      orgId: store,
      tenantId: tenant,
      occurredAt,
      type: "correction_increase",
      from: "external",
      to: "vault",
      reason: null,
      cashPointId: null,
      shiftId: null,
      attributedShiftId: null,
      postCloseOf: null,
      amount,
      refType: null,
      refId: null,
      refRevision: null,
      settlementSide: null,
      payee: null,
      note: null,
      reversalOf: null,
      bankTransactionId: null,
      moduleKey: "accounts",
      ...base(),
    });
  }

  /** 注入排程時點跑一次關帳逾期提醒(`notify` 換成記錄)。 */
  async function remindersAt(date: string, time: string) {
    const calls: NotifyInput[] = [];
    const spy = jest
      .spyOn(api.app.get(NotificationService), "notify")
      .mockImplementation((input: NotifyInput) => {
        calls.push(input);
        return Promise.resolve();
      });
    try {
      await api.app.get(PeriodCloseRemindersService).run({
        key: PERIOD_CLOSE_OVERDUE_JOB_KEY,
        scheduledFor: taipei(date, time),
        tenants: [{ tenantId: tenant, timezone: "Asia/Taipei" }],
      });
    } finally {
      spy.mockRestore();
    }
    return calls;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-period-close");
    connection = api.connection;
    await api.app
      .get<Model<LotteryPeriodClose>>(getModelToken(LotteryPeriodClose.name))
      .init();
    const { insertedId: moduleId } = await connection
      .collection("modules")
      .insertOne({
        key: "accounts",
        name: "帳戶管理",
        parentId: null,
        ancestors: [],
        route: "accounts",
        sidebarType: "link",
        order: 40,
        enabled: true,
        isSystem: false,
        icon: null,
        settings: {},
        engine: "form",
        ...base(),
      });
    await connection.collection("permissions").insertMany(
      Object.values(A).map((key) => ({
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
    // 租戶 2026-09-10 開始使用:月份列表與「依序關帳」從 9 月起算
    await connection
      .collection("orgs")
      .updateOne(
        { _id: tenant },
        { $set: { createdAt: taipei("2026-09-10", "10:00") } },
      );
    store = await createOrg(connection, { name: "中山店", parentId: tenant });
    const { insertedId } = await connection
      .collection(LOTTERY_CASH_POINTS_COLLECTION)
      .insertOne({
        orgId: store,
        tenantId: tenant,
        positionKey: "in-store-counter",
        name: "店內櫃台",
        order: 1,
        enabled: true,
        printerId: null,
        note: null,
        moduleKey: "master-data",
        ...base(),
      });
    counter = insertedId;
    const { insertedId: accountId } = await connection
      .collection(LOTTERY_BANK_ACCOUNTS_COLLECTION)
      .insertOne({
        orgId: tenant,
        tenantId: tenant,
        bankCode: "004",
        branchName: null,
        accountNo: "0001234534521",
        accountName: "台灣銀行",
        label: "台灣銀行 末 34521",
        openingBalance: 1000,
        openingDate: taipei("2026-09-01", "00:00"),
        status: "active",
        note: null,
        shareOrgs: [{ orgId: tenant, includeDescendants: true }],
        moduleKey: "accounts",
        ...base(),
      });
    account = accountId;

    closer = await person(api, connection, tenant, tenant, {
      moduleKeys: ["accounts"],
      permissionKeys: [A.closePeriod, A.viewCash],
    });
    manager = await person(api, connection, store, tenant, {
      moduleKeys: ["accounts"],
      permissionKeys: [A.viewCash],
    });
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("沒有 accounts.close-period → 看不到關帳分頁的資料、不能關帳(FORBIDDEN)", async () => {
    now("2026-11-03", "10:00");
    expect(await errorOf(manager, LIST)).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await errorOf(manager, CLOSE, {
        input: { month: "2026-09", confirmMonth: "2026-09" },
      }),
    ).toMatchObject({ code: "FORBIDDEN" });
  });

  it("月份列表與依序關帳:跳過 9 月關 10 月 → 擋下;關本月 → 擋下;確認月份不同 → 擋下;關 9 月 → 成功;重關 → 擋下", async () => {
    now("2026-11-03", "10:00");
    const list = await ok<{
      lotteryPeriodCloses: {
        items: { month: string; status: string; canClose: boolean }[];
        closableMonth: string | null;
      };
    }>(closer, LIST);
    expect(list.lotteryPeriodCloses).toMatchObject({
      closableMonth: "2026-09",
      items: [
        { month: "2026-11", status: "current", canClose: false },
        { month: "2026-10", status: "open", canClose: false },
        { month: "2026-09", status: "open", canClose: true },
      ],
    });

    expect(await closeError("2026-10")).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "PERIOD_OUT_OF_ORDER",
    });
    expect(await closeError("2026-11")).toMatchObject({
      reason: "PERIOD_NOT_ENDED",
    });
    expect(await closeError("2026-09", "2026-08")).toMatchObject({
      reason: "PERIOD_CLOSE_INVALID",
      fields: ["confirmMonth"],
    });

    const closed = await close("2026-09");
    expect(closed.errors).toBeUndefined();
    expect(closed.data).toMatchObject({
      closeLotteryPeriod: {
        month: "2026-09",
        closedBy: { id: String(closer.userId) },
      },
    });
    expect(await closeError("2026-09")).toMatchObject({
      reason: "PERIOD_ALREADY_CLOSED",
    });
    const audit = await connection
      .collection("audit_logs")
      .findOne({ action: "lottery-period.close" });
    expect(audit).toMatchObject({
      targetType: "lottery_period_close",
      after: { month: "2026-09" },
    });

    const after = await ok<{
      lotteryPeriodCloses: {
        items: { month: string; status: string; canClose: boolean }[];
        closableMonth: string | null;
      };
    }>(closer, LIST);
    expect(after.lotteryPeriodCloses.closableMonth).toBe("2026-10");
    expect(after.lotteryPeriodCloses.items).toEqual([
      expect.objectContaining({ month: "2026-11", canClose: false }),
      expect.objectContaining({ month: "2026-10", canClose: true }),
      expect.objectContaining({ month: "2026-09", status: "closed" }),
    ]);
  });

  it("關帳逾期:每月 3 號 09:00(注入時鐘)上個月沒關 → 提醒持有 close-period 的人(租戶);2 號不寄", async () => {
    expect(await remindersAt("2026-11-02", "09:00")).toEqual([]);
    const calls = await remindersAt("2026-11-03", "09:00");
    expect(calls).toEqual([
      expect.objectContaining({
        type: "lottery.period-close-overdue",
        tenantId: tenant,
        orgId: tenant,
        params: { period: "2026-10" },
        // 點進去 = 帳戶管理的關帳分頁
        ref: { type: "lottery-accounts-tab", id: "close" },
      }),
    ]);
    // 9 月已關:10/3 不寄
    expect(await remindersAt("2026-10-03", "09:00")).toEqual([]);
    // 上個月(8 月)早於租戶開始使用的月份(9 月):9/3 不寄
    expect(await remindersAt("2026-09-03", "09:00")).toEqual([]);
  });

  it("10 月:沒結帳的班 → 擋;三種單據審核中且落在 10 月 → 擋(11 月的不擋);沒被日結涵蓋的班 → 警告並記快照;關到 10/31 23:59:59.999", async () => {
    now("2026-11-03", "10:00");
    // 10/31 21:00 開的班,月底還開著
    const night = await shiftOf(
      "店內櫃台 · 10/31 晚班",
      taipei("2026-10-31", "21:00:00"),
      null,
    );
    let result = await check("2026-10");
    expect(result.openShifts).toEqual([
      { orgName: "中山店", label: "店內櫃台 · 10/31 晚班" },
    ]);
    expect(result.canClose).toBe(false);
    expect(await closeError("2026-10")).toMatchObject({
      reason: "PERIOD_SHIFTS_NOT_CLOSED",
    });

    // 晚班 11/1 01:00 送出交班結帳(跨月),結帳確認申請審核中 → 擋(交班:那一班與 10 月重疊)
    const { insertedId: nightCheckout } = await connection
      .collection(LOTTERY_CHECKOUTS_COLLECTION)
      .insertOne(
        checkoutDoc({
          type: "shift",
          status: "pending",
          shiftId: night.shiftId,
          submittedAt: taipei("2026-11-01", "01:00:00"),
          leftForNext: 2000,
        }),
      );
    await connection.collection(LOTTERY_SHIFTS_COLLECTION).updateOne(
      { _id: night.shiftId },
      {
        $set: {
          closedAt: taipei("2026-11-01", "01:00:00"),
          checkoutId: nightCheckout,
        },
      },
    );
    // 10/30 早班:已結帳、已確認,留給下一班 0;11/2 早班(不算 10 月)
    const early = await shiftOf(
      "店內櫃台 · 10/30 早班",
      taipei("2026-10-30", "08:00:00"),
      taipei("2026-10-30", "16:00:00"),
    );
    const november = await shiftOf(
      "店內櫃台 · 11/2 早班",
      taipei("2026-11-02", "08:00:00"),
      taipei("2026-11-02", "16:00:00"),
    );
    // 撤銷售出申請:退款班次 10/31 晚班 → 擋;退款班次 11/2 早班 → 不擋
    const reversal = await storeForm(
      SALE_REVERSAL_FORM_KEY,
      "reviewing",
      { refund: "yes", refund_shift: String(night.shiftId) },
      "SR-012",
      taipei("2026-11-02", "10:00:00"),
    );
    await storeForm(
      SALE_REVERSAL_FORM_KEY,
      "reviewing",
      { refund: "yes", refund_shift: String(november.shiftId) },
      "SR-013",
      taipei("2026-11-02", "10:00:00"),
    );
    // 現金更正單:位置 10/30 早班 → 擋;小金庫 10/31 送出 → 擋;小金庫 11/1 送出 → 不擋
    const drawerCorrection = await storeForm(
      CASH_CORRECTION_FORM_KEY,
      "reviewing",
      { place: "drawer", shift: String(early.shiftId) },
      "C-001",
      taipei("2026-11-02", "10:00:00"),
    );
    const vaultCorrection = await storeForm(
      CASH_CORRECTION_FORM_KEY,
      "returned",
      { place: "vault" },
      "C-002",
      taipei("2026-10-31", "22:00:00"),
    );
    await storeForm(
      CASH_CORRECTION_FORM_KEY,
      "reviewing",
      { place: "vault" },
      "C-003",
      taipei("2026-11-01", "00:00:00"),
    );
    // 結帳確認申請(日結)審核中:涵蓋 10/31 21:30 至 11/1 21:40 → 擋
    const { insertedId: dailyId } = await connection
      .collection(LOTTERY_CHECKOUTS_COLLECTION)
      .insertOne(
        checkoutDoc({
          type: "daily",
          status: "pending",
          shiftId: null,
          submittedAt: taipei("2026-11-01", "21:40:00"),
          coveredFrom: taipei("2026-10-31", "21:30:00"),
          coveredTo: taipei("2026-11-01", "21:40:00"),
        }),
      );

    result = await check("2026-10");
    expect(result.openShifts).toEqual([]);
    expect(result.pendingDocuments).toEqual([
      {
        kind: "cash_correction",
        serialNo: "C-001",
        shiftLabel: "店內櫃台 · 10/30 早班",
      },
      {
        kind: "sale_reversal",
        serialNo: "SR-012",
        shiftLabel: "店內櫃台 · 10/31 晚班",
      },
      {
        kind: "shift_checkout",
        serialNo: null,
        shiftLabel: "店內櫃台 · 10/31 晚班",
      },
      { kind: "cash_correction", serialNo: "C-002", shiftLabel: null },
      { kind: "daily_close", serialNo: null, shiftLabel: null },
    ]);
    expect(await closeError("2026-10")).toMatchObject({
      reason: "PERIOD_PENDING_DOCUMENTS",
    });

    // 都處理完:申請完成 / 駁回、交班的結帳確認申請核准;情境資料改成這家店沒有日結
    // (10/30 早班、10/31 晚班都沒有被日結涵蓋計算 → 只警告)
    await setStatus("form_submissions", reversal, "_id", "completed");
    await setStatus("form_submissions", drawerCorrection, "_id", "completed");
    await setStatus("form_submissions", vaultCorrection, "_id", "rejected");
    await setStatus(
      LOTTERY_CHECKOUTS_COLLECTION,
      nightCheckout,
      "_id",
      "confirmed",
    );
    await connection
      .collection(LOTTERY_CHECKOUTS_COLLECTION)
      .deleteOne({ _id: dailyId });

    // 帳與小金庫:10/31 23:59:59.999 算 10 月;11/1 00:00 算 11 月
    await bankTransaction("in", 500, taipei("2026-10-31", "23:59:59.999"));
    await bankTransaction("out", 200, taipei("2026-11-01", "00:00:00"));
    await vaultMovement(3000, taipei("2026-10-31", "23:59:59.999"));
    await vaultMovement(700, taipei("2026-11-01", "00:00:00"));

    result = await check("2026-10");
    expect(result.pendingDocuments).toEqual([]);
    expect(result.canClose).toBe(true);
    expect(result.snapshot.bankAccounts).toEqual([
      { label: "台灣銀行 末 34521", balance: 1500 },
    ]);
    expect(result.snapshot.stores).toEqual([
      {
        name: "中山店",
        vault: 3000,
        drawerTotal: 0,
        // 月底晚班還開著(跨月):抽屜金額不記,記那一班
        drawers: [
          {
            name: "店內櫃台",
            amount: null,
            spanningShiftLabel: "店內櫃台 · 10/31 晚班",
          },
        ],
        // 沒有被日結涵蓋計算的班:只警告,記入快照
        uncoveredShifts: [
          { label: "店內櫃台 · 10/30 早班" },
          { label: "店內櫃台 · 10/31 晚班" },
        ],
      },
    ]);

    const closed = await close("2026-10");
    expect(closed.errors).toBeUndefined();
    const snapshot = await ok<{
      lotteryPeriodClose: {
        month: string;
        snapshot: {
          bankAccounts: { balance: number }[];
          stores: { vault: number; uncoveredShifts: { label: string }[] }[];
        };
      };
    }>(closer, SNAPSHOT, { month: "2026-10" });
    expect(snapshot.lotteryPeriodClose.snapshot).toEqual({
      bankAccounts: [{ balance: 1500 }],
      stores: [
        {
          vault: 3000,
          uncoveredShifts: [
            { label: "店內櫃台 · 10/30 早班" },
            { label: "店內櫃台 · 10/31 晚班" },
          ],
        },
      ],
    });
    const stored = await connection
      .collection(LOTTERY_PERIOD_CLOSES_COLLECTION)
      .findOne({ month: "2026-10" });
    expect(stored).toMatchObject({
      tenantId: tenant,
      orgId: tenant,
      periodEnd: taipei("2026-11-01", "00:00:00"),
    });

    // 關到該月最後一刻:10/31 23:59:59.999 已關帳、11/1 00:00 沒有
    const lock = api.app.get(PeriodLock);
    await expect(
      lock.assertPeriodOpen(tenant, taipei("2026-10-31", "23:59:59.999")),
    ).rejects.toMatchObject({ extensions: { reason: "PERIOD_CLOSED" } });
    await expect(
      lock.assertPeriodOpen(tenant, taipei("2026-11-01", "00:00:00")),
    ).resolves.toBeUndefined();
    // 10 月已關:11/3 不再提醒
    expect(await remindersAt("2026-11-03", "09:15")).toEqual([]);
  });

  it("11 月快照:最後一班月底前已結帳 → 抽屜 = 留給下一班;小金庫從月底前最後一張已確認日結起算(月底後的日結不算);兩人同時關 → 一個 ALREADY_CLOSED", async () => {
    now("2026-12-02", "10:00");
    // 上一情境留下的 11 月單據先處理完
    await connection
      .collection("form_submissions")
      .updateMany(
        { serialNo: { $in: ["SR-013", "C-003"] } },
        { $set: { status: "completed" } },
      );
    await shiftOf(
      "店內櫃台 · 11/10 早班",
      taipei("2026-11-10", "08:00:00"),
      taipei("2026-11-10", "16:00:00"),
      "confirmed",
      1500,
    );
    // 11/20 已確認日結清點 10,000(月底前);12/1 的日結(月底後)不算
    for (const [submittedAt, counted] of [
      [taipei("2026-11-20", "21:00:00"), 10_000],
      [taipei("2026-12-01", "21:00:00"), 99_999],
    ] as const) {
      await connection.collection(LOTTERY_CHECKOUTS_COLLECTION).insertOne({
        ...checkoutDoc({
          type: "daily",
          status: "confirmed",
          shiftId: null,
          submittedAt,
          coveredTo: submittedAt,
        }),
        counted,
      });
    }
    await vaultMovement(500, taipei("2026-11-25", "12:00:00"));
    await vaultMovement(700, taipei("2026-12-01", "09:00:00"));

    const result = await check("2026-11");
    expect(result.canClose).toBe(true);
    expect(result.snapshot.stores).toEqual([
      {
        name: "中山店",
        vault: 10_500,
        drawerTotal: 1500,
        drawers: [{ name: "店內櫃台", amount: 1500, spanningShiftLabel: null }],
        uncoveredShifts: [],
      },
    ]);

    const [first, second] = await Promise.all([
      close("2026-11"),
      close("2026-11"),
    ]);
    const errors = [first, second].flatMap(
      (result) => result.errors?.map((error) => error.extensions) ?? [],
    );
    expect([first, second].filter((result) => !result.errors)).toHaveLength(1);
    expect(errors).toEqual([
      expect.objectContaining({ reason: "PERIOD_ALREADY_CLOSED" }),
    ]);
    expect(
      await connection
        .collection(LOTTERY_PERIOD_CLOSES_COLLECTION)
        .countDocuments({ month: "2026-11" }),
    ).toBe(1);
  });

  it("跨班更正的標示:現金流水回「屬於哪一班」(歸屬班次 / 事後更正指向的班),銀行沖正回原交易的時間", async () => {
    const viewer = await person(api, connection, tenant, tenant, {
      moduleKeys: ["accounts"],
      permissionKeys: [A.viewCash, A.viewBankAccounts],
    });
    const { shiftId: earlier } = await shiftOf(
      "店內櫃台 · 何家華 12/01 09:00",
      taipei("2026-12-01", "09:00"),
      taipei("2026-12-01", "17:00"),
    );
    const { shiftId: current } = await shiftOf(
      "店內櫃台 · 何家華 12/02 09:00",
      taipei("2026-12-02", "09:00"),
      taipei("2026-12-02", "17:00"),
    );
    const movementOf = (extra: Record<string, unknown>) =>
      connection.collection(LOTTERY_CASH_MOVEMENTS_COLLECTION).insertOne({
        orgId: store,
        tenantId: tenant,
        occurredAt: taipei("2026-12-02", "10:00"),
        type: "correction_increase",
        from: "external",
        to: "drawer",
        reason: null,
        cashPointId: counter,
        shiftId: current,
        attributedShiftId: null,
        postCloseOf: null,
        amount: 100,
        refType: null,
        refId: null,
        refRevision: null,
        settlementSide: null,
        payee: null,
        note: null,
        reversalOf: null,
        bankTransactionId: null,
        moduleKey: "accounts",
        ...base(),
        ...extra,
      });
    // 現金更正:位置是 12/2 的班、歸屬 12/1 的班 → 屬於 12/1;退貨退款事後更正指向 12/1 → 屬於 12/1;一般的沒有
    await movementOf({ attributedShiftId: earlier });
    await movementOf({
      type: "refund",
      from: "drawer",
      to: "external",
      shiftId: earlier,
      postCloseOf: earlier,
    });
    await movementOf({ attributedShiftId: current });
    const ledger = await ok<{
      lotteryCashLedger: {
        items: { type: string; correctionOfShift: string | null }[];
      };
    }>(
      viewer,
      `query ($input: LotteryCashLedgerInput!) {
        lotteryCashLedger(input: $input) { items { type correctionOfShift } }
      }`,
      {
        input: {
          orgId: String(store),
          from: taipei("2026-12-02", "00:00").toISOString(),
          to: taipei("2026-12-03", "00:00").toISOString(),
        },
      },
    );
    expect(
      ledger.lotteryCashLedger.items.map((item) => item.correctionOfShift),
    ).toEqual(
      expect.arrayContaining([
        "店內櫃台 · 何家華 12/01 09:00",
        "店內櫃台 · 何家華 12/01 09:00",
        null,
      ]),
    );
    expect(
      ledger.lotteryCashLedger.items.filter(
        (item) => item.correctionOfShift !== null,
      ),
    ).toHaveLength(2);

    const bank = connection.collection(LOTTERY_BANK_TRANSACTIONS_COLLECTION);
    const row = (extra: Record<string, unknown>) => ({
      orgId: tenant,
      tenantId: tenant,
      accountId: account,
      type: "deposit",
      amount: 700,
      branchOrgId: null,
      refType: null,
      refId: null,
      refRevision: null,
      settlementSide: null,
      reversalOf: null,
      summary: null,
      handler: null,
      note: null,
      moduleKey: "accounts",
      ...base(),
      ...extra,
    });
    const { insertedId: original } = await bank.insertOne(
      row({ occurredAt: taipei("2026-12-01", "14:00"), direction: "in" }),
    );
    await bank.insertOne(
      row({
        occurredAt: taipei("2026-12-02", "14:00"),
        direction: "out",
        reversalOf: original,
      }),
    );
    const transactions = await ok<{
      lotteryBankTransactions: {
        items: { reversalOf: string | null; reversalOfAt: string | null }[];
      };
    }>(
      viewer,
      `query ($input: LotteryBankTransactionsInput!) {
        lotteryBankTransactions(input: $input) { items { reversalOf reversalOfAt } }
      }`,
      { input: { accountId: String(account) } },
    );
    expect(
      transactions.lotteryBankTransactions.items.find(
        (item) => item.reversalOf === String(original),
      ),
    ).toEqual({
      reversalOf: String(original),
      reversalOfAt: taipei("2026-12-01", "14:00").toISOString(),
    });
  });

  it("只新增:關帳紀錄、銀行交易、現金流水的修改 / 刪除(含批次出口)一律拋 AppendOnlyLedgerError(不能重新開帳)", () => {
    for (const repository of [
      api.app.get(LotteryPeriodClosesRepository),
      api.app.get(LotteryBankTransactionsRepository),
      api.app.get(LotteryCashMovementsRepository),
    ]) {
      expect(() => repository.updateById()).toThrow(AppendOnlyLedgerError);
      expect(() => repository.findOneAndUpdate()).toThrow(
        AppendOnlyLedgerError,
      );
      expect(() => repository.updateMany()).toThrow(AppendOnlyLedgerError);
      expect(() => repository.softDeleteById()).toThrow(AppendOnlyLedgerError);
      expect(() => repository.findOwnAndUpdate()).toThrow(
        AppendOnlyLedgerError,
      );
      expect(() => repository.hardDeleteById()).toThrow(AppendOnlyLedgerError);
      expect(() => repository.softDeleteMany()).toThrow(AppendOnlyLedgerError);
      expect(() => repository.bulkUpdateByIds()).toThrow(AppendOnlyLedgerError);
    }
  });
});
