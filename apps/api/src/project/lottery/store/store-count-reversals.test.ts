import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";
import {
  STORE_PERMISSIONS as S,
  SALE_REVERSAL_FORM_KEY,
  STORE_FORM_PERMISSIONS,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { countDbCommands } from "../../../database/test-support/db-commands";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import {
  ASSIGN,
  CREATE_FORM,
  CREATE_FORM_DRAFT,
  SUBMIT,
  type SubmissionRow,
  call,
  column,
  createDraft,
  definitionOf,
  extensionsOf,
  field,
  ok,
  publishDefinition,
  rootToken,
  submitDraft,
} from "../../../forms/test-support/form-fixtures";
import { createRole } from "../../../permission/test-support/fixtures";
import {
  type Person,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  audienceRow,
  audienceSource,
  bindForm,
  decideOn,
  person,
  publishWorkflow,
  reviewStep,
} from "../../../workflows/test-support/workflow-fixtures";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import { LOTTERY_STORE_COUNT_MODES_COLLECTION } from "../../database/lottery-settings/lottery-store-count-mode.schema";
import { LotteryStocktake } from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import {
  LOTTERY_SHIFTS_COLLECTION,
  LotteryShift,
} from "../../database/lottery-store/lottery-shift.schema";
import { seedReasonCategory } from "../test-support/master-data-fixtures";
import { LotteryBooksService } from "../tickets/books.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

// ---- GraphQL ----

const SPLIT = /* GraphQL */ `
  mutation Split($input: SplitLotteryBookInput!) {
    splitLotteryBook(input: $input) {
      count
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

const SELL_BY_COUNT = /* GraphQL */ `
  mutation SellByCount($input: SellLotteryTicketsByCountInput!) {
    sellLotteryTicketsByCount(input: $input) {
      items {
        refId
        count
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

const OPTIONS = /* GraphQL */ `
  query Options($orgId: ID!, $cashPointId: ID) {
    lotteryStoreSaleReversalOptions(orgId: $orgId, cashPointId: $cashPointId) {
      countMode
      cashPoints {
        id
        name
      }
      games {
        gameId
        gameCode
        unitPrice
        available
      }
    }
  }
`;

const SALE_REVERSALS = /* GraphQL */ `
  query SaleReversals($orgId: ID!) {
    lotteryStoreSaleReversals(orgId: $orgId) {
      items {
        id
        ticketGroups
        ticketCount
      }
    }
  }
`;

const START_RESCAN = /* GraphQL */ `
  mutation StartRescan($input: StartLotteryRescanInput!) {
    startLotteryRescan(input: $input) {
      id
    }
  }
`;

const RESCAN_SCAN = /* GraphQL */ `
  mutation Scan($input: ScanLotteryRescanTicketInput!) {
    scanLotteryRescanTicket(input: $input) {
      duplicate
    }
  }
`;

const RESCAN_FINISH = /* GraphQL */ `
  mutation Finish($input: FinishLotteryRescanPlaceInput!) {
    finishLotteryRescanPlace(input: $input) {
      results {
        ticketNo
        outcome
        cashPointId
      }
    }
  }
`;

// ---- 型別 ----

interface TicketDoc {
  _id: Types.ObjectId;
  ticketNo: string;
  status: string;
  unmatched: boolean;
  soldSource: string | null;
  version: number;
  location: { kind: string; cashPointId: Types.ObjectId | null };
  lockedBy: { refType: string; refId: Types.ObjectId } | null;
}

interface EventDoc {
  type: string;
  amount: number;
  cashEffect: string;
  refType: string | null;
  cashPointId: Types.ObjectId | null;
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

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    String(from + index).padStart(3, "0"),
  );

/** 撤銷售出申請的定義(欄位 key 同受管表單 `seeds/project/revisions/sale_reversal.r4.seed.ts`)。 */
function saleReversalDefinition(): FormDefinition {
  return definitionOf([
    field("note", "text"),
    field("branch", "reference", {
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("lines", "array", {
      columns: [
        column("line_kind", "select", {
          options: {
            kind: "static",
            items: [
              { value: "by_ticket", label: "依張號", order: 1, enabled: true },
              {
                value: "by_count",
                label: "依遊戲 + 張數",
                order: 2,
                enabled: true,
              },
            ],
          },
        }),
        column("book", "reference", {
          source: { provider: "lottery_book", labelField: "bookKey" },
        }),
        column("ticket_nos", "text"),
        column("tickets", "number", { rules: { min: 1 } }),
        column("game", "reference", {
          source: { provider: "lottery_game", labelField: "name" },
        }),
        column("cash_point", "reference", {
          source: { provider: "lottery_cash_point", labelField: "name" },
        }),
        column("count", "number", { rules: { min: 1 } }),
        column("amount", "number", { rules: { required: true, min: 0 } }),
      ],
      rules: { required: true },
    }),
    field("reason", "select", {
      options: {
        kind: "fieldCategory",
        key: LOTTERY_FIELD_CATEGORY_KEYS.saleReversalReason,
      },
      rules: { required: true },
    }),
    field("refund", "select", {
      options: {
        kind: "static",
        items: [
          { value: "yes", label: "是", order: 1, enabled: true },
          { value: "no", label: "否", order: 2, enabled: true },
        ],
      },
      rules: { required: true },
    }),
    field("refund_shift", "reference", {
      source: { provider: "lottery_shift", labelField: "label" },
      visibleWhen: { "==": [{ var: "refund" }, "yes"] },
      rules: { required: true },
    }),
    field("refund_amount", "number", {
      valueSource: { kind: "computed", expr: { sumOf: ["lines", "amount"] } },
    }),
  ]);
}

/**
 * 張數店的撤銷售出申請(張數店規格 7.3 第 3–6 點、8.4 第 3 點;驗收 16.4 U2、U6、U7;T7):真的表單引擎 + 審核流程 +
 * 掛接點 + 全店重刷,對真 MongoDB(TEST-07)。流程同開通腳本:一關 店長限定「分店」+ 申請人是審核者時自動通過。每張 200 元。
 *
 * 組織樹:root ─ 租戶甲 ─ 信義店(張數店;店內櫃台 = A 台:王的班、店外攤位 = B 台:林的班)
 * 遊戲:5164 發大財(U2、U7)、5201 金好運(U6,重刷只動這個遊戲)
 */
describe("張數店的撤銷售出申請(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let world: World;

  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let counterA: Types.ObjectId;
  let stallB: Types.ObjectId;
  let gameX: Types.ObjectId;
  let gameY: Types.ObjectId;
  /** 只給 TX-06 的情境(張的版本一致:帳本鎖定依版本分批) */
  let gameZ: Types.ObjectId;

  /** 店員:銷售、拆本、盤點(重刷)、撤銷售出申請的新增 */
  let wang: Person;
  let lin: Person;
  /** 店長(審核者) */
  let manager: Person;

  let shiftA: Types.ObjectId;

  let bookSequence = 91_000;

  const db = () => connection;

  async function cashPoint(name: string, order: number) {
    const { insertedId } = await db()
      .collection(LOTTERY_CASH_POINTS_COLLECTION)
      .insertOne({
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
    return insertedId;
  }

  async function shift(
    cashPointId: Types.ObjectId,
    openedBy: Types.ObjectId,
    label: string,
  ): Promise<Types.ObjectId> {
    const { insertedId } = await db()
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        cashPointId,
        openedBy,
        openedAt: new Date(Date.now() - 3_600_000),
        openingFloat: 5000,
        openingFloatSource: "handover",
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
    return insertedId;
  }

  /** 點收一本到信義店,依張號拆到收銀點(經 api,寫「拆本」事件)。 */
  async function book(
    gameId: Types.ObjectId,
    places: { cashPointId: Types.ObjectId; ticketNos: string[] }[],
  ): Promise<{ bookId: Types.ObjectId; bookNo: string }> {
    bookSequence += 1;
    const { book: created } = await api.app
      .get(TransactionService)
      .withTransaction((session) =>
        api.app.get(LotteryBooksService).createBook(
          session,
          {
            actorId: new Types.ObjectId(),
            currentOrgId: xinyi,
            visibleOrgIds: [xinyi],
            managedOrgIds: [],
            memberOrgIds: [xinyi],
            roleIds: [],
            memberTenants: [
              {
                tenantId: tenant,
                memberOrgIds: [xinyi],
                ancestorOrgIds: [tenant],
              },
            ],
          },
          {
            orgId: xinyi,
            gameId,
            bookNo: String(bookSequence).padStart(6, "0"),
            lastTicketNo: 10,
            rate: 92,
            cost: 1840,
          },
        ),
      );
    await ok(api, wang.token, SPLIT, {
      input: {
        orgId: String(xinyi),
        bookId: String(created._id),
        skippedTicketNos: [],
        assignments: places.map((place) => ({
          cashPointId: String(place.cashPointId),
          ticketNos: place.ticketNos,
        })),
      },
    });
    return { bookId: created._id, bookNo: created.bookNo };
  }

  async function ticketOf(
    bookId: Types.ObjectId,
    ticketNo: string,
  ): Promise<TicketDoc> {
    const found = await db()
      .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
      .findOne({ bookId, ticketNo });
    if (found === null) {
      throw new Error(`沒有 #${ticketNo}`);
    }
    return found;
  }

  async function lastEventOf(ticketId: Types.ObjectId): Promise<EventDoc> {
    const found = await db()
      .collection<EventDoc>("lottery_ticket_events")
      .find({ ticketId })
      .sort({ at: -1, _id: -1 })
      .limit(1)
      .next();
    if (found === null) {
      throw new Error("沒有事件");
    }
    return found;
  }

  /** I1:某位置某遊戲的系統未售張數。 */
  function unsoldAt(
    place: Types.ObjectId | null,
    gameId = gameX,
  ): Promise<number> {
    return db()
      .collection(LOTTERY_TICKETS_COLLECTION)
      .countDocuments({
        orgId: xinyi,
        gameId,
        status: "unsold",
        ...(place === null
          ? { "location.kind": "stock" }
          : { "location.kind": "counter", "location.cashPointId": place }),
      });
  }

  async function expectedOf(cashPointId: Types.ObjectId): Promise<number> {
    const data = await ok<{
      lotteryStoreBoard: {
        item: {
          cashPoints: { id: string; shift: { expectedCash: number } | null }[];
        };
      };
    }>(api, wang.token, BOARD, { orgId: String(xinyi) });
    return (
      data.lotteryStoreBoard.item.cashPoints.find(
        (point) => point.id === String(cashPointId),
      )?.shift?.expectedCash ?? Number.NaN
    );
  }

  /** 王在 A 台刷條碼賣這幾張。 */
  async function sellScan(bookId: Types.ObjectId, ticketNos: string[]) {
    const tickets = await Promise.all(
      ticketNos.map((no) => ticketOf(bookId, no)),
    );
    await ok(api, wang.token, SELL, {
      input: {
        orgId: String(xinyi),
        localCashPointId: String(counterA),
        tickets: tickets.map((ticket) => ({
          ticketId: String(ticket._id),
          version: ticket.version,
        })),
        source: "scan",
      },
    });
  }

  /** 王在 A 台依張數賣幾張。 */
  async function sellByCount(count: number, gameId = gameX) {
    await ok(api, wang.token, SELL_BY_COUNT, {
      input: {
        orgId: String(xinyi),
        localCashPointId: String(counterA),
        lines: [{ gameId: String(gameId), count }],
        reasonKey: "too-busy",
      },
    });
  }

  /** 依張號的一列(刷退票的那一台 = `cashPointId`)。 */
  const ticketLine = (
    bookId: Types.ObjectId,
    ticketNos: string,
    count: number,
    cashPointId: Types.ObjectId | null,
  ) => ({
    rowId: randomUUID(),
    line_kind: "by_ticket",
    book: String(bookId),
    ticket_nos: ticketNos,
    tickets: count,
    amount: 200 * count,
    ...(cashPointId === null ? {} : { cash_point: String(cashPointId) }),
  });

  /** 依遊戲 + 張數的一列。 */
  const countLine = (count: number, gameId = gameX) => ({
    rowId: randomUUID(),
    line_kind: "by_count",
    game: String(gameId),
    cash_point: String(counterA),
    count,
    amount: 200 * count,
  });

  function reversalValues(
    lines: Record<string, unknown>[],
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      branch: String(xinyi),
      lines,
      reason: "customer-return",
      refund: "no",
      note: "客人退貨",
      ...overrides,
    };
  }

  async function submit(
    values: Record<string, unknown>,
  ): Promise<SubmissionRow> {
    return submitDraft(
      api,
      wang.token,
      await createDraft(api, wang.token, SALE_REVERSAL_FORM_KEY, values),
    );
  }

  async function submitError(
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const draft = await call<{
      createFormDraft: { submission: SubmissionRow };
    }>(api, wang.token, CREATE_FORM_DRAFT, {
      input: {
        formKey: SALE_REVERSAL_FORM_KEY,
        clientRequestId: `count-reversal-${String(new Types.ObjectId())}`,
        values,
      },
    });
    const created = draft.data?.createFormDraft.submission;
    if (!created) {
      return extensionsOf(draft);
    }
    const result = await call(api, wang.token, SUBMIT, {
      input: { id: created.id, expectedEditVersion: created.editVersion },
    });
    return {
      ...extensionsOf(result),
      message: result.errors?.[0]?.message ?? "",
    };
  }

  async function statusOf(bookId: Types.ObjectId, ticketNo: string) {
    const ticket = await ticketOf(bookId, ticketNo);
    return ticket.status;
  }

  async function lockedBy(submissionId: string): Promise<TicketDoc[]> {
    return db()
      .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
      .find({
        "lockedBy.refType": "sale_reversal",
        "lockedBy.refId": new Types.ObjectId(submissionId),
      })
      .toArray();
  }

  async function options(cashPointId: Types.ObjectId | null) {
    const data = await ok<{
      lotteryStoreSaleReversalOptions: {
        countMode: string;
        cashPoints: { id: string; name: string }[];
        games: {
          gameId: string;
          gameCode: string;
          unitPrice: number;
          available: number;
        }[];
      };
    }>(api, wang.token, OPTIONS, {
      orgId: String(xinyi),
      cashPointId: cashPointId === null ? null : String(cashPointId),
    });
    return data.lotteryStoreSaleReversalOptions;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-store-count-reversals");
    connection = api.connection;
    await api.app
      .get<Model<LotteryShift>>(getModelToken(LotteryShift.name))
      .init();
    await api.app
      .get<Model<LotteryStocktake>>(getModelToken(LotteryStocktake.name))
      .init();
    const { insertedId: storeModuleId } = await db()
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
        perFormCreate: true,
        ...base(),
      });
    await db()
      .collection("permissions")
      .insertMany(
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
      db(),
      LOTTERY_FIELD_CATEGORY_KEYS.saleReversalReason,
      [
        { value: "customer-return", label: "客人退貨" },
        { value: "stocktake-error", label: "盤點錯誤" },
      ],
    );
    await seedReasonCategory(
      db(),
      LOTTERY_FIELD_CATEGORY_KEYS.countSaleReason,
      [{ value: "too-busy", label: "太忙沒刷" }],
    );
    tenant = await createOrg(db(), {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    xinyi = await createOrg(db(), { name: "信義店", parentId: tenant });
    counterA = await cashPoint("店內櫃台", 1);
    stallB = await cashPoint("店外攤位", 2);
    const game = (gameCode: string, name: string) =>
      db()
        .collection("lottery_games")
        .insertOne({
          orgId: tenant,
          tenantId: tenant,
          moduleKey: "master-data",
          shareOrgs: [{ orgId: tenant, includeDescendants: true }],
          gameCode,
          name,
          unitPrice: 200,
          ticketsPerBook: 10,
          bookPrice: 2000,
          defaultRate: 92,
          color: null,
          status: "on_sale",
          ...base(),
        });
    ({ insertedId: gameX } = await game("5164", "發大財"));
    ({ insertedId: gameY } = await game("5201", "金好運"));
    ({ insertedId: gameZ } = await game("5133", "招財貓"));
    // 張數店(`lottery_store_count_modes` 一店一筆)
    await db()
      .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        moduleKey: "store",
        mode: "count",
        since: new Date(Date.now() - 86_400_000),
        lastRenumberAt: null,
        lastRenumberStocktakeId: null,
        history: [],
        movePauses: [],
        stocktakeSessions: [],
        version: 0,
        ...base(),
      });

    const root = await rootToken(api);
    await ok(api, root, CREATE_FORM, {
      input: {
        key: SALE_REVERSAL_FORM_KEY,
        moduleKey: "store",
        name: "撤銷售出申請",
      },
    });
    await publishDefinition(
      api,
      root,
      SALE_REVERSAL_FORM_KEY,
      saleReversalDefinition(),
      null,
    );
    await ok(api, root, ASSIGN, {
      input: {
        formKey: SALE_REVERSAL_FORM_KEY,
        tenantOrgIds: [String(tenant)],
      },
    });
    const admin = await person(api, db(), tenant, tenant, {
      moduleKeys: ["system", "system.workflows", "system.forms"],
      permissionKeys: ["system.workflows.*", "system.forms.*"],
    });
    const modules = ["store", "apply-center", "apply-center.view-page"];
    const clerk = [
      S.view,
      S.sell,
      S.undoSale,
      S.split,
      S.stocktake,
      STORE_FORM_PERMISSIONS.createSaleReversal,
      "apply-center.view",
    ];
    wang = await person(api, db(), xinyi, tenant, {
      moduleKeys: modules,
      permissionKeys: clerk,
    });
    lin = await person(api, db(), xinyi, tenant, {
      moduleKeys: modules,
      permissionKeys: clerk,
    });
    manager = await person(api, db(), xinyi, tenant, {
      moduleKeys: modules,
      permissionKeys: [...clerk, S.edit],
    });
    const managerRole = await createRole(api.app, db(), {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [manager.userId],
    });
    world = { api, connection: db(), admin } as unknown as World;
    await publishWorkflow(world, "sale_reversal_flow", {
      steps: [
        reviewStep(
          "store_manager",
          audienceSource(
            audienceRow("role", [managerRole]),
            audienceRow(
              "org",
              { kind: "dynamic", ref: "form-field:branch" },
              "self",
            ),
          ),
          { autoApprove: { applicant: true } },
        ),
      ],
      checkFormKey: SALE_REVERSAL_FORM_KEY,
    });
    await bindForm(world, "sale_reversal_flow", SALE_REVERSAL_FORM_KEY);

    shiftA = await shift(counterA, wang.userId, "店內櫃台 · 王小明");
    await shift(stallB, lin.userId, "店外攤位 · 林小美");
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("U2 有票就在送出時刷:不是刷條碼賣出的先和這台最近一筆依張數售出對號、再鎖;核准後回賣出的收銀點(I1)", async () => {
    const { bookId } = await book(gameX, [
      { cashPointId: counterA, ticketNos: range(1, 10) },
    ]);
    const before = await expectedOf(counterA);
    // 依張數賣 2 張:系統照挑張順序記 #001、#002 已售·未對號(客人其實拿走 #005 和另一張)
    await sellByCount(2);
    expect(await expectedOf(counterA)).toBe(before + 400);
    expect(await unsoldAt(counterA)).toBe(8);

    // 客人帶 #005 回來退:系統記它未售 → 送出時先和 A 台最近一筆依張數售出帶著的 #002 對號、再鎖
    const submitted = await submit(
      reversalValues([ticketLine(bookId, "005", 1, counterA)], {
        refund: "yes",
        refund_shift: String(shiftA),
      }),
    );
    expect(submitted.status).toBe("REVIEWING");
    const returned = await ticketOf(bookId, "005");
    expect(returned).toMatchObject({
      status: "sold",
      unmatched: false,
      soldSource: "count",
      lockedBy: { refType: "sale_reversal" },
    });
    expect(String(returned.lockedBy?.refId)).toBe(submitted.id);
    const swapped = await ticketOf(bookId, "002");
    expect(swapped).toMatchObject({
      status: "unsold",
      unmatched: false,
      lockedBy: null,
    });
    // I4:對號 cashEffect none、金額 0;各位置張數不變(#005 在客人手上、#002 在檯面上)
    expect(await lastEventOf(swapped._id)).toMatchObject({
      type: "match",
      cashEffect: "none",
      amount: 0,
    });
    expect(await unsoldAt(counterA)).toBe(8);
    expect(await expectedOf(counterA)).toBe(before + 400);

    await decideOn(world, manager, submitted.id, "APPROVE");
    const after = await ticketOf(bookId, "005");
    expect(after).toMatchObject({
      status: "unsold",
      unmatched: false,
      lockedBy: null,
      location: { kind: "counter" },
    });
    expect(String(after.location.cashPointId)).toBe(String(counterA));
    expect(await lastEventOf(after._id)).toMatchObject({
      type: "sale_undo",
      refType: "sale_reversal",
      cashEffect: "none",
      amount: 200,
    });
    // I1:A 台實體 9 張(退回的 #005 放回檯面);依張數售出那一班照算,退款記在退款班次
    expect(await unsoldAt(counterA)).toBe(9);
    expect(await expectedOf(counterA)).toBe(before + 200);
    expect(await statusOf(bookId, "001")).toBe("sold");
  });

  it("U2 刷的票不是確定張號的已售、這台這個遊戲又沒有依張數售出 → 擋下;編號店照現況只收已售", async () => {
    const { bookId } = await book(gameX, [
      { cashPointId: stallB, ticketNos: range(1, 10) },
    ]);
    expect(
      await submitError(reversalValues([ticketLine(bookId, "003", 1, stallB)])),
    ).toMatchObject({
      code: "FORBIDDEN",
      reason: "SALE_REVERSAL_COUNT_SALE_NOT_FOUND",
    });
    await db()
      .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .updateOne({ orgId: xinyi }, { $set: { mode: "numbered" } });
    try {
      expect(
        await submitError(
          reversalValues([ticketLine(bookId, "003", 1, stallB)]),
        ),
      ).toMatchObject({
        reason: "SALE_REVERSAL_TICKET_NOT_REVERSIBLE",
      });
    } finally {
      await db()
        .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
        .updateOne({ orgId: xinyi }, { $set: { mode: "count" } });
    }
    expect(await statusOf(bookId, "003")).toBe("unsold");
  });

  it("U7 沒有票時選「遊戲 + 張數」:系統挑這台最近的已售·未對號;張數不夠時告訴還有幾張;列表寫「遊戲 × 張數」", async () => {
    await book(gameY, [{ cashPointId: counterA, ticketNos: range(1, 10) }]);
    await sellByCount(3, gameY);
    await sellByCount(1, gameY);
    const latest = await db()
      .collection<TicketDoc & { soldAt: Date }>(LOTTERY_TICKETS_COLLECTION)
      .find({
        gameId: gameY,
        status: "sold",
        unmatched: true,
        "location.cashPointId": counterA,
      })
      .sort({ soldAt: -1, _id: -1 })
      .limit(2)
      .toArray();

    const listed = await options(counterA);
    expect(listed.countMode).toBe("count");
    expect(listed.cashPoints.map((point) => point.name)).toEqual([
      "店內櫃台",
      "店外攤位",
    ]);
    expect(
      listed.games.find((game) => game.gameId === String(gameY)),
    ).toMatchObject({ gameCode: "5201", unitPrice: 200, available: 4 });
    const atB = await options(stallB);
    expect(atB.games).toEqual([]);

    const exceeds = await submitError(
      reversalValues([countLine(5, gameY)], { reason: "stocktake-error" }),
    );
    expect(exceeds).toMatchObject({
      code: "FORBIDDEN",
      reason: "SALE_REVERSAL_COUNT_EXCEEDS",
    });
    expect(String(exceeds.message)).toContain("available 4");

    const before = await expectedOf(counterA);
    const submitted = await submit(
      reversalValues([countLine(2, gameY)], { reason: "stocktake-error" }),
    );
    const picked = await lockedBy(submitted.id);
    expect(picked.map((ticket) => String(ticket._id))).toEqual(
      expect.arrayContaining(latest.map((ticket) => String(ticket._id))),
    );
    expect(picked).toHaveLength(2);
    // 鎖住的不再算進「最多 N 張」
    const remaining = await options(counterA);
    expect(
      remaining.games.find((game) => game.gameId === String(gameY))?.available,
    ).toBe(2);
    const list = await ok<{
      lotteryStoreSaleReversals: {
        items: { id: string; ticketGroups: string[]; ticketCount: number }[];
      };
    }>(api, wang.token, SALE_REVERSALS, { orgId: String(xinyi) });
    expect(
      list.lotteryStoreSaleReversals.items.find(
        (row) => row.id === submitted.id,
      ),
    ).toMatchObject({ ticketGroups: ["5201 × 2"], ticketCount: 2 });

    await decideOn(world, manager, submitted.id, "APPROVE");
    for (const ticket of latest) {
      const after = await db()
        .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
        .findOne({ _id: ticket._id });
      expect(after).toMatchObject({
        status: "unsold",
        unmatched: false,
        lockedBy: null,
      });
      expect(String(after?.location.cashPointId)).toBe(String(counterA));
    }
    // 撤銷售出申請不改售出那一班的應有現金(sale_undo cashEffect none;不退款)
    expect(await expectedOf(counterA)).toBe(before);
    expect(await unsoldAt(counterA, gameY)).toBe(8);
  });

  it("資料庫指令數與張數無關(TX-06):依遊戲 + 張數 1 張與 3 張的送出相同", async () => {
    await book(gameZ, [{ cashPointId: counterA, ticketNos: range(1, 10) }]);
    await sellByCount(5, gameZ);
    // 先送一張暖身(權限與資料範圍的快取),再數
    await submit(reversalValues([countLine(1, gameZ)]));
    const one = await countDbCommands(() =>
      submit(reversalValues([countLine(1, gameZ)])),
    );
    const three = await countDbCommands(() =>
      submit(reversalValues([countLine(3, gameZ)])),
    );
    expect(three.total).toBe(one.total);
  });

  it("U6 盤點多出 → 全店重刷列出記已售但還在 → 撤銷售出申請(盤點錯誤、不退款);核准後回重刷刷到的位置(≠ 售出收銀點),售出那一班應有現金不變(I1)", async () => {
    // A 台 #001–#005、B 台 #006–#010(遊戲 5201);#001 在 A 台刷條碼賣出,實體其實在 B 台(賣錯張)
    const { bookId, bookNo } = await book(gameY, [
      { cashPointId: counterA, ticketNos: range(1, 5) },
      { cashPointId: stallB, ticketNos: range(6, 10) },
    ]);
    // 前面情境留在 A 台的 5201 先賣掉,重刷只看這一本
    const leftover = await db()
      .collection(LOTTERY_TICKETS_COLLECTION)
      .countDocuments({
        gameId: gameY,
        status: "unsold",
        "location.cashPointId": counterA,
        bookId: { $ne: bookId },
      });
    if (leftover > 0) {
      await sellByCount(leftover, gameY);
    }
    await sellScan(bookId, ["001"]);
    const before = await expectedOf(counterA);

    const started = await ok<{ startLotteryRescan: { id: string } }>(
      api,
      wang.token,
      START_RESCAN,
      { input: { orgId: String(xinyi), gameId: String(gameY) } },
    );
    const rescanId = started.startLotteryRescan.id;
    const scanAt = async (place: Types.ObjectId, nos: string[]) => {
      for (const no of nos) {
        await ok(api, wang.token, RESCAN_SCAN, {
          input: {
            orgId: String(xinyi),
            rescanId,
            code: `${bookNo.padStart(7, "0")}${no}`,
            cashPointId: String(place),
          },
        });
      }
      return ok<{
        finishLotteryRescanPlace: {
          results: {
            ticketNo: string;
            outcome: string;
            cashPointId: string | null;
          }[];
        };
      }>(api, wang.token, RESCAN_FINISH, {
        input: { orgId: String(xinyi), rescanId, cashPointId: String(place) },
      });
    };
    await scanAt(counterA, range(2, 5));
    const done = await scanAt(stallB, [...range(6, 10), "001"]);
    expect(done.finishLotteryRescanPlace.results).toContainEqual({
      ticketNo: "001",
      outcome: "sold_here",
      cashPointId: String(stallB),
    });
    // 重刷不直接改回未售(7.3 第 4 點)
    expect(await statusOf(bookId, "001")).toBe("sold");

    // 重刷頁的 [送撤銷售出申請]:預帶盤點錯誤、不退款、重刷刷到的位置(B 台)
    const submitted = await submit(
      reversalValues([ticketLine(bookId, "001", 1, stallB)], {
        reason: "stocktake-error",
        refund: "no",
      }),
    );
    await decideOn(world, manager, submitted.id, "APPROVE");
    const after = await ticketOf(bookId, "001");
    expect(after).toMatchObject({
      status: "unsold",
      lockedBy: null,
      location: { kind: "counter" },
    });
    expect(String(after.location.cashPointId)).toBe(String(stallB));
    expect(await lastEventOf(after._id)).toMatchObject({
      type: "sale_undo",
      cashEffect: "none",
    });
    // I1:B 台實體 6 張(#001、#006–#010)、A 台 4 張(#002–#005)
    expect(await unsoldAt(stallB, gameY)).toBe(6);
    expect(await unsoldAt(counterA, gameY)).toBe(4);
    // 售出那一班(A)應有現金不變:短少在交班時用差額原因說明
    expect(await expectedOf(counterA)).toBe(before);
  });
});
