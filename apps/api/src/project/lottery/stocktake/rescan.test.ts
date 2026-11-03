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
  RESCAN_REASONS,
  STORE_PERMISSIONS as S,
  STOCKTAKE_CONFIRM_FORM_KEY,
  STOCKTAKE_REASONS,
  type StocktakeDraft,
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
import { countDbCommands } from "../../../database/test-support/db-commands";
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
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import {
  type Person,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  bindForm,
  person,
  publishWorkflow,
  reviewStep,
  roleSource,
} from "../../../workflows/test-support/workflow-fixtures";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import { LOTTERY_TICKET_EVENTS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket-event.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import { LotteryStoreCountModesRepository } from "../../database/lottery-settings/lottery-settings.repositories";
import { LOTTERY_STORE_COUNT_MODES_COLLECTION } from "../../database/lottery-settings/lottery-store-count-mode.schema";
import {
  LOTTERY_STOCKTAKES_COLLECTION,
  LotteryStocktake,
} from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import { StoreCountModeService } from "../settings/store-count-mode.service";
import { StoreClock } from "../store/store-clock";
import { RescanExpiryService } from "./rescan-expiry.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

// ---- GraphQL ----

const RESCAN_FIELDS = /* GraphQL */ `
  id
  gameId
  gameCode
  status
  cancelCause
  startedByName
  minutesLeft
  canCancel
  doneCount
  places {
    cashPointId
    name
    state
    scanningByName
    mine
    scannedCount
    items {
      ticketId
      ticketNo
      outcome
      partnerTicketNo
    }
  }
  results {
    ticketId
    ticketNo
    outcome
    partnerTicketNo
    cashPointId
  }
`;

const START_RESCAN = /* GraphQL */ `
  mutation StartRescan($input: StartLotteryRescanInput!) {
    startLotteryRescan(input: $input) {
      ${RESCAN_FIELDS}
    }
  }
`;

const RESCAN = /* GraphQL */ `
  query Rescan($input: LotteryRescanInput!) {
    lotteryRescan(input: $input) {
      ${RESCAN_FIELDS}
    }
  }
`;

const SCAN = /* GraphQL */ `
  mutation Scan($input: ScanLotteryRescanTicketInput!) {
    scanLotteryRescanTicket(input: $input) {
      duplicate
      item {
        ticketNo
        outcome
      }
      rescan {
        ${RESCAN_FIELDS}
      }
    }
  }
`;

const FINISH = /* GraphQL */ `
  mutation Finish($input: FinishLotteryRescanPlaceInput!) {
    finishLotteryRescanPlace(input: $input) {
      ${RESCAN_FIELDS}
    }
  }
`;

const CANCEL = /* GraphQL */ `
  mutation Cancel($input: LotteryRescanInput!) {
    cancelLotteryRescan(input: $input) {
      ${RESCAN_FIELDS}
    }
  }
`;

const STATUS = /* GraphQL */ `
  query Status($orgId: ID!) {
    lotteryStocktakeStatus(orgId: $orgId) {
      lastSubmittedAt
      rescans {
        id
        gameCode
        doneCount
        minutesLeft
        places {
          cashPointId
          state
        }
      }
      rescanReminders {
        gameCode
        investigateCount
        flaggedCount
      }
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

const MOVE = /* GraphQL */ `
  mutation Move($input: MoveLotteryTicketsInput!) {
    moveLotteryTickets(input: $input) {
      count
    }
  }
`;

const START_SESSION = /* GraphQL */ `
  mutation StartSession($input: StartLotteryStocktakeSessionInput!) {
    startLotteryStocktakeSession(input: $input) {
      sessionId
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

interface RescanItem {
  ticketId: string;
  ticketNo: string;
  outcome: string;
  partnerTicketNo: string | null;
  cashPointId?: string | null;
}

interface RescanPlace {
  cashPointId: string | null;
  name: string;
  state: string;
  scanningByName: string | null;
  mine: boolean;
  scannedCount: number;
  items: RescanItem[];
}

interface Rescan {
  id: string;
  gameId: string;
  gameCode: string;
  status: string;
  cancelCause: string | null;
  startedByName: string;
  minutesLeft: number;
  canCancel: boolean;
  doneCount: number;
  places: RescanPlace[];
  results: RescanItem[];
}

interface Status {
  rescans: {
    id: string;
    gameCode: string;
    doneCount: number;
    minutesLeft: number;
    places: { cashPointId: string | null; state: string }[];
  }[];
  rescanReminders: {
    gameCode: string;
    investigateCount: number;
    flaggedCount: number;
  }[];
}

interface TicketRow {
  _id: Types.ObjectId;
  ticketNo: string;
  status: string;
  unmatched: boolean;
  version: number;
  location: { kind: string; cashPointId: Types.ObjectId | null };
  responsibleOrgId: Types.ObjectId | null;
}

interface EventRow {
  ticketId: Types.ObjectId;
  type: string;
  amount: number;
  cashEffect: string;
  refType: string | null;
  refId: Types.ObjectId | null;
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

const taipei = (time: string) => new Date(`2026-11-07T${time}:00+08:00`);

function now(time: string): void {
  jest.spyOn(StoreClock.prototype, "now").mockReturnValue(taipei(time));
}

/** 一張的布置:張號、狀態(預設未售)、未對號、鎖定。 */
interface TicketSpec {
  no: string;
  status?: TicketStatus;
  unmatched?: boolean;
  locked?: boolean;
  /** 系統記的位置(預設 = 本的位置) */
  at?: Types.ObjectId | null;
}

/**
 * 全店重刷、提醒與移櫃暫停(張數店規格 8.3–8.5a、16.7 S3–S7、S9 / S10 的重刷部分;T6):打真的 GraphQL 端點、
 * 對真 MongoDB(TEST-07);「現在」由 `StoreClock` 注入。
 *
 * 組織樹:root ─ 租戶甲 ─ 信義店(張數店;位置:店內櫃台 A、店外攤位 B、庫存)
 * 遊戲:5164 發大財(X)、5201 金好運(Y)、5133 招財貓(Z),每張 200 元
 */
describe("全店重刷、提醒與移櫃暫停(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let counterA: Types.ObjectId;
  let stallB: Types.ObjectId;
  let gameX: Types.ObjectId;
  let gameY: Types.ObjectId;
  let gameZ: Types.ObjectId;

  /** 王小明、李小華:店員(銷售、盤點、移櫃);店長:`store.edit`、`store.bank-deposit`(收全店重刷提醒) */
  let clerkA: Person;
  let clerkB: Person;
  let manager: Person;

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

  const codeOf = (gameId: Types.ObjectId): string => {
    if (gameId.equals(gameX)) {
      return "5164";
    }
    return gameId.equals(gameY) ? "5201" : "5133";
  };

  /**
   * 一本已拆過的本(`firstOpenedAt` = 07:00):`place` = 收銀點(null = 庫存),張依 `tickets` 布置。
   * 回傳本號與張號 → 條碼(正面條碼 = 本號 7 位 + 張號 3 位)。
   */
  async function book(
    gameId: Types.ObjectId,
    place: Types.ObjectId | null,
    tickets: readonly TicketSpec[],
    options: { opened?: boolean } = {},
  ): Promise<{ bookId: Types.ObjectId; code: (no: string) => string }> {
    bookSequence += 1;
    const bookNo = String(bookSequence).padStart(7, "0");
    const gameCode = codeOf(gameId);
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
        lastTicketNo: "100",
        skippedTicketNos: [],
        lockedTicketCount: 0,
        firstOpenedAt: options.opened === false ? null : taipei("07:00"),
        status: "normal",
        shareOrgs: [],
        moduleKey: "inventory",
        ...base(),
      });
    const docs = tickets.map((spec) => {
      const at = spec.at === undefined ? place : spec.at;
      const status = spec.status ?? "unsold";
      return {
        orgId: xinyi,
        tenantId: tenant,
        bookId,
        gameId,
        bookNo,
        ticketNo: spec.no,
        ticketKey: `${gameCode}-${bookNo}-${spec.no}`,
        status,
        location:
          at === null
            ? { kind: "stock", cashPointId: null }
            : { kind: "counter", cashPointId: at },
        lockedBy:
          spec.locked === true
            ? { refType: "transfer", refId: new Types.ObjectId() }
            : null,
        responsibleOrgId:
          status === "investigating" || status === "lost" ? xinyi : null,
        unitCost: 184,
        soldAt: status === "sold" ? taipei("09:00") : null,
        soldBy: null,
        soldSource:
          status === "sold"
            ? spec.unmatched === true
              ? "count"
              : "scan"
            : null,
        unmatched: spec.unmatched ?? false,
        saleEventId: status === "sold" ? `sale-${bookNo}-${spec.no}` : null,
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
    return { bookId, code: (no: string) => `${bookNo}${no}` };
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

  /** I1:某位置某遊戲的系統未售張數。 */
  function unsoldAt(
    place: Types.ObjectId | null,
    gameId = gameX,
  ): Promise<number> {
    return connection.collection(LOTTERY_TICKETS_COLLECTION).countDocuments({
      orgId: xinyi,
      gameId,
      status: "unsold",
      ...(place === null
        ? { "location.kind": "stock" }
        : { "location.kind": "counter", "location.cashPointId": place }),
    });
  }

  async function startRescan(who: Person, gameId = gameX): Promise<Rescan> {
    const data = await ok<{ startLotteryRescan: Rescan }>(who, START_RESCAN, {
      input: { orgId: String(xinyi), gameId: String(gameId) },
    });
    return data.startLotteryRescan;
  }

  const placeInput = (place: Types.ObjectId | null) =>
    place === null ? {} : { cashPointId: String(place) };

  function scan(
    who: Person,
    rescanId: string,
    place: Types.ObjectId | null,
    code: string,
  ): Promise<GraphqlResult> {
    return gql(who, SCAN, {
      input: { orgId: String(xinyi), rescanId, code, ...placeInput(place) },
    });
  }

  async function scanAll(
    who: Person,
    rescanId: string,
    place: Types.ObjectId | null,
    codes: readonly string[],
  ): Promise<void> {
    for (const code of codes) {
      const result = await scan(who, rescanId, place, code);
      expect(result.errors).toBeUndefined();
    }
  }

  async function finish(
    who: Person,
    rescanId: string,
    place: Types.ObjectId | null,
  ): Promise<Rescan> {
    const data = await ok<{ finishLotteryRescanPlace: Rescan }>(who, FINISH, {
      input: { orgId: String(xinyi), rescanId, ...placeInput(place) },
    });
    return data.finishLotteryRescanPlace;
  }

  async function view(who: Person, rescanId: string): Promise<Rescan> {
    const data = await ok<{ lotteryRescan: Rescan }>(who, RESCAN, {
      input: { orgId: String(xinyi), rescanId },
    });
    return data.lotteryRescan;
  }

  async function status(who: Person): Promise<Status> {
    const data = await ok<{ lotteryStocktakeStatus: Status }>(who, STATUS, {
      orgId: String(xinyi),
    });
    return data.lotteryStocktakeStatus;
  }

  function moveByCount(
    who: Person,
    gameId: Types.ObjectId,
    count = 1,
  ): Promise<GraphqlResult> {
    return gql(who, MOVE_BY_COUNT, {
      input: {
        orgId: String(xinyi),
        fromCashPointId: String(counterA),
        toCashPointId: String(stallB),
        gameId: String(gameId),
        count,
      },
    });
  }

  async function pauses(): Promise<{ gameId: Types.ObjectId | null }[]> {
    const record = await connection
      .collection<{ movePauses: { gameId: Types.ObjectId | null }[] }>(
        LOTTERY_STORE_COUNT_MODES_COLLECTION,
      )
      .findOne({ orgId: xinyi });
    return record?.movePauses ?? [];
  }

  function eventsOf(ticketId: Types.ObjectId): Promise<EventRow[]> {
    return connection
      .collection<EventRow>(LOTTERY_TICKET_EVENTS_COLLECTION)
      .find({ ticketId })
      .sort({ at: 1, _id: 1 })
      .toArray();
  }

  const outcomesOf = (items: readonly RescanItem[]) =>
    Object.fromEntries(items.map((item) => [item.ticketNo, item.outcome]));

  const placeOf = (rescan: Rescan, place: Types.ObjectId | null) => {
    const found = rescan.places.find((one) =>
      place === null
        ? one.cashPointId === null
        : one.cashPointId === String(place),
    );
    if (found === undefined) {
      throw new Error("沒有這個位置");
    }
    return found;
  };

  function draftOf(
    countLines: StocktakeDraft["countLines"],
    scope: Types.ObjectId | null = null,
  ): StocktakeDraft {
    return {
      version: 1,
      orgId: String(xinyi),
      scopeCashPointId: scope === null ? null : String(scope),
      startedAt: taipei("10:05").toISOString(),
      lines: [],
      unopened: [],
      lostReview: [],
      countMode: "count",
      purpose: "normal",
      countLines,
    };
  }

  function submit(who: Person, draft: StocktakeDraft): Promise<GraphqlResult> {
    requestSequence += 1;
    return gql(who, SUBMIT, {
      input: {
        formKey: STOCKTAKE_CONFIRM_FORM_KEY,
        clientRequestId: `rescan-stocktake-${String(requestSequence)}`,
        values: {
          branch: draft.orgId,
          scope_label: "全店",
          totals: "",
          draft: serializeStocktakeDraft(draft),
        },
      },
    });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-rescan");
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
    ({ insertedId: gameZ } = await games.insertOne(gameDoc("5133", "招財貓")));

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
    clerkA = await person(api, connection, xinyi, tenant, clerkScope);
    clerkB = await person(api, connection, xinyi, tenant, clerkScope);
    manager = await person(api, connection, xinyi, tenant, {
      moduleKeys: clerkScope.moduleKeys,
      permissionKeys: [...clerkScope.permissionKeys, S.edit, S.bankDeposit],
    });
    const managerRole = await createRole(api.app, connection, {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [manager.userId],
    });
    const users = connection.collection("users");
    await users.updateOne({ _id: clerkA.userId }, { $set: { name: "王小明" } });
    await users.updateOne({ _id: clerkB.userId }, { $set: { name: "李小華" } });
    await users.updateOne(
      { _id: manager.userId },
      { $set: { name: "何店長" } },
    );

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
    const world = { api, connection, admin } as unknown as World;
    const step: StepDef = reviewStep("store", roleSource(managerRole));
    await publishWorkflow(world, "rescan_stocktake_flow", {
      steps: [step],
      checkFormKey: STOCKTAKE_CONFIRM_FORM_KEY,
    });
    await bindForm(world, "rescan_stocktake_flow", STOCKTAKE_CONFIRM_FORM_KEY);
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
    await connection.collection("notifications").deleteMany({});
    await connection.collection(LOTTERY_STORE_COUNT_MODES_COLLECTION).updateOne(
      { orgId: xinyi },
      {
        $set: {
          mode: "count",
          since: taipei("07:00"),
          movePauses: [],
          stocktakeSessions: [],
        },
        $setOnInsert: {
          orgId: xinyi,
          tenantId: tenant,
          lastRenumberAt: null,
          lastRenumberStocktakeId: null,
          history: [],
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

  describe("全店重刷的結果(8.4;16.7 S4、S7)", () => {
    it("S4 三種結果:對號、尋回留在刷到的位置、記已售但還在、確定不在;含系統位置記錯的張;所有位置刷完才結束(I1–I4)", async () => {
      // 店內櫃台 A:系統 #001–#005 未售、#006 已售·未對號、#007 待查·未對號、#008 未售;
      // 實體在 A:#001 #002 #003 #006 #007(#004、#005 不見了;#008 其實在庫存)
      const a = await book(gameX, counterA, [
        { no: "001" },
        { no: "002" },
        { no: "003" },
        { no: "004" },
        { no: "005" },
        { no: "006", status: "sold", unmatched: true },
        { no: "007", status: "investigating", unmatched: true },
        { no: "008" },
      ]);
      // 店外攤位 B:#011 #012 未售、#013 刷條碼售出(確定的已售)但實體還在、#014 未售但不見了
      const b = await book(gameX, stallB, [
        { no: "011" },
        { no: "012" },
        { no: "013", status: "sold" },
        { no: "014" },
      ]);
      // 庫存:#031–#034 未售(都在)
      const stock = await book(gameX, null, [
        { no: "031" },
        { no: "032" },
        { no: "033" },
        { no: "034" },
      ]);
      const publish = jest.spyOn(
        api.app.get(RealtimePublisher),
        "publishAfterCommit",
      );
      const rescan = await startRescan(clerkA);
      expect(rescan.status).toBe("in_progress");
      expect(rescan.places.map((place) => place.name)).toEqual([
        "店內櫃台",
        "店外攤位",
        "",
      ]);
      expect(publish).toHaveBeenCalled();
      expect(await pauses()).toEqual([
        expect.objectContaining({ gameId: gameX }),
      ]);

      await scanAll(clerkA, rescan.id, counterA, [
        a.code("001"),
        a.code("002"),
        a.code("003"),
        a.code("006"),
        a.code("007"),
      ]);
      // 刷到的結果即時列出(還沒寫;按刷完才寫)
      const preview = placeOf(await view(clerkA, rescan.id), counterA);
      expect(preview.state).toBe("scanning");
      expect(outcomesOf(preview.items)).toEqual({
        "001": "ok",
        "002": "ok",
        "003": "ok",
        "006": "matched",
        "007": "matched",
      });
      expect((await ticket(a.bookId, "006")).status).toBe("sold");

      publish.mockClear();
      const afterA = await finish(clerkA, rescan.id, counterA);
      expect(publish).toHaveBeenCalled();
      expect(afterA.status).toBe("in_progress");
      // #006 配到 #004(變已售·未對號)、#007 配到 #005(變待查·未對號);#008 沒刷到 → 待查
      expect(outcomesOf(afterA.results)).toEqual({
        "006": "matched",
        "007": "matched",
        "008": "investigated",
      });
      expect(await ticket(a.bookId, "004")).toMatchObject({
        status: "sold",
        unmatched: true,
      });
      expect(await ticket(a.bookId, "005")).toMatchObject({
        status: "investigating",
        unmatched: true,
      });
      expect(await ticket(a.bookId, "006")).toMatchObject({
        status: "unsold",
        unmatched: false,
      });
      expect(await ticket(a.bookId, "008")).toMatchObject({
        status: "investigating",
        unmatched: false,
      });
      expect(await unsoldAt(counterA)).toBe(5);
      // I4:對號不影響現金、金額 0
      for (const event of await eventsOf((await ticket(a.bookId, "006"))._id)) {
        expect(event).toMatchObject({
          type: "match",
          cashEffect: "none",
          amount: 0,
        });
      }

      await scanAll(clerkB, rescan.id, stallB, [
        b.code("011"),
        b.code("012"),
        b.code("013"),
      ]);
      const afterB = await finish(clerkB, rescan.id, stallB);
      expect(
        afterB.results.filter((item) => item.outcome === "sold_here"),
      ).toEqual([expect.objectContaining({ ticketNo: "013" })]);
      // 重刷不直接改回未售(7.3 第 4 點):#013 照舊已售,送撤銷售出申請
      expect((await ticket(b.bookId, "013")).status).toBe("sold");

      // 庫存刷到 #008(系統記在 A、刷完 A 時記成待查)→ 庫存沒有沒刷到的未售可配對 → 尋回、留在庫存
      await scanAll(clerkA, rescan.id, null, [
        stock.code("031"),
        stock.code("032"),
        stock.code("033"),
        stock.code("034"),
        a.code("008"),
      ]);
      expect((await view(clerkA, rescan.id)).status).toBe("in_progress");
      const done = await finish(clerkA, rescan.id, null);
      expect(done.status).toBe("finished");
      expect(done.doneCount).toBe(3);
      expect(await ticket(a.bookId, "008")).toMatchObject({
        status: "unsold",
        location: { kind: "stock", cashPointId: null },
        responsibleOrgId: null,
      });
      expect(outcomesOf(placeOf(done, null).items)).toEqual({
        "008": "recovered",
      });
      // B 的 #014 沒刷到 → 確定待查(I3)
      expect(await ticket(b.bookId, "014")).toMatchObject({
        status: "investigating",
        unmatched: false,
      });
      // I1:每個位置的系統未售 = 實體(B 的 #013 等撤銷售出申請)
      expect(await unsoldAt(counterA)).toBe(5);
      expect(await unsoldAt(stallB)).toBe(2);
      expect(await unsoldAt(null)).toBe(5);
      // 寫入記成這張重刷單(B6 會把重刷寫的事件當成「別張盤點處理過」)
      const recovered = await eventsOf((await ticket(a.bookId, "008"))._id);
      expect(recovered.at(-1)).toMatchObject({
        type: "recover",
        refType: "stocktake",
        refId: new Types.ObjectId(rescan.id),
      });
      // 完成 → 移櫃暫停解除
      expect(await pauses()).toEqual([]);
    });

    it("S7 刷到記跳號、記報廢、鎖定中的張 → 不動、要先更正;不是這個遊戲 → 不處理", async () => {
      const a = await book(gameX, counterA, [
        { no: "001" },
        { no: "002", status: "skipped" },
        { no: "003", status: "scrapped" },
        { no: "004", locked: true },
      ]);
      const other = await book(gameY, counterA, [{ no: "001" }]);
      const rescan = await startRescan(clerkA);
      await scanAll(clerkA, rescan.id, counterA, [
        a.code("001"),
        a.code("002"),
        a.code("003"),
        a.code("004"),
        other.code("001"),
      ]);
      const done = await finish(clerkA, rescan.id, counterA);
      expect(outcomesOf(placeOf(done, counterA).items)).toEqual({
        "002": "skipped",
        "003": "scrapped",
        "004": "locked",
      });
      expect((await ticket(a.bookId, "002")).status).toBe("skipped");
      expect((await ticket(a.bookId, "003")).status).toBe("scrapped");
      // 鎖定中的張刷到了、不記待查
      expect((await ticket(a.bookId, "004")).status).toBe("unsold");
      expect((await ticket(other.bookId, "001")).status).toBe("unsold");
      expect(await eventsOf((await ticket(a.bookId, "002"))._id)).toEqual([]);
    });

    it("刷到一半的清單每刷一張就存(換裝置可接著刷);重複刷到不重複算;找不到的碼 → 說明", async () => {
      const a = await book(gameX, counterA, [{ no: "001" }, { no: "002" }]);
      const rescan = await startRescan(clerkA);
      await scanAll(clerkA, rescan.id, counterA, [a.code("001")]);
      const again = await ok<{
        scanLotteryRescanTicket: { duplicate: boolean; rescan: Rescan };
      }>(clerkA, SCAN, {
        input: {
          orgId: String(xinyi),
          rescanId: rescan.id,
          cashPointId: String(counterA),
          code: a.code("001"),
        },
      });
      expect(again.scanLotteryRescanTicket.duplicate).toBe(true);
      const reloaded = placeOf(await view(clerkA, rescan.id), counterA);
      expect(reloaded).toMatchObject({
        state: "scanning",
        mine: true,
        scannedCount: 1,
        scanningByName: "王小明",
      });
      expect(
        await errorOf(clerkA, SCAN, {
          input: {
            orgId: String(xinyi),
            rescanId: rescan.id,
            cashPointId: String(counterA),
            code: "9999999999",
          },
        }),
      ).toMatchObject({ reason: RESCAN_REASONS.notFound });
    });

    it("別人刷到一半的位置 → 擋(誰);1 小時沒刷就釋出、清單保留,別人可接手;刷完的位置不能再刷", async () => {
      const a = await book(gameX, counterA, [{ no: "001" }, { no: "002" }]);
      const rescan = await startRescan(clerkA);
      await scanAll(clerkA, rescan.id, counterA, [a.code("001")]);
      expect(
        await errorOf(clerkB, SCAN, {
          input: {
            orgId: String(xinyi),
            rescanId: rescan.id,
            cashPointId: String(counterA),
            code: a.code("002"),
          },
        }),
      ).toMatchObject({ reason: RESCAN_REASONS.placeBusy, byName: "王小明" });
      // 李小華在別的位置刷(多人同時刷不同位置)讓整次重刷保持有動作
      now("10:40");
      await finish(clerkB, rescan.id, stallB);
      now("11:01");
      expect(placeOf(await view(clerkB, rescan.id), counterA).state).toBe(
        "released",
      );
      await scanAll(clerkB, rescan.id, counterA, [a.code("002")]);
      const taken = placeOf(await view(clerkB, rescan.id), counterA);
      expect(taken).toMatchObject({
        state: "scanning",
        scanningByName: "李小華",
        scannedCount: 2,
      });
      await finish(clerkB, rescan.id, counterA);
      expect(
        await errorOf(clerkA, SCAN, {
          input: {
            orgId: String(xinyi),
            rescanId: rescan.id,
            cashPointId: String(counterA),
            code: a.code("001"),
          },
        }),
      ).toMatchObject({ reason: RESCAN_REASONS.placeDone });
    });

    it("TX-06:按「這裡刷完了」的資料庫指令數不隨刷到的張數成長", async () => {
      // 每 4 張一組:刷到 1 張已售·未對號(對號)+ 1 張未售(沒問題),沒刷到 2 張(1 張被挑去配對、1 張記待查);
      // 1 組與 5 組比
      const blockOf = (blocks: number): TicketSpec[] =>
        Array.from({ length: blocks * 4 }, (_, index) => {
          const no = String(index + 1).padStart(3, "0");
          return index % 4 === 0
            ? { no, status: "sold" as const, unmatched: true }
            : { no };
        });
      const scannedOf = (blocks: number): string[] =>
        Array.from({ length: blocks }, (_, block) => [
          String(block * 4 + 1).padStart(3, "0"),
          String(block * 4 + 2).padStart(3, "0"),
        ]).flat();
      const small = await book(gameX, counterA, blockOf(1));
      const big = await book(gameY, counterA, blockOf(5));
      const one = await startRescan(clerkA, gameX);
      await scanAll(
        clerkA,
        one.id,
        counterA,
        scannedOf(1).map((no) => small.code(no)),
      );
      const few = await countDbCommands(() => finish(clerkA, one.id, counterA));
      const two = await startRescan(clerkA, gameY);
      await scanAll(
        clerkA,
        two.id,
        counterA,
        scannedOf(5).map((no) => big.code(no)),
      );
      const many = await countDbCommands(() =>
        finish(clerkA, two.id, counterA),
      );
      expect(outcomesOf(placeOf(many.result, counterA).items)).toMatchObject({
        "001": "matched",
        "017": "matched",
      });
      // 帳本依要改的值分組:對號的配對張各自接手不同的售出事件 → 多 4 次對號就多 4 組(同 T3 的售出對號),
      // 其他(讀刷到的張、讀未售、讀本、寫事件、記待查、寫重刷單)指令數不變
      expect(many.byCommand.get("lottery_tickets.updateMany")).toBe(
        (few.byCommand.get("lottery_tickets.updateMany") ?? 0) + 4,
      );
      expect(many.total).toBe(few.total + 4);
    });
  });

  describe("移櫃暫停與同步(8.5、8.5a;16.7 S5、S6)", () => {
    it("S5 重刷 X 途中:X 的兩種移櫃都被後端擋、Y 照常;結束後解除", async () => {
      const a = await book(gameX, counterA, [{ no: "001" }, { no: "002" }]);
      await book(gameY, counterA, [{ no: "001" }, { no: "002" }]);
      const rescan = await startRescan(clerkA);
      expect(
        (await moveByCount(clerkA, gameX)).errors?.[0]?.extensions,
      ).toMatchObject({
        reason: "MOVE_PAUSED",
        pause: { kind: "rescan", gameId: String(gameX) },
      });
      const scanMove = await gql(clerkA, MOVE, {
        input: {
          orgId: String(xinyi),
          tickets: [
            {
              ticketId: String((await ticket(a.bookId, "001"))._id),
              version: 1,
            },
          ],
          source: "scan",
          fromCashPointId: String(counterA),
          toCashPointId: String(stallB),
        },
      });
      expect(scanMove.errors?.[0]?.extensions).toMatchObject({
        reason: "MOVE_PAUSED",
      });
      expect((await moveByCount(clerkA, gameY)).errors).toBeUndefined();
      await ok(clerkA, CANCEL, {
        input: { orgId: String(xinyi), rescanId: rescan.id },
      });
      expect((await moveByCount(clerkA, gameX)).errors).toBeUndefined();
    });

    it("S5 開始重刷與移櫃同時:移櫃讀完暫停清單後重刷先提交 → 移櫃的寫入衝突、重跑後被擋(不會「重刷後才移」)", async () => {
      await book(gameX, counterA, [{ no: "001" }, { no: "002" }]);
      const repository = api.app.get(LotteryStoreCountModesRepository);
      const original = repository.findOneAndUpdate.bind(repository);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reached: () => void = () => undefined;
      const atGate = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let held = false;
      jest
        .spyOn(repository, "findOneAndUpdate")
        .mockImplementation(async (operator, filter, update, options) => {
          // 移櫃的 `$inc version`(只有 `$inc`、沒有條件版本):第一次在這裡停住,等重刷提交
          const plain = update as Record<string, unknown>;
          if (
            !held &&
            "$inc" in plain &&
            !("$push" in plain) &&
            !("version" in (filter as Record<string, unknown>))
          ) {
            held = true;
            reached();
            await gate;
          }
          return original(operator, filter, update, options);
        });
      const move = moveByCount(clerkA, gameX);
      await atGate;
      const rescan = await startRescan(clerkB);
      release();
      const moved = await move;
      expect(moved.errors?.[0]?.extensions).toMatchObject({
        reason: "MOVE_PAUSED",
      });
      expect(await unsoldAt(counterA)).toBe(2);
      expect(rescan.status).toBe("in_progress");
    });

    it("S5 先移後重刷:移櫃先提交 → 兩個都成功,移過去的張由重刷照常刷到", async () => {
      const a = await book(gameX, counterA, [{ no: "001" }, { no: "002" }]);
      expect((await moveByCount(clerkA, gameX)).errors).toBeUndefined();
      const rescan = await startRescan(clerkB);
      expect(await unsoldAt(stallB)).toBe(1);
      await scanAll(clerkB, rescan.id, stallB, [a.code("001")]);
      const view1 = placeOf(await view(clerkB, rescan.id), stallB);
      expect(view1.items).toEqual([
        expect.objectContaining({ ticketNo: "001", outcome: "ok" }),
      ]);
    });

    it("S6 補點編號中不能開始重刷;同遊戲不能同時兩個重刷;X、Y 同時重刷交錯進行,只擋 X、Y,各自結束後解除", async () => {
      const ax = await book(gameX, counterA, [{ no: "001" }, { no: "002" }]);
      const ay = await book(gameY, counterA, [{ no: "001" }, { no: "002" }]);
      await book(gameZ, counterA, [{ no: "001" }, { no: "002" }]);
      await connection
        .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
        .updateOne(
          { orgId: xinyi },
          {
            $set: {
              movePauses: [{ stocktakeId: new Types.ObjectId(), gameId: null }],
            },
          },
        );
      expect(
        await errorOf(clerkA, START_RESCAN, {
          input: { orgId: String(xinyi), gameId: String(gameX) },
        }),
      ).toMatchObject({
        reason: RESCAN_REASONS.startBlocked,
        block: "renumber",
      });
      // 補點中全部遊戲的移櫃都擋
      expect(
        (await moveByCount(clerkA, gameZ)).errors?.[0]?.extensions,
      ).toMatchObject({ pause: { kind: "renumber" } });
      await connection
        .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
        .updateOne({ orgId: xinyi }, { $set: { movePauses: [] } });

      const x = await startRescan(clerkA, gameX);
      expect(
        await errorOf(clerkB, START_RESCAN, {
          input: { orgId: String(xinyi), gameId: String(gameX) },
        }),
      ).toMatchObject({ block: "rescan" });
      const y = await startRescan(clerkB, gameY);
      // 交錯刷
      await scanAll(clerkA, x.id, counterA, [ax.code("001")]);
      await scanAll(clerkB, y.id, null, []);
      await finish(clerkB, y.id, null);
      await scanAll(clerkA, x.id, counterA, [ax.code("002")]);
      expect((await moveByCount(clerkA, gameX)).errors).toBeDefined();
      expect((await moveByCount(clerkA, gameY)).errors).toBeDefined();
      expect((await moveByCount(clerkA, gameZ)).errors).toBeUndefined();
      await finish(clerkA, x.id, counterA);
      await finish(clerkA, x.id, stallB);
      await finish(clerkA, x.id, null);
      // X 結束 → X 解除;Y 還在重刷
      expect((await moveByCount(clerkA, gameX)).errors).toBeUndefined();
      expect((await moveByCount(clerkA, gameY)).errors).toBeDefined();
      await scanAll(clerkB, y.id, counterA, [ay.code("001"), ay.code("002")]);
      await finish(clerkB, y.id, counterA);
      await finish(clerkB, y.id, stallB);
      expect((await moveByCount(clerkA, gameY)).errors).toBeUndefined();
      expect(await pauses()).toEqual([]);
    });

    it("[取消重刷]:開始的人或店長可以,其他人 FORBIDDEN;已刷完的位置更正保留、其餘不處理、移櫃解除", async () => {
      const a = await book(gameX, counterA, [{ no: "001" }, { no: "002" }]);
      const b = await book(gameX, stallB, [{ no: "011" }]);
      const rescan = await startRescan(clerkA);
      expect(rescan.canCancel).toBe(true);
      expect((await view(clerkB, rescan.id)).canCancel).toBe(false);
      expect((await view(manager, rescan.id)).canCancel).toBe(true);
      await scanAll(clerkA, rescan.id, counterA, [a.code("001")]);
      await finish(clerkA, rescan.id, counterA);
      expect(
        await errorOf(clerkB, CANCEL, {
          input: { orgId: String(xinyi), rescanId: rescan.id },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
      const cancelled = await ok<{ cancelLotteryRescan: Rescan }>(
        manager,
        CANCEL,
        { input: { orgId: String(xinyi), rescanId: rescan.id } },
      );
      expect(cancelled.cancelLotteryRescan).toMatchObject({
        status: "cancelled",
        cancelCause: "manual",
      });
      expect((await ticket(a.bookId, "002")).status).toBe("investigating");
      expect((await ticket(b.bookId, "011")).status).toBe("unsold");
      expect(await pauses()).toEqual([]);
      expect(
        await errorOf(clerkA, FINISH, {
          input: {
            orgId: String(xinyi),
            rescanId: rescan.id,
            cashPointId: String(stallB),
          },
        }),
      ).toMatchObject({ reason: RESCAN_REASONS.ended });
    });

    it("整次重刷 1 小時沒有動作 → 自動取消(移櫃前當場、排程保底);看板倒數剩幾分鐘", async () => {
      await book(gameX, counterA, [{ no: "001" }]);
      const rescan = await startRescan(clerkA);
      now("10:08");
      expect((await status(clerkA)).rescans).toEqual([
        expect.objectContaining({ id: rescan.id, minutesLeft: 52 }),
      ]);
      now("11:00");
      expect((await moveByCount(clerkA, gameX)).errors).toBeUndefined();
      expect((await view(clerkA, rescan.id)).status).toBe("cancelled");
      expect((await view(clerkA, rescan.id)).cancelCause).toBe("expired");

      const second = await startRescan(clerkA);
      now("12:30");
      await api.app.get(RescanExpiryService).run({
        scheduledFor: taipei("12:30"),
        tenants: [{ tenantId: tenant, timezone: "Asia/Taipei" }],
      } as unknown as Parameters<RescanExpiryService["run"]>[0]);
      expect((await view(clerkA, second.id)).status).toBe("cancelled");
      expect(await pauses()).toEqual([]);
    });

    it("沒有收到信號的畫面也被擋:暫停狀態只看後端的分店那一筆", async () => {
      await book(gameX, counterA, [{ no: "001" }]);
      await startRescan(clerkA);
      const service = api.app.get(StoreCountModeService);
      const record = await service.recordOf(
        {
          actorId: null,
          currentOrgId: tenant,
          visibleOrgIds: [tenant, xinyi],
          managedOrgIds: [],
          memberOrgIds: [tenant],
          roleIds: [],
          memberTenants: [
            { tenantId: tenant, memberOrgIds: [tenant], ancestorOrgIds: [] },
          ],
        },
        xinyi,
      );
      expect(record?.movePauses).toHaveLength(1);
      expect((await moveByCount(clerkB, gameX)).errors).toBeDefined();
    });
  });

  describe("盤點與重刷(8.5a B5、盤點中登記;16.7 S9、S10 的重刷部分)", () => {
    it("S9 這個位置有人登記盤點中 → 開始刷被擋(誰、幾點開始、剩幾分鐘);別的位置照常", async () => {
      const a = await book(gameX, counterA, [{ no: "001" }]);
      const b = await book(gameX, stallB, [{ no: "011" }]);
      await ok(clerkB, START_SESSION, {
        input: {
          orgId: String(xinyi),
          type: "shift",
          cashPointId: String(counterA),
        },
      });
      const rescan = await startRescan(clerkA);
      now("10:08");
      expect(
        (await scan(clerkA, rescan.id, counterA, a.code("001"))).errors?.[0]
          ?.extensions,
      ).toMatchObject({
        reason: RESCAN_REASONS.placeStocktaking,
        byName: "李小華",
        startedAt: taipei("10:00").toISOString(),
        minutesLeft: 52,
      });
      expect(
        (await scan(clerkA, rescan.id, stallB, b.code("011"))).errors,
      ).toBeUndefined();
    });

    it("S9 登記與開始刷同時:開始刷讀完登記後登記先提交 → 開始刷的寫入衝突、重跑後被擋", async () => {
      const a = await book(gameX, counterA, [{ no: "001" }]);
      const rescan = await startRescan(clerkA);
      const service = api.app.get(StoreCountModeService);
      const original = service.touchForRescanPlace.bind(service);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reached: () => void = () => undefined;
      const atGate = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let held = false;
      jest
        .spyOn(service, "touchForRescanPlace")
        .mockImplementation(async (...args) => {
          if (!held) {
            held = true;
            reached();
            await gate;
          }
          return original(...args);
        });
      const scanning = scan(clerkA, rescan.id, counterA, a.code("001"));
      await atGate;
      await ok(clerkB, START_SESSION, {
        input: {
          orgId: String(xinyi),
          type: "shift",
          cashPointId: String(counterA),
        },
      });
      release();
      expect((await scanning).errors?.[0]?.extensions).toMatchObject({
        reason: RESCAN_REASONS.placeStocktaking,
      });
      expect(placeOf(await view(clerkA, rescan.id), counterA).state).toBe(
        "pending",
      );
    });

    it("S10 B5:正在刷的位置那一組送出被後端擋(這裡正在重刷 X);還沒開始刷的位置、別的遊戲照常", async () => {
      const a = await book(gameX, counterA, [{ no: "001" }, { no: "002" }]);
      await book(gameX, stallB, [{ no: "011" }]);
      await book(gameY, counterA, [{ no: "001" }]);
      const rescan = await startRescan(clerkA);
      await scanAll(clerkA, rescan.id, counterA, [a.code("001")]);
      const line = (
        place: Types.ObjectId,
        gameId: Types.ObjectId,
        present: number,
      ) => ({
        gameId: String(gameId),
        cashPointId: String(place),
        countedAt: taipei("10:05").toISOString(),
        presentCount: present,
        recounts: [],
        saleCount: 0,
        saleRefIds: [],
        investigateCount: 0,
        flagged: false,
      });
      const blocked = await submit(
        clerkB,
        draftOf([line(counterA, gameX, 2), line(counterA, gameY, 1)]),
      );
      expect(blocked.errors?.[0]?.extensions).toMatchObject({
        reason: STOCKTAKE_REASONS.rescanning,
      });
      const fine = await submit(
        clerkB,
        draftOf([line(stallB, gameX, 1), line(counterA, gameY, 1)]),
      );
      expect(fine.errors).toBeUndefined();
      // 盤點頁的 B5 依進行中重刷的位置狀態(看板信號重抓)
      expect((await status(clerkB)).rescans[0]?.places).toEqual(
        expect.arrayContaining([
          { cashPointId: String(counterA), state: "scanning" },
          { cashPointId: String(stallB), state: "pending" },
        ]),
      );
    });
  });

  describe("全店重刷提醒(8.3;16.7 S3)", () => {
    it("S3 有待查·未對號 → 提醒 [全店重刷 遊戲 X];重刷中不提醒(改顯示重刷中);重刷完成後消失", async () => {
      const a = await book(gameX, counterA, [
        { no: "001" },
        { no: "002", status: "investigating", unmatched: true },
      ]);
      await book(gameY, counterA, [{ no: "001" }]);
      expect((await status(clerkA)).rescanReminders).toEqual([
        { gameCode: "5164", investigateCount: 1, flaggedCount: 0 },
      ]);
      const rescan = await startRescan(clerkA);
      const during = await status(clerkA);
      expect(during.rescanReminders).toEqual([]);
      expect(during.rescans.map((one) => one.gameCode)).toEqual(["5164"]);
      await scanAll(clerkA, rescan.id, counterA, [a.code("001")]);
      now("10:10");
      await finish(clerkA, rescan.id, counterA);
      await finish(clerkA, rescan.id, stallB);
      await finish(clerkA, rescan.id, null);
      now("10:20");
      expect(await status(clerkA)).toMatchObject({
        rescans: [],
        rescanReminders: [],
      });
    });

    it("S3 [標記異常] 送出 → 提醒(標記異常 N 張)與負責人提醒給店長;全店重刷不算「上次盤點」", async () => {
      await book(gameX, counterA, [{ no: "001" }, { no: "002" }]);
      const flagged = await submit(
        clerkA,
        draftOf([
          {
            gameId: String(gameX),
            cashPointId: String(counterA),
            countedAt: taipei("10:05").toISOString(),
            presentCount: 3,
            recounts: [],
            saleCount: 0,
            saleRefIds: [],
            investigateCount: 0,
            flagged: true,
          },
        ]),
      );
      expect(flagged.errors).toBeUndefined();
      const reminders = (await status(clerkA)).rescanReminders;
      expect(reminders).toEqual([
        { gameCode: "5164", investigateCount: 0, flaggedCount: 1 },
      ]);
      const notes = await connection
        .collection<{
          type: string;
          recipientId: Types.ObjectId;
          body: string;
        }>("notifications")
        .find({ type: "lottery.rescan-reminder" })
        .toArray();
      expect(notes.map((note) => String(note.recipientId))).toEqual([
        String(manager.userId),
      ]);
      expect(notes[0]?.body).toContain("5164 發大財");
      const before = await ok<{
        lotteryStocktakeStatus: { lastSubmittedAt: string };
      }>(clerkA, STATUS, { orgId: String(xinyi) });
      now("11:00");
      await startRescan(clerkA);
      const after = await ok<{
        lotteryStocktakeStatus: { lastSubmittedAt: string };
      }>(clerkA, STATUS, { orgId: String(xinyi) });
      expect(after.lotteryStocktakeStatus.lastSubmittedAt).toBe(
        before.lotteryStocktakeStatus.lastSubmittedAt,
      );
    });

    it("編號店不能重刷、也沒有重刷提醒", async () => {
      await book(gameX, counterA, [
        { no: "001", status: "investigating", unmatched: true },
      ]);
      await connection
        .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
        .updateOne({ orgId: xinyi }, { $set: { mode: "numbered" } });
      expect((await status(clerkA)).rescanReminders).toEqual([]);
      expect(
        await errorOf(clerkA, START_RESCAN, {
          input: { orgId: String(xinyi), gameId: String(gameX) },
        }),
      ).toMatchObject({ reason: RESCAN_REASONS.notCountStore });
    });
  });
});
