import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import {
  STORE_PERMISSIONS as S,
  STOCKTAKE_CONFIRM_FORM_KEY,
  STOCKTAKE_REASONS,
  type StocktakeDraft,
  type StocktakeDraftCountLine,
  type TicketLocationKind,
  type TicketStatus,
  bookCountsOf,
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
import {
  countDbCommands,
  expectDbCommandsAtMost,
} from "../../../database/test-support/db-commands";
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
import { LOTTERY_TICKET_EVENTS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket-event.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import { LOTTERY_STORE_COUNT_MODES_COLLECTION } from "../../database/lottery-settings/lottery-store-count-mode.schema";
import {
  LOTTERY_STOCKTAKES_COLLECTION,
  LotteryStocktake,
} from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import { LOTTERY_SHIFTS_COLLECTION } from "../../database/lottery-store/lottery-shift.schema";
import { StoreClock } from "../store/store-clock";
import { seedReasonCategory } from "../test-support/master-data-fixtures";
import { StocktakeService } from "./stocktake.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

// ---- GraphQL ----

const SHEET = /* GraphQL */ `
  query Sheet($input: LotteryStocktakeSheetInput!) {
    lotteryStocktakeSheet(input: $input) {
      countMode
      books {
        bookId
        cashPointId
      }
      countGroups {
        cashPointId
        gameId
        gameCode
        unitPrice
        unsoldCount
        bookNos
      }
      lostTickets {
        ticketId
        unmatched
        sourceType
        sourceCashPointName
      }
    }
  }
`;

const REVIEW = /* GraphQL */ `
  query Review($input: LotteryStocktakeReviewInput!) {
    lotteryStocktakeReview(input: $input) {
      staleCount
      unhandledCount
      uncountedCount
      summary {
        backfillCount
        backfillAmount
        newInvestigate
        flagged
      }
      countLines {
        cashPointId
        gameCode
        systemCount
        presentCount
        kind
        diffCount
        saleCount
        stale
        unhandled
      }
    }
  }
`;

const COUNT_BACKFILL = /* GraphQL */ `
  mutation CountBackfill($input: BackfillLotteryStocktakeCountSalesInput!) {
    backfillLotteryStocktakeCountSales(input: $input) {
      refId
      count
      amount
      shiftId
      postClose
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
    lotteryStocktake(submissionId: $submissionId) {
      countMode
      countLines {
        cashPointName
        gameCode
        systemCount
        presentCount
        recounts
        saleCount
        saleAmount
        investigateCount
        flaggedCount
      }
      uncountedGroups {
        cashPointName
        gameCode
      }
      draft
    }
  }
`;

const SESSION_FIELDS = /* GraphQL */ `
  sessionId
  type
  wholeStore
  cashPointName
  byName
  mine
  canEnd
  startedAt
  minutesLeft
  live
  ended
  draft
`;

const SESSIONS = /* GraphQL */ `
  query Sessions($orgId: ID!) {
    lotteryStocktakeSessions(orgId: $orgId) {
      items {
        ${SESSION_FIELDS}
      }
    }
  }
`;

const START = /* GraphQL */ `
  mutation Start($input: StartLotteryStocktakeSessionInput!) {
    startLotteryStocktakeSession(input: $input) {
      ${SESSION_FIELDS}
    }
  }
`;

const SAVE = /* GraphQL */ `
  mutation Save($input: SaveLotteryStocktakeSessionInput!) {
    saveLotteryStocktakeSession(input: $input) {
      ${SESSION_FIELDS}
    }
  }
`;

const END = /* GraphQL */ `
  mutation End($input: EndLotteryStocktakeSessionInput!) {
    endLotteryStocktakeSession(input: $input)
  }
`;

interface Session {
  sessionId: string;
  type: string;
  wholeStore: boolean;
  cashPointName: string | null;
  byName: string;
  mine: boolean;
  canEnd: boolean;
  startedAt: string;
  minutesLeft: number;
  live: boolean;
  ended: boolean;
  draft: string | null;
}

interface CountReviewLine {
  cashPointId: string;
  gameCode: string;
  systemCount: number;
  presentCount: number;
  kind: string;
  diffCount: number;
  saleCount: number;
  stale: boolean;
  unhandled: boolean;
}

interface Review {
  staleCount: number;
  unhandledCount: number;
  uncountedCount: number;
  summary: Record<string, number>;
  countLines: CountReviewLine[];
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

/** 結果的錯誤 extensions(沒有錯 = undefined)。 */
async function failureOf(
  run: Promise<GraphqlResult>,
): Promise<Record<string, unknown> | undefined> {
  const result = await run;
  return result.errors?.[0]?.extensions;
}

/** 現金方向:增加 +1、減少 −1、不影響 0。 */
const signOf = (effect: string): number => {
  if (effect === "increase") {
    return 1;
  }
  return effect === "decrease" ? -1 : 0;
};

const taipei = (time: string) => new Date(`2026-11-05T${time}:00+08:00`);

function now(time: string): void {
  jest.spyOn(StoreClock.prototype, "now").mockReturnValue(taipei(time));
}

/**
 * 張數盤點、差異處理與盤點中登記(張數店規格 8.1、8.2、8.5a、13.3、16.7 S8~S10;T4):打真的 GraphQL 端點、
 * 對真 MongoDB(TEST-07);「現在」由 `StoreClock` 注入。
 *
 * 組織樹:root ─ 租戶甲 ─ 信義店(張數店;店內櫃台:開班中 5,000;店外攤位:上一班已結帳)
 *                     └ 大安店(編號店,沒有盤點制度那一筆)
 * 遊戲:5164 發大財 200 元、5201 金好運 100 元
 */
describe("張數盤點與盤點中登記(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let world: World;
  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let daan: Types.ObjectId;
  let counter: Types.ObjectId;
  let stall: Types.ObjectId;
  let daanPoint: Types.ObjectId;
  let counterShift: Types.ObjectId;
  let gold: Types.ObjectId;
  let lucky: Types.ObjectId;

  /** 王小明、李小華:店員(銷售、盤點);店長:審核者、`store.edit` */
  let clerkA: Person;
  let clerkB: Person;
  let manager: Person;

  let bookSequence = 90_000;
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

  /** 一本 `count` 張(未售),拆在收銀點檯面上(`firstOpenedAt` = 今天 07:00)。 */
  async function counterBook(
    cashPointId: Types.ObjectId,
    gameId: Types.ObjectId,
    count: number,
    orgId: Types.ObjectId = xinyi,
  ): Promise<Types.ObjectId> {
    bookSequence += 1;
    const bookNo = String(bookSequence).padStart(7, "0");
    const code = gameId.equals(gold) ? "5164" : "5201";
    const { insertedId: bookId } = await connection
      .collection("lottery_books")
      .insertOne({
        orgId,
        tenantId: tenant,
        gameId,
        gameCode: code,
        bookNo,
        bookKey: `${code}-${bookNo}`,
        printVersion: "1",
        holderOrgIds: [orgId],
        purchaseSubmissionId: null,
        purchasedAt: null,
        purchaseDealerId: null,
        rate: 92,
        cost: 184 * count,
        standardTickets: count,
        firstTicketNo: "001",
        lastTicketNo: String(count).padStart(3, "0"),
        skippedTicketNos: [],
        lockedTicketCount: 0,
        firstOpenedAt: taipei("07:00"),
        status: "normal",
        shareOrgs: [],
        moduleKey: "inventory",
        ...base(),
      });
    const tickets = Array.from({ length: count }, (_, index) => {
      const ticketNo = String(index + 1).padStart(3, "0");
      return {
        orgId,
        tenantId: tenant,
        bookId,
        gameId,
        bookNo,
        ticketNo,
        ticketKey: `${code}-${bookNo}-${ticketNo}`,
        status: "unsold",
        location: { kind: "counter", cashPointId },
        lockedBy: null,
        responsibleOrgId: null,
        unitCost: 184,
        soldAt: null,
        soldBy: null,
        soldSource: null,
        unmatched: false,
        saleEventId: null,
        version: 1,
        moduleKey: "inventory",
        ...base(),
      };
    });
    await connection.collection(LOTTERY_TICKETS_COLLECTION).insertMany(tickets);
    await connection.collection("lottery_books").updateOne(
      { _id: bookId },
      {
        $set: {
          ticketCounts: bookCountsOf(
            tickets.map((ticket) => ({
              status: ticket.status as TicketStatus,
              locationKind: ticket.location.kind as TicketLocationKind,
            })),
          ),
        },
      },
    );
    return bookId;
  }

  /** 清掉信義店檯面上的張與事件、盤點中登記(每題各自布置檯面)。 */
  async function resetStore(): Promise<void> {
    await connection
      .collection(LOTTERY_TICKETS_COLLECTION)
      .deleteMany({ orgId: xinyi });
    await connection
      .collection(LOTTERY_TICKET_EVENTS_COLLECTION)
      .deleteMany({ orgId: xinyi });
    await connection
      .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .updateOne({ orgId: xinyi }, { $set: { stocktakeSessions: [] } });
  }

  function countLineOf(
    cashPointId: Types.ObjectId,
    gameId: Types.ObjectId,
    countedAt: string,
    presentCount: number,
    extra: Partial<StocktakeDraftCountLine> = {},
  ): StocktakeDraftCountLine {
    return {
      gameId: String(gameId),
      cashPointId: String(cashPointId),
      countedAt: taipei(countedAt).toISOString(),
      presentCount,
      recounts: [],
      saleCount: 0,
      saleRefIds: [],
      investigateCount: 0,
      flagged: false,
      ...extra,
    };
  }

  function draftOf(
    countLines: StocktakeDraftCountLine[],
    extra: Partial<StocktakeDraft> = {},
  ): StocktakeDraft {
    return {
      version: 1,
      orgId: String(xinyi),
      scopeCashPointId: null,
      startedAt: taipei("10:05").toISOString(),
      lines: [],
      unopened: [],
      lostReview: [],
      countMode: "count",
      purpose: "normal",
      countLines,
      ...extra,
    };
  }

  async function review(who: Person, draft: StocktakeDraft): Promise<Review> {
    const data = await ok<{ lotteryStocktakeReview: Review }>(who, REVIEW, {
      input: { draft: serializeStocktakeDraft(draft) },
    });
    return data.lotteryStocktakeReview;
  }

  async function countBackfill(
    who: Person,
    cashPointId: Types.ObjectId,
    gameId: Types.ObjectId,
    count: number,
  ) {
    const data = await ok<{
      backfillLotteryStocktakeCountSales: {
        refId: string;
        count: number;
        amount: number;
        shiftId: string;
        postClose: boolean;
      };
    }>(who, COUNT_BACKFILL, {
      input: {
        orgId: String(xinyi),
        cashPointId: String(cashPointId),
        gameId: String(gameId),
        count,
      },
    });
    return data.backfillLotteryStocktakeCountSales;
  }

  function submit(who: Person, draft: StocktakeDraft): Promise<GraphqlResult> {
    requestSequence += 1;
    return gql(who, SUBMIT, {
      input: {
        formKey: STOCKTAKE_CONFIRM_FORM_KEY,
        clientRequestId: `count-stocktake-${String(requestSequence)}`,
        values: {
          branch: draft.orgId,
          scope_label: "全店",
          totals: "",
          draft: serializeStocktakeDraft(draft),
        },
      },
    });
  }

  async function submitOk(who: Person, draft: StocktakeDraft): Promise<string> {
    const result = await submit(who, draft);
    expect(result.errors).toBeUndefined();
    return (
      result.data as {
        createAndSubmitFormSubmission: { submission: { id: string } };
      }
    ).createAndSubmitFormSubmission.submission.id;
  }

  function stocktakeOf(submissionId: string) {
    return connection
      .collection<LotteryStocktake>(LOTTERY_STOCKTAKES_COLLECTION)
      .findOne({ submissionId: new Types.ObjectId(submissionId) });
  }

  /** 收銀點 × 遊戲的張(依張號)。 */
  function ticketsAt(cashPointId: Types.ObjectId, gameId: Types.ObjectId) {
    return connection
      .collection<{
        _id: Types.ObjectId;
        ticketNo: string;
        status: string;
        unmatched: boolean;
        version: number;
        bookId: Types.ObjectId;
      }>(LOTTERY_TICKETS_COLLECTION)
      .find({ "location.cashPointId": cashPointId, gameId })
      .sort({ bookId: 1, ticketNo: 1 })
      .toArray();
  }

  /** 收銀點 × 遊戲某個狀態的張。 */
  async function withStatus(
    cashPointId: Types.ObjectId,
    gameId: Types.ObjectId,
    status: string,
  ) {
    const tickets = await ticketsAt(cashPointId, gameId);
    return tickets.filter((ticket) => ticket.status === status);
  }

  /** 店內櫃台這一班的應有現金 = 期初 + 售出(事件現金增加)。 */
  async function counterCash(): Promise<number> {
    const events = await connection
      .collection<{ amount: number; cashEffect: string; postCloseOf: unknown }>(
        LOTTERY_TICKET_EVENTS_COLLECTION,
      )
      .find({ shiftId: counterShift, postCloseOf: null })
      .toArray();
    return events.reduce(
      (sum, event) => sum + signOf(event.cashEffect) * event.amount,
      5000,
    );
  }

  async function start(
    who: Person,
    input: Record<string, unknown>,
  ): Promise<GraphqlResult> {
    return gql(who, START, {
      input: { orgId: String(xinyi), type: "adhoc", ...input },
    });
  }

  async function startOk(
    who: Person,
    input: Record<string, unknown>,
  ): Promise<Session> {
    const result = await start(who, input);
    expect(result.errors).toBeUndefined();
    return (result.data as { startLotteryStocktakeSession: Session })
      .startLotteryStocktakeSession;
  }

  async function sessionsOf(who: Person, orgId = xinyi): Promise<Session[]> {
    const data = await ok<{
      lotteryStocktakeSessions: { items: Session[] };
    }>(who, SESSIONS, { orgId: String(orgId) });
    return data.lotteryStocktakeSessions.items;
  }

  async function firstSessionOf(who: Person): Promise<Session | undefined> {
    const items = await sessionsOf(who);
    return items[0];
  }

  async function versionOf(orgId: Types.ObjectId): Promise<number> {
    const record = await countModeRecord(orgId);
    return record?.version ?? 0;
  }

  function countModeRecord(orgId: Types.ObjectId) {
    return connection
      .collection<{
        mode: string | null;
        version: number;
        stocktakeSessions: unknown[];
      }>(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .findOne({ orgId });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-stocktake-count");
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
      LOTTERY_FIELD_CATEGORY_KEYS.lostReason,
      [{ value: "other", label: "其他" }],
    );
    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
    daan = await createOrg(connection, { name: "大安店", parentId: tenant });

    const points = connection.collection(LOTTERY_CASH_POINTS_COLLECTION);
    const pointDoc = (orgId: Types.ObjectId, name: string, order: number) => ({
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
    ({ insertedId: counter } = await points.insertOne(
      pointDoc(xinyi, "店內櫃台", 1),
    ));
    ({ insertedId: stall } = await points.insertOne(
      pointDoc(xinyi, "店外攤位", 2),
    ));
    ({ insertedId: daanPoint } = await points.insertOne(
      pointDoc(daan, "大安櫃台", 1),
    ));
    const gameDoc = (gameCode: string, name: string, unitPrice: number) => ({
      gameCode,
      name,
      status: "on_sale",
      unitPrice,
      ticketsPerBook: 20,
      bookPrice: unitPrice * 20,
      defaultRate: 92,
      color: null,
      orgId: tenant,
      tenantId: tenant,
      shareOrgs: [{ orgId: tenant, includeDescendants: true }],
      moduleKey: "master-data",
      ...base(),
    });
    ({ insertedId: gold } = await connection
      .collection("lottery_games")
      .insertOne(gameDoc("5164", "發大財", 200)));
    ({ insertedId: lucky } = await connection
      .collection("lottery_games")
      .insertOne(gameDoc("5201", "金好運", 100)));

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
    manager = await person(api, connection, tenant, tenant, {
      moduleKeys: ["store", "apply-center", "apply-center.view-page"],
      permissionKeys: [...clerkScope.permissionKeys, S.edit, S.confirmLost],
    });
    const managerRole = await createRole(api.app, connection, {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [manager.userId],
    });
    const users = connection.collection("users");
    await users.updateOne({ _id: clerkA.userId }, { $set: { name: "王小明" } });
    await users.updateOne({ _id: clerkB.userId }, { $set: { name: "李小華" } });

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
    await publishWorkflow(world, "count_stocktake_flow", {
      steps: [step],
      checkFormKey: STOCKTAKE_CONFIRM_FORM_KEY,
    });
    await bindForm(world, "count_stocktake_flow", STOCKTAKE_CONFIRM_FORM_KEY);

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
    await shifts.insertOne(shiftDoc(stall, taipei("09:00")));

    // 信義店是張數店
    await connection
      .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        mode: "count",
        since: taipei("07:00"),
        lastRenumberAt: null,
        lastRenumberStocktakeId: null,
        history: [],
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

  describe("張數盤點(8.1、8.2;16.7 S1、S2)", () => {
    it("盤點頁:檯面是「收銀點 × 遊戲」的組(現在的未售張數、哪幾本),不列檯面的本", async () => {
      await resetStore();
      now("10:00");
      await counterBook(counter, gold, 12);
      await counterBook(counter, gold, 3);
      await counterBook(stall, lucky, 10);
      const data = await ok<{
        lotteryStocktakeSheet: {
          countMode: string;
          books: unknown[];
          countGroups: {
            cashPointId: string;
            gameCode: string;
            unsoldCount: number;
            bookNos: string[];
          }[];
        };
      }>(clerkA, SHEET, { input: { orgId: String(xinyi) } });
      const sheet = data.lotteryStocktakeSheet;
      expect(sheet.countMode).toBe("count");
      expect(sheet.books).toEqual([]);
      expect(
        sheet.countGroups.map((group) => [
          group.cashPointId,
          group.gameCode,
          group.unsoldCount,
          group.bookNos.length,
        ]),
      ).toEqual([
        [String(counter), "5164", 15, 2],
        [String(stall), "5201", 10, 1],
      ]);
    });

    it("S2 少 → [算售出](立即生效、已售·未對號、算那一班)+ [待查](核准時挑張記待查·未對號);多 → [標記異常] 張的狀態不動", async () => {
      await resetStore();
      now("10:00");
      await counterBook(counter, gold, 12);
      await counterBook(stall, lucky, 10);
      now("10:06");
      // 店內櫃台 5164 系統 12、實際 10:少 2 → 算售出 1、待查 1
      const sale = await countBackfill(clerkA, counter, gold, 1);
      expect(sale).toMatchObject({
        count: 1,
        amount: 200,
        shiftId: String(counterShift),
        postClose: false,
      });
      expect(await counterCash()).toBe(5200);
      const soldNow = await withStatus(counter, gold, "sold");
      // 照挑張順序:同一本張號小到大
      expect(
        soldNow.map((ticket) => [ticket.ticketNo, ticket.unmatched]),
      ).toEqual([["001", true]]);
      const draft = draftOf([
        countLineOf(counter, gold, "10:05", 10, {
          recounts: [11],
          saleCount: 1,
          saleRefIds: [sale.refId],
          investigateCount: 1,
        }),
        // 店外攤位 5201 系統 10、實際 11:多 1 → 標記異常
        countLineOf(stall, lucky, "10:05", 11, { flagged: true }),
      ]);
      const checked = await review(clerkA, draft);
      expect(checked).toMatchObject({
        staleCount: 0,
        unhandledCount: 0,
        uncountedCount: 0,
        summary: {
          backfillCount: 1,
          backfillAmount: 200,
          newInvestigate: 1,
          flagged: 1,
        },
      });
      expect(
        checked.countLines.map((line) => [
          line.gameCode,
          line.systemCount,
          line.kind,
          line.diffCount,
          line.saleCount,
        ]),
      ).toEqual([
        ["5164", 12, "short", 2, 1],
        ["5201", 10, "over", 1, 0],
      ]);

      const id = await submitOk(clerkA, draft);
      const record = await stocktakeOf(id);
      expect(record).toMatchObject({
        countMode: "count",
        purpose: "normal",
        status: "pending",
        summary: { backfillCount: 1, newInvestigate: 1, flagged: 1 },
      });
      expect(record?.countLines.map((line) => line.recounts)).toEqual([
        [11],
        [],
      ]);
      expect(record?.countLines[0]?.diffs).toEqual([
        expect.objectContaining({
          ticketNo: "001",
          action: "sale_backfill",
          amount: 200,
        }),
      ]);
      // 送出不動張:待查在核准時才挑
      expect(await withStatus(counter, gold, "investigating")).toEqual([]);

      await decideOn(world, manager, id, "APPROVE");
      const after = await ticketsAt(counter, gold);
      const investigating = after.filter(
        (ticket) => ticket.status === "investigating",
      );
      expect(
        investigating.map((ticket) => [ticket.ticketNo, ticket.unmatched]),
      ).toEqual([["002", true]]);
      expect(after.filter((ticket) => ticket.status === "unsold")).toHaveLength(
        10,
      );
      // 標記異常:張的狀態不動
      expect(await withStatus(stall, lucky, "unsold")).toHaveLength(10);
      const approved = await stocktakeOf(id);
      expect(approved?.countLines[0]?.diffs).toEqual([
        expect.objectContaining({ action: "sale_backfill" }),
        expect.objectContaining({ ticketNo: "002", action: "investigate" }),
      ]);
      // 檢視頁:每次輸入(第一次 11、改成 10)、算售出金額
      const detail = await ok<{
        lotteryStocktake: {
          countMode: string;
          countLines: Record<string, unknown>[];
          draft: string;
        };
      }>(manager, DETAIL, { submissionId: id });
      expect(detail.lotteryStocktake.countMode).toBe("count");
      expect(detail.lotteryStocktake.countLines[0]).toMatchObject({
        cashPointName: "店內櫃台",
        recounts: [11],
        presentCount: 10,
        saleCount: 1,
        saleAmount: 200,
        investigateCount: 1,
      });
      expect(JSON.parse(detail.lotteryStocktake.draft)).toMatchObject({
        countMode: "count",
        countLines: [{ saleRefIds: [sale.refId] }, { flagged: true }],
      });
      // 待查清單:待查·未對號,標來源盤點(臨時)與收銀點
      const sheet = await ok<{
        lotteryStocktakeSheet: {
          lostTickets: {
            unmatched: boolean;
            sourceType: string | null;
            sourceCashPointName: string | null;
          }[];
        };
      }>(clerkA, SHEET, { input: { orgId: String(xinyi) } });
      expect(sheet.lotteryStocktakeSheet.lostTickets).toEqual([
        {
          ticketId: expect.any(String),
          unmatched: true,
          sourceType: "adhoc",
          sourceCashPointName: "店內櫃台",
        },
      ]);
    });

    it("S2 已結帳的收銀點 [算售出] → 那個收銀點最近一班的事後更正;可挑的張不夠 → 擋下並說還有幾張", async () => {
      await resetStore();
      now("10:00");
      await counterBook(stall, lucky, 3);
      const sale = await countBackfill(clerkA, stall, lucky, 2);
      expect(sale).toMatchObject({ count: 2, amount: 200, postClose: true });
      expect(
        await errorOf(clerkA, COUNT_BACKFILL, {
          input: {
            orgId: String(xinyi),
            cashPointId: String(stall),
            gameId: String(lucky),
            count: 2,
          },
        }),
      ).toMatchObject({
        reason: STOCKTAKE_REASONS.countSaleUnavailable,
        available: 1,
      });
    });

    it("差異沒處理完不能送出;處理對不上(多的卻待查、沒算售出卻說算了)→ 要重數;盤點內容和店的制度對不上 → 讀不懂", async () => {
      await resetStore();
      now("10:00");
      await counterBook(counter, gold, 12);
      const unhandled = draftOf([
        countLineOf(counter, gold, "10:00", 10, { investigateCount: 1 }),
      ]);
      const unhandledReview = await review(clerkA, unhandled);
      expect(unhandledReview.unhandledCount).toBe(1);
      expect(await failureOf(submit(clerkA, unhandled))).toMatchObject({
        reason: STOCKTAKE_REASONS.unhandled,
      });
      const fake = draftOf([
        countLineOf(counter, gold, "10:00", 11, { saleCount: 1 }),
      ]);
      const fakeReview = await review(clerkA, fake);
      expect(fakeReview.countLines[0]).toMatchObject({
        stale: true,
      });
      // 張數店送編號盤點的內容
      expect(
        await errorOf(clerkA, REVIEW, {
          input: {
            draft: serializeStocktakeDraft(
              draftOf([], { countMode: undefined, countLines: undefined }),
            ),
          },
        }),
      ).toMatchObject({ reason: STOCKTAKE_REASONS.invalid });
    });

    it("S1 交班盤點不能沒盤完送出(臨時盤點、一般日結可以):還沒數的組記在盤點單", async () => {
      await resetStore();
      now("10:00");
      await counterBook(counter, gold, 12);
      await counterBook(counter, lucky, 5);
      const partial = draftOf([countLineOf(counter, gold, "10:00", 12)], {
        scopeCashPointId: String(counter),
      });
      const partialReview = await review(clerkA, partial);
      expect(partialReview.uncountedCount).toBe(1);
      const service = api.app.get(StocktakeService);
      const transactions = api.app.get(TransactionService);
      const submissionId = new Types.ObjectId();
      const submitAs = (type: "shift" | "adhoc") =>
        transactions.withTransaction((session) =>
          service.submitStocktakeDraft(session, partial, {
            type,
            submissionId,
            tenantId: tenant,
            submittedBy: clerkA.userId,
          }),
        );
      await expect(submitAs("shift")).rejects.toMatchObject({
        extensions: { reason: STOCKTAKE_REASONS.incomplete },
      });
      await submitAs("adhoc");
      const record = await connection
        .collection<LotteryStocktake>(LOTTERY_STOCKTAKES_COLLECTION)
        .findOne({ submissionId });
      expect(record?.uncountedGroups).toEqual([
        expect.objectContaining({ gameCode: "5201", cashPointId: counter }),
      ]);
      expect(record?.summary.uncountedCount).toBe(1);
    });
  });

  describe("B6:重疊的盤點只退那一組(8.5a;16.7 S10)", () => {
    it("兩張盤點同時數店內櫃台 5164、都少 1:先送出的算售出;後送出的那組要重數,重數後沒差 → 賣了沒記只算一次", async () => {
      await resetStore();
      now("10:00");
      await counterBook(counter, gold, 12);
      await counterBook(stall, lucky, 10);
      // A 台交班盤點 10:05 數到 11;全店臨時盤點 10:06 也數到 11(客人拿走 1 張沒刷)
      const shiftDraft = draftOf(
        [countLineOf(counter, gold, "10:05", 11, { saleCount: 0 })],
        { scopeCashPointId: String(counter) },
      );
      now("10:07");
      const sale = await countBackfill(clerkB, counter, gold, 1);
      const wholeDraft = draftOf([
        countLineOf(counter, gold, "10:06", 11, {
          saleCount: 1,
          saleRefIds: [sale.refId],
        }),
        countLineOf(stall, lucky, "10:06", 10),
      ]);
      await submitOk(clerkB, wholeDraft);
      // 之後一般的銷售不讓組退回(以開始數那一刻比對)
      now("10:08");
      const tickets = await ticketsAt(counter, gold);
      const unsold = tickets.find((ticket) => ticket.status === "unsold");
      if (unsold === undefined) {
        throw new Error("沒有未售的張");
      }
      await ok(clerkA, SELL, {
        input: {
          orgId: String(xinyi),
          localCashPointId: String(counter),
          tickets: [{ ticketId: String(unsold._id), version: unsold.version }],
          source: "scan",
        },
      });
      // 交班那一張:開始數之後被別張盤點處理過 → 這一組退回重數
      const stale = await review(clerkA, {
        ...shiftDraft,
        countLines: [
          countLineOf(counter, gold, "10:05", 11, { investigateCount: 1 }),
        ],
      });
      expect(stale.staleCount).toBe(1);
      expect(stale.countLines[0]).toMatchObject({
        stale: true,
        systemCount: 12,
      });
      expect(
        await failureOf(
          submit(clerkA, {
            ...shiftDraft,
            countLines: [
              countLineOf(counter, gold, "10:05", 11, { investigateCount: 1 }),
            ],
          }),
        ),
      ).toMatchObject({ reason: STOCKTAKE_REASONS.stale });
      // 重數(10:09 再數,實際 10 張;系統 10)→ 沒差
      now("10:09");
      const recounted = await review(clerkA, {
        ...shiftDraft,
        countLines: [
          countLineOf(counter, gold, "10:09", 10, { recounts: [11] }),
        ],
      });
      expect(recounted.countLines[0]).toMatchObject({
        stale: false,
        kind: "match",
        systemCount: 10,
      });
      // I1 / I5:系統未售 10 = 實體;那張沒刷的只算一次(+200),加上刷條碼賣的 1 張
      const after = await ticketsAt(counter, gold);
      expect(after.filter((ticket) => ticket.status === "unsold")).toHaveLength(
        10,
      );
      expect(await counterCash()).toBe(5400);
    });

    it("舊盤點晚核准不覆蓋新的結果:開始數之後被別張盤點處理過的組,核准時不挑待查", async () => {
      await resetStore();
      now("10:00");
      await counterBook(counter, gold, 12);
      const older = await submitOk(
        clerkA,
        draftOf([
          countLineOf(counter, gold, "10:00", 11, { investigateCount: 1 }),
        ]),
      );
      now("10:10");
      const sale = await countBackfill(clerkB, counter, gold, 1);
      await submitOk(
        clerkB,
        draftOf([
          countLineOf(counter, gold, "10:09", 11, {
            saleCount: 1,
            saleRefIds: [sale.refId],
          }),
        ]),
      );
      now("10:20");
      await decideOn(world, manager, older, "APPROVE");
      expect(await withStatus(counter, gold, "investigating")).toEqual([]);
      expect(await stocktakeOf(older)).toMatchObject({ status: "confirmed" });
    });
  });

  describe("盤點中登記(8.5a;16.7 S9)", () => {
    it("同位置第二張盤點被擋(誰、幾點開始、剩幾分鐘);不重疊的位置照常;每次登記 $inc version", async () => {
      await resetStore();
      now("10:05");
      const before = await versionOf(xinyi);
      const mine = await startOk(clerkA, { cashPointId: String(counter) });
      expect(mine).toMatchObject({
        type: "adhoc",
        wholeStore: false,
        cashPointName: "店內櫃台",
        byName: "王小明",
        mine: true,
        minutesLeft: 60,
        live: true,
      });
      now("10:13");
      expect(
        await failureOf(
          start(clerkB, { type: "shift", cashPointId: String(counter) }),
        ),
      ).toMatchObject({
        code: "CONFLICT",
        reason: STOCKTAKE_REASONS.sessionBusy,
        session: {
          byName: "王小明",
          cashPointName: "店內櫃台",
          startedAt: taipei("10:05").toISOString(),
          minutesLeft: 52,
          canEnd: false,
        },
      });
      // 全店盤點和店內櫃台重疊 → 擋;店外攤位不重疊 → 可以
      expect(await failureOf(start(clerkB, {}))).toMatchObject({
        reason: STOCKTAKE_REASONS.sessionBusy,
      });
      await startOk(clerkB, { type: "shift", cashPointId: String(stall) });
      // 自己另一個進行中的盤點重疊 → 先 [繼續] 或 [放棄]
      expect(
        await failureOf(start(clerkA, { cashPointId: String(counter) })),
      ).toMatchObject({ reason: STOCKTAKE_REASONS.sessionOwn });
      expect(await versionOf(xinyi)).toBe(before + 2);
      // 店長看得到 [結束這個盤點]
      const managerView = await sessionsOf(manager);
      expect(managerView.map((item) => [item.byName, item.canEnd])).toEqual([
        ["王小明", true],
        ["李小華", true],
      ]);
    });

    it("登記同時發生只有一個成功", async () => {
      await resetStore();
      now("10:05");
      const results = await Promise.all([
        start(clerkA, { cashPointId: String(counter) }),
        start(clerkB, { type: "shift", cashPointId: String(counter) }),
      ]);
      expect(
        results.filter((result) => result.errors === undefined),
      ).toHaveLength(1);
      expect(
        results.filter(
          (result) =>
            (result.errors?.[0]?.extensions as { reason?: unknown } | undefined)
              ?.reason === STOCKTAKE_REASONS.sessionBusy,
        ),
      ).toHaveLength(1);
      const record = await countModeRecord(xinyi);
      expect(record?.stocktakeSessions).toHaveLength(1);
    });

    it("重新整理後 [繼續] 還原已數的組與 countedAt;1 小時沒操作自動失效、進度保留;被別人接手後不能繼續", async () => {
      await resetStore();
      now("10:05");
      const session = await startOk(clerkA, { cashPointId: String(counter) });
      const progress = serializeStocktakeDraft(
        draftOf([countLineOf(counter, gold, "10:06", 11, { recounts: [12] })], {
          scopeCashPointId: String(counter),
        }),
      );
      now("10:20");
      const saved = await ok<{ saveLotteryStocktakeSession: Session }>(
        clerkA,
        SAVE,
        {
          input: {
            orgId: String(xinyi),
            sessionId: session.sessionId,
            draft: progress,
          },
        },
      );
      // 有操作就重算倒數
      expect(saved.saveLotteryStocktakeSession.minutesLeft).toBe(60);
      // 別人看不到進度;自己(任何裝置)看得到
      const othersView = await firstSessionOf(clerkB);
      expect(othersView?.draft).toBeNull();
      const resumed = await startOk(clerkA, { sessionId: session.sessionId });
      expect(resumed.sessionId).toBe(session.sessionId);
      expect(JSON.parse(resumed.draft ?? "{}")).toMatchObject({
        countLines: [
          {
            countedAt: taipei("10:06").toISOString(),
            presentCount: 11,
            recounts: [12],
          },
        ],
      });

      // 1 小時沒操作 → 失效:別人可以登記同位置;自己的進度還在(不刪)
      now("11:21");
      expect(await firstSessionOf(clerkA)).toMatchObject({
        live: false,
        minutesLeft: 0,
        draft: progress,
      });
      await startOk(clerkB, { type: "shift", cashPointId: String(counter) });
      expect(
        await failureOf(start(clerkA, { sessionId: session.sessionId })),
      ).toMatchObject({ reason: STOCKTAKE_REASONS.sessionBusy });
      expect(
        await failureOf(
          gql(clerkA, SAVE, {
            input: {
              orgId: String(xinyi),
              sessionId: session.sessionId,
              draft: progress,
            },
          }),
        ),
      ).toMatchObject({ reason: STOCKTAKE_REASONS.sessionEnded });
    });

    it("店長 [結束這個盤點]:解除登記、進度保留、留稽核;不是店長 → FORBIDDEN;[放棄] 自己的 → 整筆拿掉", async () => {
      await resetStore();
      now("10:05");
      const session = await startOk(clerkA, { cashPointId: String(counter) });
      expect(
        await errorOf(clerkB, END, {
          input: { orgId: String(xinyi), sessionId: session.sessionId },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
      now("10:10");
      await ok(manager, END, {
        input: { orgId: String(xinyi), sessionId: session.sessionId },
      });
      expect(
        await connection.collection("audit_logs").findOne({
          action: "lottery-stocktake-session.end",
          actorId: manager.userId,
        }),
      ).toMatchObject({ targetId: xinyi });
      expect(await firstSessionOf(clerkA)).toMatchObject({
        sessionId: session.sessionId,
        ended: true,
        live: false,
      });
      // 解除後別人可以登記;本人回來仍可 [繼續](位置沒被別人佔)
      const other = await startOk(clerkB, { cashPointId: String(stall) });
      const back = await startOk(clerkA, { sessionId: session.sessionId });
      expect(back).toMatchObject({ live: true, ended: false });
      // [放棄]:整筆拿掉
      await ok(clerkB, END, {
        input: { orgId: String(xinyi), sessionId: other.sessionId },
      });
      const remaining = await sessionsOf(clerkB);
      expect(remaining.map((item) => item.sessionId)).toEqual([
        session.sessionId,
      ]);
    });

    it("編號店也登記:沒有那一筆時新增一筆(盤點制度留空 = 仍是編號店)", async () => {
      now("10:05");
      expect(await countModeRecord(daan)).toBeNull();
      const result = await gql(manager, START, {
        input: {
          orgId: String(daan),
          type: "adhoc",
          cashPointId: String(daanPoint),
        },
      });
      expect(result.errors).toBeUndefined();
      expect(await countModeRecord(daan)).toMatchObject({
        mode: null,
        version: 1,
        stocktakeSessions: [expect.objectContaining({ by: manager.userId })],
      });
      const sheet = await ok<{ lotteryStocktakeSheet: { countMode: string } }>(
        manager,
        SHEET,
        { input: { orgId: String(daan) } },
      );
      expect(sheet.lotteryStocktakeSheet.countMode).toBe("numbered");
    });

    it("送出就解除送出的人這個範圍的登記(同一個交易)", async () => {
      await resetStore();
      now("10:00");
      await counterBook(counter, gold, 5);
      await startOk(clerkA, {});
      expect(await sessionsOf(clerkA)).toHaveLength(1);
      await submitOk(clerkA, draftOf([countLineOf(counter, gold, "10:01", 5)]));
      expect(await sessionsOf(clerkA)).toEqual([]);
    });
  });

  it("張數盤點的資料庫指令數與組數無關(防退化,TX-06):差異核對、[算售出]、送出、核准完成", async () => {
    async function commandsOf(groups: number) {
      await resetStore();
      now("10:00");
      const pairs: [Types.ObjectId, Types.ObjectId][] = [
        [counter, gold],
        [counter, lucky],
        [stall, gold],
        [stall, lucky],
      ].slice(0, groups) as [Types.ObjectId, Types.ObjectId][];
      for (const [point, game] of pairs) {
        await counterBook(point, game, 6);
      }
      const backfill = await countDbCommands(() =>
        countBackfill(clerkA, counter, gold, 2),
      );
      const lines = pairs.map(([point, game], index) =>
        countLineOf(
          point,
          game,
          "09:59",
          4,
          index === 0
            ? { saleCount: 2, saleRefIds: [backfill.result.refId] }
            : { investigateCount: 2 },
        ),
      );
      const draft = draftOf(lines);
      const reviewed = await countDbCommands(() => review(clerkA, draft));
      const submitted = await countDbCommands(() => submit(clerkA, draft));
      expect(submitted.result.errors).toBeUndefined();
      const { id } = (
        submitted.result.data as {
          createAndSubmitFormSubmission: { submission: { id: string } };
        }
      ).createAndSubmitFormSubmission.submission;
      const completed = await countDbCommands(() =>
        decideOn(world, manager, id, "APPROVE"),
      );
      return { backfill, reviewed, submitted, completed };
    }
    const two = await commandsOf(2);
    const four = await commandsOf(4);
    for (const key of ["reviewed", "submitted", "completed"] as const) {
      // 帳本依要改的值分組:多一組只多「那一組待查的值」的種類(TX-06);讀取不隨組數成長
      expectDbCommandsAtMost(
        four[key],
        two[key].total + 4,
        `張數盤點 ${key} 4 組(2 組 = ${String(two[key].total)} 次)`,
      );
    }
    expect(four.backfill.total).toBe(two.backfill.total);
  });
});
