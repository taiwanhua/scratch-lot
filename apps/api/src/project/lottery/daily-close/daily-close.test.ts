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
  CHECKOUT_CONFIRM_FORM_KEY,
  CHECKOUT_FIELD_KEYS,
  CHECKOUT_REASONS,
  type CheckoutDraft,
  DAILY_CLOSE_REASONS,
  type DailyCloseDraft,
  STORE_PERMISSIONS as S,
  serializeDailyCloseDraft,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import type { StepDef } from "@repo/domain/workflow";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import {
  ASSIGN,
  CREATE_FORM,
  definitionOf,
  field,
  ok as formOk,
  publishDefinition,
  rootToken,
} from "../../../forms/test-support/form-fixtures";
import {
  NotificationService,
  type NotifyInput,
} from "../../../notifications/notification.service";
import { createRole } from "../../../permission/test-support/fixtures";
import {
  type Person,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  bindForm,
  decideOn,
  person,
  publishWorkflow,
  reviewStep,
  roleSource,
} from "../../../workflows/test-support/workflow-fixtures";
import { LOTTERY_BANK_ACCOUNTS_COLLECTION } from "../../database/lottery-accounts/lottery-bank-account.schema";
import { LOTTERY_BANK_TRANSACTIONS_COLLECTION } from "../../database/lottery-accounts/lottery-bank-transaction.schema";
import { LOTTERY_CASH_MOVEMENTS_COLLECTION } from "../../database/lottery-accounts/lottery-cash-movement.schema";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import {
  LOTTERY_CHECKOUTS_COLLECTION,
  LotteryCheckout,
} from "../../database/lottery-checkouts/lottery-checkout.schema";
import { LOTTERY_SHIFTS_COLLECTION } from "../../database/lottery-store/lottery-shift.schema";
import { StoreClock } from "../store/store-clock";
import { seedReasonCategory } from "../test-support/master-data-fixtures";
import {
  DAILY_CLOSE_OVERDUE_JOB_KEY,
  DailyCloseRemindersService,
} from "./daily-close-reminders.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

// ---- GraphQL ----

const WIZARD = /* GraphQL */ `
  query Wizard($orgId: ID!, $submissionId: ID) {
    lotteryDailyCloseWizard(orgId: $orgId, submissionId: $submissionId) {
      coveredFrom
      coveredTo
      gapDates
      openShifts {
        cashPointName
        ownerName
      }
      pending {
        submissionId
        status
      }
      shifts {
        shiftId
        state
        difference
        waitingFor
        isMine
      }
      differenceTotal
      vaultItems {
        kind
        count
        amount
      }
      vaultExpected
      bankAccounts {
        id
        name
      }
    }
  }
`;

const STATUS = /* GraphQL */ `
  query Status($orgId: ID!) {
    lotteryDailyCloseStatus(orgId: $orgId) {
      lastClosedAt
      daysSince
      pending {
        status
      }
    }
  }
`;

const SUBMIT = /* GraphQL */ `
  mutation Submit($input: CreateAndSubmitFormSubmissionInput!) {
    createAndSubmitFormSubmission(input: $input) {
      submission {
        id
        status
      }
    }
  }
`;

const DETAIL = /* GraphQL */ `
  query Detail($submissionId: ID!) {
    lotteryCheckout(submissionId: $submissionId) {
      type
      status
      expected
      counted
      difference
      coveredFrom
      coveredTo
      coveredShifts {
        submissionId
      }
      bankDepositAmount
      bankAccount {
        name
      }
      draft
    }
  }
`;

const DEPOSIT_FORM = /* GraphQL */ `
  query DepositForm($orgId: ID!) {
    lotteryBankDepositForm(orgId: $orgId) {
      vaultExpected
      accounts {
        id
        name
      }
    }
  }
`;

const DEPOSIT = /* GraphQL */ `
  mutation Deposit($input: DepositLotteryVaultToBankInput!) {
    depositLotteryVaultToBank(input: $input) {
      vaultExpected
      movementId
      transactionId
    }
  }
`;

const OPEN_FORM = /* GraphQL */ `
  query OpenForm($cashPointId: ID!) {
    lotteryStoreOpenShiftForm(cashPointId: $cashPointId) {
      item {
        plan
      }
    }
  }
`;

const BOARD = /* GraphQL */ `
  query Board($orgId: ID!) {
    lotteryStoreBoard(orgId: $orgId) {
      item {
        vaultExpected
      }
    }
  }
`;

const BADGES = /* GraphQL */ `
  query Badges {
    sidebarBadges {
      moduleKey
      count
    }
  }
`;

interface WizardData {
  lotteryDailyCloseWizard: {
    coveredFrom: string | null;
    coveredTo: string | null;
    gapDates: string[];
    openShifts: { cashPointName: string; ownerName: string }[];
    pending: { submissionId: string; status: string } | null;
    shifts: {
      shiftId: string;
      state: string;
      difference: number;
      waitingFor: string[];
      isMine: boolean;
    }[];
    differenceTotal: number;
    vaultItems: { kind: string; count: number; amount: number }[];
    vaultExpected: number;
    bankAccounts: { id: string; name: string }[];
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

/** 台北時間 2026-10-DD HH:mm。 */
const taipei = (day: string, time: string) =>
  new Date(`2026-10-${day}T${time}:00+08:00`);

function now(day: string, time: string): void {
  jest.spyOn(StoreClock.prototype, "now").mockReturnValue(taipei(day, time));
}

/** 實點 = 面額 × 張數;給一個總額自動拆成 1,000 / 100 / 10 / 1。 */
function denominationsOf(total: number): CheckoutDraft["denominations"] {
  let rest = total;
  return [1000, 100, 10, 1].map((value) => {
    const count = Math.floor(rest / value);
    rest -= count * value;
    return { value, count };
  });
}

/**
 * 日結與存銀行(規格 6.10、6.11、8.7、3.4;票面 P27 的驗收條件):打真的 GraphQL 端點、真的表單引擎 + 兩關流程
 * (接班人 / 店長,照開通腳本:日結跳過第 1 關、店長審核)+ 掛接點,對真 MongoDB(TEST-07);「現在」由 `StoreClock` 注入。
 * 交班結帳(P26 已測)直接寫成資料:已送出的班 + 那一班的結帳單(狀態看情境)。
 *
 * 組織樹:root ─ 租戶甲(含下層)─ 每個情境一家店(店內櫃台、店外攤位)
 */
describe("日結與存銀行(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let world: World;
  let tenant: Types.ObjectId;

  /** 領班:送日結(`store.checkout` + 跳過盤點),不是店長 */
  let lead: Person;
  /** 店長(角色「店長」;店面管理全部) */
  let manager: Person;
  /** 店員:沒有 `store.checkout`、`store.bank-deposit` */
  let clerk: Person;

  let requestSequence = 0;
  /** 租戶共用給全部分店的帳戶 */
  let sharedAccount: Types.ObjectId;

  const gql = (
    who: Person,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> =>
    api.graphql(query, variables, { accessToken: who.token });

  async function ok<T>(
    who: Person,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const result = await gql(who, query, variables);
    expect(result.errors).toBeUndefined();
    return result.data as T;
  }

  async function errorOf(
    who: Person,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const result = await gql(who, query, variables);
    return result.errors?.[0]?.extensions;
  }

  /** 一家新的店(兩個收銀點)。 */
  async function newStore(name: string) {
    const orgId = await createOrg(connection, { name, parentId: tenant });
    const points = connection.collection(LOTTERY_CASH_POINTS_COLLECTION);
    const point = async (pointName: string, order: number) => {
      const { insertedId } = await points.insertOne({
        orgId,
        tenantId: tenant,
        positionKey: `position-${String(order)}`,
        name: pointName,
        order,
        enabled: true,
        printerId: null,
        note: null,
        moduleKey: "master-data",
        ...base(),
      });
      return insertedId;
    };
    return {
      orgId,
      counter: await point("店內櫃台", 1),
      stall: await point("店外攤位", 2),
    };
  }

  /** 開著的班。 */
  async function openShift(
    orgId: Types.ObjectId,
    cashPointId: Types.ObjectId,
    openedAt: Date,
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .insertOne({
        orgId,
        tenantId: tenant,
        cashPointId,
        openedBy: lead.userId,
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
        label: "",
        moduleKey: "store",
        ...base(),
      });
    return insertedId;
  }

  /** 送出交班結帳的班:班結束(`closedAt`)+ 那一班的結帳單(狀態看情境)。 */
  async function closedShift(
    orgId: Types.ObjectId,
    cashPointId: Types.ObjectId,
    closedAt: Date,
    status: "pending" | "confirmed" | "returned" = "confirmed",
    difference = 0,
  ): Promise<Types.ObjectId> {
    const shiftId = await openShift(
      orgId,
      cashPointId,
      new Date(closedAt.getTime() - 6 * 3_600_000),
    );
    const { insertedId: checkoutId } = await connection
      .collection(LOTTERY_CHECKOUTS_COLLECTION)
      .insertOne({
        orgId,
        tenantId: tenant,
        type: "shift",
        status,
        cashPointId,
        shiftId,
        stocktakeMode: "skip",
        stocktakeId: null,
        skipReasonKey: "short-staffed",
        skipReason: "人力不足",
        skipReasonNote: null,
        expectedItems: [],
        expected: 3000,
        denominations: [],
        counted: 3000 + difference,
        difference,
        diffReasonKey: null,
        diffReason: null,
        diffReasonNote: null,
        pendingImpacts: [],
        leftForNext: 0,
        successorId: null,
        submittedBy: lead.userId,
        submittedAt: closedAt,
        confirmedAt: status === "confirmed" ? closedAt : null,
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
        ...base(),
      });
    await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .updateOne({ _id: shiftId }, { $set: { closedAt, checkoutId } });
    return shiftId;
  }

  /** 已送出的日結(直接寫成資料;涵蓋計算期間到 `coveredTo`)。 */
  async function pastDaily(
    orgId: Types.ObjectId,
    coveredTo: Date,
    counted: number,
  ): Promise<void> {
    await connection.collection(LOTTERY_CHECKOUTS_COLLECTION).insertOne({
      orgId,
      tenantId: tenant,
      type: "daily",
      status: "confirmed",
      cashPointId: null,
      shiftId: null,
      stocktakeMode: "skip",
      stocktakeId: null,
      skipReasonKey: "short-staffed",
      skipReason: "人力不足",
      skipReasonNote: null,
      expectedItems: [],
      expected: counted,
      denominations: [],
      counted,
      difference: 0,
      diffReasonKey: null,
      diffReason: null,
      diffReasonNote: null,
      pendingImpacts: [],
      leftForNext: 0,
      successorId: null,
      submittedBy: lead.userId,
      submittedAt: coveredTo,
      confirmedAt: coveredTo,
      confirmedBy: manager.userId,
      coveredFrom: null,
      coveredTo,
      coveredShiftIds: [],
      bankDepositAmount: 0,
      bankAccountId: null,
      bankTransactionId: null,
      bankMovementId: null,
      submissionId: new Types.ObjectId(),
      version: 1,
      moduleKey: "store",
      ...base(),
    });
  }

  /** 一筆碰小金庫的流水(投庫:抽屜 → 小金庫;出庫:小金庫 → 抽屜)。 */
  async function vaultMovement(
    orgId: Types.ObjectId,
    type: "deposit" | "withdraw",
    amount: number,
    occurredAt: Date,
  ): Promise<void> {
    await connection.collection(LOTTERY_CASH_MOVEMENTS_COLLECTION).insertOne({
      orgId,
      tenantId: tenant,
      occurredAt,
      type,
      from: type === "deposit" ? "drawer" : "vault",
      to: type === "deposit" ? "vault" : "drawer",
      reason: type === "withdraw" ? "change" : null,
      cashPointId: new Types.ObjectId(),
      shiftId: new Types.ObjectId(),
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

  async function bankAccount(
    orgId: Types.ObjectId,
    accountNo: string,
    shareOrgs: { orgId: Types.ObjectId; includeDescendants: boolean }[],
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection(LOTTERY_BANK_ACCOUNTS_COLLECTION)
      .insertOne({
        orgId,
        tenantId: tenant,
        bankCode: "004",
        branchName: "中山分行",
        accountNo,
        accountName: "好運彩券行",
        label: `好運彩券行 ****${accountNo.slice(-5)}`,
        openingBalance: 0,
        openingDate: taipei("01", "00:00"),
        status: "active",
        note: null,
        shareOrgs,
        moduleKey: "accounts",
        ...base(),
      });
    return insertedId;
  }

  function dailyDraftOf(
    orgId: Types.ObjectId,
    counted: number,
    extra: Partial<DailyCloseDraft> = {},
  ): DailyCloseDraft {
    return {
      version: 1,
      type: "daily",
      orgId: String(orgId),
      stocktake: {
        mode: "skip",
        reasonKey: "short-staffed",
        reasonNote: null,
      },
      denominations: denominationsOf(counted),
      diffReasonKey: null,
      diffReasonNote: null,
      bankDeposit: { amount: 0, accountId: null },
      ...extra,
    };
  }

  function submit(who: Person, draft: DailyCloseDraft) {
    requestSequence += 1;
    return gql(who, SUBMIT, {
      input: {
        formKey: CHECKOUT_CONFIRM_FORM_KEY,
        clientRequestId: `daily-${String(requestSequence)}`,
        values: {
          [CHECKOUT_FIELD_KEYS.branch]: draft.orgId,
          [CHECKOUT_FIELD_KEYS.type]: "daily",
          [CHECKOUT_FIELD_KEYS.cashPoint]: null,
          [CHECKOUT_FIELD_KEYS.successor]: null,
          [CHECKOUT_FIELD_KEYS.leftForNext]: 0,
          [CHECKOUT_FIELD_KEYS.draft]: serializeDailyCloseDraft(draft),
        },
      },
    });
  }

  async function submitOk(who: Person, draft: DailyCloseDraft) {
    const result = await submit(who, draft);
    expect(result.errors).toBeUndefined();
    const data = result.data as {
      createAndSubmitFormSubmission: { submission: { id: string } };
    };
    return data.createAndSubmitFormSubmission.submission.id;
  }

  async function submitBlocked(who: Person, draft: DailyCloseDraft) {
    const result = await submit(who, draft);
    return result.errors?.[0]?.extensions;
  }

  async function wizard(orgId: Types.ObjectId, submissionId?: string) {
    const data = await ok<WizardData>(lead, WIZARD, {
      orgId: String(orgId),
      submissionId: submissionId ?? null,
    });
    return data.lotteryDailyCloseWizard;
  }

  function checkoutOf(submissionId: string) {
    return connection
      .collection<LotteryCheckout>(LOTTERY_CHECKOUTS_COLLECTION)
      .findOne({ submissionId: new Types.ObjectId(submissionId) });
  }

  async function vaultOf(orgId: Types.ObjectId): Promise<number> {
    const data = await ok<{
      lotteryStoreBoard: { item: { vaultExpected: number } };
    }>(manager, BOARD, { orgId: String(orgId) });
    return data.lotteryStoreBoard.item.vaultExpected;
  }

  async function storeBadge(): Promise<number> {
    const data = await ok<{
      sidebarBadges: { moduleKey: string; count: number }[];
    }>(manager, BADGES, {});
    return (
      data.sidebarBadges.find((badge) => badge.moduleKey === "store")?.count ??
      0
    );
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-daily-close");
    connection = api.connection;
    await api.app
      .get<Model<LotteryCheckout>>(getModelToken(LotteryCheckout.name))
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
        engine: "form",
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
      LOTTERY_FIELD_CATEGORY_KEYS.checkoutDiffReason,
      [
        { value: "wrong-change", label: "找錯錢" },
        { value: "other", label: "其他" },
      ],
    );
    await seedReasonCategory(
      connection,
      LOTTERY_FIELD_CATEGORY_KEYS.skipStocktakeReason,
      [
        { value: "short-staffed", label: "人力不足" },
        { value: "other", label: "其他" },
      ],
    );
    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    sharedAccount = await bankAccount(tenant, "0012345", [
      { orgId: tenant, includeDescendants: true },
    ]);

    const root = await rootToken(api);
    const admin = await person(api, connection, tenant, tenant, {
      moduleKeys: ["system", "system.workflows", "system.forms"],
      permissionKeys: ["system.workflows.*", "system.forms.*"],
    });
    const viewScope = ["store", "apply-center", "apply-center.view-page"];
    lead = await person(api, connection, tenant, tenant, {
      moduleKeys: viewScope,
      permissionKeys: [
        S.view,
        S.create,
        S.checkout,
        S.skipStocktake,
        S.stocktake,
        "apply-center.view",
      ],
    });
    manager = await person(api, connection, tenant, tenant, {
      moduleKeys: viewScope,
      permissionKeys: [...Object.values(S), "apply-center.view"],
    });
    clerk = await person(api, connection, tenant, tenant, {
      moduleKeys: ["store"],
      permissionKeys: [S.view, S.create, S.openShift],
    });
    const managerRole = await createRole(api.app, connection, {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [manager.userId],
    });

    await formOk(api, root, CREATE_FORM, {
      input: {
        key: CHECKOUT_CONFIRM_FORM_KEY,
        moduleKey: "store",
        name: "結帳確認申請",
      },
    });
    await publishDefinition(
      api,
      root,
      CHECKOUT_CONFIRM_FORM_KEY,
      definitionOf([
        field(CHECKOUT_FIELD_KEYS.branch, "text"),
        field(CHECKOUT_FIELD_KEYS.type, "select", {
          options: {
            kind: "static",
            items: [
              { value: "shift", label: "交班", order: 1, enabled: true },
              { value: "daily", label: "日結", order: 2, enabled: true },
            ],
          },
        }),
        field(CHECKOUT_FIELD_KEYS.cashPoint, "text"),
        field(CHECKOUT_FIELD_KEYS.successor, "reference", {
          source: { provider: "user", labelField: "name" },
        }),
        field(CHECKOUT_FIELD_KEYS.leftForNext, "number"),
        field(CHECKOUT_FIELD_KEYS.draft, "multiline", {
          rules: { required: true },
        }),
      ]),
      null,
    );
    await formOk(api, root, ASSIGN, {
      input: {
        formKey: CHECKOUT_CONFIRM_FORM_KEY,
        tenantOrgIds: [String(tenant)],
      },
    });
    world = { api, connection, admin } as unknown as World;
    // 兩關照開通腳本(`onboarding/form-workflows/checkout-confirm.ts`):日結跳過接班人那一關、由店長審核
    const successorStep: StepDef = reviewStep(
      "successor",
      {
        kind: "field",
        formKey: CHECKOUT_CONFIRM_FORM_KEY,
        fieldKey: CHECKOUT_FIELD_KEYS.successor,
      },
      {
        skipWhen: {
          or: [
            { "==": [{ var: CHECKOUT_FIELD_KEYS.type }, "daily"] },
            { "!": { var: CHECKOUT_FIELD_KEYS.successor } },
          ],
        },
      },
    );
    const managerStep: StepDef = reviewStep(
      "store_manager",
      roleSource(managerRole),
      {
        skipWhen: {
          and: [
            { "==": [{ var: CHECKOUT_FIELD_KEYS.type }, "shift"] },
            { "!!": { var: CHECKOUT_FIELD_KEYS.successor } },
          ],
        },
      },
    );
    await publishWorkflow(world, "checkout_flow", {
      steps: [successorStep, managerStep],
      checkFormKey: CHECKOUT_CONFIRM_FORM_KEY,
    });
    await bindForm(world, "checkout_flow", CHECKOUT_CONFIRM_FORM_KEY);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("還有班沒送出交班 → 擋下(精靈列出開著的班);涵蓋的交班有未核准 → 擋下;全部核准 → 送出、店長審核(接班人那一關跳過)、完成", async () => {
    now("14", "08:00");
    const store = await newStore("中山店");
    await closedShift(store.orgId, store.counter, taipei("13", "22:00"));
    const open = await openShift(
      store.orgId,
      store.stall,
      taipei("13", "18:00"),
    );
    const withOpen = await wizard(store.orgId);
    expect(withOpen.openShifts).toEqual([
      { cashPointName: "店外攤位", ownerName: expect.any(String) },
    ]);
    expect(await submitBlocked(lead, dailyDraftOf(store.orgId, 0))).toEqual(
      expect.objectContaining({
        code: "FORBIDDEN",
        reason: DAILY_CLOSE_REASONS.shiftsOpen,
      }),
    );

    // 店外攤位送出交班結帳,但還沒核准
    await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .deleteOne({ _id: open });
    await closedShift(
      store.orgId,
      store.stall,
      taipei("13", "23:00"),
      "pending",
      -100,
    );
    const pending = await wizard(store.orgId);
    expect(pending.openShifts).toEqual([]);
    expect(pending.shifts.map((row) => row.state)).toEqual([
      "approved",
      "pending",
    ]);
    expect(pending.differenceTotal).toBe(-100);
    expect(await submitBlocked(lead, dailyDraftOf(store.orgId, 0))).toEqual(
      expect.objectContaining({ reason: DAILY_CLOSE_REASONS.unapproved }),
    );

    // 全部核准 → 送出
    await connection
      .collection(LOTTERY_CHECKOUTS_COLLECTION)
      .updateMany(
        { orgId: store.orgId, type: "shift" },
        { $set: { status: "confirmed" } },
      );
    const id = await submitOk(lead, dailyDraftOf(store.orgId, 0));
    expect(await checkoutOf(id)).toMatchObject({
      type: "daily",
      status: "pending",
      coveredFrom: null,
      coveredTo: taipei("14", "08:00"),
      expected: 0,
      counted: 0,
    });
    const submitted = await checkoutOf(id);
    expect(submitted?.coveredShiftIds).toHaveLength(2);
    // 已有審核中的日結 → 不能再送一張;看板頂部顯示審核中
    expect(await submitBlocked(lead, dailyDraftOf(store.orgId, 0))).toEqual(
      expect.objectContaining({ reason: DAILY_CLOSE_REASONS.pendingExists }),
    );
    const status = await ok<{
      lotteryDailyCloseStatus: { pending: { status: string } | null };
    }>(manager, STATUS, { orgId: String(store.orgId) });
    expect(status.lotteryDailyCloseStatus.pending).toEqual({
      status: "pending",
    });

    await decideOn(world, manager, id, "APPROVE");
    expect(await checkoutOf(id)).toMatchObject({
      status: "confirmed",
      confirmedBy: manager.userId,
    });
    const detail = await ok<{
      lotteryCheckout: {
        type: string;
        coveredShifts: { submissionId: string }[];
        draft: string;
      };
    }>(manager, DETAIL, { submissionId: id });
    expect(detail.lotteryCheckout.type).toBe("daily");
    expect(detail.lotteryCheckout.coveredShifts).toHaveLength(2);
    expect(JSON.parse(detail.lotteryCheckout.draft)).toMatchObject({
      type: "daily",
      bankDeposit: { amount: 0, accountId: null },
    });
  });

  it("涵蓋計算期間:10/14 09:02 日結後再開的班算下一次日結;10/14、10/15 沒日結時期間顯示正確;已被涵蓋的上一班 → 下一班是第一班", async () => {
    const store = await newStore("信義店");
    const before = await closedShift(
      store.orgId,
      store.counter,
      taipei("14", "08:30"),
    );
    await pastDaily(store.orgId, taipei("14", "09:02"), 20_000);
    const after = await closedShift(
      store.orgId,
      store.stall,
      taipei("14", "14:02"),
    );

    now("16", "10:00");
    const view = await wizard(store.orgId);
    expect(view.coveredFrom).toBe(taipei("14", "09:02").toISOString());
    expect(view.gapDates).toEqual(["2026-10-14", "2026-10-15"]);
    expect(view.shifts.map((row) => row.shiftId)).toEqual([String(after)]);
    expect(view.shifts.map((row) => row.shiftId)).not.toContain(String(before));
    const status = await ok<{
      lotteryDailyCloseStatus: { lastClosedAt: string; daysSince: number };
    }>(manager, STATUS, { orgId: String(store.orgId) });
    expect(status.lotteryDailyCloseStatus).toMatchObject({
      lastClosedAt: taipei("14", "09:02").toISOString(),
      daysSince: 2,
    });

    // 店內櫃台的上一班(08:30)已被 09:02 的日結涵蓋 → 開班是第一班;店外攤位的上一班還沒 → 照交接
    const planOf = async (cashPointId: Types.ObjectId) => {
      const data = await ok<{
        lotteryStoreOpenShiftForm: { item: { plan: string } };
      }>(manager, OPEN_FORM, { cashPointId: String(cashPointId) });
      return data.lotteryStoreOpenShiftForm.item.plan;
    };
    expect(await planOf(store.counter)).toBe("first");
    expect(await planOf(store.stall)).toBe("handover");

    // 小金庫:上次日結清點 20,000 起算
    const id = await submitOk(lead, dailyDraftOf(store.orgId, 20_000));
    expect(await checkoutOf(id)).toMatchObject({
      coveredFrom: taipei("14", "09:02"),
      coveredTo: taipei("16", "10:00"),
      coveredShiftIds: [after],
      expected: 20_000,
    });
    await decideOn(world, manager, id, "APPROVE");
    expect(await planOf(store.stall)).toBe("first");

    // 送出後再送出交班結帳的班 → 下一次日結
    const later = await closedShift(
      store.orgId,
      store.counter,
      taipei("16", "11:00"),
    );
    now("16", "12:00");
    const next = await wizard(store.orgId);
    expect(next.coveredFrom).toBe(taipei("16", "10:00").toISOString());
    expect(next.gapDates).toEqual([]);
    expect(next.shifts.map((row) => row.shiftId)).toEqual([String(later)]);
  });

  it("日結完成後小金庫應有 = 清點金額 + 之後流水;存入銀行寫銀行「存入」+「存銀行」流水;差額要原因、存入超過實點擋下", async () => {
    const store = await newStore("大安店");
    await vaultMovement(store.orgId, "deposit", 12_000, taipei("14", "10:00"));
    await vaultMovement(store.orgId, "withdraw", 3000, taipei("14", "11:00"));
    now("14", "22:00");
    const view = await wizard(store.orgId);
    expect(view.vaultExpected).toBe(9000);
    expect(
      view.vaultItems.map((item) => [item.kind, item.count, item.amount]),
    ).toEqual([
      ["opening", 0, 0],
      ["deposits", 1, 12_000],
      ["withdrawals", 1, -3000],
      ["transfers", 0, 0],
      ["corrections", 0, 0],
      ["bank_deposits", 0, 0],
    ]);
    expect(view.bankAccounts.map((account) => account.id)).toEqual([
      String(sharedAccount),
    ]);

    // 實點 8,900 ≠ 應有 9,000 沒原因 → 擋下;存入 10,000 > 實點 → 擋下
    expect(await submitBlocked(lead, dailyDraftOf(store.orgId, 8900))).toEqual(
      expect.objectContaining({ reason: CHECKOUT_REASONS.reasonRequired }),
    );
    expect(
      await submitBlocked(
        lead,
        dailyDraftOf(store.orgId, 9000, {
          bankDeposit: { amount: 10_000, accountId: String(sharedAccount) },
        }),
      ),
    ).toEqual(
      expect.objectContaining({ reason: DAILY_CLOSE_REASONS.depositInvalid }),
    );
    expect(
      await submitBlocked(
        lead,
        dailyDraftOf(store.orgId, 9000, {
          bankDeposit: { amount: 5000, accountId: null },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        reason: DAILY_CLOSE_REASONS.accountNotUsable,
      }),
    );

    const id = await submitOk(
      lead,
      dailyDraftOf(store.orgId, 8900, {
        diffReasonKey: "wrong-change",
        bankDeposit: { amount: 5000, accountId: String(sharedAccount) },
      }),
    );
    expect(await checkoutOf(id)).toMatchObject({
      expected: 9000,
      counted: 8900,
      difference: -100,
      diffReason: "找錯錢",
      bankDepositAmount: 5000,
    });
    // 送出時還沒寫銀行(完成時才寫);送出之後的流水照常算
    expect(
      await connection
        .collection(LOTTERY_BANK_TRANSACTIONS_COLLECTION)
        .countDocuments({ refId: new Types.ObjectId(id) }),
    ).toBe(0);
    now("14", "22:30");
    await vaultMovement(store.orgId, "deposit", 1000, taipei("14", "22:10"));

    now("15", "09:00");
    await decideOn(world, manager, id, "APPROVE");
    const record = await checkoutOf(id);
    const transaction = await connection
      .collection(LOTTERY_BANK_TRANSACTIONS_COLLECTION)
      .findOne({ _id: record?.bankTransactionId ?? undefined });
    expect(transaction).toMatchObject({
      type: "deposit",
      direction: "in",
      amount: 5000,
      branchOrgId: store.orgId,
      accountId: sharedAccount,
    });
    expect(
      await connection
        .collection(LOTTERY_CASH_MOVEMENTS_COLLECTION)
        .findOne({ _id: record?.bankMovementId ?? undefined }),
    ).toMatchObject({
      type: "bank_deposit",
      from: "vault",
      to: "bank",
      amount: 5000,
      bankTransactionId: transaction?._id,
    });
    // 清點 8,900 起算(送出時間 22:00)+ 22:10 投庫 1,000 − 完成時存銀行 5,000
    expect(await vaultOf(store.orgId)).toBe(4900);
    const next = await wizard(store.orgId);
    expect(
      next.vaultItems
        .filter((item) => item.amount !== 0)
        .map((item) => [item.kind, item.amount]),
    ).toEqual([
      ["opening", 8900],
      ["deposits", 1000],
      ["bank_deposits", -5000],
    ]);
  });

  it("[存銀行]:金額 > 小金庫應有 → 擋下;成功寫流水 + 銀行存入(歸屬分店 = 這家店);這家店沒有可用帳戶 → ST-26b 錯誤;沒有權限 → 擋下", async () => {
    now("17", "10:00");
    const store = await newStore("松山店");
    await vaultMovement(store.orgId, "deposit", 3000, taipei("17", "09:00"));
    const form = await ok<{
      lotteryBankDepositForm: {
        vaultExpected: number;
        accounts: { id: string }[];
      };
    }>(manager, DEPOSIT_FORM, { orgId: String(store.orgId) });
    expect(form.lotteryBankDepositForm).toEqual({
      vaultExpected: 3000,
      accounts: [{ id: String(sharedAccount), name: expect.any(String) }],
    });
    const deposit = (amount: number, accountId = String(sharedAccount)) =>
      gql(manager, DEPOSIT, {
        input: { orgId: String(store.orgId), amount, accountId },
      });
    const tooMuch = await deposit(5000);
    expect(tooMuch.errors?.[0]?.extensions).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "AMOUNT_EXCEEDS_VAULT",
    });
    const done = await deposit(2000);
    expect(done.errors).toBeUndefined();
    const payload = (
      done.data as {
        depositLotteryVaultToBank: {
          vaultExpected: number;
          transactionId: string;
          movementId: string;
        };
      }
    ).depositLotteryVaultToBank;
    expect(payload.vaultExpected).toBe(1000);
    expect(
      await connection
        .collection(LOTTERY_BANK_TRANSACTIONS_COLLECTION)
        .findOne({ _id: new Types.ObjectId(payload.transactionId) }),
    ).toMatchObject({
      type: "deposit",
      amount: 2000,
      branchOrgId: store.orgId,
    });
    expect(
      await connection
        .collection(LOTTERY_CASH_MOVEMENTS_COLLECTION)
        .findOne({ _id: new Types.ObjectId(payload.movementId) }),
    ).toMatchObject({
      type: "bank_deposit",
      orgId: store.orgId,
      bankTransactionId: new Types.ObjectId(payload.transactionId),
    });

    // 只有別家店的帳戶 → 沒有可用帳戶
    const other = await newStore("南港店");
    const lonely = await newStore("內湖店");
    await vaultMovement(lonely.orgId, "deposit", 3000, taipei("17", "09:00"));
    const otherAccount = await bankAccount(other.orgId, "0099999", []);
    // 這家店看得到的帳戶只有共用的那一個;把它停用模擬「本店沒有銀行帳戶」
    await connection
      .collection(LOTTERY_BANK_ACCOUNTS_COLLECTION)
      .updateOne({ _id: sharedAccount }, { $set: { status: "inactive" } });
    try {
      const empty = await ok<{
        lotteryBankDepositForm: { accounts: unknown[] };
      }>(manager, DEPOSIT_FORM, { orgId: String(lonely.orgId) });
      expect(empty.lotteryBankDepositForm.accounts).toEqual([]);
      expect(
        await errorOf(manager, DEPOSIT, {
          input: {
            orgId: String(lonely.orgId),
            amount: 1000,
            accountId: String(otherAccount),
          },
        }),
      ).toMatchObject({ reason: DAILY_CLOSE_REASONS.noBankAccount });
    } finally {
      await connection
        .collection(LOTTERY_BANK_ACCOUNTS_COLLECTION)
        .updateOne({ _id: sharedAccount }, { $set: { status: "active" } });
    }

    // 沒有 `store.bank-deposit` / `store.checkout`
    expect(
      await errorOf(clerk, DEPOSIT_FORM, { orgId: String(store.orgId) }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await errorOf(clerk, WIZARD, { orgId: String(store.orgId) }),
    ).toMatchObject({ code: "FORBIDDEN" });
  });

  it("日結逾期:注入時鐘,送出日隔天 09:00 之後有沒被涵蓋的班 → 店長收到提醒(一天一則)、側欄計數 +1;日結後不再寄", async () => {
    now("21", "09:30");
    const baseline = await storeBadge();
    const store = await newStore("士林店");
    await closedShift(store.orgId, store.counter, taipei("20", "22:10"));
    await closedShift(store.orgId, store.stall, taipei("21", "08:00"));
    expect(await storeBadge()).toBe(baseline + 1);
    now("21", "08:45");
    const early = await storeBadge();

    const calls: NotifyInput[] = [];
    jest
      .spyOn(api.app.get(NotificationService), "notify")
      .mockImplementation((input: NotifyInput) => {
        calls.push(input);
        return Promise.resolve();
      });
    const runAt = async (day: string, time: string) => {
      calls.length = 0;
      await api.app.get(DailyCloseRemindersService).run({
        key: DAILY_CLOSE_OVERDUE_JOB_KEY,
        scheduledFor: taipei(day, time),
        tenants: [{ tenantId: tenant, timezone: "Asia/Taipei" }],
      });
      return calls.filter((call) => String(call.orgId) === String(store.orgId));
    };
    expect(await runAt("21", "08:45")).toEqual([]);
    const first = await runAt("21", "09:00");
    expect(first).toEqual([
      expect.objectContaining({
        type: "lottery.daily-close-overdue",
        tenantId: tenant,
        params: { orgName: "士林店", since: "2026-10-20" },
      }),
    ]);
    const again = await runAt("21", "09:15");
    expect(again[0]?.dedupeKey).toBe(first[0]?.dedupeKey);
    const nextDay = await runAt("22", "09:00");
    expect(nextDay).toHaveLength(1);
    expect(nextDay[0]?.dedupeKey).not.toBe(first[0]?.dedupeKey);

    // 送出日隔天 09:00 前不算(這家店 08:45 不算逾期)
    now("21", "09:30");
    expect(early).toBe(baseline);

    // 日結涵蓋兩班 → 不再寄、側欄計數回去
    await pastDaily(store.orgId, taipei("21", "09:20"), 0);
    expect(await runAt("22", "09:00")).toEqual([]);
    expect(await storeBadge()).toBe(baseline);
  });
});
