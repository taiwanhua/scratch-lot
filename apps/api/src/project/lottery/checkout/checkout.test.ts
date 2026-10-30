import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import {
  CHECKOUT_CONFIRM_FORM_KEY,
  CHECKOUT_FIELD_KEYS,
  CHECKOUT_REASONS,
  type CheckoutDraft,
  STORE_PERMISSIONS as S,
  type StocktakeDraft,
  serializeCheckoutDraft,
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
import { createRole } from "../../../permission/test-support/fixtures";
import {
  DECIDE,
  type Person,
  SUBMIT_SUBMISSION,
  VOID,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  bindForm,
  decideOn,
  pendingTaskOf,
  person,
  publishWorkflow,
  reviewStep,
  roleSource,
} from "../../../workflows/test-support/workflow-fixtures";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import {
  LOTTERY_CHECKOUTS_COLLECTION,
  LotteryCheckout,
} from "../../database/lottery-checkouts/lottery-checkout.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import { LOTTERY_STOCKTAKES_COLLECTION } from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import { LOTTERY_SHIFTS_COLLECTION } from "../../database/lottery-store/lottery-shift.schema";
import { drawerCashSourceNames } from "../store/drawer-cash";
import { StoreClock } from "../store/store-clock";
import { seedReasonCategory } from "../test-support/master-data-fixtures";
import { EXPECTED_CASH_SOURCE_NAMES } from "./expected-cash";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const byName = (a: string, b: string) => a.localeCompare(b, "zh-Hant");

// ---- GraphQL ----

const WIZARD = /* GraphQL */ `
  query Wizard($shiftId: ID!) {
    lotteryCheckoutWizard(shiftId: $shiftId) {
      shift {
        id
        cashPoint {
          name
        }
        openedBy {
          name
        }
        closed
      }
      canSubmit
      canSkipStocktake
      reusableStocktake {
        submissionId
        scopeName
      }
      redemptions {
        ticketLabel
        prizeAmount
      }
      redemptionTotal
      expectedItems {
        kind
        count
        amount
        entries {
          refType
          label
          amount
        }
      }
      expected
      pendingImpacts {
        formKey
        amount
      }
      successorOptions {
        id
        name
      }
    }
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
          }
        }
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
        editVersion
      }
    }
  }
`;

const OPEN = /* GraphQL */ `
  mutation Open($input: OpenLotteryShiftInput!) {
    openLotteryShift(input: $input) {
      item {
        id
        openingFloat
      }
    }
  }
`;

const OPEN_FORM = /* GraphQL */ `
  query OpenForm($cashPointId: ID!) {
    lotteryStoreOpenShiftForm(cashPointId: $cashPointId) {
      item {
        plan
        handoverAmount
      }
    }
  }
`;

const SELL = /* GraphQL */ `
  mutation Sell($input: SellLotteryTicketsInput!) {
    sellLotteryTickets(input: $input) {
      items {
        ticketId
      }
    }
  }
`;

const LIST = /* GraphQL */ `
  query List($input: LotteryCheckoutsInput!) {
    lotteryCheckouts(input: $input) {
      total
      items {
        submissionId
        serialNo
        type
        status
        submissionStatus
        cashPoint {
          name
        }
        submittedBy {
          name
        }
        expected
        counted
        difference
      }
    }
  }
`;

const DETAIL = /* GraphQL */ `
  query Detail($submissionId: ID!) {
    lotteryCheckout(submissionId: $submissionId) {
      status
      cashPointPrinterId
      shiftOpenedAt
      shiftClosedAt
      stocktakeMode
      stocktake {
        submissionId
      }
      skipReason
      expected
      counted
      difference
      diffReason
      leftForNext
      successor {
        name
      }
      submittedBy {
        name
      }
      draft
    }
  }
`;

interface WizardData {
  lotteryCheckoutWizard: {
    shift: {
      id: string;
      cashPoint: { name: string };
      openedBy: { name: string };
      closed: boolean;
    };
    canSubmit: boolean;
    canSkipStocktake: boolean;
    reusableStocktake: {
      submissionId: string;
      scopeName: string | null;
    } | null;
    redemptions: { ticketLabel: string; prizeAmount: number }[];
    redemptionTotal: number;
    expectedItems: {
      kind: string;
      count: number;
      amount: number;
      entries: { refType: string; label: string; amount: number }[];
    }[];
    expected: number;
    pendingImpacts: { formKey: string; amount: number }[];
    successorOptions: { id: string; name: string }[];
  };
}

interface InstanceDoc {
  submissionId: Types.ObjectId;
  steps: { stepKey: string; status: string }[];
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

function now(time: string): void {
  jest.spyOn(StoreClock.prototype, "now").mockReturnValue(taipei(time));
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
 * 交班結帳與結帳確認申請(規格 6.9、8.7、6.6、6.0;票面 P26 的驗收條件):打真的 GraphQL 端點、
 * 真的表單引擎 + 兩關流程(接班人 / 店長,照開通腳本的定義)+ 掛接點,對真 MongoDB(TEST-07);
 * 「現在」由 `StoreClock` 注入。每張 200 元。
 *
 * 組織樹:root ─ 租戶甲 ─ 信義店(店內櫃台、店外攤位)
 */
describe("交班結帳(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let world: World;
  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let counter: Types.ObjectId;
  let stall: Types.ObjectId;
  let gameId: Types.ObjectId;

  /** 王小明:店員(負責人) */
  let clerkA: Person;
  /** 李小華:店員(接班人) */
  let clerkB: Person;
  /** 店長(`store.edit`,角色「店長」) */
  let manager: Person;
  /** 只有看板 */
  let viewer: Person;
  /** 租戶頂層的人(不是信義店的成員) */
  let outsider: Person;

  let bookSequence = 80_000;
  let requestSequence = 0;

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

  async function openShift(
    cashPointId: Types.ObjectId,
    openedBy: Types.ObjectId,
    openingFloat: number,
    overrides: Record<string, unknown> = {},
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        cashPointId,
        openedBy,
        openedAt: taipei("08:00"),
        openingFloat,
        openingFloatSource: "handover",
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
        ...overrides,
      });
    return insertedId;
  }

  async function movement(
    shiftId: Types.ObjectId,
    cashPointId: Types.ObjectId,
    type: string,
    from: string,
    to: string,
    amount: number,
    extra: Record<string, unknown> = {},
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection("lottery_cash_movements")
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        occurredAt: taipei("10:00"),
        type,
        from,
        to,
        reason: type === "withdraw" ? "change" : null,
        cashPointId,
        shiftId,
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
        ...extra,
      });
    return insertedId;
  }

  async function redemption(
    shiftId: Types.ObjectId,
    cashPointId: Types.ObjectId,
    ticketNo: string,
    prizeAmount: number,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await connection.collection("lottery_redemptions").insertOne({
      orgId: xinyi,
      tenantId: tenant,
      shiftId,
      cashPointId,
      redeemedAt: taipei("09:15"),
      redeemedBy: clerkA.userId,
      gameCode: "5164",
      bookNo: "0056527",
      ticketNo,
      ticketLabel: `5164-056527-${ticketNo}`,
      rawInput: `5164-1-056527-${ticketNo}-0-6`,
      ticketId: null,
      gameId,
      prizeAmount,
      status: "in_store",
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
      ...base(),
      ...extra,
    });
  }

  /** 一本 20 張拆在 `cashPointId` 檯面(未售)。 */
  async function counterBook(cashPointId: Types.ObjectId) {
    bookSequence += 1;
    const bookNo = String(bookSequence).padStart(7, "0");
    const { insertedId: bookId } = await connection
      .collection("lottery_books")
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        gameId,
        gameCode: "5164",
        bookNo,
        bookKey: `5164-${bookNo}`,
        printVersion: "1",
        holderOrgIds: [xinyi],
        purchaseSubmissionId: null,
        purchasedAt: null,
        purchaseDealerId: null,
        rate: 92,
        cost: 3680,
        standardTickets: 20,
        firstTicketNo: "001",
        lastTicketNo: "020",
        skippedTicketNos: [],
        lockedTicketCount: 0,
        status: "normal",
        shareOrgs: [],
        moduleKey: "inventory",
        ...base(),
      });
    await connection.collection(LOTTERY_TICKETS_COLLECTION).insertMany(
      Array.from({ length: 20 }, (_, index) => {
        const ticketNo = String(index + 1).padStart(3, "0");
        return {
          orgId: xinyi,
          tenantId: tenant,
          bookId,
          gameId,
          bookNo,
          ticketNo,
          ticketKey: `5164-${bookNo}-${ticketNo}`,
          status: "unsold",
          location: { kind: "counter", cashPointId },
          lockedBy: null,
          responsibleOrgId: null,
          unitCost: 184,
          soldAt: null,
          soldBy: null,
          soldSource: null,
          version: 1,
          moduleKey: "inventory",
          ...base(),
        };
      }),
    );
    return { bookId, bookNo };
  }

  async function sell(
    who: Person,
    cashPointId: Types.ObjectId,
    bookId: Types.ObjectId,
    ticketNos: readonly string[],
  ): Promise<void> {
    const tickets = await connection
      .collection<{ _id: Types.ObjectId; version: number; ticketNo: string }>(
        LOTTERY_TICKETS_COLLECTION,
      )
      .find({ bookId, ticketNo: { $in: [...ticketNos] } })
      .toArray();
    await ok(who, SELL, {
      input: {
        orgId: String(xinyi),
        localCashPointId: String(cashPointId),
        tickets: tickets.map((ticket) => ({
          ticketId: String(ticket._id),
          version: ticket.version,
        })),
        source: "scan",
      },
    });
  }

  function stocktakeDraftOf(
    cashPointId: Types.ObjectId,
    lines: StocktakeDraft["lines"] = [],
  ): StocktakeDraft {
    return {
      version: 1,
      orgId: String(xinyi),
      scopeCashPointId: String(cashPointId),
      startedAt: taipei("21:30").toISOString(),
      lines,
      unopened: [],
      lostReview: [],
    };
  }

  function draftOf(
    shiftId: Types.ObjectId,
    cashPointId: Types.ObjectId,
    counted: number,
    extra: Partial<CheckoutDraft> = {},
  ): CheckoutDraft {
    return {
      version: 1,
      type: "shift",
      orgId: String(xinyi),
      shiftId: String(shiftId),
      cashPointId: String(cashPointId),
      stocktake: { mode: "new", draft: stocktakeDraftOf(cashPointId) },
      denominations: denominationsOf(counted),
      diffReasonKey: null,
      diffReasonNote: null,
      leftForNext: 0,
      successorId: null,
      ...extra,
    };
  }

  function valuesOf(draft: CheckoutDraft, successorName = "李小華") {
    return {
      [CHECKOUT_FIELD_KEYS.branch]: String(xinyi),
      [CHECKOUT_FIELD_KEYS.type]: "shift",
      [CHECKOUT_FIELD_KEYS.cashPoint]: "店內櫃台",
      [CHECKOUT_FIELD_KEYS.successor]:
        draft.successorId === null
          ? null
          : { id: draft.successorId, label: successorName },
      [CHECKOUT_FIELD_KEYS.leftForNext]: draft.leftForNext,
      [CHECKOUT_FIELD_KEYS.draft]: serializeCheckoutDraft(draft),
    };
  }

  function submit(who: Person, draft: CheckoutDraft): Promise<GraphqlResult> {
    requestSequence += 1;
    return gql(who, SUBMIT, {
      input: {
        formKey: CHECKOUT_CONFIRM_FORM_KEY,
        clientRequestId: `checkout-${String(requestSequence)}`,
        values: valuesOf(draft),
      },
    });
  }

  async function submitOk(who: Person, draft: CheckoutDraft) {
    const result = await submit(who, draft);
    expect(result.errors).toBeUndefined();
    const data = result.data as {
      createAndSubmitFormSubmission: {
        submission: { id: string; status: string; editVersion: number };
      };
    };
    return data.createAndSubmitFormSubmission.submission;
  }

  async function submitBlocked(who: Person, draft: CheckoutDraft) {
    const result = await submit(who, draft);
    return result.errors?.[0]?.extensions;
  }

  async function wizard(who: Person, shiftId: Types.ObjectId) {
    const data = await ok<WizardData>(who, WIZARD, {
      shiftId: String(shiftId),
    });
    return data.lotteryCheckoutWizard;
  }

  async function editVersionOf(submissionId: string): Promise<number> {
    const raw = await connection
      .collection<{ editVersion: number }>("form_submissions")
      .findOne({ _id: new Types.ObjectId(submissionId) });
    return raw?.editVersion ?? 0;
  }

  function checkoutOf(submissionId: string) {
    return connection
      .collection<LotteryCheckout>(LOTTERY_CHECKOUTS_COLLECTION)
      .findOne({ submissionId: new Types.ObjectId(submissionId) });
  }

  function shiftOf(id: Types.ObjectId) {
    return connection
      .collection<{
        openedAt: Date;
        closedAt: Date | null;
        checkoutId: Types.ObjectId | null;
        openingFloat: number;
      }>(LOTTERY_SHIFTS_COLLECTION)
      .findOne({ _id: id });
  }

  async function stepsOf(submissionId: string) {
    const instance = await connection
      .collection<InstanceDoc>("workflow_instances")
      .find({ submissionId: new Types.ObjectId(submissionId) })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    return Object.fromEntries(
      (instance?.steps ?? []).map((step) => [step.stepKey, step.status]),
    );
  }

  async function expectedOfBoard(shiftId: Types.ObjectId): Promise<number> {
    const data = await ok<{
      lotteryStoreBoard: {
        item: {
          cashPoints: { shift: { id: string; expectedCash: number } | null }[];
        };
      };
    }>(clerkA, BOARD, { orgId: String(xinyi) });
    return (
      data.lotteryStoreBoard.item.cashPoints.find(
        (point) => point.shift?.id === String(shiftId),
      )?.shift?.expectedCash ?? -1
    );
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-checkout");
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
    xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
    const points = connection.collection(LOTTERY_CASH_POINTS_COLLECTION);
    ({ insertedId: counter } = await points.insertOne({
      orgId: xinyi,
      tenantId: tenant,
      positionKey: "position-1",
      name: "店內櫃台",
      order: 1,
      enabled: true,
      printerId: null,
      note: null,
      moduleKey: "master-data",
      ...base(),
    }));
    ({ insertedId: stall } = await points.insertOne({
      orgId: xinyi,
      tenantId: tenant,
      positionKey: "position-2",
      name: "店外攤位",
      order: 2,
      enabled: true,
      printerId: null,
      note: null,
      moduleKey: "master-data",
      ...base(),
    }));
    ({ insertedId: gameId } = await connection
      .collection("lottery_games")
      .insertOne({
        gameCode: "5164",
        name: "發大財",
        status: "on_sale",
        unitPrice: 200,
        ticketsPerBook: 20,
        bookPrice: 4000,
        defaultRate: 92,
        color: null,
        orgId: tenant,
        tenantId: tenant,
        shareOrgs: [{ orgId: tenant, includeDescendants: true }],
        moduleKey: "master-data",
        ...base(),
      }));

    const root = await rootToken(api);
    const admin = await person(api, connection, tenant, tenant, {
      moduleKeys: ["system", "system.workflows", "system.forms"],
      permissionKeys: ["system.workflows.*", "system.forms.*"],
    });
    const clerkScope = {
      moduleKeys: ["store", "apply-center", "apply-center.view-page"],
      permissionKeys: [
        S.view,
        S.create,
        S.sell,
        S.stocktake,
        S.checkout,
        S.openShift,
        "apply-center.view",
      ],
    };
    clerkA = await person(api, connection, xinyi, tenant, clerkScope);
    clerkB = await person(api, connection, xinyi, tenant, clerkScope);
    manager = await person(api, connection, xinyi, tenant, {
      ...clerkScope,
      permissionKeys: [...clerkScope.permissionKeys, S.edit, S.skipStocktake],
    });
    viewer = await person(api, connection, xinyi, tenant, {
      moduleKeys: ["store"],
      permissionKeys: [S.view],
    });
    outsider = await person(api, connection, tenant, tenant, {
      moduleKeys: ["store"],
      permissionKeys: [S.view],
    });
    const managerRole = await createRole(api.app, connection, {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [manager.userId],
    });
    await connection
      .collection("users")
      .updateOne({ _id: clerkA.userId }, { $set: { name: "王小明" } });
    await connection
      .collection("users")
      .updateOne({ _id: clerkB.userId }, { $set: { name: "李小華" } });

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
    // 兩關照開通腳本(`onboarding/form-workflows/checkout-confirm.ts`):接班人確認(日結或沒有接班人跳過)、
    // 店長審核(交班且有接班人跳過)
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

  it("守門:抽屜應有登記的來源 = 應有現金逐項涵蓋的來源(新登記來源沒同步分項就紅)", () => {
    expect(drawerCashSourceNames().toSorted(byName)).toEqual(
      EXPECTED_CASH_SOURCE_NAMES.toSorted(byName),
    );
  });

  it("應有現金公式(規格 6.9)每一項各一筆:期初 + 銷售 − 兌獎 − 投庫 + 出庫 − 調貨支出 + 調貨收入 − 退貨退款 ± 現金更正;只算已完成、不含事後更正;與看板的應有相等", async () => {
    now("12:00");
    const shiftId = await openShift(counter, clerkA.userId, 3000);
    const { bookId } = await counterBook(counter);
    await sell(clerkA, counter, bookId, ["001", "002"]);
    await redemption(shiftId, counter, "031", 200);
    // 班開著時撤銷的兌獎不算;交班後才撤銷的仍算(事後更正另計)
    await redemption(shiftId, counter, "032", 500, {
      status: "revoked",
      revokedAt: taipei("11:00"),
    });
    await movement(shiftId, counter, "deposit", "drawer", "vault", 500);
    await movement(shiftId, counter, "withdraw", "vault", "drawer", 300);
    await movement(shiftId, counter, "transfer_out", "drawer", "external", 100);
    await movement(shiftId, counter, "transfer_in", "external", "drawer", 150);
    await movement(shiftId, counter, "refund", "drawer", "external", 200);
    await movement(
      shiftId,
      counter,
      "correction_increase",
      "external",
      "drawer",
      50,
    );
    await movement(
      shiftId,
      counter,
      "correction_decrease",
      "drawer",
      "external",
      20,
    );
    // 事後更正(指向這一班)不算結帳時的應有
    await movement(
      shiftId,
      counter,
      "correction_increase",
      "external",
      "drawer",
      999,
      {
        postCloseOf: shiftId,
      },
    );

    const data = await wizard(clerkA, shiftId);
    expect(data.shift).toMatchObject({
      cashPoint: { name: "店內櫃台" },
      openedBy: { name: "王小明" },
      closed: false,
    });
    expect(data.canSubmit).toBe(true);
    expect(data.canSkipStocktake).toBe(false);
    const byKind = Object.fromEntries(
      data.expectedItems.map((item) => [item.kind, item]),
    );
    expect(byKind.opening).toMatchObject({ amount: 3000 });
    expect(byKind.sales).toMatchObject({ count: 2, amount: 400 });
    expect(byKind.redemptions).toMatchObject({ count: 1, amount: -200 });
    expect(byKind.deposits).toMatchObject({ count: 1, amount: -500 });
    expect(byKind.withdrawals).toMatchObject({ count: 1, amount: 300 });
    expect(byKind.transfer_out).toMatchObject({ count: 1, amount: -100 });
    expect(byKind.transfer_in).toMatchObject({ count: 1, amount: 150 });
    expect(byKind.refunds).toMatchObject({ count: 1, amount: -200 });
    expect(byKind.corrections).toMatchObject({ count: 2, amount: 30 });
    expect(data.expected).toBe(2880);
    expect(await expectedOfBoard(shiftId)).toBe(2880);
    // 第 ② 步:這一班有效的兌獎
    expect(data.redemptions).toEqual([
      { ticketLabel: "5164-056527-031", prizeAmount: 200 },
    ]);
    expect(data.redemptionTotal).toBe(200);
    // 接班人候選:這家店的人,不含自己
    expect(data.successorOptions.map((option) => option.name)).toContain(
      "李小華",
    );
    expect(data.successorOptions.map((option) => option.id)).not.toContain(
      String(clerkA.userId),
    );
    // 精靈只讀:看過不留任何資料
    expect(
      await connection
        .collection(LOTTERY_CHECKOUTS_COLLECTION)
        .countDocuments(),
    ).toBe(0);

    // 沒有 store.checkout → 看不到精靈
    expect(
      await errorOf(viewer, WIZARD, { shiftId: String(shiftId) }),
    ).toMatchObject({ code: "FORBIDDEN" });
    // 別人的班、不是店長 → 不能送出;店長可以
    const asSuccessor = await wizard(clerkB, shiftId);
    expect(asSuccessor.canSubmit).toBe(false);
    const asManager = await wizard(manager, shiftId);
    expect(asManager.canSubmit).toBe(true);
    // 店長代結:這一班的負責人也不在接班人候選裡(接班人 = 下一班的人)
    expect(asManager.successorOptions.map((option) => option.id)).not.toContain(
      String(clerkA.userId),
    );
    expect(
      await submitBlocked(clerkB, draftOf(shiftId, counter, 2880)),
    ).toMatchObject({ code: "FORBIDDEN", reason: CHECKOUT_REASONS.forbidden });
    // 接班人不能是申請人、不能是這一班的負責人、不能是別家店的人
    const handoverTo = (who: Person) =>
      draftOf(shiftId, counter, 2880, {
        leftForNext: 1000,
        successorId: String(who.userId),
      });
    expect(await submitBlocked(clerkA, handoverTo(clerkA))).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.successorSelf,
    });
    expect(await submitBlocked(manager, handoverTo(clerkA))).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.successorSelf,
    });
    // 別家店的人:使用者參照欄位先擋(不在操作者可見範圍 → VALIDATION_FAILED);`CHECKOUT_SUCCESSOR_INVALID` 是第二道
    expect(await submitBlocked(clerkA, handoverTo(outsider))).toMatchObject({
      code: "VALIDATION_FAILED",
    });
    // 留給下一班不能超過實點
    expect(
      await submitBlocked(
        clerkA,
        draftOf(shiftId, counter, 2880, {
          leftForNext: 2881,
          successorId: String(clerkB.userId),
        }),
      ),
    ).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.leftExceedsCounted,
    });
    // 這一題不送出:直接結束這一班,讓後面的題目能在同一個收銀點開班
    await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .updateOne({ _id: shiftId }, { $set: { closedAt: taipei("12:30") } });
  });

  it("留給下一班 > 0 沒接班人 → 擋下;差額不為 0 沒原因 → 擋下;沒有接班人(0)→ 接班人那一關跳過、由店長審核;駁回、作廢一律擋下", async () => {
    now("13:00");
    const shiftId = await openShift(stall, clerkA.userId, 2000);
    expect(
      await submitBlocked(
        clerkA,
        draftOf(shiftId, stall, 2000, { leftForNext: 500 }),
      ),
    ).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.leftMustBeZero,
    });
    expect(
      await submitBlocked(clerkA, draftOf(shiftId, stall, 1950)),
    ).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.reasonRequired,
    });
    // 跳過盤點要 store.skip-stocktake
    expect(
      await submitBlocked(
        clerkA,
        draftOf(shiftId, stall, 2000, {
          stocktake: {
            mode: "skip",
            reasonKey: "short-staffed",
            reasonNote: null,
          },
        }),
      ),
    ).toMatchObject({ code: "FORBIDDEN", reason: CHECKOUT_REASONS.forbidden });

    const submitted = await submitOk(
      clerkA,
      draftOf(shiftId, stall, 1950, { diffReasonKey: "wrong-change" }),
    );
    expect(await stepsOf(submitted.id)).toMatchObject({
      successor: "skipped",
      store_manager: "active",
    });
    expect(await checkoutOf(submitted.id)).toMatchObject({
      status: "pending",
      expected: 2000,
      counted: 1950,
      difference: -50,
      diffReason: "找錯錢",
      leftForNext: 0,
      successorId: null,
      stocktakeMode: "new",
    });
    // 這一班結束;盤點單(交班)在同一個交易建立
    expect(await shiftOf(shiftId)).toMatchObject({
      closedAt: taipei("13:00"),
    });
    expect(
      await connection
        .collection(LOTTERY_STOCKTAKES_COLLECTION)
        .findOne({ submissionId: new Types.ObjectId(submitted.id) }),
    ).toMatchObject({ type: "shift", status: "pending" });
    // 送出後這一班已有審核中的結帳 → 再送擋下
    expect(
      await submitBlocked(clerkA, draftOf(shiftId, stall, 2000)),
    ).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.pendingExists,
    });

    // 駁回一律擋下
    const task = await pendingTaskOf(world, manager, submitted.id);
    const rejected = await gql(manager, DECIDE, {
      input: {
        taskId: task.id,
        expectedEditVersion: task.editVersion,
        decision: "REJECT",
        comment: "理由",
      },
    });
    expect(rejected.errors?.[0]?.extensions).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.rejectForbidden,
    });
    // 作廢一律擋下(完成後也一樣)
    await decideOn(world, manager, submitted.id, "APPROVE");
    expect(await checkoutOf(submitted.id)).toMatchObject({
      status: "confirmed",
      confirmedBy: manager.userId,
    });
    expect(
      await connection
        .collection(LOTTERY_STOCKTAKES_COLLECTION)
        .findOne({ submissionId: new Types.ObjectId(submitted.id) }),
    ).toMatchObject({ status: "confirmed" });
    // 核准完成後這一班已結束,不能再送交班結帳
    expect(
      await submitBlocked(clerkA, draftOf(shiftId, stall, 2000)),
    ).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.shiftClosed,
    });
    const voided = await gql(clerkA, VOID, {
      input: {
        id: submitted.id,
        expectedEditVersion: await editVersionOf(submitted.id),
        reasonNote: "結錯",
      },
    });
    expect(voided.errors?.[0]?.extensions).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.voidForbidden,
    });

    // 列表(待審核篩選已沒有它)與檢視頁
    const list = await ok<{
      lotteryCheckouts: {
        total: number;
        items: { submissionId: string; submissionStatus: string }[];
      };
    }>(clerkA, LIST, { input: { orgId: String(xinyi), status: "completed" } });
    expect(list.lotteryCheckouts.items).toContainEqual(
      expect.objectContaining({
        submissionId: submitted.id,
        submissionStatus: "completed",
      }),
    );
    const detail = await ok<{
      lotteryCheckout: {
        status: string;
        diffReason: string | null;
        cashPointPrinterId: string | null;
        shiftOpenedAt: string | null;
        shiftClosedAt: string | null;
      };
    }>(manager, DETAIL, { submissionId: submitted.id });
    expect(detail.lotteryCheckout).toMatchObject({
      status: "confirmed",
      diffReason: "找錯錢",
    });
    // 58mm 結帳單的「班次」= 開班 ~ 結束;收銀點沒設定印表機 = null(列印用分店預設)
    const shift = await shiftOf(shiftId);
    expect(detail.lotteryCheckout).toMatchObject({
      cashPointPrinterId: null,
      shiftOpenedAt: shift?.openedAt.toISOString(),
      shiftClosedAt: shift?.closedAt?.toISOString(),
    });
  });

  it("有接班人 → 接班人審核(店長那一關跳過);送出後同收銀點可再開班、期初 = 留給下一班;退回改金額 → 下一班期初跟著更新;核准完成", async () => {
    now("14:00");
    const shiftId = await openShift(counter, clerkA.userId, 3000);
    const draft = draftOf(shiftId, counter, 3000, {
      leftForNext: 3000,
      successorId: String(clerkB.userId),
    });
    const submitted = await submitOk(clerkA, draft);
    // 第 2 關的跳過在進關時才判斷(接班人核准後才是 skipped)
    expect(await stepsOf(submitted.id)).toMatchObject({
      successor: "active",
      store_manager: "pending",
    });
    expect(await shiftOf(shiftId)).toMatchObject({ closedAt: taipei("14:00") });
    // 這一班已有審核中的結帳 → 再送一張擋下(店長也不行)
    expect(await submitBlocked(manager, draft)).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.pendingExists,
    });

    // B 先開班:期初 = A 的「留給下一班」3,000
    const form = await ok<{
      lotteryStoreOpenShiftForm: {
        item: { plan: string; handoverAmount: number };
      };
    }>(clerkB, OPEN_FORM, { cashPointId: String(counter) });
    expect(form.lotteryStoreOpenShiftForm.item).toEqual({
      plan: "handover",
      handoverAmount: 3000,
    });
    const opened = await ok<{
      openLotteryShift: { item: { id: string; openingFloat: number } };
    }>(clerkB, OPEN, {
      input: { cashPointId: String(counter), temporaryCover: true },
    });
    expect(opened.openLotteryShift.item.openingFloat).toBe(3000);
    const shiftB = new Types.ObjectId(opened.openLotteryShift.item.id);

    // 接班人退回 → A 改留給下一班 2,500 再送出 → B 的期初跟著更新
    await decideOn(world, clerkB, submitted.id, "RETURN");
    // 記下退回時間(營運報表「期末那一刻有效的結帳單」用)
    const returned = await checkoutOf(submitted.id);
    expect(returned).toMatchObject({
      status: "returned",
      returnedAt: expect.any(Date),
      attempts: [expect.objectContaining({ returnedAt: expect.any(Date) })],
    });
    expect(
      await connection
        .collection(LOTTERY_STOCKTAKES_COLLECTION)
        .findOne({ submissionId: new Types.ObjectId(submitted.id) }),
    ).toMatchObject({ status: "returned" });
    const revised = { ...draft, leftForNext: 2500 };
    const resubmitted = await gql(clerkA, SUBMIT_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: await editVersionOf(submitted.id),
        values: valuesOf(revised),
      },
    });
    expect(resubmitted.errors).toBeUndefined();
    expect(await checkoutOf(submitted.id)).toMatchObject({
      status: "pending",
      leftForNext: 2500,
      returnedAt: null,
      // 重送不改寫第一次送出的時間;多一次送出的快照
      firstSubmittedAt: returned?.firstSubmittedAt,
      attempts: [
        expect.objectContaining({ returnedAt: expect.any(Date) }),
        expect.objectContaining({ returnedAt: null }),
      ],
    });
    expect(await shiftOf(shiftB)).toMatchObject({ openingFloat: 2500 });
    expect(await expectedOfBoard(shiftB)).toBe(2500);

    await decideOn(world, clerkB, submitted.id, "APPROVE");
    expect(await stepsOf(submitted.id)).toMatchObject({
      successor: "completed",
      store_manager: "skipped",
    });
    expect(await checkoutOf(submitted.id)).toMatchObject({
      status: "confirmed",
      confirmedBy: clerkB.userId,
    });
    const detail = await ok<{
      lotteryCheckout: {
        leftForNext: number;
        successor: { name: string } | null;
        submittedBy: { name: string } | null;
        draft: string;
      };
    }>(clerkB, DETAIL, { submissionId: submitted.id });
    expect(detail.lotteryCheckout).toMatchObject({
      leftForNext: 2500,
      successor: { name: "李小華" },
      submittedBy: { name: "王小明" },
    });
    expect(JSON.parse(detail.lotteryCheckout.draft)).toMatchObject({
      leftForNext: 2500,
      stocktake: { mode: "new" },
    });
  });

  it("盤點方式:沿用 30 分鐘內的盤點(已退回的不能沿用;超過就不能沿用)、店長跳過盤點要原因(報表標示用 skipReason);退回後改成跳過 → 自己建立的盤點單不留", async () => {
    now("15:00");
    const shiftId = await openShift(stall, clerkA.userId, 1000);
    // 14:50 開始盤的全店盤點(已確認)可以沿用;14:55 開始盤的(已退回)最新但不能沿用
    const stocktakeSubmissionId = new Types.ObjectId();
    const returnedSubmissionId = new Types.ObjectId();
    const stocktakeDoc = (
      submissionId: Types.ObjectId,
      status: "confirmed" | "returned",
      startedAt: Date,
    ) => ({
      orgId: xinyi,
      tenantId: tenant,
      type: "adhoc",
      status,
      scopeCashPointId: null,
      startedAt,
      submittedBy: clerkA.userId,
      submittedAt: taipei("14:56"),
      confirmedAt: status === "confirmed" ? taipei("14:57") : null,
      confirmedBy: status === "confirmed" ? manager.userId : null,
      submissionId,
      lines: [],
      unopenedLines: [],
      lostReviewLines: [],
      summary: {
        books: 0,
        backfillCount: 0,
        backfillAmount: 0,
        newInvestigate: 0,
        flagged: 0,
        confirmLost: 0,
        confirmLostCost: 0,
      },
      version: 0,
      moduleKey: "store",
      ...base(),
    });
    await connection
      .collection(LOTTERY_STOCKTAKES_COLLECTION)
      .insertMany([
        stocktakeDoc(stocktakeSubmissionId, "confirmed", taipei("14:50")),
        stocktakeDoc(returnedSubmissionId, "returned", taipei("14:55")),
      ]);
    expect(
      await submitBlocked(
        clerkA,
        draftOf(shiftId, stall, 1000, {
          stocktake: {
            mode: "reuse",
            submissionId: String(returnedSubmissionId),
          },
        }),
      ),
    ).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.stocktakeNotReusable,
    });
    const within = await wizard(clerkA, shiftId);
    expect(within.reusableStocktake).toEqual({
      submissionId: String(stocktakeSubmissionId),
      scopeName: null,
    });
    const reuse = draftOf(shiftId, stall, 1000, {
      stocktake: { mode: "reuse", submissionId: String(stocktakeSubmissionId) },
    });
    // 15:25 超過 30 分鐘 → 不能沿用
    now("15:25");
    const later = await wizard(clerkA, shiftId);
    expect(later.reusableStocktake).toBeNull();
    expect(await submitBlocked(clerkA, reuse)).toMatchObject({
      code: "FORBIDDEN",
      reason: CHECKOUT_REASONS.stocktakeNotReusable,
    });
    // 店長先「現在盤點」送出(接班人 B)→ B 退回 → 改成跳過盤點(原因必填)再送出:自己建立的那張盤點單不留
    const asManager = await wizard(manager, shiftId);
    expect(asManager.canSkipStocktake).toBe(true);
    const handover = { leftForNext: 500, successorId: String(clerkB.userId) };
    const submitted = await submitOk(
      manager,
      draftOf(shiftId, stall, 1000, handover),
    );
    const ownStocktake = { submissionId: new Types.ObjectId(submitted.id) };
    expect(
      await connection
        .collection(LOTTERY_STOCKTAKES_COLLECTION)
        .findOne(ownStocktake),
    ).toMatchObject({ type: "shift", status: "pending", deletedAt: null });
    await decideOn(world, clerkB, submitted.id, "RETURN");
    const resubmitted = await gql(manager, SUBMIT_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: await editVersionOf(submitted.id),
        values: valuesOf(
          draftOf(shiftId, stall, 1000, {
            ...handover,
            stocktake: {
              mode: "skip",
              reasonKey: "short-staffed",
              reasonNote: null,
            },
          }),
        ),
      },
    });
    expect(resubmitted.errors).toBeUndefined();
    expect(await checkoutOf(submitted.id)).toMatchObject({
      status: "pending",
      stocktakeMode: "skip",
      stocktakeId: null,
      skipReasonKey: "short-staffed",
      skipReason: "人力不足",
    });
    expect(
      await connection
        .collection(LOTTERY_STOCKTAKES_COLLECTION)
        .findOne(ownStocktake),
    ).toMatchObject({ deletedAt: expect.any(Date) });
    const detail = await ok<{
      lotteryCheckout: { stocktakeMode: string; skipReason: string | null };
    }>(clerkA, DETAIL, { submissionId: submitted.id });
    expect(detail.lotteryCheckout).toEqual(
      expect.objectContaining({
        stocktakeMode: "skip",
        skipReason: "人力不足",
      }),
    );
  });
});
