import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  INVENTORY_MODULE_KEYS,
  INVENTORY_PERMISSIONS as P,
  PURCHASE_FIELD_KEYS,
  PURCHASE_FORM_KEY,
  PURCHASE_MODULE_KEY,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import { LOTTERY_SETTINGS_PERMISSIONS } from "@repo/domain/project/lottery-settings";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../../auth/test-support/auth-app";
import {
  createOrg,
  createUser,
  newObjectId,
} from "../../../../auth/test-support/fixtures";
import type { OperatorContext } from "../../../../database/operator-context";
import { countDbCommands } from "../../../../database/test-support/db-commands";
import { HOOK_TIMEOUT_MS } from "../../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../../database/transaction";
import { login } from "../../../../demo-items-two/test-support/fixtures";
import { createRole } from "../../../../permission/test-support/fixtures";
import { PASSWORD, errorOf, ok } from "../../test-support/master-data-fixtures";
import { TicketLedgerService } from "../../tickets/ticket-ledger.service";

const CREATE = /* GraphQL */ `
  mutation TestCreateOpening($input: CreateLotteryOpeningBookInput!) {
    createLotteryOpeningBook(input: $input) {
      bookId
      count
    }
  }
`;

const VOID = /* GraphQL */ `
  mutation TestVoidOpening($bookId: ID!) {
    voidLotteryOpeningBook(bookId: $bookId) {
      bookId
      count
    }
  }
`;

const STATUS = /* GraphQL */ `
  query TestStoreOpening($orgId: ID!) {
    lotteryStoreOpening(orgId: $orgId) {
      item {
        closed
        closedBy {
          name
        }
        bookCount
        canOpen
        canClose
        history {
          action
          reason
        }
        books {
          bookId
          bookKey
          openingSoldCount
          inHandCount
          places {
            cashPoint {
              name
            }
            count
          }
          openedBy {
            name
          }
          voidable
        }
      }
    }
  }
`;

const SCAN = /* GraphQL */ `
  query TestOpeningScan($input: LotteryOpeningScanInput!) {
    lotteryOpeningScan(input: $input) {
      bookNo
      topTicketNo
      hasGameCode
      candidates {
        gameCode
        discontinued
        block
        serialNo
      }
    }
  }
`;

const FIX = /* GraphQL */ `
  mutation TestFixOpening($input: FixLotteryOpeningTicketsInput!) {
    fixLotteryOpeningTickets(input: $input) {
      count
    }
  }
`;

const CLOSE = /* GraphQL */ `
  mutation TestCloseOpening($orgId: ID!) {
    closeLotteryStoreOpening(orgId: $orgId) {
      item {
        closed
      }
    }
  }
`;

const REOPEN = /* GraphQL */ `
  mutation TestReopenOpening($input: ReopenLotteryStoreOpeningInput!) {
    reopenLotteryStoreOpening(input: $input) {
      item {
        closed
        history {
          action
          reason
        }
      }
    }
  }
`;

interface StatusData {
  lotteryStoreOpening: {
    item: {
      closed: boolean;
      closedBy: { name: string } | null;
      bookCount: number;
      canOpen: boolean;
      canClose: boolean;
      history: { action: string; reason: string | null }[];
      books: {
        bookId: string;
        bookKey: string;
        openingSoldCount: number;
        inHandCount: number;
        places: { cashPoint: { name: string } | null; count: number }[];
        openedBy: { name: string } | null;
        voidable: boolean;
      }[];
    };
  };
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    String(from + index).padStart(3, "0"),
  );

function baseFields(now: Date): Record<string, unknown> {
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
}

/** 庫存管理的模組樹 + 期初建檔權限 + 刮刮樂設定改分店(只寫進隔離的測試資料庫)。 */
async function seedAuthorization(connection: Connection) {
  const now = new Date();
  const modules = connection.collection("modules");
  const { insertedId: listId } = await modules.insertOne({
    key: INVENTORY_MODULE_KEYS.list,
    name: "庫存管理",
    parentId: null,
    ancestors: [],
    route: "inventory",
    sidebarType: "link",
    order: 20,
    enabled: true,
    isSystem: false,
    icon: null,
    settings: {},
    engine: "fixed",
    ...baseFields(now),
  });
  await modules.insertOne({
    key: INVENTORY_MODULE_KEYS.openingPage,
    name: "期初建檔",
    parentId: listId,
    ancestors: [listId],
    route: "opening-page",
    sidebarType: "hidden",
    order: 2,
    enabled: true,
    isSystem: false,
    icon: null,
    settings: {},
    engine: "fixed",
    ...baseFields(now),
  });
  await connection.collection("permissions").insertMany(
    [...Object.values(P), LOTTERY_SETTINGS_PERMISSIONS.editOrg].map((key) => ({
      key,
      moduleId: listId,
      name: key,
      enabled: true,
      isSystem: false,
      settings: {},
      source: "seed",
      retiredAt: null,
      ...baseFields(now),
    })),
  );
}

/** 欄位管理「期初更正原因」(全域):建檔時標錯、其他。 */
async function seedReasonCategory(connection: Connection) {
  const now = new Date();
  const key = LOTTERY_FIELD_CATEGORY_KEYS.openingCorrectionReason;
  const { insertedId: categoryId } = await connection
    .collection("field_categories")
    .insertOne({
      key,
      name: key,
      isSystem: true,
      enabled: true,
      ...baseFields(now),
    });
  await connection.collection("fields").insertMany(
    [
      { value: "mis-entered", label: "建檔時標錯" },
      { value: "other", label: "其他" },
    ].map((option, index) => ({
      ...option,
      key: `${key}.${option.value}`,
      categoryId,
      orgId: null,
      order: index + 1,
      enabled: true,
      isSystem: true,
      ...baseFields(now),
    })),
  );
}

let accountSequence = 0;

/**
 * 期初建檔(期初建檔規格第 2–4、6 節;OP1–OP6):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 *
 * 組織樹:root ─ 租戶甲(含下層可見)─┬─ 中山店(店內櫃台、停用的舊櫃台)
 *                                  └─ 新竹店
 */
describe("期初建檔(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let tenant: Types.ObjectId;
  let storeA: Types.ObjectId;
  let storeB: Types.ObjectId;
  let gameId: Types.ObjectId;
  let pointA: Types.ObjectId;
  let disabledPoint: Types.ObjectId;
  /** 總部:期初建檔 + 結束 / 重新開放 + 看成本。 */
  let hq: string;
  /** 中山店店長:期初建檔。 */
  let managerA: string;
  /** 中山店、沒有期初建檔。 */
  let clerkA: string;
  /** 新竹店店長(看不到中山店)。 */
  let managerB: string;
  let bookSequence = 56_600;

  const nextBookNo = () => {
    bookSequence += 1;
    return String(bookSequence).padStart(6, "0");
  };

  async function operatorToken(
    orgId: Types.ObjectId,
    permissionKeys: readonly string[],
  ): Promise<string> {
    accountSequence += 1;
    const account = `opening-${String(accountSequence)}`;
    const userId = await createUser(api.connection, {
      account,
      password: PASSWORD,
      orgIds: [orgId],
    });
    await createRole(api.app, api.connection, {
      name: `期初建檔角色:${account}`,
      ownerOrgId: tenant,
      moduleKeys: [
        INVENTORY_MODULE_KEYS.list,
        INVENTORY_MODULE_KEYS.openingPage,
      ],
      permissionKeys: [...permissionKeys],
      assignTo: [userId],
    });
    return login(api, account, PASSWORD);
  }

  /** 拆過的本:導入前已賣出 001–046、跳號 078、其餘 54 張在店內櫃台(規格示範資料)。 */
  const openedInput = (bookNo: string, orgId = storeA) => ({
    orgId: String(orgId),
    gameId: String(gameId),
    bookNo,
    lastTicketNo: 101,
    rate: 92,
    soldTicketNos: range(1, 46),
    skippedTicketNos: ["078"],
    placements: [
      {
        cashPointId: String(pointA),
        ticketNos: range(47, 101).filter((no) => no !== "078"),
      },
    ],
  });

  /** 原封的本:全部在庫存、不標跳號。 */
  const sealedInput = (bookNo: string, lastTicketNo = 101) => ({
    orgId: String(storeA),
    gameId: String(gameId),
    bookNo,
    lastTicketNo,
    rate: 93,
    soldTicketNos: [],
    skippedTicketNos: [],
    placements: [{ cashPointId: null, ticketNos: range(1, lastTicketNo) }],
  });

  const create = (token: string, input: Record<string, unknown>) =>
    ok<{ createLotteryOpeningBook: { bookId: string; count: number } }>(
      api,
      token,
      CREATE,
      { input },
    ).then((data) => data.createLotteryOpeningBook);

  const statusOf = (token: string, orgId = storeA) =>
    ok<StatusData>(api, token, STATUS, { orgId: String(orgId) }).then(
      (data) => data.lotteryStoreOpening.item,
    );

  const ticketsOf = (bookId: string) =>
    api.connection
      .collection<{
        _id: Types.ObjectId;
        ticketNo: string;
        status: string;
        soldSource: string | null;
        soldAt: Date | null;
        saleEventId: string | null;
        unitCost: number;
        version: number;
        location: { kind: string; cashPointId: Types.ObjectId | null };
      }>("lottery_tickets")
      .find({ bookId: new Types.ObjectId(bookId) })
      .sort({ ticketNo: 1 })
      .toArray();

  const bookDoc = (bookId: string) =>
    api.connection
      .collection("lottery_books")
      .findOne({ _id: new Types.ObjectId(bookId) });

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-opening");
    await seedAuthorization(api.connection);
    await seedReasonCategory(api.connection);
    tenant = await createOrg(api.connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    storeA = await createOrg(api.connection, {
      name: "中山店",
      parentId: tenant,
    });
    storeB = await createOrg(api.connection, {
      name: "新竹店",
      parentId: tenant,
    });
    const now = new Date();
    ({ insertedId: gameId } = await api.connection
      .collection("lottery_games")
      .insertOne({
        orgId: tenant,
        tenantId: tenant,
        moduleKey: "master-data",
        shareOrgs: [{ orgId: tenant, includeDescendants: true }],
        gameCode: "5164",
        name: "發大財",
        unitPrice: 200,
        ticketsPerBook: 100,
        bookPrice: 20_000,
        defaultRate: 92,
        color: null,
        status: "on_sale",
        ...baseFields(now),
      }));
    const point = (name: string, enabled: boolean) => ({
      orgId: storeA,
      tenantId: tenant,
      positionKey: name,
      name,
      order: 1,
      enabled,
      printerId: null,
      note: null,
      moduleKey: "master-data.cash-points",
      ...baseFields(now),
    });
    ({ insertedId: pointA } = await api.connection
      .collection("lottery_cash_points")
      .insertOne(point("店內櫃台", true)));
    ({ insertedId: disabledPoint } = await api.connection
      .collection("lottery_cash_points")
      .insertOne(point("舊櫃台", false)));
    hq = await operatorToken(tenant, [
      ...Object.values(P),
      LOTTERY_SETTINGS_PERMISSIONS.editOrg,
    ]);
    managerA = await operatorToken(storeA, [P.opening, P.showCost]);
    clerkA = await operatorToken(storeA, [P.showCost]);
    managerB = await operatorToken(storeB, [P.opening]);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  });

  it("OP1 拆過的本:張的狀態、位置、成本、拆本時間、事件;原封的本全部在庫存、未拆", async () => {
    const { bookId, count } = await create(managerA, openedInput(nextBookNo()));
    expect(count).toBe(101);
    const tickets = await ticketsOf(bookId);
    const sold = tickets.filter((ticket) => ticket.status === "sold");
    expect(sold.map((ticket) => ticket.ticketNo)).toEqual(range(1, 46));
    expect(
      sold.every(
        (ticket) =>
          ticket.soldSource === "opening" &&
          ticket.saleEventId === null &&
          ticket.location.kind === TICKET_LOCATION_KIND.counter &&
          ticket.location.cashPointId?.equals(pointA) === true,
      ),
    ).toBe(true);
    expect(
      tickets
        .filter((ticket) => ticket.status === "skipped")
        .map((t) => t.ticketNo),
    ).toEqual(["078"]);
    const onCounter = tickets.filter((ticket) => ticket.status === "unsold");
    expect(onCounter).toHaveLength(54);
    expect(
      onCounter.every((ticket) => ticket.location.cashPointId?.equals(pointA)),
    ).toBe(true);
    expect(tickets.every((ticket) => ticket.unitCost === 184)).toBe(true);
    const book = await bookDoc(bookId);
    expect(book).toMatchObject({
      source: "opening",
      cost: 18_400,
      rate: 92,
      purchaseSubmissionId: null,
      purchasedAt: null,
      skippedTicketNos: ["078"],
      ticketCounts: expect.objectContaining({
        counter: 54,
        sold: 46,
        stock: 0,
      }),
    });
    expect(book?.firstOpenedAt).toBeInstanceOf(Date);
    expect(book?.openingAt).toBeInstanceOf(Date);
    const events = await api.connection
      .collection("lottery_ticket_events")
      .find({ bookId: new Types.ObjectId(bookId) })
      .toArray();
    expect(events).toHaveLength(101);
    expect(
      events.every(
        (event) =>
          event.type === TICKET_EVENT_TYPE.opening &&
          event.cashEffect === "none" &&
          event.amount === 0 &&
          event.from === null,
      ),
    ).toBe(true);

    const sealed = await create(managerA, sealedInput(nextBookNo()));
    const sealedBook = await bookDoc(sealed.bookId);
    expect(sealedBook).toMatchObject({
      firstOpenedAt: null,
      cost: 18_600,
      skippedTicketNos: [],
      ticketCounts: expect.objectContaining({ stock: 101, sold: 0 }),
    });

    const status = await statusOf(managerA);
    expect(status.closed).toBe(false);
    expect(status.canOpen).toBe(true);
    const listed = status.books.find((item) => item.bookId === bookId);
    expect(listed).toMatchObject({
      openingSoldCount: 46,
      inHandCount: 54,
      places: [{ cashPoint: { name: "店內櫃台" }, count: 54 }],
      voidable: true,
    });
  });

  it("OP2 擋下:已在系統裡、在進貨單上、整本賣完、跳號沒標、停用的收銀點;停售的遊戲可以建", async () => {
    const bookNo = nextBookNo();
    await create(managerA, sealedInput(bookNo));
    expect(
      await errorOf(api, managerA, CREATE, { input: sealedInput(bookNo) }),
    ).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "BOOK_KEY_DUPLICATE",
    });
    const scanned = await ok<{
      lotteryOpeningScan: {
        bookNo: string;
        topTicketNo: string;
        hasGameCode: boolean;
        candidates: { block: string | null }[];
      };
    }>(api, managerA, SCAN, {
      input: { orgId: String(storeA), code: `5164-1-${bookNo}-047-1-A` },
    });
    expect(scanned.lotteryOpeningScan).toMatchObject({
      topTicketNo: "047",
      hasGameCode: true,
      candidates: [{ block: "exists" }],
    });

    // 在有效的進貨單上、還沒點收
    const onPurchase = nextBookNo();
    const now = new Date();
    await api.connection.collection("form_submissions").insertOne({
      orgId: tenant,
      tenantId: tenant,
      moduleKey: PURCHASE_MODULE_KEY,
      formKey: PURCHASE_FORM_KEY,
      version: 1,
      values: {
        [PURCHASE_FIELD_KEYS.branch]: { id: String(storeA), label: "中山店" },
        [PURCHASE_FIELD_KEYS.lines]: [
          {
            rowId: "r1",
            [PURCHASE_FIELD_KEYS.game]: { id: String(gameId), label: "發大財" },
            [PURCHASE_FIELD_KEYS.bookNo]: onPurchase,
          },
        ],
      },
      summary: null,
      status: "reviewing",
      revision: 1,
      revisions: [],
      editVersion: 1,
      touched: [],
      clientRequestId: String(new Types.ObjectId()),
      serialNo: "P-0101",
      submittedAt: now,
      currentInstanceId: null,
      blocked: false,
      shareOrgs: [],
      ...baseFields(now),
    });
    expect(
      await errorOf(api, managerA, CREATE, { input: sealedInput(onPurchase) }),
    ).toMatchObject({ reason: "BOOK_ON_PURCHASE", serialNo: "P-0101" });

    const allSold = {
      ...sealedInput(nextBookNo(), 100),
      soldTicketNos: range(1, 100),
      placements: [],
    };
    expect(
      await errorOf(api, managerA, CREATE, { input: allSold }),
    ).toMatchObject({
      reason: "OPENING_PLAN_INVALID",
      openingProblem: "all_sold",
    });
    expect(
      await errorOf(api, managerA, CREATE, {
        input: {
          ...openedInput(nextBookNo()),
          skippedTicketNos: [],
          placements: [
            { cashPointId: String(pointA), ticketNos: range(47, 101) },
          ],
        },
      }),
    ).toMatchObject({
      reason: "OPENING_PLAN_INVALID",
      openingProblem: "skip_count_mismatch",
    });
    const toDisabled = openedInput(nextBookNo());
    toDisabled.placements[0] = {
      cashPointId: String(disabledPoint),
      ticketNos: toDisabled.placements[0]?.ticketNos ?? [],
    };
    expect(
      await errorOf(api, managerA, CREATE, { input: toDisabled }),
    ).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "CASH_POINT_DISABLED",
    });

    await api.connection
      .collection("lottery_games")
      .updateOne({ _id: gameId }, { $set: { status: "discontinued" } });
    try {
      const discontinued = nextBookNo();
      const scan = await ok<{
        lotteryOpeningScan: { candidates: { discontinued: boolean }[] };
      }>(api, managerA, SCAN, {
        input: {
          orgId: String(storeA),
          code: `5164-1-${discontinued}-001-1-A`,
        },
      });
      expect(scan.lotteryOpeningScan.candidates[0]?.discontinued).toBe(true);
      await create(managerA, sealedInput(discontinued));
    } finally {
      await api.connection
        .collection("lottery_games")
        .updateOne({ _id: gameId }, { $set: { status: "on_sale" } });
    }
  });

  it("OP3 兩個人同時建同一本:只有一個成功", async () => {
    const bookNo = nextBookNo();
    const results = await Promise.all([
      api.graphql(
        CREATE,
        { input: sealedInput(bookNo) },
        { accessToken: managerA },
      ),
      api.graphql(CREATE, { input: sealedInput(bookNo) }, { accessToken: hq }),
    ]);
    expect(
      results.filter((result) => result.errors === undefined),
    ).toHaveLength(1);
    expect(
      await api.connection
        .collection("lottery_books")
        .countDocuments({ bookNo: `0${bookNo}`, deletedAt: null }),
    ).toBe(1);
  });

  it("OP4 結束與建檔同時:有先後;結束後擋下,重新開放(原因必填)後可以再建", async () => {
    const bookNo = nextBookNo();
    const [created, closed] = await Promise.all([
      api.graphql(
        CREATE,
        { input: sealedInput(bookNo) },
        { accessToken: managerA },
      ),
      api.graphql(CLOSE, { orgId: String(storeA) }, { accessToken: hq }),
    ]);
    expect(closed.errors).toBeUndefined();
    const book = await api.connection
      .collection("lottery_books")
      .findOne({ bookNo: `0${bookNo}`, deletedAt: null });
    if (created.errors === undefined) {
      const record = await api.connection
        .collection("lottery_store_openings")
        .findOne({ orgId: storeA });
      expect(book?.openingAt <= record?.closedAt).toBe(true);
    } else {
      expect(book).toBeNull();
      expect(created.errors[0]?.extensions).toMatchObject({
        reason: "STORE_OPENING_CLOSED",
      });
    }
    expect(
      await errorOf(api, managerA, CREATE, {
        input: sealedInput(nextBookNo()),
      }),
    ).toMatchObject({ reason: "STORE_OPENING_CLOSED" });
    const status = await statusOf(managerA);
    expect(status).toMatchObject({ closed: true, canOpen: false });
    expect(
      await errorOf(api, hq, CLOSE, { orgId: String(storeA) }),
    ).toMatchObject({ code: "CONFLICT" });
    expect(
      await errorOf(api, hq, REOPEN, {
        input: { orgId: String(storeA), reason: " " },
      }),
    ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["reason"] });
    const reopened = await ok<{
      reopenLotteryStoreOpening: {
        item: {
          closed: boolean;
          history: { action: string; reason: string | null }[];
        };
      };
    }>(api, hq, REOPEN, {
      input: { orgId: String(storeA), reason: "結束後才發現一箱漏建" },
    });
    expect(reopened.reopenLotteryStoreOpening.item).toMatchObject({
      closed: false,
      history: [
        { action: "close", reason: null },
        { action: "reopen", reason: "結束後才發現一箱漏建" },
      ],
    });
    await create(managerA, sealedInput(nextBookNo()));
    const audits = await api.connection
      .collection("audit_logs")
      .countDocuments({
        action: {
          $in: ["inventory.opening-close", "inventory.opening-reopen"],
        },
      });
    expect(audits).toBe(2);
  });

  it("OP5 作廢:本號釋出可以重建;有其他動作後不能作廢", async () => {
    const bookNo = nextBookNo();
    const first = await create(managerA, openedInput(bookNo));
    const voided = await ok<{ voidLotteryOpeningBook: { count: number } }>(
      api,
      managerA,
      VOID,
      { bookId: first.bookId },
    );
    expect(voided.voidLotteryOpeningBook.count).toBe(101);
    const voidedBook = await bookDoc(first.bookId);
    expect(voidedBook).toMatchObject({ status: "revoked" });
    expect(voidedBook?.deletedAt).toBeInstanceOf(Date);
    expect(
      await api.connection.collection("lottery_ticket_events").countDocuments({
        bookId: new Types.ObjectId(first.bookId),
        type: TICKET_EVENT_TYPE.openingVoid,
      }),
    ).toBe(101);
    const status = await statusOf(managerA);
    expect(status.books.some((item) => item.bookId === first.bookId)).toBe(
      false,
    );

    const second = await create(managerA, openedInput(bookNo));
    expect(second.bookId).not.toBe(first.bookId);
    // 收回一張到庫存(帳本寫事件)→ 這本已有其他動作
    const secondTickets = await ticketsOf(second.bookId);
    const ticket = secondTickets.find((item) => item.status === "unsold");
    if (ticket === undefined) {
      throw new Error("沒有未售的張");
    }
    const operator: OperatorContext = {
      actorId: newObjectId(),
      currentOrgId: storeA,
      visibleOrgIds: [storeA],
      managedOrgIds: [],
      memberOrgIds: [storeA],
      roleIds: [],
      memberTenants: [
        { tenantId: tenant, memberOrgIds: [storeA], ancestorOrgIds: [tenant] },
      ],
    };
    await api.app.get(TransactionService).withTransaction((session) =>
      api.app
        .get(TicketLedgerService)
        .applyTicketEvents(session, { operator }, [
          {
            ticketId: ticket._id,
            expectedVersion: ticket.version,
            type: TICKET_EVENT_TYPE.recall,
            patch: {
              location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
            },
          },
        ]),
    );
    const after = await statusOf(managerA);
    expect(
      after.books.find((item) => item.bookId === second.bookId)?.voidable,
    ).toBe(false);
    expect(
      await errorOf(api, managerA, VOID, { bookId: second.bookId }),
    ).toMatchObject({ reason: "OPENING_NOT_VOIDABLE" });
  });

  it("OP11 期初更正:改回未售放到選的位置;改成導入前已賣出只在進行中;原因必填;不碰現金", async () => {
    const { bookId } = await create(managerA, openedInput(nextBookNo()));
    const tickets = await ticketsOf(bookId);
    const pick = (nos: string[]) =>
      tickets
        .filter((ticket) => nos.includes(ticket.ticketNo))
        .map((ticket) => ({
          ticketId: String(ticket._id),
          version: ticket.version,
        }));
    expect(
      await errorOf(api, managerA, FIX, {
        input: { tickets: pick(["046"]), to: "unsold", reasonKey: "" },
      }),
    ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["reasonKey"] });
    expect(
      await errorOf(api, managerA, FIX, {
        input: {
          tickets: pick(["047"]),
          to: "unsold",
          reasonKey: "mis-entered",
        },
      }),
    ).toMatchObject({ reason: "TICKET_STATUS_NOT_ALLOWED" });
    await ok(api, managerA, FIX, {
      input: {
        tickets: pick(["045", "046"]),
        to: "unsold",
        cashPointId: String(pointA),
        reasonKey: "mis-entered",
      },
    });
    const after = await ticketsOf(bookId);
    const fixed = after.filter((ticket) =>
      ["045", "046"].includes(ticket.ticketNo),
    );
    expect(
      fixed.every(
        (ticket) =>
          ticket.status === "unsold" &&
          ticket.soldSource === null &&
          ticket.location.cashPointId?.equals(pointA) === true,
      ),
    ).toBe(true);
    const fixEvents = await api.connection
      .collection("lottery_ticket_events")
      .find({
        bookId: new Types.ObjectId(bookId),
        type: TICKET_EVENT_TYPE.openingFix,
      })
      .toArray();
    expect(fixEvents).toHaveLength(2);
    expect(
      fixEvents.every(
        (event) =>
          event.cashEffect === "none" &&
          event.amount === 0 &&
          event.reasonKey === "mis-entered",
      ),
    ).toBe(true);
    // 進行中:未售 → 導入前已賣出
    const unsold = after.find((ticket) => ticket.ticketNo === "060");
    await ok(api, managerA, FIX, {
      input: {
        tickets: [{ ticketId: String(unsold?._id), version: unsold?.version }],
        to: "opening_sold",
        reasonKey: "other",
        reasonNote: "漏標",
      },
    });
    const afterSold = await ticketsOf(bookId);
    const sixty = afterSold.find((ticket) => ticket.ticketNo === "060");
    expect(sixty).toMatchObject({ status: "sold", soldSource: "opening" });
    expect(sixty?.saleEventId).toBeNull();
    // 結束後:只能改回未售
    await ok(api, hq, CLOSE, { orgId: String(storeA) });
    try {
      const current = await ticketsOf(bookId);
      const ref = (no: string) => {
        const ticket = current.find((item) => item.ticketNo === no);
        return [{ ticketId: String(ticket?._id), version: ticket?.version }];
      };
      expect(
        await errorOf(api, managerA, FIX, {
          input: {
            tickets: ref("061"),
            to: "opening_sold",
            reasonKey: "mis-entered",
          },
        }),
      ).toMatchObject({ reason: "STORE_OPENING_CLOSED" });
      await ok(api, managerA, FIX, {
        input: { tickets: ref("060"), to: "unsold", reasonKey: "mis-entered" },
      });
    } finally {
      await ok(api, hq, REOPEN, {
        input: { orgId: String(storeA), reason: "測試還原" },
      });
    }
  });

  it("OP6 沒有權限 / 看不到的分店 → FORBIDDEN;指令數與張數無關", async () => {
    expect(
      await errorOf(api, clerkA, CREATE, { input: sealedInput(nextBookNo()) }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await errorOf(api, managerB, CREATE, {
        input: sealedInput(nextBookNo()),
      }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await errorOf(api, managerB, STATUS, { orgId: String(storeA) }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await errorOf(api, managerA, CLOSE, { orgId: String(storeA) }),
    ).toMatchObject({ code: "FORBIDDEN" });

    const small = await countDbCommands(() =>
      create(managerA, sealedInput(nextBookNo(), 100)),
    );
    const large = await countDbCommands(() =>
      create(managerA, sealedInput(nextBookNo(), 300)),
    );
    expect(large.total).toBe(small.total);
  });
});
