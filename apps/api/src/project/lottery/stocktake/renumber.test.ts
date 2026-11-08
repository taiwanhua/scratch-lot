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

import {
  STORE_PERMISSIONS as S,
  STOCKTAKE_CONFIRM_FORM_KEY,
  STOCKTAKE_REASONS,
  type StocktakeDraft,
  type StocktakeDraftLine,
  type TicketLocationKind,
  type TicketStatus,
  bookCountsOf,
  serializeStocktakeDraft,
} from "@repo/domain/project/lottery";
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
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import { LOTTERY_TICKET_EVENTS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket-event.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import { LOTTERY_STORE_COUNT_MODES_COLLECTION } from "../../database/lottery-settings/lottery-store-count-mode.schema";
import {
  LOTTERY_STOCKTAKES_COLLECTION,
  LotteryStocktake,
} from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import { StoreClock } from "../store/store-clock";
import {
  RENUMBER_DUE_JOB_KEY,
  RenumberRemindersService,
} from "./renumber-reminders.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

// ---- GraphQL ----

const SHEET = /* GraphQL */ `
  query Sheet($input: LotteryStocktakeSheetInput!) {
    lotteryStocktakeSheet(input: $input) {
      countMode
      purpose
      books {
        bookId
        cashPointId
        pendingSkipCount
        tickets {
          ticketNo
          status
          unmatched
        }
      }
      countGroups {
        gameCode
      }
    }
  }
`;

const REVIEW = /* GraphQL */ `
  query Review($input: LotteryStocktakeReviewInput!) {
    lotteryStocktakeReview(input: $input) {
      staleCount
      unhandledCount
      renumberMissing
      renumberMatches {
        gameCode
        cashPointName
        ticketNo
        partnerTicketNo
      }
      summary {
        renumberMatched
      }
      lines {
        bookNo
        systemCount
        presentCount
        pendingSkipCount
        diffs {
          ticketNo
          kind
        }
      }
    }
  }
`;

const START_SESSION = /* GraphQL */ `
  mutation StartSession($input: StartLotteryStocktakeSessionInput!) {
    startLotteryStocktakeSession(input: $input) {
      sessionId
      purpose
      wholeStore
    }
  }
`;

const END_SESSION = /* GraphQL */ `
  mutation EndSession($input: EndLotteryStocktakeSessionInput!) {
    endLotteryStocktakeSession(input: $input)
  }
`;

const START_RESCAN = /* GraphQL */ `
  mutation StartRescan($input: StartLotteryRescanInput!) {
    startLotteryRescan(input: $input) {
      id
    }
  }
`;

const MOVE_BY_COUNT = /* GraphQL */ `
  mutation MoveByCount($input: MoveLotteryTicketsByCountInput!) {
    moveLotteryTicketsByCount(input: $input) {
      count
    }
  }
`;

const BOARD = /* GraphQL */ `
  query Board($orgId: ID!) {
    lotteryStoreBoard(orgId: $orgId) {
      item {
        countMode
        movePauses {
          gameId
        }
        renumber {
          due
          lastRenumberAt
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
      }
    }
  }
`;

// ---- 型別與小工具 ----

interface TicketRow {
  _id: Types.ObjectId;
  ticketNo: string;
  status: string;
  unmatched: boolean;
  version: number;
  location: { kind: string; cashPointId: Types.ObjectId | null };
}

interface EventRow {
  ticketId: Types.ObjectId;
  type: string;
  amount: number;
  cashEffect: string;
  refType: string | null;
}

interface ReviewResult {
  staleCount: number;
  unhandledCount: number;
  renumberMissing: number;
  renumberMatches: {
    gameCode: string;
    cashPointName: string | null;
    ticketNo: string;
    partnerTicketNo: string;
  }[];
  summary: { renumberMatched: number };
  lines: {
    bookNo: string;
    pendingSkipCount: number;
    diffs: { ticketNo: string; kind: string }[];
  }[];
}

interface CountModeRow {
  mode: string | null;
  lastRenumberAt: Date | null;
  lastRenumberStocktakeId: Types.ObjectId | null;
  movePauses: { stocktakeId: Types.ObjectId; gameId: Types.ObjectId | null }[];
  history: {
    from: string | null;
    to: string;
    cause: string;
    stocktakeId: Types.ObjectId | null;
  }[];
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

const taipei = (time: string, day = "2026-11-07") =>
  new Date(`${day}T${time}:00+08:00`);

function now(time: string, day?: string): void {
  jest.spyOn(StoreClock.prototype, "now").mockReturnValue(taipei(time, day));
}

/** 一張的布置:張號、狀態(預設未售)、未對號。 */
interface TicketSpec {
  no: string;
  status?: TicketStatus;
  unmatched?: boolean;
}

/** 一本的布置:位置(null = 庫存)、張、還沒標的跳號幾張(迄號 = 100 + 待標註)。 */
interface BookSpec {
  place: Types.ObjectId | null;
  tickets: readonly TicketSpec[];
  pending?: number;
}

/** 依張數賣挑到的是「依張數」、刷條碼賣的是「刷條碼」。 */
const soldSourceOf = (spec: { unmatched?: boolean }): string =>
  spec.unmatched === true ? "count" : "scan";

/** 結果的錯誤 extensions(沒有錯 = undefined)。 */
async function errorOf(
  run: Promise<GraphqlResult>,
): Promise<Record<string, unknown> | undefined> {
  const result = await run;
  return result.errors?.[0]?.extensions;
}

const nos = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    String(from + index).padStart(3, "0"),
  );

/**
 * 補點編號、轉換中、補點編號提醒(張數店規格 9.2、9.3、10、16.8 RN1–RN4、16.2 SW2 / SW3、8.5a B2 / B4;T8):
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);「現在」由 `StoreClock` 注入。
 *
 * 組織樹:root ─ 租戶甲 ─ 信義店(張數店;位置:店內櫃台 A、店外攤位 B、庫存)
 * 遊戲:5164 發大財(X)、5201 金好運(Y),每張 200 元
 */
describe("補點編號與轉換中(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let counterA: Types.ObjectId;
  let stallB: Types.ObjectId;
  let gameX: Types.ObjectId;
  let gameY: Types.ObjectId;
  let world: World;

  let clerk: Person;
  let manager: Person;

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

  /** 一本已拆過的本(`firstOpenedAt` = 07:00 + 序號分鐘,先建的先拆)。 */
  async function book(
    gameId: Types.ObjectId,
    spec: BookSpec,
  ): Promise<{ bookId: Types.ObjectId; bookNo: string }> {
    bookSequence += 1;
    const bookNo = String(bookSequence).padStart(7, "0");
    const gameCode = gameId.equals(gameX) ? "5164" : "5201";
    const pending = spec.pending ?? 0;
    const { insertedId: bookId } = await connection
      .collection("lottery_books")
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        gameId,
        gameCode,
        bookNo,
        bookKey: `${gameCode}-${bookNo}`,
        printVersion: "1",
        holderOrgIds: [xinyi],
        purchaseSubmissionId: null,
        purchasedAt: null,
        purchaseDealerId: null,
        rate: 92,
        cost: 184 * 100,
        standardTickets: 100,
        firstTicketNo: "001",
        lastTicketNo: String(100 + pending),
        skippedTicketNos: [],
        lockedTicketCount: 0,
        firstOpenedAt: new Date(
          taipei("07:00").getTime() + (bookSequence % 1000) * 60_000,
        ),
        status: "normal",
        shareOrgs: [],
        moduleKey: "inventory",
        ...base(),
      });
    const docs = spec.tickets.map((ticket) => {
      const status = ticket.status ?? "unsold";
      return {
        orgId: xinyi,
        tenantId: tenant,
        bookId,
        gameId,
        bookNo,
        ticketNo: ticket.no,
        ticketKey: `${gameCode}-${bookNo}-${ticket.no}`,
        status,
        location:
          spec.place === null
            ? { kind: "stock", cashPointId: null }
            : { kind: "counter", cashPointId: spec.place },
        lockedBy: null,
        responsibleOrgId:
          status === "investigating" || status === "lost" ? xinyi : null,
        unitCost: 184,
        soldAt: status === "sold" ? taipei("09:00") : null,
        soldBy: null,
        soldSource: status === "sold" ? soldSourceOf(ticket) : null,
        unmatched: ticket.unmatched ?? false,
        saleEventId: status === "sold" ? `sale-${bookNo}-${ticket.no}` : null,
        version: 1,
        moduleKey: "inventory",
        ...base(),
      };
    });
    await connection.collection(LOTTERY_TICKETS_COLLECTION).insertMany(docs);
    await connection.collection("lottery_books").updateOne(
      { _id: bookId },
      {
        $set: {
          ticketCounts: bookCountsOf(
            docs.map((doc) => ({
              status: doc.status,
              locationKind: doc.location.kind as TicketLocationKind,
            })),
          ),
        },
      },
    );
    return { bookId, bookNo };
  }

  async function ticket(
    bookId: Types.ObjectId,
    no: string,
  ): Promise<TicketRow> {
    const found = await connection
      .collection<TicketRow>(LOTTERY_TICKETS_COLLECTION)
      .findOne({ bookId, ticketNo: no });
    if (found === null) {
      throw new Error(`沒有 #${no}`);
    }
    return found;
  }

  const stateOf = async (bookId: Types.ObjectId, no: string) => {
    const found = await ticket(bookId, no);
    return [found.status, found.unmatched];
  };

  function eventsOfType(type: string): Promise<EventRow[]> {
    return connection
      .collection<EventRow>(LOTTERY_TICKET_EVENTS_COLLECTION)
      .find({ orgId: xinyi, type })
      .toArray();
  }

  async function record(): Promise<CountModeRow> {
    const found = await connection
      .collection<CountModeRow>(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .findOne({ orgId: xinyi });
    if (found === null) {
      throw new Error("沒有分店那一筆");
    }
    return found;
  }

  const setMode = (mode: string) =>
    connection
      .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .updateOne({ orgId: xinyi }, { $set: { mode } });

  /** 補點編號的一行:這本在這個位置實際在的張。 */
  const lineOf = (
    bookId: Types.ObjectId,
    place: Types.ObjectId | null,
    present: readonly string[],
    diffs: StocktakeDraftLine["diffs"] = [],
  ): StocktakeDraftLine => ({
    bookId: String(bookId),
    cashPointId: place === null ? "stock" : String(place),
    countedAt: taipei("10:05").toISOString(),
    method: "grid",
    presentTicketNos: [...present],
    diffs,
  });

  const draftOf = (lines: StocktakeDraftLine[]): StocktakeDraft => ({
    version: 1,
    orgId: String(xinyi),
    scopeCashPointId: null,
    startedAt: taipei("10:05").toISOString(),
    lines,
    unopened: [],
    lostReview: [],
    countMode: "numbered",
    purpose: "renumber",
  });

  async function review(draft: StocktakeDraft): Promise<ReviewResult> {
    const data = await ok<{ lotteryStocktakeReview: ReviewResult }>(
      clerk,
      REVIEW,
      { input: { draft: serializeStocktakeDraft(draft) } },
    );
    return data.lotteryStocktakeReview;
  }

  function submit(draft: StocktakeDraft): Promise<GraphqlResult> {
    requestSequence += 1;
    return gql(clerk, SUBMIT, {
      input: {
        formKey: STOCKTAKE_CONFIRM_FORM_KEY,
        clientRequestId: `renumber-${String(requestSequence)}`,
        values: {
          branch: draft.orgId,
          scope_label: "全店",
          totals: "",
          draft: serializeStocktakeDraft(draft),
        },
      },
    });
  }

  async function submitOk(draft: StocktakeDraft): Promise<string> {
    const result = await submit(draft);
    expect(result.errors).toBeUndefined();
    return (
      result.data as {
        createAndSubmitFormSubmission: { submission: { id: string } };
      }
    ).createAndSubmitFormSubmission.submission.id;
  }

  function startSession(
    who: Person,
    purpose: string | null,
  ): Promise<GraphqlResult> {
    return gql(who, START_SESSION, {
      input: {
        orgId: String(xinyi),
        type: "adhoc",
        ...(purpose === null ? {} : { purpose }),
      },
    });
  }

  function moveByCount(gameId: Types.ObjectId): Promise<GraphqlResult> {
    return gql(clerk, MOVE_BY_COUNT, {
      input: {
        orgId: String(xinyi),
        fromCashPointId: String(counterA),
        toCashPointId: String(stallB),
        gameId: String(gameId),
        count: 1,
      },
    });
  }

  /**
   * RN1 的布置:A 台遊戲 X 兩本(本一先拆)、B 台遊戲 X 一本。
   * 本一:#001 已售·未對號(實際在)、#002 待查·未對號(實際在)、#003 未售(實際不在)、#004–#008 未售在;
   * 本二:#001–#004 未售,#004 實際不在(跨本配給本一的 #002);
   * B 台本三:#001 已售·未對號(實際不在,猜對了)、#002 #003 未售在。
   */
  async function arrangeRn1() {
    const one = await book(gameX, {
      place: counterA,
      tickets: [
        { no: "001", status: "sold", unmatched: true },
        { no: "002", status: "investigating", unmatched: true },
        ...nos(3, 8).map((no) => ({ no })),
      ],
    });
    const two = await book(gameX, {
      place: counterA,
      tickets: nos(1, 4).map((no) => ({ no })),
    });
    const three = await book(gameX, {
      place: stallB,
      tickets: [
        { no: "001", status: "sold", unmatched: true },
        { no: "002" },
        { no: "003" },
      ],
    });
    const draft = draftOf([
      lineOf(one.bookId, counterA, ["001", "002", ...nos(4, 8)]),
      lineOf(two.bookId, counterA, nos(1, 3)),
      lineOf(three.bookId, stallB, ["002", "003"]),
    ]);
    return { one, two, three, draft };
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-renumber");
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
    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
    const points = connection.collection(LOTTERY_CASH_POINTS_COLLECTION);
    const pointDoc = (name: string, order: number) => ({
      orgId: xinyi,
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
    ({ insertedId: counterA } = await points.insertOne(
      pointDoc("店內櫃台", 1),
    ));
    ({ insertedId: stallB } = await points.insertOne(pointDoc("店外攤位", 2)));
    const gameDoc = (gameCode: string, name: string) => ({
      gameCode,
      name,
      status: "on_sale",
      unitPrice: 200,
      ticketsPerBook: 100,
      bookPrice: 20_000,
      defaultRate: 92,
      color: null,
      orgId: tenant,
      tenantId: tenant,
      shareOrgs: [{ orgId: tenant, includeDescendants: true }],
      moduleKey: "master-data",
      ...base(),
    });
    const games = connection.collection("lottery_games");
    ({ insertedId: gameX } = await games.insertOne(gameDoc("5164", "發大財")));
    ({ insertedId: gameY } = await games.insertOne(gameDoc("5201", "金好運")));
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
        S.move,
        S.stocktake,
        "apply-center.view",
      ],
    };
    clerk = await person(api, connection, xinyi, tenant, clerkScope);
    manager = await person(api, connection, xinyi, tenant, {
      moduleKeys: clerkScope.moduleKeys,
      permissionKeys: [...clerkScope.permissionKeys, S.edit, S.bankDeposit],
    });
    const managerRole = await createRole(api.app, connection, {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [manager.userId],
    });
    await connection
      .collection("users")
      .updateOne({ _id: clerk.userId }, { $set: { name: "王小明" } });
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
    await publishWorkflow(world, "renumber_stocktake_flow", {
      steps: [step],
      checkFormKey: STOCKTAKE_CONFIRM_FORM_KEY,
    });
    await bindForm(
      world,
      "renumber_stocktake_flow",
      STOCKTAKE_CONFIRM_FORM_KEY,
    );
  }, HOOK_TIMEOUT_MS);

  beforeEach(async () => {
    await connection
      .collection(LOTTERY_TICKETS_COLLECTION)
      .deleteMany({ orgId: xinyi });
    await connection
      .collection(LOTTERY_TICKET_EVENTS_COLLECTION)
      .deleteMany({ orgId: xinyi });
    await connection
      .collection(LOTTERY_STOCKTAKES_COLLECTION)
      .deleteMany({ orgId: xinyi });
    await connection.collection("lottery_books").deleteMany({ orgId: xinyi });
    await connection.collection("lottery_settings").deleteMany({});
    await connection.collection(LOTTERY_STORE_COUNT_MODES_COLLECTION).updateOne(
      { orgId: xinyi },
      {
        $set: {
          mode: "count",
          since: taipei("07:00", "2026-10-01"),
          lastRenumberAt: null,
          lastRenumberStocktakeId: null,
          history: [],
          movePauses: [],
          stocktakeSessions: [],
        },
        $setOnInsert: {
          orgId: xinyi,
          tenantId: tenant,
          version: 0,
          moduleKey: "store",
          ...base(),
        },
      },
      { upsert: true },
    );
    now("10:00");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("比對與自動對號(9.3 第 1–3 點;16.8 RN1、RN3)", () => {
    it("補點編號的盤點頁:張數店照編號盤點逐本列出,未對號的格子也列出(虛線)、待標註張數", async () => {
      const { one } = await arrangeRn1();
      await book(gameY, {
        place: stallB,
        tickets: [{ no: "001" }],
        pending: 1,
      });
      const data = await ok<{
        lotteryStocktakeSheet: {
          countMode: string;
          purpose: string;
          books: {
            bookId: string;
            pendingSkipCount: number;
            tickets: { ticketNo: string; status: string; unmatched: boolean }[];
          }[];
          countGroups: unknown[];
        };
      }>(clerk, SHEET, {
        input: { orgId: String(xinyi), purpose: "renumber" },
      });
      const sheet = data.lotteryStocktakeSheet;
      expect(sheet).toMatchObject({
        countMode: "numbered",
        purpose: "renumber",
      });
      expect(sheet.countGroups).toEqual([]);
      const first = sheet.books.find(
        (item) => item.bookId === String(one.bookId),
      );
      expect(first?.tickets.slice(0, 2)).toEqual([
        { ticketNo: "001", status: "sold", unmatched: true },
        { ticketNo: "002", status: "investigating", unmatched: true },
      ]);
      expect(sheet.books.map((item) => item.pendingSkipCount)).toContain(1);
      // 一般盤點照舊是張數盤點(SW2:轉換中也一樣)
      await setMode("converting");
      const normal = await ok<{
        lotteryStocktakeSheet: { countMode: string; purpose: string };
      }>(clerk, SHEET, { input: { orgId: String(xinyi) } });
      expect(normal.lotteryStocktakeSheet).toMatchObject({
        countMode: "count",
        purpose: "normal",
      });
    });

    it("RN1 自動對號:實際在的未對號張配實際不在的未售張、可跨本,不算差異;剩下的照編號差異", async () => {
      const { draft } = await arrangeRn1();
      const checked = await review(draft);
      expect(checked).toMatchObject({
        staleCount: 0,
        unhandledCount: 0,
        renumberMissing: 0,
        summary: { renumberMatched: 2 },
      });
      expect(
        checked.renumberMatches.map((match) => [
          match.ticketNo,
          match.partnerTicketNo,
          match.cashPointName,
        ]),
      ).toEqual([
        ["001", "003", "店內櫃台"],
        ["002", "004", "店內櫃台"],
      ]);
      expect(checked.lines.flatMap((line) => line.diffs)).toEqual([]);

      // 多一張不在的:配完還少 1 張 → 照編號盤點的差異(待處理)
      const extra = await review({
        ...draft,
        lines: draft.lines.map((line, index) =>
          index === 0
            ? { ...line, presentTicketNos: ["001", "002", ...nos(5, 8)] }
            : line,
        ),
      });
      expect(extra.summary.renumberMatched).toBe(2);
      expect(extra.lines.flatMap((line) => line.diffs)).toEqual([
        { ticketNo: "004", kind: "missing" },
      ]);
      expect(extra.unhandledCount).toBe(1);
    });

    it("RN3 每本都要盤,不能沒盤完送出;已拆還有待標註的本一併 [標跳號](最多待標註張數)", async () => {
      const { draft } = await arrangeRn1();
      const partial = { ...draft, lines: draft.lines.slice(0, 2) };
      expect(await errorOf(submit(partial))).toMatchObject({
        reason: STOCKTAKE_REASONS.renumberIncomplete,
      });
      const missing = await review(partial);
      expect(missing.renumberMissing).toBe(1);

      // 本四:迄號 102(待標註 2 張),#004 #005 實際不在 → 標跳號
      const four = await book(gameY, {
        place: stallB,
        tickets: nos(1, 5).map((no) => ({ no })),
        pending: 2,
      });
      const skip = (present: string[], skipped: string[]) =>
        lineOf(
          four.bookId,
          stallB,
          present,
          skipped.map((no) => ({ ticketNo: no, action: "skip" as const })),
        );
      const tooMany = {
        ...draft,
        lines: [...draft.lines, skip(["001", "002"], ["003", "004", "005"])],
      };
      const over = await review(tooMany);
      expect(over.staleCount).toBe(1);
      const full = {
        ...draft,
        lines: [...draft.lines, skip(nos(1, 3), ["004", "005"])],
      };
      const checked = await review(full);
      expect(checked).toMatchObject({ staleCount: 0, unhandledCount: 0 });
      expect(
        checked.lines.find((line) => line.diffs.length > 0)?.pendingSkipCount,
      ).toBe(2);
      const id = await submitOk(full);
      await decideOn(world, manager, id, "APPROVE");
      expect(await stateOf(four.bookId, "004")).toEqual(["skipped", false]);
      expect(await stateOf(four.bookId, "005")).toEqual(["skipped", false]);
      const after = await connection
        .collection<{ skippedTicketNos: string[] }>("lottery_books")
        .findOne({ _id: four.bookId });
      expect(after?.skippedTicketNos).toEqual(["004", "005"]);
    });

    it("不是張數店不能做補點編號;補點只能全店", async () => {
      const { draft } = await arrangeRn1();
      expect(
        await errorOf(submit({ ...draft, scopeCashPointId: String(counterA) })),
      ).toMatchObject({ reason: STOCKTAKE_REASONS.renumberNotAllowed });
      await setMode("numbered");
      expect(await errorOf(startSession(clerk, "renumber"))).toMatchObject({
        reason: STOCKTAKE_REASONS.renumberNotAllowed,
      });
    });
  });

  /** TX-06 用:`pairs` 本各一組自動對號,送出後核准,回核准的資料庫指令數。 */
  async function approvalOf(pairs: number) {
    await connection
      .collection(LOTTERY_TICKETS_COLLECTION)
      .deleteMany({ orgId: xinyi });
    await connection
      .collection(LOTTERY_STOCKTAKES_COLLECTION)
      .deleteMany({ orgId: xinyi });
    const lines: StocktakeDraftLine[] = [];
    for (let index = 0; index < pairs; index += 1) {
      const made = await book(gameX, {
        place: counterA,
        tickets: [
          { no: "001", status: "sold", unmatched: true },
          { no: "002" },
          { no: "003" },
        ],
      });
      lines.push(lineOf(made.bookId, counterA, ["001", "003"]));
    }
    const id = await submitOk(draftOf(lines));
    return countDbCommands(() => decideOn(world, manager, id, "APPROVE"));
  }

  describe("核准與退回(9.3 第 4、5 點;16.8 RN2、16.2 SW3)", () => {
    it("RN2 核准:對號兩筆 match、猜對的每張一筆 renumber_confirm、店內不再有未對號、寫上次補點;張數店不改制度(I1、I4)", async () => {
      const { one, two, three, draft } = await arrangeRn1();
      const id = await submitOk(draft);
      // 送出不動張
      expect(await stateOf(one.bookId, "001")).toEqual(["sold", true]);
      now("10:30");
      await decideOn(world, manager, id, "APPROVE");

      // 對號:實際在的回未售、清記號;配對張接手後猜對了 → 清記號
      expect(await stateOf(one.bookId, "001")).toEqual(["unsold", false]);
      expect(await stateOf(one.bookId, "003")).toEqual(["sold", false]);
      expect(await stateOf(one.bookId, "002")).toEqual(["unsold", false]);
      expect(await stateOf(two.bookId, "004")).toEqual([
        "investigating",
        false,
      ]);
      // B 台的已售·未對號實際不在:猜對了
      expect(await stateOf(three.bookId, "001")).toEqual(["sold", false]);
      expect(
        await connection
          .collection(LOTTERY_TICKETS_COLLECTION)
          .countDocuments({ orgId: xinyi, unmatched: true }),
      ).toBe(0);
      // I1:各位置未售張數 = 實體張數
      expect(
        await connection.collection(LOTTERY_TICKETS_COLLECTION).countDocuments({
          orgId: xinyi,
          status: "unsold",
          "location.cashPointId": counterA,
        }),
      ).toBe(10);
      // I4:對號不動現金
      const matches = await eventsOfType("match");
      expect(matches).toHaveLength(4);
      expect(
        matches.every(
          (event) => event.cashEffect === "none" && event.amount === 0,
        ),
      ).toBe(true);
      const confirms = await eventsOfType("renumber_confirm");
      expect(confirms).toHaveLength(3);
      expect(confirms.every((event) => event.refType === "stocktake")).toBe(
        true,
      );
      const after = await record();
      expect(after.mode).toBe("count");
      expect(after.lastRenumberAt).toEqual(taipei("10:30"));
      const stocktake = await connection
        .collection(LOTTERY_STOCKTAKES_COLLECTION)
        .findOne({ orgId: xinyi });
      expect(String(after.lastRenumberStocktakeId)).toBe(
        String(stocktake?._id),
      );
      expect(after.history).toEqual([
        expect.objectContaining({
          from: "count",
          to: "count",
          cause: "renumber_approved",
        }),
      ]);
    });

    it("RN2 轉換中核准 → 改成編號、歷程記補點的盤點單;退回 → 維持原狀、可以再盤", async () => {
      await setMode("converting");
      const { one, draft } = await arrangeRn1();
      const returned = await submitOk(draft);
      await decideOn(world, manager, returned, "RETURN");
      expect(await stateOf(one.bookId, "001")).toEqual(["sold", true]);
      const kept = await record();
      expect(kept.mode).toBe("converting");
      expect(await eventsOfType("match")).toEqual([]);

      await connection
        .collection(LOTTERY_STOCKTAKES_COLLECTION)
        .deleteMany({ orgId: xinyi });
      const id = await submitOk(draft);
      await decideOn(world, manager, id, "APPROVE");
      const after = await record();
      expect(after.mode).toBe("numbered");
      expect(after.history).toEqual([
        expect.objectContaining({
          from: "converting",
          to: "numbered",
          cause: "renumber_approved",
          stocktakeId: after.lastRenumberStocktakeId,
        }),
      ]);
    });

    it("SW3 審核中的補點編號不算進行中(可以取消轉換);取消轉換回張數後照樣核准,不改制度", async () => {
      await setMode("converting");
      const { draft } = await arrangeRn1();
      await ok(clerk, START_SESSION, {
        input: { orgId: String(xinyi), type: "adhoc", purpose: "renumber" },
      });
      const during = await record();
      expect(during.movePauses).toHaveLength(1);
      const id = await submitOk(draft);
      // 送出就解除登記與暫停 → 改盤點制度不會被「補點編號還沒結束」擋
      const submitted = await record();
      expect(submitted.movePauses).toEqual([]);
      // [取消轉換](照 `cancelLotteryCountModeConversion` 寫分店那一筆)
      await connection
        .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
        .updateOne(
          { orgId: xinyi },
          {
            $set: { mode: "count" },
            $push: {
              history: {
                from: "converting",
                to: "count",
                at: taipei("10:10"),
                by: manager.userId,
                cause: "convert_cancelled",
                stocktakeId: null,
              },
            } as never,
          },
        );
      await decideOn(world, manager, id, "APPROVE");
      const after = await record();
      expect(after.mode).toBe("count");
      expect(
        after.history.map((entry) => [entry.from, entry.to, entry.cause]),
      ).toEqual([
        ["converting", "count", "convert_cancelled"],
        ["count", "count", "renumber_approved"],
      ]);
    });

    it("TX-06:核准時寫入整批(對號 2 組 vs 4 組只多帳本依值分組的那幾次)", async () => {
      const two = await approvalOf(2);
      const four = await approvalOf(4);
      expect(await eventsOfType("match")).toHaveLength(12);
      // 讀取不隨張數成長;帳本依要改的值分組:對號的配對張各自接手不同的售出事件 → 多 2 組多 2 × 2 次
      expectDbCommandsAtMost(
        four,
        two.total + 4,
        `補點編號核准 4 組(2 組 = ${String(two.total)} 次)`,
      );
    });
  });

  describe("移櫃暫停與互斥(8.5、8.5a B2 / B4;16.7 S6)", () => {
    it("補點中全部遊戲的移櫃被擋、不能開始重刷;送出 / 放棄 / 1 小時沒操作後解除", async () => {
      await book(gameX, {
        place: counterA,
        tickets: nos(1, 3).map((no) => ({ no })),
      });
      await book(gameY, {
        place: counterA,
        tickets: nos(1, 3).map((no) => ({ no })),
      });
      const started = await ok<{
        startLotteryStocktakeSession: {
          sessionId: string;
          purpose: string;
          wholeStore: boolean;
        };
      }>(clerk, START_SESSION, {
        input: { orgId: String(xinyi), type: "adhoc", purpose: "renumber" },
      });
      expect(started.startLotteryStocktakeSession).toMatchObject({
        purpose: "renumber",
        wholeStore: true,
      });
      const { movePauses: pauses } = await record();
      expect(pauses).toEqual([
        { stocktakeId: expect.any(Types.ObjectId), gameId: null },
      ]);
      for (const gameId of [gameX, gameY]) {
        expect(await errorOf(moveByCount(gameId))).toMatchObject({
          reason: "MOVE_PAUSED",
        });
      }
      expect(
        await errorOf(
          gql(clerk, START_RESCAN, {
            input: { orgId: String(xinyi), gameId: String(gameX) },
          }),
        ),
      ).toMatchObject({ block: "renumber" });
      const board = await ok<{
        lotteryStoreBoard: {
          item: { movePauses: { gameId: string | null }[] };
        };
      }>(clerk, BOARD, { orgId: String(xinyi) });
      expect(board.lotteryStoreBoard.item.movePauses).toEqual([
        { gameId: null },
      ]);

      // 1 小時沒操作:登記失效,暫停不再算(移櫃可以)
      now("11:01");
      const moved = await moveByCount(gameX);
      expect(moved.errors).toBeUndefined();
      // 本人 [放棄]:登記與暫停一起拿掉
      await ok(clerk, END_SESSION, {
        input: {
          orgId: String(xinyi),
          sessionId: started.startLotteryStocktakeSession.sessionId,
        },
      });
      const ended = await record();
      expect(ended.movePauses).toEqual([]);
    });

    it("B4 有遊戲正在全店重刷 → 不能開始補點編號", async () => {
      await book(gameX, {
        place: counterA,
        tickets: nos(1, 3).map((no) => ({ no })),
      });
      await ok(clerk, START_RESCAN, {
        input: { orgId: String(xinyi), gameId: String(gameX) },
      });
      expect(await errorOf(startSession(clerk, "renumber"))).toMatchObject({
        code: "CONFLICT",
        reason: STOCKTAKE_REASONS.renumberBlocked,
      });
    });

    it("開始補點與移櫃同時發生:結果只會是先移後補點或移櫃被擋(同一份文件 version 先後)", async () => {
      await book(gameX, {
        place: counterA,
        tickets: nos(1, 5).map((no) => ({ no })),
      });
      const [moved, started] = await Promise.all([
        moveByCount(gameX),
        startSession(manager, "renumber"),
      ]);
      expect(started.errors).toBeUndefined();
      const movedCount = await connection
        .collection(LOTTERY_TICKET_EVENTS_COLLECTION)
        .countDocuments({ orgId: xinyi, type: "move" });
      if (moved.errors === undefined) {
        expect(movedCount).toBe(1);
      } else {
        expect(moved.errors[0]?.extensions).toMatchObject({
          reason: "MOVE_PAUSED",
        });
        expect(movedCount).toBe(0);
      }
      const after = await record();
      expect(after.movePauses).toHaveLength(1);
    });
  });

  /** 注入排程時點跑一次補點編號到期提醒(`notify` 換成記錄),回這家店收到的通知。 */
  async function remindersAt(
    day: string,
    time: string,
  ): Promise<NotifyInput[]> {
    const calls: NotifyInput[] = [];
    const spy = jest
      .spyOn(api.app.get(NotificationService), "notify")
      .mockImplementation((input: NotifyInput) => {
        calls.push(input);
        return Promise.resolve();
      });
    try {
      await api.app.get(RenumberRemindersService).run({
        key: RENUMBER_DUE_JOB_KEY,
        scheduledFor: taipei(time, day),
        tenants: [{ tenantId: tenant, timezone: "Asia/Taipei" }],
      });
    } finally {
      spy.mockRestore();
    }
    return calls.filter((call) => String(call.orgId) === String(xinyi));
  }

  describe("補點編號提醒(第 10 節;16.8 RN4)", () => {
    it("每月(程式預設):上次補點後滿一個月到期,當天起每天 09:00 一則;看板顯示上次日期;編號店不提醒", async () => {
      await connection
        .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
        .updateOne(
          { orgId: xinyi },
          { $set: { lastRenumberAt: taipei("15:00", "2026-10-07") } },
        );
      expect(await remindersAt("2026-11-06", "09:00")).toEqual([]);
      const due = await remindersAt("2026-11-07", "09:00");
      expect(due).toHaveLength(1);
      expect(due[0]).toMatchObject({
        type: "lottery.renumber-due",
        params: { orgName: "信義店", last: "2026-10-07" },
        dedupeKey: "lottery.renumber-due:" + String(xinyi) + ":2026-11-07",
      });
      // 同一天補跑仍是同一個時點(去重);隔天又一則
      const again = await remindersAt("2026-11-07", "09:15");
      expect(again[0]?.dedupeKey).toBe(due[0]?.dedupeKey);
      const nextDay = await remindersAt("2026-11-08", "09:00");
      expect(nextDay[0]?.dedupeKey).toBe(
        "lottery.renumber-due:" + String(xinyi) + ":2026-11-08",
      );
      now("16:00", "2026-11-07");
      const board = await ok<{
        lotteryStoreBoard: {
          item: { renumber: { due: boolean; lastRenumberAt: string } | null };
        };
      }>(clerk, BOARD, { orgId: String(xinyi) });
      expect(board.lotteryStoreBoard.item.renumber).toEqual({
        due: true,
        lastRenumberAt: taipei("15:00", "2026-10-07").toISOString(),
      });

      await setMode("numbered");
      expect(await remindersAt("2026-11-08", "09:00")).toEqual([]);
    });

    it("「不設」→ 不提醒、看板不到期", async () => {
      await connection.collection("lottery_settings").insertOne({
        orgId: xinyi,
        tenantId: tenant,
        key: "renumber_reminder",
        enabled: true,
        value: { option: "none" },
        level: "org",
        order: 0,
        moduleKey: "lottery-settings",
        ...base(),
      });
      expect(await remindersAt("2026-11-07", "09:00")).toEqual([]);
      const board = await ok<{
        lotteryStoreBoard: { item: { renumber: { due: boolean } | null } };
      }>(clerk, BOARD, { orgId: String(xinyi) });
      expect(board.lotteryStoreBoard.item.renumber?.due).toBe(false);
    });
  });
});
