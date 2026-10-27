import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Connection, Types } from "mongoose";

import {
  INVENTORY_MODULE_KEYS,
  INVENTORY_PERMISSIONS as P,
  STORE_PERMISSIONS,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import {
  createOrg,
  createUser,
  newObjectId,
} from "../../../auth/test-support/fixtures";
import type { OperatorContext } from "../../../database/operator-context";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import { login } from "../../../demo-items-two/test-support/fixtures";
import { createRole } from "../../../permission/test-support/fixtures";
import { PASSWORD, errorOf, ok } from "../test-support/master-data-fixtures";
import { LotteryAllocationsService } from "../tickets/allocations.service";
import { LotteryBooksService } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";

const BOOK = /* GraphQL */ `
  query TestInventoryBook($id: ID!) {
    lotteryInventoryBook(id: $id) {
      item {
        book {
          id
          bookKey
          skippedTicketNos
          requiredSkipCount
          holdings {
            org {
              name
            }
            count
          }
        }
        tickets {
          id
          ticketNo
          status
          operable
          version
        }
        events {
          type
          ticketNos
          reasonKey
          reasonNote
          correctionOfShift
        }
        cost {
          cost
        }
        investigation {
          status
        }
        abilities {
          canCorrectSkips
          canRecover
          canScrap
          canShowCost
        }
      }
    }
  }
`;

const BOOKS = /* GraphQL */ `
  query TestInventoryBooks($input: LotteryInventoryBooksInput!) {
    lotteryInventoryBooks(input: $input) {
      items {
        id
        state
        remainingCount
        totalCount
        pendingSkipCount
      }
      totalCount
    }
  }
`;

const SWAP = /* GraphQL */ `
  mutation TestSwapSkip($input: SwapLotterySkippedTicketInput!) {
    swapLotterySkippedTicket(input: $input) {
      count
    }
  }
`;

const RECOVER = /* GraphQL */ `
  mutation TestRecover($input: RecoverLotteryTicketsInput!) {
    recoverLotteryTickets(input: $input) {
      count
    }
  }
`;

const STORES = /* GraphQL */ `
  query TestStores {
    lotteryInventoryStores {
      items {
        name
      }
    }
  }
`;

const SCRAP = /* GraphQL */ `
  mutation TestScrap($input: ScrapLotteryTicketsInput!) {
    scrapLotteryTickets(input: $input) {
      count
      lossCost
    }
  }
`;

const ALLOCATIONS = /* GraphQL */ `
  query TestAllocations($input: LotteryAllocationsInput!) {
    lotteryAllocations(input: $input) {
      stores {
        id
        name
      }
      games {
        id
      }
      cells {
        orgId
        gameId
        plannedBooks
        givenBooks
        givenExtraTickets
      }
      canEdit
    }
  }
`;

const SET_ALLOCATION = /* GraphQL */ `
  mutation TestSetAllocation($input: SetLotteryAllocationInput!) {
    setLotteryAllocation(input: $input) {
      item {
        plannedBooks
        givenBooks
      }
    }
  }
`;

const LOOKUP = /* GraphQL */ `
  query TestLookup($input: LotteryTicketLookupInput!) {
    lotteryTicketLookup(input: $input) {
      items {
        bookId
        ticketNo
        status
      }
    }
  }
`;

const INVESTIGATIONS = /* GraphQL */ `
  query TestInvestigations {
    lotteryInvestigations {
      items {
        bookId
        status
        cost
        ticketCount
        responsibleOrg {
          name
        }
        tickets {
          ticketNo
        }
      }
      canRecover
    }
  }
`;

const STOCK = /* GraphQL */ `
  query TestStock($input: LotteryStockOverviewInput!) {
    lotteryStockOverview(input: $input) {
      items {
        org {
          name
        }
        unopenedBooks
        counterTickets
        soldTickets
      }
    }
  }
`;

interface TicketView {
  id: string;
  ticketNo: string;
  status: string;
  operable?: boolean;
  version: number;
}

interface BookData {
  lotteryInventoryBook: {
    item: {
      book: {
        id: string;
        bookKey: string;
        skippedTicketNos: string[];
        requiredSkipCount: number;
        holdings: { org: { name: string }; count: number }[];
      };
      tickets: TicketView[];
      events: {
        type: string;
        ticketNos: string[];
        reasonKey: string | null;
        reasonNote: string | null;
        correctionOfShift: string | null;
      }[];
      cost: { cost: number } | null;
      investigation: { status: string } | null;
      abilities: {
        canCorrectSkips: boolean;
        canRecover: boolean;
        canScrap: boolean;
        canShowCost: boolean;
      };
    };
  };
}

interface AllocationsData {
  lotteryAllocations: {
    stores: { id: string; name: string }[];
    games: { id: string }[];
    cells: {
      orgId: string;
      gameId: string;
      plannedBooks: number | null;
      givenBooks: number;
      givenExtraTickets: number;
    }[];
    canEdit: boolean;
  };
}

function baseFields(now: Date): Record<string, unknown> {
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
}

/** 庫存管理的模組樹與權限(形狀同 seed `seeds/project/inventory.ts`;只寫進隔離的測試資料庫)。 */
async function seedInventoryAuthorization(connection: Connection) {
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
    key: INVENTORY_MODULE_KEYS.bookPage,
    name: "本的詳情",
    parentId: listId,
    ancestors: [listId],
    route: "book-page",
    sidebarType: "hidden",
    order: 1,
    enabled: true,
    isSystem: false,
    icon: null,
    settings: {},
    engine: "fixed",
    ...baseFields(now),
  });
  await connection.collection("permissions").insertMany(
    [...Object.values(P), STORE_PERMISSIONS.view].map((key) => ({
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

/** 三個原因類別(全域),各有一個選項與「其他」。 */
async function seedReasonCategories(connection: Connection) {
  const now = new Date();
  for (const key of [
    LOTTERY_FIELD_CATEGORY_KEYS.skipCorrectionReason,
    LOTTERY_FIELD_CATEGORY_KEYS.recoverReason,
    LOTTERY_FIELD_CATEGORY_KEYS.scrapReason,
  ]) {
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
        { value: "mistake", label: "標註錯誤" },
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
}

let accountSequence = 0;

/** 選到的張與讀到的版本(尋回 / 報廢的輸入)。 */
function versionsOf(tickets: readonly TicketView[], nos: string[]) {
  return tickets
    .filter((ticket) => nos.includes(ticket.ticketNo))
    .map((ticket) => ({ ticketId: ticket.id, version: ticket.version }));
}

/** 這一張能不能操作(api 的 `operable`)。 */
const operableOf = (tickets: readonly TicketView[], no: string) =>
  tickets.find((ticket) => ticket.ticketNo === no)?.operable;

/** 這幾張的 id。 */
const idsOf = (tickets: readonly TicketView[], nos: string[]) =>
  versionsOf(tickets, nos).map((item) => item.ticketId);

/**
 * 庫存管理(專案規格 7.3、7.4、7.6):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 * 張與本由帳本 / 本的服務直接建(進貨點收、拆本標跳號、待查是別的功能的入口)。
 *
 * 組織樹:root ─ 租戶甲(含下層可見)─┬─ 中山店
 *                                  ├─ 新竹店
 *                                  └─ 台中店
 */
describe("庫存管理(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let tenant: Types.ObjectId;
  let storeA: Types.ObjectId;
  let storeB: Types.ObjectId;
  let storeC: Types.ObjectId;
  /** 只用在庫存概況的店(沒有別的測試動它)。 */
  let storeD: Types.ObjectId;
  let gameId: Types.ObjectId;
  /** 總部:庫存管理全部。 */
  let hq: string;
  /** 中山店店長:除了 edit-allocations 全部。 */
  let managerA: string;
  /** 新竹店店長:同上。 */
  let managerB: string;
  /** 台中店店長:同上。 */
  let managerC: string;
  /** 中山店、只有報廢(沒有顯示成本、沒有更正跳號)。 */
  let scrapOnly: string;
  /** 中山店、沒綁庫存管理。 */
  let outsider: string;
  let bookSequence = 300_000;

  const transactions = () => api.app.get(TransactionService);
  const ledger = () => api.app.get(TicketLedgerService);

  /** 分店人員的操作者上下文(帳本 / 本的服務用;權限由呼叫端判斷)。 */
  function storeOperator(orgId: Types.ObjectId): OperatorContext {
    return {
      actorId: newObjectId(),
      currentOrgId: orgId,
      visibleOrgIds: [orgId],
      managedOrgIds: [],
      memberOrgIds: [orgId],
      roleIds: [],
      memberTenants: [
        { tenantId: tenant, memberOrgIds: [orgId], ancestorOrgIds: [tenant] },
      ],
    };
  }

  async function operatorToken(
    orgId: Types.ObjectId | Types.ObjectId[],
    permissionKeys: readonly string[],
    withModule = true,
  ): Promise<string> {
    accountSequence += 1;
    const account = `inventory-${String(accountSequence)}`;
    const userId = await createUser(api.connection, {
      account,
      password: PASSWORD,
      orgIds: Array.isArray(orgId) ? orgId : [orgId],
    });
    await createRole(api.app, api.connection, {
      name: `庫存管理角色:${account}`,
      ownerOrgId: tenant,
      moduleKeys: withModule
        ? [INVENTORY_MODULE_KEYS.list, INVENTORY_MODULE_KEYS.bookPage]
        : [],
      permissionKeys: [...permissionKeys],
      assignTo: [userId],
    });
    return login(api, account, PASSWORD);
  }

  /** 點收一本到某家店(標準 100 張,成本 18,400 → 單張 184)。 */
  async function receiveBook(
    orgId: Types.ObjectId,
    lastTicketNo = 100,
  ): Promise<Types.ObjectId> {
    bookSequence += 1;
    const { book } = await transactions().withTransaction((session) =>
      api.app
        .get(LotteryBooksService)
        .createBook(session, storeOperator(orgId), {
          orgId,
          gameId,
          bookNo: String(bookSequence).padStart(6, "0"),
          lastTicketNo,
          rate: 92,
          cost: 18_400,
        }),
    );
    return book._id;
  }

  async function ticketsOf(bookId: Types.ObjectId) {
    return api.connection
      .collection<{
        _id: Types.ObjectId;
        orgId: Types.ObjectId;
        ticketNo: string;
        status: string;
        version: number;
        unitCost: number;
        responsibleOrgId: Types.ObjectId | null;
        location: { kind: string };
      }>("lottery_tickets")
      .find({ bookId })
      .sort({ ticketNo: 1 })
      .toArray();
  }

  async function ticketOf(bookId: Types.ObjectId, ticketNo: string) {
    const all = await ticketsOf(bookId);
    return all.find((ticket) => ticket.ticketNo === ticketNo);
  }

  /** 以帳本寫一批事件(店裡的人、自己的範圍)。 */
  async function apply(
    orgId: Types.ObjectId,
    bookId: Types.ObjectId,
    ticketNos: readonly string[],
    event: Pick<TicketEventInput, "type" | "patch">,
  ): Promise<void> {
    const all = await ticketsOf(bookId);
    const tickets = all.filter((ticket) => ticketNos.includes(ticket.ticketNo));
    await transactions().withTransaction((session) =>
      ledger().applyTicketEvents(
        session,
        { operator: storeOperator(orgId) },
        tickets.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          ...event,
        })),
      ),
    );
  }

  /** 把幾張調進另一家店(帳本的跨店寫入,同調貨點收)。 */
  async function moveTo(
    orgId: Types.ObjectId,
    bookId: Types.ObjectId,
    ticketNos: readonly string[],
  ): Promise<void> {
    const all = await ticketsOf(bookId);
    const tickets = all.filter((ticket) => ticketNos.includes(ticket.ticketNo));
    await transactions().withTransaction((session) =>
      ledger().applyTicketEvents(
        session,
        { operator: storeOperator(orgId), crossStoreTenantId: tenant },
        tickets.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          type: TICKET_EVENT_TYPE.transferIn,
          patch: {
            orgId,
            location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
          },
        })),
      ),
    );
  }

  /** 中山店的本,#001–010 調到新竹店;中山店的 #050 待查、新竹店的 #005 待查。 */
  async function splitBook(lastTicketNo = 100): Promise<Types.ObjectId> {
    const bookId = await receiveBook(storeA, lastTicketNo);
    const moved = Array.from({ length: 10 }, (_, index) =>
      String(index + 1).padStart(3, "0"),
    );
    await moveTo(storeB, bookId, moved);
    await apply(storeA, bookId, ["050"], {
      type: TICKET_EVENT_TYPE.investigate,
      patch: {
        status: TICKET_STATUS.investigating,
        responsibleOrgId: storeA,
      },
    });
    await apply(storeB, bookId, ["005"], {
      type: TICKET_EVENT_TYPE.investigate,
      patch: {
        status: TICKET_STATUS.investigating,
        responsibleOrgId: storeB,
      },
    });
    return bookId;
  }

  const bookOf = (bookId: Types.ObjectId, token = hq) =>
    ok<BookData>(api, token, BOOK, { id: String(bookId) }).then(
      (data) => data.lotteryInventoryBook.item,
    );

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-inventory");
    await seedInventoryAuthorization(api.connection);
    await seedReasonCategories(api.connection);
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
    storeC = await createOrg(api.connection, {
      name: "台中店",
      parentId: tenant,
    });
    storeD = await createOrg(api.connection, {
      name: "高雄店",
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
    const manager = [P.markSkipped, P.recover, P.scrap, P.showCost];
    hq = await operatorToken(tenant, [
      ...Object.values(P),
      STORE_PERMISSIONS.view,
    ]);
    managerA = await operatorToken(storeA, manager);
    managerB = await operatorToken(storeB, manager);
    managerC = await operatorToken(storeC, manager);
    scrapOnly = await operatorToken(storeA, [P.scrap]);
    outsider = await operatorToken(storeA, Object.values(P), false);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("對調跳號(規格 7.3;做法 D)", () => {
    let bookId: Types.ObjectId;

    /** 這本某幾張的 id 與版本(對調的輸入)。 */
    const pairOf = async (skippedNo: string, unsoldNo: string) => {
      const detail = await bookOf(bookId, managerA);
      const [skipped] = versionsOf(detail.tickets, [skippedNo]);
      const [unsold] = versionsOf(detail.tickets, [unsoldNo]);
      return { bookId: String(bookId), skipped, unsold };
    };

    beforeAll(async () => {
      // 迄號 102、標準 100 → 待標註 2 張;拆本時標了 #037、#064
      bookId = await receiveBook(storeA, 102);
      await apply(storeA, bookId, ["037", "064"], {
        type: TICKET_EVENT_TYPE.skip,
        patch: { status: TICKET_STATUS.skipped },
      });
    });

    it("原因必填;選「其他」要填說明", async () => {
      const input = await pairOf("064", "065");
      expect(
        await errorOf(api, managerA, SWAP, {
          input: { ...input, reasonKey: "" },
        }),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["reasonKey"] });
      expect(
        await errorOf(api, managerA, SWAP, {
          input: { ...input, reasonKey: "other" },
        }),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["reasonNote"] });
    });

    it("沒有 mark-skipped → FORBIDDEN;詳情頁沒有 [對調跳號]", async () => {
      const extensions = await errorOf(api, scrapOnly, SWAP, {
        input: { ...(await pairOf("064", "065")), reasonKey: "mistake" },
      });
      expect(extensions).toMatchObject({ code: "FORBIDDEN" });
      const detail = await bookOf(bookId, scrapOnly);
      expect(detail.abilities.canCorrectSkips).toBe(false);
    });

    it("組合不對(兩張都是跳號 / 未售那張已售)→ TICKET_STATUS_NOT_ALLOWED;版本不對 → CONFLICT", async () => {
      expect(
        await errorOf(api, managerA, SWAP, {
          input: { ...(await pairOf("064", "037")), reasonKey: "mistake" },
        }),
      ).toMatchObject({ reason: "TICKET_STATUS_NOT_ALLOWED" });
      await apply(storeA, bookId, ["070"], {
        type: TICKET_EVENT_TYPE.sale,
        patch: { status: TICKET_STATUS.sold },
      });
      expect(
        await errorOf(api, managerA, SWAP, {
          input: { ...(await pairOf("064", "070")), reasonKey: "mistake" },
        }),
      ).toMatchObject({ reason: "TICKET_STATUS_NOT_ALLOWED" });
      const stale = await pairOf("064", "065");
      expect(
        await errorOf(api, managerA, SWAP, {
          input: {
            ...stale,
            unsold: {
              ...stale.unsold,
              version: (stale.unsold?.version ?? 0) + 5,
            },
            reasonKey: "mistake",
          },
        }),
      ).toMatchObject({ code: "CONFLICT" });
    });

    it("同店 #064 ↔ #065:#064 改回未售、接手 #065 的位置與單張成本;時間軸「取消跳號」+「跳號」,本的跳號清單跟著改", async () => {
      const cashPointId = newObjectId();
      await apply(storeA, bookId, ["065"], {
        type: TICKET_EVENT_TYPE.open,
        patch: {
          location: { kind: TICKET_LOCATION_KIND.counter, cashPointId },
        },
      });
      await ok(api, managerA, SWAP, {
        input: {
          ...(await pairOf("064", "065")),
          reasonKey: "other",
          reasonNote: "拆本時點錯格",
        },
      });
      const detail = await bookOf(bookId, managerA);
      expect(detail.book.skippedTicketNos).toEqual(["037", "065"]);
      expect(detail.events.slice(0, 2)).toEqual(
        expect.arrayContaining([
          {
            type: TICKET_EVENT_TYPE.unskip,
            ticketNos: ["064"],
            reasonKey: "other",
            reasonNote: "拆本時點錯格",
            correctionOfShift: null,
          },
          {
            type: TICKET_EVENT_TYPE.skip,
            ticketNos: ["065"],
            reasonKey: "other",
            reasonNote: "拆本時點錯格",
            correctionOfShift: null,
          },
        ]),
      );
      const back = await ticketOf(bookId, "064");
      expect(back).toMatchObject({
        status: TICKET_STATUS.unsold,
        location: { kind: TICKET_LOCATION_KIND.counter, cashPointId },
        unitCost: 184,
      });
      expect(String(back?.orgId)).toBe(String(storeA));
      const swapped = await ticketOf(bookId, "065");
      expect(swapped?.status).toBe(TICKET_STATUS.skipped);
    });
  });

  describe("尋回(規格 7.4)", () => {
    it("待查 → 回到刷到那家店的庫存、清掉責任分店", async () => {
      const bookId = await receiveBook(storeA);
      await apply(storeA, bookId, ["071"], {
        type: TICKET_EVENT_TYPE.investigate,
        patch: {
          status: TICKET_STATUS.investigating,
          responsibleOrgId: storeA,
        },
      });
      // 新竹店刷到這張(張還在中山店、新竹店看不到這本)
      const lookup = await ok<{
        lotteryTicketLookup: {
          items: { bookId: string; ticketNo: string; status: string }[];
        };
      }>(api, hq, LOOKUP, {
        input: {
          gameCode: "5164",
          bookNo: String(bookSequence),
          ticketNo: "071",
        },
      });
      expect(lookup.lotteryTicketLookup.items).toEqual([
        { bookId: String(bookId), ticketNo: "071", status: "investigating" },
      ]);
      const ticket = await ticketOf(bookId, "071");
      await ok(api, managerB, RECOVER, {
        input: {
          tickets: [
            { ticketId: String(ticket?._id), version: ticket?.version },
          ],
          orgId: String(storeB),
          reasonKey: "mistake",
        },
      });
      const after = await ticketOf(bookId, "071");
      expect(after).toMatchObject({
        status: TICKET_STATUS.unsold,
        location: { kind: TICKET_LOCATION_KIND.stock },
        responsibleOrgId: null,
      });
      expect(after?.orgId.equals(storeB)).toBe(true);
      // 新竹店持有 1 張 → 讀得到這本(讀取放行)
      const detail = await bookOf(bookId, managerB);
      expect(detail.book.holdings).toEqual(
        expect.arrayContaining([{ org: { name: "新竹店" }, count: 1 }]),
      );
      expect(detail.events[0]).toMatchObject({
        type: TICKET_EVENT_TYPE.recover,
        ticketNos: ["071"],
      });
    });

    it("遺失也能尋回;未售的不能尋回(TICKET_STATUS_NOT_ALLOWED)", async () => {
      const bookId = await receiveBook(storeA);
      await apply(storeA, bookId, ["010"], {
        type: TICKET_EVENT_TYPE.lose,
        patch: { status: TICKET_STATUS.lost, responsibleOrgId: storeA },
      });
      const detail = await bookOf(bookId, managerA);
      const unsold = await errorOf(api, managerA, RECOVER, {
        input: {
          tickets: versionsOf(detail.tickets, ["011"]),
          orgId: String(storeA),
          reasonKey: "mistake",
        },
      });
      expect(unsold).toMatchObject({ reason: "TICKET_STATUS_NOT_ALLOWED" });
      await ok(api, managerA, RECOVER, {
        input: {
          tickets: versionsOf(detail.tickets, ["010"]),
          orgId: String(storeA),
          reasonKey: "mistake",
        },
      });
      const after = await ticketOf(bookId, "010");
      expect(after?.status).toBe(TICKET_STATUS.unsold);
    });

    it("回到的要是店:最上層組織(有下層)→ RECOVER_TARGET_NOT_STORE;店的選項只列看得到的店", async () => {
      const bookId = await receiveBook(storeA);
      await apply(storeA, bookId, ["002"], {
        type: TICKET_EVENT_TYPE.investigate,
        patch: {
          status: TICKET_STATUS.investigating,
          responsibleOrgId: storeA,
        },
      });
      const detail = await bookOf(bookId, hq);
      expect(
        await errorOf(api, hq, RECOVER, {
          input: {
            tickets: versionsOf(detail.tickets, ["002"]),
            orgId: String(tenant),
            reasonKey: "mistake",
          },
        }),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "RECOVER_TARGET_NOT_STORE",
        fields: ["orgId"],
      });
      const stores = await ok<{
        lotteryInventoryStores: { items: { name: string }[] };
      }>(api, hq, STORES);
      expect(
        stores.lotteryInventoryStores.items.map((item) => item.name),
      ).not.toContain("租戶甲");
      expect(
        stores.lotteryInventoryStores.items.map((item) => item.name),
      ).toEqual(expect.arrayContaining(["中山店", "新竹店", "台中店"]));
      const own = await ok<{
        lotteryInventoryStores: { items: { name: string }[] };
      }>(api, managerA, STORES);
      expect(own.lotteryInventoryStores.items).toEqual([{ name: "中山店" }]);
      await ok(api, hq, RECOVER, {
        input: {
          tickets: versionsOf(detail.tickets, ["002"]),
          orgId: String(storeB),
          reasonKey: "mistake",
        },
      });
    });

    it("刷到實體:目前組織是店 → 只能回到它;同時屬於兩家店的店長尋回到另一家 → RECOVER_TARGET_NOT_OPERATING_STORE", async () => {
      const bookId = await receiveBook(storeA);
      await apply(storeA, bookId, ["003"], {
        type: TICKET_EVENT_TYPE.investigate,
        patch: {
          status: TICKET_STATUS.investigating,
          responsibleOrgId: storeA,
        },
      });
      // 中山店 + 新竹店的店長,目前組織 = 中山店(第一個所屬組織)
      const twoStores = await operatorToken(
        [storeA, storeB],
        [P.recover, P.scrap, P.markSkipped],
      );
      const detail = await bookOf(bookId, hq);
      expect(
        await errorOf(api, twoStores, RECOVER, {
          input: {
            tickets: versionsOf(detail.tickets, ["003"]),
            orgId: String(storeB),
            reasonKey: "mistake",
          },
        }),
      ).toMatchObject({
        code: "FORBIDDEN",
        reason: "RECOVER_TARGET_NOT_OPERATING_STORE",
      });
      const before = await ticketOf(bookId, "003");
      expect(before?.status).toBe(TICKET_STATUS.investigating);
      await ok(api, twoStores, RECOVER, {
        input: {
          tickets: versionsOf(detail.tickets, ["003"]),
          orgId: String(storeA),
          reasonKey: "mistake",
        },
      });
    });

    it("總部(上層組織)在看板操作某家店:有店面權限 store.view 才能尋回到那家店", async () => {
      const bookId = await receiveBook(storeA);
      await apply(storeA, bookId, ["004"], {
        type: TICKET_EVENT_TYPE.investigate,
        patch: {
          status: TICKET_STATUS.investigating,
          responsibleOrgId: storeA,
        },
      });
      const noStore = await operatorToken(tenant, Object.values(P));
      const detail = await bookOf(bookId, hq);
      expect(
        await errorOf(api, noStore, RECOVER, {
          input: {
            tickets: versionsOf(detail.tickets, ["004"]),
            orgId: String(storeB),
            reasonKey: "mistake",
          },
        }),
      ).toMatchObject({
        code: "FORBIDDEN",
        reason: "RECOVER_TARGET_NOT_OPERATING_STORE",
      });
      await ok(api, hq, RECOVER, {
        input: {
          tickets: versionsOf(detail.tickets, ["004"]),
          orgId: String(storeB),
          reasonKey: "mistake",
        },
      });
      const after = await ticketOf(bookId, "004");
      expect(after?.orgId.equals(storeB)).toBe(true);
    });

    it("回到的分店要在自己的可見範圍內", async () => {
      const bookId = await receiveBook(storeA);
      await apply(storeA, bookId, ["001"], {
        type: TICKET_EVENT_TYPE.investigate,
        patch: {
          status: TICKET_STATUS.investigating,
          responsibleOrgId: storeA,
        },
      });
      const detail = await bookOf(bookId, managerA);
      const extensions = await errorOf(api, managerA, RECOVER, {
        input: {
          tickets: versionsOf(detail.tickets, ["001"]),
          orgId: String(storeB),
          reasonKey: "mistake",
        },
      });
      expect(extensions).toMatchObject({ code: "NOT_FOUND" });
    });

    it("整本待查 → 狀態列;待查·遺失分頁列出(責任分店、批購成本)", async () => {
      const bookId = await receiveBook(storeA);
      const rows = await ticketsOf(bookId);
      const all = rows.map((ticket) => ticket.ticketNo);
      await apply(storeA, bookId, all, {
        type: TICKET_EVENT_TYPE.investigate,
        patch: {
          status: TICKET_STATUS.investigating,
          responsibleOrgId: storeA,
        },
      });
      const detail = await bookOf(bookId, managerA);
      expect(detail.investigation).toEqual({ status: "investigating" });
      const list = await ok<{
        lotteryInvestigations: {
          items: {
            bookId: string;
            status: string;
            cost: number | null;
            responsibleOrg: { name: string } | null;
            tickets: { ticketNo: string }[];
          }[];
          canRecover: boolean;
        };
      }>(api, managerA, INVESTIGATIONS);
      const row = list.lotteryInvestigations.items.find(
        (item) => item.bookId === String(bookId),
      );
      expect(row).toMatchObject({
        status: "investigating",
        cost: 18_400,
        responsibleOrg: { name: "中山店" },
      });
      expect(row?.tickets).toHaveLength(100);
      expect(list.lotteryInvestigations.canRecover).toBe(true);
    });

    it("待標註的跳號(使用者 10/27 定案甲):迄號 101 的未拆本 → 持有 / 總張數 100;整本待查 → 待查·遺失 100 張 · 18,400", async () => {
      const bookId = await receiveBook(storeA, 101);
      const detail = await bookOf(bookId, managerA);
      expect(detail.book.holdings).toEqual([
        { org: { name: "中山店" }, count: 100 },
      ]);
      const books = await ok<{
        lotteryInventoryBooks: {
          items: {
            id: string;
            remainingCount: number;
            totalCount: number;
            pendingSkipCount: number;
          }[];
        };
      }>(api, managerA, BOOKS, { input: { orgId: String(storeA) } });
      expect(
        books.lotteryInventoryBooks.items.find(
          (item) => item.id === String(bookId),
        ),
      ).toMatchObject({
        remainingCount: 100,
        totalCount: 100,
        pendingSkipCount: 1,
      });
      const rows = await ticketsOf(bookId);
      await apply(
        storeA,
        bookId,
        rows.map((ticket) => ticket.ticketNo),
        {
          type: TICKET_EVENT_TYPE.investigate,
          patch: {
            status: TICKET_STATUS.investigating,
            responsibleOrgId: storeA,
          },
        },
      );
      const list = await ok<{
        lotteryInvestigations: {
          items: {
            bookId: string;
            cost: number | null;
            ticketCount: number;
            tickets: { ticketNo: string }[];
          }[];
        };
      }>(api, managerA, INVESTIGATIONS);
      const row = list.lotteryInvestigations.items.find(
        (item) => item.bookId === String(bookId),
      );
      // 101 張紀錄照列,張數與成本扣掉待標註那張
      expect(row?.tickets).toHaveLength(101);
      expect(row).toMatchObject({ ticketCount: 100, cost: 18_400 });
    });
  });

  describe("報廢(規格 7.4)", () => {
    it("只能報未售;損失 = 單張成本加總(批購成本);張保留單張成本給報表", async () => {
      const bookId = await receiveBook(storeA);
      await apply(storeA, bookId, ["001"], {
        type: TICKET_EVENT_TYPE.sale,
        patch: { status: TICKET_STATUS.sold },
      });
      const detail = await bookOf(bookId, managerA);
      const sold = await errorOf(api, managerA, SCRAP, {
        input: {
          tickets: versionsOf(detail.tickets, ["001", "090"]),
          reasonKey: "mistake",
        },
      });
      expect(sold).toMatchObject({ reason: "TICKET_STATUS_NOT_ALLOWED" });
      const result = await ok<{
        scrapLotteryTickets: { count: number; lossCost: number | null };
      }>(api, managerA, SCRAP, {
        input: {
          tickets: versionsOf(detail.tickets, ["090", "091", "092"]),
          reasonKey: "mistake",
        },
      });
      expect(result.scrapLotteryTickets).toEqual({ count: 3, lossCost: 552 });
      const rows = await ticketsOf(bookId);
      const scrapped = rows.filter(
        (ticket) => ticket.status === TICKET_STATUS.scrapped,
      );
      expect(scrapped.map((ticket) => ticket.ticketNo)).toEqual([
        "090",
        "091",
        "092",
      ]);
      // 報表(P29)的報廢損失 = 報廢的張的單張成本加總
      expect(
        Math.round(scrapped.reduce((sum, ticket) => sum + ticket.unitCost, 0)),
      ).toBe(552);
      const events = await api.connection
        .collection("lottery_ticket_events")
        .countDocuments({ bookId, type: TICKET_EVENT_TYPE.scrap });
      expect(events).toBe(3);
      // 每筆報廢事件存當下的成本快照(報表的報廢損失讀這個欄位)
      const snapshots = await api.connection
        .collection<{ cost: number | null }>("lottery_ticket_events")
        .find({ bookId, type: TICKET_EVENT_TYPE.scrap })
        .toArray();
      expect(snapshots.map((event) => event.cost)).toEqual([184, 184, 184]);
    });

    it("沒有 show-cost:損失與成本不回;沒有 recover 看不到 [尋回]", async () => {
      const bookId = await receiveBook(storeA);
      const detail = await bookOf(bookId, scrapOnly);
      expect(detail.cost).toBeNull();
      expect(detail.abilities).toEqual({
        canCorrectSkips: false,
        canRecover: false,
        canScrap: true,
        canShowCost: false,
      });
      const result = await ok<{
        scrapLotteryTickets: { lossCost: number | null };
      }>(api, scrapOnly, SCRAP, {
        input: {
          tickets: versionsOf(detail.tickets, ["001"]),
          reasonKey: "mistake",
        },
      });
      expect(result.scrapLotteryTickets.lossCost).toBeNull();
      const withCost = await bookOf(bookId, managerA);
      expect(withCost.cost).toEqual({ cost: 18_400 });
    });
  });

  describe("別店的張只能看(規格 7.5;能操作 = 張的所在分店在可見範圍內)", () => {
    it("每張帶 operable:收貨店只能操作自己店的張;總部(上層組織)每張都能操作", async () => {
      const bookId = await splitBook();
      const receiver = await bookOf(bookId, managerB);
      expect(operableOf(receiver.tickets, "001")).toBe(true);
      expect(operableOf(receiver.tickets, "050")).toBe(false);
      const shipper = await bookOf(bookId, managerA);
      expect(operableOf(shipper.tickets, "001")).toBe(false);
      expect(operableOf(shipper.tickets, "050")).toBe(true);
      const head = await bookOf(bookId, hq);
      expect(head.tickets.every((ticket) => ticket.operable)).toBe(true);
    });

    it("詳情頁尋回(不給 orgId):收貨店尋回出貨店的待查張 → CROSS_STORE_NOT_ALLOWED;自己店的留在自己店", async () => {
      const bookId = await splitBook();
      const detail = await bookOf(bookId, managerB);
      expect(
        await errorOf(api, managerB, RECOVER, {
          input: {
            tickets: versionsOf(detail.tickets, ["050"]),
            reasonKey: "mistake",
          },
        }),
      ).toMatchObject({
        code: "FORBIDDEN",
        reason: "CROSS_STORE_NOT_ALLOWED",
        ticketIds: idsOf(detail.tickets, ["050"]),
      });
      const current050 = await ticketOf(bookId, "050");
      expect(current050?.status).toBe(TICKET_STATUS.investigating);
      // 混了別店的張 → 整批擋下,自己店的也不動
      expect(
        await errorOf(api, managerB, RECOVER, {
          input: {
            tickets: versionsOf(detail.tickets, ["005", "050"]),
            reasonKey: "mistake",
          },
        }),
      ).toMatchObject({ reason: "CROSS_STORE_NOT_ALLOWED" });
      const current005 = await ticketOf(bookId, "005");
      expect(current005?.status).toBe(TICKET_STATUS.investigating);
      await ok(api, managerB, RECOVER, {
        input: {
          tickets: versionsOf(detail.tickets, ["005"]),
          reasonKey: "mistake",
        },
      });
      const own = await ticketOf(bookId, "005");
      expect(own).toMatchObject({
        status: TICKET_STATUS.unsold,
        location: { kind: TICKET_LOCATION_KIND.stock },
        responsibleOrgId: null,
      });
      expect(own?.orgId.equals(storeB)).toBe(true);
    });

    it("總部從詳情頁替中山店尋回 → 張留在中山店(不換店);一次選兩家店的張各回各店", async () => {
      const bookId = await splitBook();
      const detail = await bookOf(bookId, hq);
      await ok(api, hq, RECOVER, {
        input: {
          tickets: versionsOf(detail.tickets, ["005", "050"]),
          reasonKey: "mistake",
        },
      });
      const [ticket050, ticket005] = await Promise.all([
        ticketOf(bookId, "050"),
        ticketOf(bookId, "005"),
      ]);
      expect(ticket050?.status).toBe(TICKET_STATUS.unsold);
      expect(ticket050?.orgId.equals(storeA)).toBe(true);
      expect(ticket005?.status).toBe(TICKET_STATUS.unsold);
      expect(ticket005?.orgId.equals(storeB)).toBe(true);
      const after = await bookOf(bookId, hq);
      expect(after.book.holdings).toEqual(
        expect.arrayContaining([
          { org: { name: "中山店" }, count: 90 },
          { org: { name: "新竹店" }, count: 10 },
        ]),
      );
    });

    it("店面刷到別店的待查張(給 orgId)仍可尋回到刷到的那家店", async () => {
      const bookId = await splitBook();
      const detail = await bookOf(bookId, managerB);
      await ok(api, managerB, RECOVER, {
        input: {
          tickets: versionsOf(detail.tickets, ["050"]),
          orgId: String(storeB),
          reasonKey: "mistake",
        },
      });
      const current050 = await ticketOf(bookId, "050");
      expect(current050?.orgId.equals(storeB)).toBe(true);
    });

    it("報廢別店的張 → CROSS_STORE_NOT_ALLOWED(不是已被處理);總部可以報廢、事件記在張的分店", async () => {
      const bookId = await splitBook();
      const detail = await bookOf(bookId, managerB);
      expect(
        await errorOf(api, managerB, SCRAP, {
          input: {
            tickets: versionsOf(detail.tickets, ["001", "060"]),
            reasonKey: "mistake",
          },
        }),
      ).toMatchObject({
        code: "FORBIDDEN",
        reason: "CROSS_STORE_NOT_ALLOWED",
        ticketIds: idsOf(detail.tickets, ["060"]),
      });
      const current001 = await ticketOf(bookId, "001");
      expect(current001?.status).toBe(TICKET_STATUS.unsold);
      await ok(api, hq, SCRAP, {
        input: {
          tickets: versionsOf(detail.tickets, ["001", "060"]),
          reasonKey: "mistake",
        },
      });
      const events = await api.connection
        .collection<{ orgId: Types.ObjectId; ticketId: Types.ObjectId }>(
          "lottery_ticket_events",
        )
        .find({ bookId, type: TICKET_EVENT_TYPE.scrap })
        .toArray();
      const orgOfEvent = (no: string) => {
        const [id] = idsOf(detail.tickets, [no]);
        return events.find((event) => String(event.ticketId) === id)?.orgId;
      };
      expect(orgOfEvent("001")?.equals(storeB)).toBe(true);
      expect(orgOfEvent("060")?.equals(storeA)).toBe(true);
    });

    it("不存在的張仍是已被處理(CONFLICT)", async () => {
      expect(
        await errorOf(api, managerB, SCRAP, {
          input: {
            tickets: [{ ticketId: String(newObjectId()), version: 1 }],
            reasonKey: "mistake",
          },
        }),
      ).toMatchObject({ code: "CONFLICT", reason: "TICKET_ALREADY_PROCESSED" });
    });

    it("對調跳號:跳號記在別店也可以選;改回未售的張歸到做對調的那家店(接手配對那張的分店、位置、單張成本,留換店稽核);未售那張要是自己店的", async () => {
      // 迄號 102、標準 100 → 中山店拆本時標了 #037、#064;#001–010 在新竹店(調入,單張成本照調入)
      const bookId = await splitBook(102);
      await apply(storeA, bookId, ["037", "064"], {
        type: TICKET_EVENT_TYPE.skip,
        patch: { status: TICKET_STATUS.skipped },
      });
      const receiver = await bookOf(bookId, managerB);
      expect(receiver.abilities.canCorrectSkips).toBe(true);
      const pair = (skippedNo: string, unsoldNo: string) => {
        const [skipped] = versionsOf(receiver.tickets, [skippedNo]);
        const [unsold] = versionsOf(receiver.tickets, [unsoldNo]);
        return {
          bookId: String(bookId),
          skipped,
          unsold,
          reasonKey: "mistake",
        };
      };
      // 未售那張在中山店(別店)→ 擋
      expect(
        await errorOf(api, managerB, SWAP, { input: pair("037", "070") }),
      ).toMatchObject({
        code: "FORBIDDEN",
        reason: "CROSS_STORE_NOT_ALLOWED",
      });
      const before002 = await ticketOf(bookId, "002");
      await ok(api, managerB, SWAP, { input: pair("037", "002") });
      const back = await ticketOf(bookId, "037");
      expect(back).toMatchObject({
        status: TICKET_STATUS.unsold,
        location: { kind: TICKET_LOCATION_KIND.stock },
        unitCost: before002?.unitCost,
      });
      expect(String(back?.orgId)).toBe(String(storeB));
      const swapped = await ticketOf(bookId, "002");
      expect(swapped?.status).toBe(TICKET_STATUS.skipped);
      // 換店稽核
      const audits = await api.connection
        .collection<{ after: { ids: string[] } }>("audit_logs")
        .find({ action: "data.reassign-org", targetType: "lottery_tickets" })
        .toArray();
      expect(
        audits.some((audit) => audit.after.ids.includes(String(back?._id))),
      ).toBe(true);
    });
  });

  describe("讀取放行(規格 7.1)", () => {
    it("B 店持有 A 店某本的 1 張 → B 店讀得到那本詳情;C 店讀不到", async () => {
      const bookId = await receiveBook(storeA);
      const [moving] = await ticketsOf(bookId);
      if (!moving) {
        throw new Error("沒有張");
      }
      await transactions().withTransaction((session) =>
        ledger().applyTicketEvents(
          session,
          { operator: storeOperator(storeB), crossStoreTenantId: tenant },
          [
            {
              ticketId: moving._id,
              expectedVersion: moving.version,
              type: TICKET_EVENT_TYPE.transferIn,
              patch: {
                orgId: storeB,
                location: {
                  kind: TICKET_LOCATION_KIND.stock,
                  cashPointId: null,
                },
              },
            },
          ],
        ),
      );
      const detail = await bookOf(bookId, managerB);
      expect(detail.book.id).toBe(String(bookId));
      expect(detail.tickets).toHaveLength(100);
      expect(
        await errorOf(api, managerC, BOOK, { id: String(bookId) }),
      ).toMatchObject({ code: "NOT_FOUND" });
      // 庫存分頁:新竹店篩得到這本
      const books = await ok<{
        lotteryInventoryBooks: { items: { id: string }[] };
      }>(api, managerB, BOOKS, { input: { orgId: String(storeB) } });
      expect(
        books.lotteryInventoryBooks.items.map((item) => item.id),
      ).toContain(String(bookId));
    });

    it("沒綁庫存管理 → FORBIDDEN", async () => {
      expect(await errorOf(api, outsider, BOOKS, { input: {} })).toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("預計要給本數(規格 7.6)", () => {
    it("改數字寫 audit_log;矩陣、遊戲詳情、乙類詳情讀同一份", async () => {
      const result = await ok<{
        setLotteryAllocation: {
          item: { plannedBooks: number; givenBooks: number };
        };
      }>(api, hq, SET_ALLOCATION, {
        input: {
          orgId: String(storeC),
          gameId: String(gameId),
          plannedBooks: 8,
          note: "週年慶",
        },
      });
      expect(result.setLotteryAllocation.item.plannedBooks).toBe(8);
      const audits = await api.connection
        .collection("audit_logs")
        .countDocuments({ action: "lottery-allocation.edit" });
      expect(audits).toBe(1);
      const cellOf = (data: AllocationsData) =>
        data.lotteryAllocations.cells.find(
          (cell) =>
            cell.orgId === String(storeC) && cell.gameId === String(gameId),
        );
      for (const input of [
        {},
        { gameId: String(gameId) },
        { orgId: String(storeC) },
      ]) {
        const data = await ok<AllocationsData>(api, hq, ALLOCATIONS, { input });
        expect(cellOf(data)?.plannedBooks).toBe(8);
        expect(data.lotteryAllocations.canEdit).toBe(true);
      }
    });

    it("沒有 edit-allocations:三處都唯讀(canEdit = false),修改 → FORBIDDEN", async () => {
      for (const input of [
        {},
        { gameId: String(gameId) },
        { orgId: String(storeA) },
      ]) {
        const data = await ok<AllocationsData>(api, managerA, ALLOCATIONS, {
          input,
        });
        expect(data.lotteryAllocations.canEdit).toBe(false);
      }
      expect(
        await errorOf(api, managerA, SET_ALLOCATION, {
          input: {
            orgId: String(storeA),
            gameId: String(gameId),
            plannedBooks: 3,
          },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
    });

    it("allocationMatrix 防線:操作者看不到的分店不回", async () => {
      const cells = await api.app
        .get(LotteryAllocationsService)
        .allocationMatrix(storeOperator(storeA), [storeA, storeC], [gameId]);
      expect(cells.map((cell) => cell.orgId)).not.toContain(String(storeC));
    });

    it("已給 = 進貨本數;分店只列看得到的", async () => {
      const data = await ok<AllocationsData>(api, managerA, ALLOCATIONS, {
        input: {},
      });
      expect(data.lotteryAllocations.stores.map((store) => store.name)).toEqual(
        ["中山店"],
      );
      const cell = data.lotteryAllocations.cells.find(
        (item) => item.orgId === String(storeA),
      );
      expect(cell?.givenBooks).toBeGreaterThan(0);
    });
  });

  describe("庫存概況(遊戲詳情 5.1、乙類詳情 5.2)", () => {
    it("未拆(本)/ 檯面(張)/ 已售(張)", async () => {
      const store = storeD;
      const opened = await receiveBook(store);
      await receiveBook(store);
      await apply(store, opened, ["001", "002", "003"], {
        type: TICKET_EVENT_TYPE.open,
        patch: {
          location: { kind: TICKET_LOCATION_KIND.counter, cashPointId: null },
        },
      });
      await apply(store, opened, ["001"], {
        type: TICKET_EVENT_TYPE.sale,
        patch: { status: TICKET_STATUS.sold },
      });
      const data = await ok<{
        lotteryStockOverview: {
          items: {
            org: { name: string };
            unopenedBooks: number;
            counterTickets: number;
            soldTickets: number;
          }[];
        };
      }>(api, hq, STOCK, { input: { orgId: String(store) } });
      expect(data.lotteryStockOverview.items).toEqual([
        {
          org: { name: "高雄店" },
          unopenedBooks: 1,
          counterTickets: 2,
          soldTickets: 1,
        },
      ]);
    });
  });

  it("事件時間軸:撤銷和原售出不在同一班、盤點補登的事後更正 → 標「前期更正,屬於 X 班」(讀取時算出)", async () => {
    const bookId = await receiveBook(storeA);
    const shiftOf = async (label: string) => {
      const { insertedId } = await api.connection
        .collection("lottery_shifts")
        .insertOne({ orgId: storeA, tenantId: tenant, label, deletedAt: null });
      return insertedId;
    };
    const monday = await shiftOf("店內櫃台 · 李小華 10/12 17:00");
    const tuesday = await shiftOf("店內櫃台 · 王小明 10/13 09:00");
    const write = async (
      ticketNo: string,
      event: Omit<TicketEventInput, "ticketId" | "expectedVersion">,
    ) => {
      const ticket = await ticketOf(bookId, ticketNo);
      if (ticket === undefined) {
        throw new Error(`ticket ${ticketNo} not found`);
      }
      await transactions().withTransaction((session) =>
        ledger().applyTicketEvents(
          session,
          { operator: storeOperator(storeA) },
          [{ ticketId: ticket._id, expectedVersion: ticket.version, ...event }],
        ),
      );
    };
    const sold = { status: "sold" as const, sold: null };
    const unsold = { status: "unsold" as const, sold: null };
    // #001 週一售出、週二撤銷(跨班)→ 屬於週一;#002 同一班售出又撤銷 → 不標
    await write("001", {
      type: "sale",
      at: new Date("2026-10-12T10:00:00.000Z"),
      patch: sold,
      amount: 200,
      cashEffect: "increase",
      shiftId: monday,
    });
    await write("001", {
      type: "sale_undo",
      at: new Date("2026-10-13T02:00:00.000Z"),
      patch: unsold,
      amount: 200,
      cashEffect: "decrease",
      shiftId: tuesday,
    });
    await write("002", {
      type: "sale",
      at: new Date("2026-10-13T02:10:00.000Z"),
      patch: sold,
      amount: 200,
      cashEffect: "increase",
      shiftId: tuesday,
    });
    await write("002", {
      type: "sale_undo",
      at: new Date("2026-10-13T02:11:00.000Z"),
      patch: unsold,
      amount: 200,
      cashEffect: "decrease",
      shiftId: tuesday,
    });
    // #003 盤點補登售出,那個收銀點沒有開著的班 → 事後更正指向週一
    await write("003", {
      type: "sale_stocktake",
      at: new Date("2026-10-13T03:00:00.000Z"),
      patch: sold,
      amount: 200,
      cashEffect: "increase",
      shiftId: monday,
      postCloseOf: monday,
    });
    const book = await bookOf(bookId);
    const marked = (type: string, ticketNo: string) =>
      book.events.find(
        (event) => event.type === type && event.ticketNos.includes(ticketNo),
      )?.correctionOfShift;
    expect(marked("sale_undo", "001")).toBe("店內櫃台 · 李小華 10/12 17:00");
    expect(marked("sale_undo", "002")).toBeNull();
    expect(marked("sale", "001")).toBeNull();
    expect(marked("sale_stocktake", "003")).toBe(
      "店內櫃台 · 李小華 10/12 17:00",
    );
  });

  it("庫存分頁:狀態篩選(未拆 / 有待標註)", async () => {
    const pending = await receiveBook(storeC, 103);
    const data = await ok<{
      lotteryInventoryBooks: {
        items: { id: string; state: string; pendingSkipCount: number }[];
      };
    }>(api, managerC, BOOKS, { input: { state: "pending_skip" } });
    expect(data.lotteryInventoryBooks.items).toEqual([
      {
        id: String(pending),
        state: "unopened",
        pendingSkipCount: 3,
        remainingCount: 100,
        // 待標註的跳號不算總張數(使用者 10/27 定案甲)
        totalCount: 100,
      },
    ]);
  });
});
