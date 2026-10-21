import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import {
  STORE_PERMISSIONS as S,
  STOCKTAKE_CONFIRM_FORM_KEY,
  STOCKTAKE_REASONS,
  type StocktakeDraft,
  serializeStocktakeDraft,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import type { StepDef } from "@repo/domain/workflow";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { OrgsRepository } from "../../../database/database.module";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
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
  type Person,
  SUBMIT_SUBMISSION,
  VOID,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  bindForm,
  decideOn,
  person,
  publishWorkflow,
  reviewStep,
  roleSource,
} from "../../../workflows/test-support/workflow-fixtures";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import { LotteryTicketEventsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { LOTTERY_TICKET_EVENTS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket-event.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import {
  LOTTERY_STOCKTAKES_COLLECTION,
  LotteryStocktake,
} from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import { LOTTERY_SHIFTS_COLLECTION } from "../../database/lottery-store/lottery-shift.schema";
import { StoreClock } from "../store/store-clock";
import { ticketEventsPostCloseNet } from "../store/store-registrations";
import { seedReasonCategory } from "../test-support/master-data-fixtures";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

// ---- GraphQL ----

const SHEET = /* GraphQL */ `
  query Sheet($input: LotteryStocktakeSheetInput!) {
    lotteryStocktakeSheet(input: $input) {
      orgName
      cashPoints {
        id
        name
        shift {
          id
          expectedCash
        }
        lastShift {
          id
          closed
        }
      }
      books {
        bookId
        cashPointId
        bookNo
        tickets {
          ticketNo
          status
          pendingReversal
        }
      }
      unopenedBooks {
        bookId
        ticketCount
      }
      lostTickets {
        ticketId
        ticketNo
        source
      }
    }
  }
`;

const REVIEW = /* GraphQL */ `
  query Review($input: LotteryStocktakeReviewInput!) {
    lotteryStocktakeReview(input: $input) {
      staleCount
      unhandledCount
      summary {
        books
        backfillCount
        backfillAmount
        newInvestigate
        flagged
        confirmLost
      }
      lines {
        bookId
        systemCount
        diffs {
          ticketNo
          kind
          backfilled
        }
        pendingReversalTicketNos
        staleTicketNos
      }
    }
  }
`;

const BACKFILL = /* GraphQL */ `
  mutation Backfill($input: BackfillLotteryStocktakeSalesInput!) {
    backfillLotteryStocktakeSales(input: $input) {
      items {
        ticketNo
        eventId
        amount
        shiftId
        postClose
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

const BOARD = /* GraphQL */ `
  query Board($orgId: ID!) {
    lotteryStoreBoard(orgId: $orgId) {
      item {
        cashPoints {
          id
          shift {
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

const STATUS = /* GraphQL */ `
  query Status($orgId: ID!) {
    lotteryStocktakeStatus(orgId: $orgId) {
      lastSubmittedAt
      remind
    }
  }
`;

const LIST = /* GraphQL */ `
  query List($input: LotteryStocktakesInput!) {
    lotteryStocktakes(input: $input) {
      total
      items {
        submissionId
        serialNo
        type
        status
        summary {
          backfillCount
          newInvestigate
          uncountedCount
        }
      }
    }
  }
`;

const DETAIL = /* GraphQL */ `
  query Detail($submissionId: ID!) {
    lotteryStocktake(submissionId: $submissionId) {
      status
      submittedBy {
        name
      }
      lines {
        bookNo
        cashPointName
        systemCount
        presentCount
        diffs {
          ticketNo
          action
          postClose
        }
      }
      unopened {
        present
      }
      lostReview {
        action
        reasonLabel
      }
      uncountedBooks {
        bookNo
        cashPointName
      }
      summary {
        uncountedCount
      }
      draft
    }
  }
`;

interface ReviewLine {
  bookId: string;
  systemCount: number;
  diffs: { ticketNo: string; kind: string; backfilled: boolean }[];
  pendingReversalTicketNos: string[];
  staleTicketNos: string[];
}

interface Review {
  staleCount: number;
  unhandledCount: number;
  summary: Record<string, number>;
  lines: ReviewLine[];
}

interface TicketDoc {
  _id: Types.ObjectId;
  ticketNo: string;
  status: string;
  version: number;
  lockedBy: unknown;
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

const allNos = (except: readonly string[] = []) =>
  Array.from({ length: 20 }, (_, index) =>
    String(index + 1).padStart(3, "0"),
  ).filter((no) => !except.includes(no));

function extensionsOfSubmit(
  result: GraphqlResult,
): Record<string, unknown> | undefined {
  return result.errors?.[0]?.extensions;
}

/**
 * 盤點與盤點確認申請(規格 6.8、8.6、7.4、第 17 章第 1、2、3、6 題):打真的 GraphQL 端點、對真 MongoDB
 * (TEST-07);「現在」由 `StoreClock` 注入。每張 200 元;店內櫃台開著的班期初 5,000。
 *
 * 組織樹:root ─ 租戶甲 ─ 信義店(店內櫃台:開班中;店外攤位:上一班已結帳)
 */
describe("盤點(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let world: World;
  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let counter: Types.ObjectId;
  let stall: Types.ObjectId;
  let counterShift: Types.ObjectId;
  let stallShift: Types.ObjectId;
  let gameId: Types.ObjectId;

  /** 店員 A、B:看板、銷售、盤點、送盤點確認申請 */
  let clerkA: Person;
  let clerkB: Person;
  /** 店長:審核者(另有確認遺失) */
  let manager: Person;
  /** 資深店員:另有確認遺失(不是審核者) */
  let senior: Person;
  /** 沒有盤點權限 */
  let viewer: Person;

  let bookSequence = 70_000;
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

  /** 一本 20 張拆在 `cashPointId` 檯面(未售);`sold` 的張號已售。 */
  async function counterBook(
    cashPointId: Types.ObjectId,
    sold: readonly string[] = [],
  ): Promise<{ bookId: Types.ObjectId; bookNo: string }> {
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
        const isSold = sold.includes(ticketNo);
        return {
          orgId: xinyi,
          tenantId: tenant,
          bookId,
          gameId,
          bookNo,
          ticketNo,
          ticketKey: `5164-${bookNo}-${ticketNo}`,
          status: isSold ? "sold" : "unsold",
          location: { kind: "counter", cashPointId },
          lockedBy: null,
          responsibleOrgId: null,
          unitCost: 184,
          soldAt: isSold ? taipei("09:00") : null,
          soldBy: null,
          soldSource: isSold ? "scan" : null,
          version: 1,
          moduleKey: "inventory",
          ...base(),
        };
      }),
    );
    return { bookId, bookNo };
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

  function saleEventsOf(ticketId: Types.ObjectId): Promise<number> {
    return connection
      .collection(LOTTERY_TICKET_EVENTS_COLLECTION)
      .countDocuments({
        ticketId,
        type: { $in: ["sale", "sale_stocktake"] },
      });
  }

  async function expectedOfCounter(): Promise<number> {
    const data = await ok<{
      lotteryStoreBoard: {
        item: {
          cashPoints: { id: string; shift: { expectedCash: number } | null }[];
        };
      };
    }>(clerkA, BOARD, { orgId: String(xinyi) });
    const point = data.lotteryStoreBoard.item.cashPoints.find(
      (item) => item.id === String(counter),
    );
    return point?.shift?.expectedCash ?? -1;
  }

  function draftOf(
    lines: StocktakeDraft["lines"],
    extra: Partial<StocktakeDraft> = {},
  ): StocktakeDraft {
    return {
      version: 1,
      orgId: String(xinyi),
      scopeCashPointId: null,
      startedAt: taipei("21:30").toISOString(),
      lines,
      unopened: [],
      lostReview: [],
      ...extra,
    };
  }

  /** 一本 × 收銀點:全部「在」,除了 `missing`;`diffs` = 差異的處理。 */
  function lineOf(
    bookId: Types.ObjectId,
    cashPointId: Types.ObjectId,
    countedAt: string,
    present: readonly string[],
    diffs: StocktakeDraft["lines"][number]["diffs"] = [],
  ): StocktakeDraft["lines"][number] {
    return {
      bookId: String(bookId),
      cashPointId: String(cashPointId),
      countedAt: taipei(countedAt).toISOString(),
      method: "grid",
      presentTicketNos: [...present],
      diffs: [...diffs],
    };
  }

  async function review(who: Person, draft: StocktakeDraft): Promise<Review> {
    const data = await ok<{ lotteryStocktakeReview: Review }>(who, REVIEW, {
      input: { draft: serializeStocktakeDraft(draft) },
    });
    return data.lotteryStocktakeReview;
  }

  function backfill(who: Person, ticket: TicketDoc): Promise<GraphqlResult> {
    return gql(who, BACKFILL, {
      input: {
        orgId: String(xinyi),
        tickets: [{ ticketId: String(ticket._id), version: ticket.version }],
      },
    });
  }

  async function backfillOk(who: Person, ticket: TicketDoc) {
    const result = await backfill(who, ticket);
    expect(result.errors).toBeUndefined();
    const data = result.data as {
      backfillLotteryStocktakeSales: {
        items: {
          eventId: string;
          shiftId: string;
          postClose: boolean;
          amount: number;
        }[];
      };
    };
    const item = data.backfillLotteryStocktakeSales.items[0];
    if (item === undefined) {
      throw new Error("沒有補登結果");
    }
    return item;
  }

  function submit(who: Person, draft: StocktakeDraft): Promise<GraphqlResult> {
    requestSequence += 1;
    return gql(who, SUBMIT, {
      input: {
        formKey: STOCKTAKE_CONFIRM_FORM_KEY,
        clientRequestId: `stocktake-${String(requestSequence)}`,
        values: {
          branch: String(xinyi),
          scope_label: "全店",
          totals: "",
          draft: serializeStocktakeDraft(draft),
        },
      },
    });
  }

  async function submitOk(who: Person, draft: StocktakeDraft) {
    const result = await submit(who, draft);
    expect(result.errors).toBeUndefined();
    const data = result.data as {
      createAndSubmitFormSubmission: {
        submission: { id: string; status: string; editVersion: number };
      };
    };
    return data.createAndSubmitFormSubmission.submission;
  }

  async function statusOf(
    bookId: Types.ObjectId,
    ticketNo: string,
  ): Promise<string> {
    const ticket = await ticketOf(bookId, ticketNo);
    return ticket.status;
  }

  async function firstDiffsOf(submissionId: string) {
    const record = await stocktakeOf(submissionId);
    return record?.lines[0]?.diffs ?? [];
  }

  async function firstSummaryOf(submissionId: string) {
    const record = await stocktakeOf(submissionId);
    return record?.summary;
  }

  function stocktakeOf(submissionId: string) {
    return connection
      .collection<LotteryStocktake>(LOTTERY_STOCKTAKES_COLLECTION)
      .findOne({ submissionId: new Types.ObjectId(submissionId) });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-stocktake");
    connection = api.connection;
    await api.app
      .get<Model<LotteryStocktake>>(getModelToken(LotteryStocktake.name))
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
      [...Object.values(S), "inventory.show-cost"].map((key) => ({
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
      LOTTERY_FIELD_CATEGORY_KEYS.lostReason,
      [
        { value: "not-found", label: "找不到" },
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
        "apply-center.view",
      ],
    };
    clerkA = await person(api, connection, xinyi, tenant, clerkScope);
    clerkB = await person(api, connection, xinyi, tenant, clerkScope);
    senior = await person(api, connection, xinyi, tenant, {
      ...clerkScope,
      permissionKeys: [...clerkScope.permissionKeys, S.confirmLost],
    });
    manager = await person(api, connection, xinyi, tenant, {
      moduleKeys: ["store", "apply-center", "apply-center.view-page"],
      permissionKeys: [
        S.view,
        S.create,
        S.edit,
        S.sell,
        S.stocktake,
        S.confirmLost,
        "inventory.show-cost",
        "apply-center.view",
      ],
    });
    viewer = await person(api, connection, xinyi, tenant, {
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

    await formOk(api, root, CREATE_FORM, {
      input: {
        key: STOCKTAKE_CONFIRM_FORM_KEY,
        moduleKey: "store",
        name: "盤點確認申請",
      },
    });
    await publishDefinition(
      api,
      root,
      STOCKTAKE_CONFIRM_FORM_KEY,
      definitionOf([
        field("branch", "text"),
        field("scope_label", "text"),
        field("totals", "multiline"),
        field("note", "text"),
        field("draft", "multiline", { rules: { required: true } }),
      ]),
      null,
    );
    await formOk(api, root, ASSIGN, {
      input: {
        formKey: STOCKTAKE_CONFIRM_FORM_KEY,
        tenantOrgIds: [String(tenant)],
      },
    });
    world = { api, connection, admin } as unknown as World;
    const step: StepDef = reviewStep("store", roleSource(managerRole));
    await publishWorkflow(world, "stocktake_flow", {
      steps: [step],
      checkFormKey: STOCKTAKE_CONFIRM_FORM_KEY,
    });
    await bindForm(world, "stocktake_flow", STOCKTAKE_CONFIRM_FORM_KEY);

    // 店內櫃台開著的班(期初 5,000);店外攤位上一班已結帳
    const shifts = connection.collection(LOTTERY_SHIFTS_COLLECTION);
    const shiftDoc = (cashPointId: Types.ObjectId, closedAt: Date | null) => ({
      orgId: xinyi,
      tenantId: tenant,
      cashPointId,
      openedBy: clerkA.userId,
      openedAt: taipei("08:00"),
      openingFloat: 5000,
      openingFloatSource: "handover",
      previousShiftId: null,
      openingMovementId: null,
      scheduleEntryId: null,
      scheduleTaskSnapshot: null,
      positionMismatch: null,
      closedAt,
      checkoutId: null,
      drawerVersion: 0,
      moduleKey: "store",
      ...base(),
    });
    ({ insertedId: counterShift } = await shifts.insertOne(
      shiftDoc(counter, null),
    ));
    ({ insertedId: stallShift } = await shifts.insertOne(
      shiftDoc(stall, taipei("13:00")),
    ));
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  /** 每題前把店內櫃台這一班的售出事件清掉,應有回到期初 5,000。 */
  async function resetCounterCash(): Promise<void> {
    await connection
      .collection(LOTTERY_TICKET_EVENTS_COLLECTION)
      .deleteMany({ shiftId: counterShift });
  }

  it("盤點頁:各收銀點(開著的班與應有現金、最近一班)、檯面上的本、未拆的本、待查清單", async () => {
    now("21:00");
    const { bookId } = await counterBook(counter, ["001", "002"]);
    const data = await ok<{
      lotteryStocktakeSheet: {
        orgName: string;
        cashPoints: {
          id: string;
          shift: { expectedCash: number } | null;
          lastShift: { closed: boolean } | null;
        }[];
        books: { bookId: string; tickets: { status: string }[] }[];
      };
    }>(clerkA, SHEET, { input: { orgId: String(xinyi) } });
    const sheet = data.lotteryStocktakeSheet;
    expect(sheet.orgName).toBe("信義店");
    expect(sheet.cashPoints.map((point) => point.id)).toEqual([
      String(counter),
      String(stall),
    ]);
    expect(sheet.cashPoints[0]?.shift?.expectedCash).toBe(5000);
    expect(sheet.cashPoints[1]).toMatchObject({
      shift: null,
      lastShift: { closed: true },
    });
    const book = sheet.books.find((item) => item.bookId === String(bookId));
    expect(book?.tickets.filter((t) => t.status === "sold")).toHaveLength(2);

    // 沒有 store.stocktake → FORBIDDEN(看不到 [盤點])
    expect(
      await errorOf(viewer, SHEET, { input: { orgId: String(xinyi) } }),
    ).toMatchObject({ code: "FORBIDDEN" });
  });

  it("第 17 章第 1 題:兩人同時盤點都補登 #012 → 只有一個成功、售出事件 1 筆、另一人提示已被處理、後送出的不再列差異;應有 5,200", async () => {
    await resetCounterCash();
    const { bookId } = await counterBook(counter);
    const t012 = await ticketOf(bookId, "012");
    now("21:41");
    // A、B 都在 21:40 盤到 #012 不在
    const draftA = draftOf([lineOf(bookId, counter, "21:40", allNos(["012"]))]);
    const before = await review(clerkA, draftA);
    expect(before.lines[0]?.diffs).toEqual([
      { ticketNo: "012", kind: "missing", backfilled: false },
    ]);
    const [resultA, resultB] = await Promise.all([
      backfill(clerkA, t012),
      backfill(clerkB, t012),
    ]);
    const succeeded = [resultA, resultB].filter(
      (result) => result.errors === undefined,
    );
    expect(succeeded).toHaveLength(1);
    const failed = [resultA, resultB].find(
      (result) => result.errors !== undefined,
    );
    expect(failed?.errors?.[0]?.extensions).toMatchObject({
      code: "CONFLICT",
      reason: STOCKTAKE_REASONS.alreadyProcessed,
    });
    expect(await saleEventsOf(t012._id)).toBe(1);
    expect(await expectedOfCounter()).toBe(5200);

    const winner = resultA.errors === undefined ? clerkA : clerkB;
    const loser = winner === clerkA ? clerkB : clerkA;
    const winnerResult = (resultA.errors === undefined ? resultA : resultB)
      .data as {
      backfillLotteryStocktakeSales: { items: { eventId: string }[] };
    };
    const eventId =
      winnerResult.backfillLotteryStocktakeSales.items[0]?.eventId ?? "";

    // 補登成功的一方:差異照列(已補登),送出成功
    const winnerDraft = draftOf([
      lineOf(bookId, counter, "21:40", allNos(["012"]), [
        { ticketNo: "012", action: "sale_backfill", eventId },
      ]),
    ]);
    const winnerReview = await review(winner, winnerDraft);
    expect(winnerReview.lines[0]?.diffs).toEqual([
      { ticketNo: "012", kind: "missing", backfilled: true },
    ]);
    expect(winnerReview.staleCount).toBe(0);

    // 失敗的一方:重新核對後不再列 #012;還留著補登的處理 → 這幾張已被處理
    const loserStale = draftOf([
      lineOf(bookId, counter, "21:40", allNos(["012"]), [
        { ticketNo: "012", action: "sale_backfill", eventId: null },
      ]),
    ]);
    const stale = await review(loser, loserStale);
    expect(stale.lines[0]?.diffs).toEqual([]);
    expect(stale.lines[0]?.staleTicketNos).toEqual(["012"]);
    expect(extensionsOfSubmit(await submit(loser, loserStale))).toMatchObject({
      code: "FORBIDDEN",
      reason: STOCKTAKE_REASONS.stale,
    });
    const loserDraft = draftOf([
      lineOf(bookId, counter, "21:40", allNos(["012"])),
    ]);
    now("21:50");
    const second = await submitOk(loser, loserDraft);
    const first = await submitOk(winner, winnerDraft);
    expect(await firstDiffsOf(second.id)).toEqual([]);
    expect(await firstSummaryOf(first.id)).toMatchObject({
      backfillCount: 1,
      backfillAmount: 200,
    });
    expect(await saleEventsOf(t012._id)).toBe(1);
    expect(await expectedOfCounter()).toBe(5200);
  });

  it("第 17 章第 2 題:盤點後客人才刷買 → 盤點單沒有 #012 的差異;應有 5,200", async () => {
    await resetCounterCash();
    const { bookId } = await counterBook(counter);
    const t012 = await ticketOf(bookId, "012");
    // 21:40 盤到 #012 在;21:45 客人買 #012
    now("21:45");
    await ok(clerkB, SELL, {
      input: {
        orgId: String(xinyi),
        localCashPointId: String(counter),
        tickets: [{ ticketId: String(t012._id), version: t012.version }],
        source: "scan",
      },
    });
    now("21:50");
    const draft = draftOf([lineOf(bookId, counter, "21:40", allNos())]);
    const checked = await review(clerkA, draft);
    expect(checked.lines[0]).toMatchObject({ diffs: [], systemCount: 20 });
    const submitted = await submitOk(clerkA, draft);
    expect(await firstDiffsOf(submitted.id)).toEqual([]);
    expect(await expectedOfCounter()).toBe(5200);
  });

  it("第 17 章第 3 題(盤點一側):補登與看板補刷同時 → 只一次成功;盤點方看到「這幾張已被處理」", async () => {
    await resetCounterCash();
    const { bookId } = await counterBook(counter);
    const t014 = await ticketOf(bookId, "014");
    now("21:41");
    const [stocktakeSide, boardSide] = await Promise.all([
      backfill(clerkA, t014),
      gql(clerkB, SELL, {
        input: {
          orgId: String(xinyi),
          localCashPointId: String(counter),
          tickets: [{ ticketId: String(t014._id), version: t014.version }],
          source: "scan",
        },
      }),
    ]);
    expect(
      [stocktakeSide, boardSide].filter((item) => item.errors === undefined),
    ).toHaveLength(1);
    if (stocktakeSide.errors !== undefined) {
      expect(stocktakeSide.errors[0]?.extensions).toMatchObject({
        code: "CONFLICT",
        reason: STOCKTAKE_REASONS.alreadyProcessed,
      });
    }
    expect(await statusOf(bookId, "014")).toBe("sold");
    expect(await saleEventsOf(t014._id)).toBe(1);
    expect(await expectedOfCounter()).toBe(5200);
  });

  it("第 17 章第 6 題(盤點一側):撤銷申請先送出 → #012 標「撤銷審核中」、送出時提示已被處理", async () => {
    const { bookId } = await counterBook(counter, ["012"]);
    now("21:40");
    const draft = draftOf([
      lineOf(bookId, counter, "21:40", allNos(), [
        { ticketNo: "012", action: "flag" },
      ]),
    ]);
    const checked = await review(clerkA, draft);
    expect(checked.lines[0]?.diffs).toEqual([
      { ticketNo: "012", kind: "extra", backfilled: false },
    ]);
    // 撤銷售出申請送出:鎖住 #012(P15 `lockTickets` 夾具)
    const t012 = await ticketOf(bookId, "012");
    await api.app.get(TransactionService).withTransaction((session) =>
      api.app
        .get(TicketLedgerService)
        .lockTicketsInTenant(session, tenant, [t012._id], {
          refType: "sale_reversal",
          refId: new Types.ObjectId(),
        }),
    );
    now("21:50");
    const after = await review(clerkA, draft);
    expect(after.lines[0]).toMatchObject({
      diffs: [],
      pendingReversalTicketNos: ["012"],
      staleTicketNos: ["012"],
    });
    expect(extensionsOfSubmit(await submit(clerkA, draft))).toMatchObject({
      code: "FORBIDDEN",
      reason: STOCKTAKE_REASONS.stale,
    });
  });

  it("送出前每筆差異都要處理;盤點送出不影響庫存,核准完成才套用(待查、未拆的本不在、確認遺失、尋回)", async () => {
    now("22:00");
    const { bookId } = await counterBook(counter);
    const { bookId: unopenedId } = await counterBook(counter);
    await connection
      .collection(LOTTERY_TICKETS_COLLECTION)
      .updateMany(
        { bookId: unopenedId },
        { $set: { location: { kind: "stock", cashPointId: null } } },
      );
    const { bookId: missingBook } = await counterBook(counter);
    await connection.collection(LOTTERY_TICKETS_COLLECTION).updateMany(
      { bookId: missingBook, ticketNo: { $in: ["001", "002"] } },
      {
        $set: {
          status: "investigating",
          responsibleOrgId: xinyi,
          location: { kind: "stock", cashPointId: null },
        },
      },
    );
    const lostTicket = await ticketOf(missingBook, "001");
    const foundTicket = await ticketOf(missingBook, "002");
    const line = lineOf(bookId, counter, "22:00", allNos(["016"]));
    const unhandled = draftOf([line]);
    expect(extensionsOfSubmit(await submit(clerkA, unhandled))).toMatchObject({
      code: "FORBIDDEN",
      reason: STOCKTAKE_REASONS.unhandled,
    });

    const draft = draftOf(
      [
        lineOf(bookId, counter, "22:00", allNos(["016"]), [
          { ticketNo: "016", action: "investigate" },
        ]),
      ],
      {
        unopened: [{ bookId: String(unopenedId), present: false }],
        lostReview: [
          {
            ticketId: String(lostTicket._id),
            action: "lost",
            reasonKey: "not-found",
          },
          { ticketId: String(foundTicket._id), action: "found" },
        ],
      },
    );
    // 確認遺失要 store.confirm-lost
    expect(extensionsOfSubmit(await submit(clerkA, draft))).toMatchObject({
      code: "FORBIDDEN",
      reason: STOCKTAKE_REASONS.forbidden,
    });
    const submitted = await submitOk(senior, draft);
    expect(await statusOf(bookId, "016")).toBe("unsold");
    const pending = await stocktakeOf(submitted.id);
    expect(pending).toMatchObject({
      status: "pending",
      type: "adhoc",
      summary: { newInvestigate: 21, confirmLost: 1 },
    });

    await decideOn(world, manager, submitted.id, "APPROVE");
    expect(await statusOf(bookId, "016")).toBe("investigating");
    const unopenedTickets = await connection
      .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
      .find({ bookId: unopenedId })
      .toArray();
    expect(unopenedTickets.every((t) => t.status === "investigating")).toBe(
      true,
    );
    expect(await statusOf(missingBook, "001")).toBe("lost");
    expect(await statusOf(missingBook, "002")).toBe("unsold");
    expect(await stocktakeOf(submitted.id)).toMatchObject({
      status: "confirmed",
      // 核准的人 = 最後核准的審核者
      confirmedBy: manager.userId,
    });

    // 檢視頁(審核者讀得到)與盤點紀錄
    const detail = await ok<{
      lotteryStocktake: {
        status: string;
        lines: { diffs: { action: string }[] }[];
        lostReview: { action: string; reasonLabel: string | null }[];
        draft: string;
      };
    }>(manager, DETAIL, { submissionId: submitted.id });
    expect(detail.lotteryStocktake).toMatchObject({
      status: "confirmed",
      lines: [{ diffs: [{ action: "investigate" }] }],
    });
    expect(detail.lotteryStocktake.lostReview).toContainEqual({
      action: "lost",
      reasonLabel: "找不到",
    });
    expect(JSON.parse(detail.lotteryStocktake.draft)).toMatchObject({
      unopened: [{ present: false }],
    });
    const list = await ok<{
      lotteryStocktakes: {
        total: number;
        items: { submissionId: string; serialNo: string | null }[];
      };
    }>(clerkA, LIST, { input: { orgId: String(xinyi), status: "confirmed" } });
    expect(
      list.lotteryStocktakes.items.map((item) => item.submissionId),
    ).toContain(submitted.id);

    // 作廢一律擋下
    const raw = await connection
      .collection<{ editVersion: number }>("form_submissions")
      .findOne({ _id: new Types.ObjectId(submitted.id) });
    const voided = await gql(senior, VOID, {
      input: {
        id: submitted.id,
        expectedEditVersion: raw?.editVersion ?? 0,
        reasonNote: "盤錯",
      },
    });
    expect(voided.errors?.[0]?.extensions).toMatchObject({
      code: "FORBIDDEN",
      reason: STOCKTAKE_REASONS.voidForbidden,
    });
  });

  it("舊盤點晚完成不覆蓋新盤點的結果:盤點之後被動過的張略過", async () => {
    const { bookId } = await counterBook(counter);
    // A 22:30 盤到 #009 不在(待查),送出、還沒核准
    now("22:31");
    const older = await submitOk(
      clerkA,
      draftOf([
        lineOf(bookId, counter, "22:30", allNos(["009"]), [
          { ticketNo: "009", action: "investigate" },
        ]),
      ]),
    );
    // B 22:40 也盤到 #009 不在,先核准完成 → 待查
    now("22:41");
    const newer = await submitOk(
      clerkB,
      draftOf([
        lineOf(bookId, counter, "22:40", allNos(["009"]), [
          { ticketNo: "009", action: "investigate" },
        ]),
      ]),
    );
    now("22:42");
    await decideOn(world, manager, newer.id, "APPROVE");
    expect(await statusOf(bookId, "009")).toBe("investigating");
    // C 22:50 待查清單「找到了」→ 尋回(回到庫存、未售)
    const t009 = await ticketOf(bookId, "009");
    now("22:51");
    const found = await submitOk(
      senior,
      draftOf([], {
        startedAt: taipei("22:50").toISOString(),
        lostReview: [{ ticketId: String(t009._id), action: "found" }],
      }),
    );
    now("22:52");
    await decideOn(world, manager, found.id, "APPROVE");
    expect(await statusOf(bookId, "009")).toBe("unsold");
    // A 最後才核准:#009 在 A 盤點之後被動過 → 不再改成待查
    now("22:53");
    await decideOn(world, manager, older.id, "APPROVE");
    expect(await statusOf(bookId, "009")).toBe("unsold");
    expect(await stocktakeOf(older.id)).toMatchObject({ status: "confirmed" });
  });

  it("待查清單「找到了」逐張:零碎待查只尋回送出的那一張,另一張維持待查", async () => {
    const { bookId } = await counterBook(counter);
    await connection.collection(LOTTERY_TICKETS_COLLECTION).updateMany(
      { bookId, ticketNo: { $in: ["011", "012"] } },
      {
        $set: {
          status: "investigating",
          responsibleOrgId: xinyi,
          location: { kind: "stock", cashPointId: null },
        },
      },
    );
    const t011 = await ticketOf(bookId, "011");
    now("23:01");
    const submitted = await submitOk(
      senior,
      draftOf([], {
        startedAt: taipei("23:00").toISOString(),
        lostReview: [{ ticketId: String(t011._id), action: "found" }],
      }),
    );
    now("23:02");
    await decideOn(world, manager, submitted.id, "APPROVE");
    expect(await statusOf(bookId, "011")).toBe("unsold");
    expect(await statusOf(bookId, "012")).toBe("investigating");
  });

  it("沒盤完可以送出(10/21 定案):18 本盤 12 本 → 盤點單記 6 本未盤、不記差異、檢視頁列出;退回後補盤 3 本再送出 → 未盤清單更新", async () => {
    now("22:40");
    // 專屬的收銀點,盤點範圍只有這 18 本
    const { insertedId: kiosk } = await connection
      .collection(LOTTERY_CASH_POINTS_COLLECTION)
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        positionKey: "position-3",
        name: "二樓櫃台",
        order: 3,
        enabled: true,
        printerId: null,
        note: null,
        moduleKey: "master-data",
        ...base(),
      });
    const books: { bookId: Types.ObjectId; bookNo: string }[] = [];
    for (let index = 0; index < 18; index += 1) {
      books.push(await counterBook(kiosk));
    }
    const countedLines = books
      .slice(0, 12)
      .map((book) => lineOf(book.bookId, kiosk, "22:35", allNos()));
    const scoped = { scopeCashPointId: String(kiosk) };
    const submitted = await submitOk(clerkA, draftOf(countedLines, scoped));
    const record = await stocktakeOf(submitted.id);
    expect(record?.lines).toHaveLength(12);
    // 沒盤的 6 本記下來(依本號),不記差異;張維持系統狀態
    expect(record?.uncountedBooks.map((book) => book.bookNo)).toEqual(
      books.slice(12).map((book) => book.bookNo),
    );
    expect(record?.uncountedBooks[0]).toMatchObject({
      bookId: books[12]?.bookId,
      gameCode: "5164",
      gameName: "發大財",
      cashPointId: kiosk,
    });
    expect(record?.summary).toMatchObject({
      books: 12,
      uncountedCount: 6,
      backfillCount: 0,
      newInvestigate: 0,
      flagged: 0,
    });
    expect(record?.lines.every((line) => line.diffs.length === 0)).toBe(true);
    for (const book of books.slice(12)) {
      expect(await statusOf(book.bookId, "001")).toBe("unsold");
    }

    // 檢視頁列出沒盤的本;盤點紀錄給未盤本數
    const detail = await ok<{
      lotteryStocktake: {
        uncountedBooks: { bookNo: string; cashPointName: string }[];
        summary: { uncountedCount: number };
      };
    }>(manager, DETAIL, { submissionId: submitted.id });
    expect(detail.lotteryStocktake.summary.uncountedCount).toBe(6);
    expect(detail.lotteryStocktake.uncountedBooks).toEqual(
      books.slice(12).map((book) => ({
        bookNo: book.bookNo,
        cashPointName: "二樓櫃台",
      })),
    );
    const list = await ok<{
      lotteryStocktakes: {
        items: { submissionId: string; summary: { uncountedCount: number } }[];
      };
    }>(clerkA, LIST, { input: { orgId: String(xinyi), status: "pending" } });
    expect(
      list.lotteryStocktakes.items.find(
        (item) => item.submissionId === submitted.id,
      )?.summary.uncountedCount,
    ).toBe(6);

    // 退回後補盤 3 本再送出 → 改寫同一筆,未盤剩 3 本
    await decideOn(world, manager, submitted.id, "RETURN");
    expect(await stocktakeOf(submitted.id)).toMatchObject({
      status: "returned",
    });
    const raw = await connection
      .collection<{ editVersion: number }>("form_submissions")
      .findOne({ _id: new Types.ObjectId(submitted.id) });
    const moreLines = books
      .slice(12, 15)
      .map((book) => lineOf(book.bookId, kiosk, "22:50", allNos()));
    const resubmitted = await gql(clerkA, SUBMIT_SUBMISSION, {
      input: {
        id: submitted.id,
        expectedEditVersion: raw?.editVersion ?? 0,
        values: {
          branch: String(xinyi),
          scope_label: "二樓櫃台",
          totals: "",
          draft: serializeStocktakeDraft(
            draftOf([...countedLines, ...moreLines], scoped),
          ),
        },
      },
    });
    expect(resubmitted.errors).toBeUndefined();
    const again = await stocktakeOf(submitted.id);
    expect(again).toMatchObject({
      status: "pending",
      summary: { books: 15, uncountedCount: 3 },
    });
    expect(again?.uncountedBooks.map((book) => book.bookNo)).toEqual(
      books.slice(15).map((book) => book.bookNo),
    );
  });

  it("駁回 → 已駁回、補登的售出不退;退回 → 已退回", async () => {
    await resetCounterCash();
    now("22:10");
    const { bookId } = await counterBook(counter);
    const t005 = await ticketOf(bookId, "005");
    const filled = await backfillOk(clerkA, t005);
    const draft = draftOf([
      lineOf(bookId, counter, "22:05", allNos(["005"]), [
        { ticketNo: "005", action: "sale_backfill", eventId: filled.eventId },
      ]),
    ]);
    const rejected = await submitOk(clerkA, draft);
    await decideOn(world, manager, rejected.id, "REJECT");
    expect(await stocktakeOf(rejected.id)).toMatchObject({
      status: "rejected",
    });
    expect(await statusOf(bookId, "005")).toBe("sold");
    expect(await expectedOfCounter()).toBe(5200);

    const returned = await submitOk(clerkA, draft);
    await decideOn(world, manager, returned.id, "RETURN");
    expect(await stocktakeOf(returned.id)).toMatchObject({
      status: "returned",
    });
  });

  it("補登售出時那個收銀點沒有開著的班 → 記成最近一班的事後更正,不算那一班結帳時的應有", async () => {
    now("22:20");
    const { bookId } = await counterBook(stall);
    const t003 = await ticketOf(bookId, "003");
    const filled = await backfillOk(clerkA, t003);
    expect(filled).toMatchObject({
      shiftId: String(stallShift),
      postClose: true,
      amount: 200,
    });
    const reader = await tenantBoundaryContext(
      api.app.get(OrgsRepository),
      null,
      tenant,
    );
    expect(
      await ticketEventsPostCloseNet(
        api.app.get(LotteryTicketEventsRepository),
        reader,
        stallShift,
      ),
    ).toBe(200);
    const draft = draftOf([
      lineOf(bookId, stall, "22:15", allNos(["003"]), [
        { ticketNo: "003", action: "sale_backfill", eventId: filled.eventId },
      ]),
    ]);
    const submitted = await submitOk(clerkA, draft);
    expect(await firstDiffsOf(submitted.id)).toMatchObject([
      { action: "sale_backfill", postClose: true, amount: 200 },
    ]);
  });

  it("看板頂部:距離上次送出的盤點超過 24 小時 → 建議盤點一次", async () => {
    now("23:00");
    const fresh = await ok<{
      lotteryStocktakeStatus: { remind: boolean; lastSubmittedAt: string };
    }>(clerkA, STATUS, { orgId: String(xinyi) });
    expect(fresh.lotteryStocktakeStatus.remind).toBe(false);
    jest
      .spyOn(api.app.get(StoreClock), "now")
      .mockReturnValue(new Date(taipei("23:00").getTime() + 25 * 3_600_000));
    const later = await ok<{
      lotteryStocktakeStatus: { remind: boolean };
    }>(clerkA, STATUS, { orgId: String(xinyi) });
    expect(later.lotteryStocktakeStatus.remind).toBe(true);
  });
});
