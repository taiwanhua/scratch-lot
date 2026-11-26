import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import {
  WHOLESALE_FIELD_KEYS,
  WHOLESALE_FORM_KEY,
  WHOLESALE_MODULE_KEY,
  WHOLESALE_SETTLEMENT_SIDE,
} from "@repo/domain/project/lottery";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import {
  type Person,
  WORKFLOW_TEST_TIMEOUT_MS,
  person,
} from "../../../workflows/test-support/workflow-fixtures";
import { LOTTERY_BANK_ACCOUNTS_COLLECTION } from "../../database/lottery-accounts/lottery-bank-account.schema";
import { LOTTERY_BANK_TRANSACTIONS_COLLECTION } from "../../database/lottery-accounts/lottery-bank-transaction.schema";
import { LOTTERY_CASH_MOVEMENTS_COLLECTION } from "../../database/lottery-accounts/lottery-cash-movement.schema";
import { LOTTERY_SETTLEMENT_MARKS_COLLECTION } from "../../database/lottery-accounts/lottery-settlement-mark.schema";
import { LOTTERY_BOOKS_COLLECTION } from "../../database/lottery-inventory/lottery-book.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import { insertGame } from "../purchase/test-support/purchase-fixtures";
import { LotteryBooksService } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import {
  WholesaleLedger,
  type WholesaleLedgerLine,
  wholesaleLockOf,
} from "../tickets/wholesale-ledger.service";
import {
  insertWholesaleCustomer,
  seedWholesaleAuthorization,
} from "../wholesale/test-support/wholesale-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const OPERATIONS = /* GraphQL */ `
  query Operations($input: LotteryOperationsReportInput!) {
    lotteryOperationsReport(input: $input) {
      stores {
        orgId
        sales {
          net {
            count
            amount
          }
        }
        inventory {
          openingTickets
          purchaseTickets
          salesTickets
          wholesaleTickets
          wholesaleCost
          pendingAdjustTickets
          endingTickets
          endingCost
          checkTickets
          checkCost
        }
        wholesale {
          customers {
            customerName
            documents
            books
            tickets
            amount
            cost
          }
          documents {
            serialNo
            voided
            at
            customerName
            books
            tickets
            amount
            cost
            paymentMode
            receivedAtEnd
            toReceiveAtEnd
          }
          receivedUnshipped {
            count
            amount
            serialNos
          }
          pendingAtEnd {
            count
            books
            tickets
            amount
            serialNos
          }
        }
        cash {
          movements {
            type
            count
            drawer
            vault
          }
        }
        bankAccounts {
          types {
            type
            inAmount
            outAmount
          }
        }
        outstanding {
          items {
            kind
            count
            amount
            serialNos
          }
        }
      }
    }
  }
`;

interface Store {
  orgId: string;
  sales: { net: { count: number; amount: number } };
  inventory: Record<string, number | null>;
  wholesale: {
    customers: Record<string, unknown>[];
    documents: Record<string, unknown>[];
    receivedUnshipped: Record<string, unknown>;
    pendingAtEnd: Record<string, unknown>;
  };
  cash: {
    movements: { type: string; count: number; drawer: number; vault: number }[];
  };
  bankAccounts: {
    types: { type: string; inAmount: number; outAmount: number }[];
  }[];
  outstanding: {
    items: {
      kind: string;
      count: number;
      amount: number;
      serialNos: string[];
    }[];
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

/**
 * 台北時間。驗算情境寫的是 11/25、12/3 等日子;這裡放在 2025 年,所有時間都是過去、而且都明寫(不依賴「現在」,TEST-13)。
 */
const taipei = (date: string, time = "00:00") =>
  new Date(`2025-${date}T${time}+08:00`);

const monthOf = (month: "11" | "12") => ({
  periodKind: "month",
  from: taipei(`${month}-01`).toISOString(),
  to: (month === "11"
    ? taipei("12-01")
    : new Date("2026-01-01T00:00+08:00")
  ).toISOString(),
});

const dayOf = (date: string) => ({
  periodKind: "day",
  from: taipei(date).toISOString(),
  to: new Date(taipei(date).getTime() + 86_400_000).toISOString(),
});

/** 一列的批售金額(整本 20,000 × 批購金額率)。 */
const lineAmount = (rate: number) => (20_000 * rate) / 100;

const movementOf = (store: Store, type: string) =>
  store.cash.movements.find((row) => row.type === type);
const bankTypeOf = (store: Store, type: string) =>
  store.bankAccounts
    .flatMap((account) => account.types)
    .find((row) => row.type === type);
const outstandingOf = (store: Store, kind: string) =>
  store.outstanding.items.find((item) => item.kind === kind);

/** 一本書在批售單上的一列。 */
interface Line {
  bookId: Types.ObjectId;
  rate: number;
}

/**
 * 營運報表的批售(專案規格 21.7;21.9 驗算 #8、#17、#18、#24、#25)。真帳本(進貨點收、鎖定、出貨、取消批售)+
 * 直接寫入的批售單、流程實例與收付(形狀同正式資料);每個情境核對 0、重跑舊報表數字不變。
 *
 * 共同前提:遊戲 5164,單張 200、每本 100 張、整本 20,000;本 A 照 92 進貨(18,400)、本 B 照 90(18,000);
 * 批售兩本都改 93 → 每本 18,600,批售金額 37,200、原成本 36,400、獲利 800。
 */
describe("營運報表:批售(驗算 #8、#17、#18、#24、#25)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let tenant: Types.ObjectId;
  let zhongshan: Types.ObjectId;
  let hsinchu: Types.ObjectId;
  let taichung: Types.ObjectId;
  let chiayi: Types.ObjectId;
  let game: Types.ObjectId;
  let customer: Types.ObjectId;
  let accountId: Types.ObjectId;
  let hq: Person;
  let noCost: Person;
  let bookSequence = 0;

  const transactions = () => api.app.get(TransactionService);

  const storeOperator = (orgId: Types.ObjectId): OperatorContext => ({
    actorId: hq.userId,
    currentOrgId: orgId,
    visibleOrgIds: [orgId],
    managedOrgIds: [],
    memberOrgIds: [orgId],
    roleIds: [],
    memberTenants: [
      { tenantId: tenant, memberOrgIds: [orgId], ancestorOrgIds: [tenant] },
    ],
  });

  const insert = async (
    collection: string,
    doc: Record<string, unknown>,
  ): Promise<Types.ObjectId> => {
    const { insertedId } = await connection
      .collection(collection)
      .insertOne({ tenantId: tenant, ...doc, ...base() });
    return insertedId;
  };

  async function report(
    input: Record<string, unknown>,
    who: Person = hq,
  ): Promise<Store> {
    const result: GraphqlResult = await api.graphql(
      OPERATIONS,
      { input },
      { accessToken: who.token },
    );
    expect(result.errors).toBeUndefined();
    const [store] = (
      result.data as { lotteryOperationsReport: { stores: Store[] } }
    ).lotteryOperationsReport.stores;
    if (store === undefined) {
      throw new Error("no store in report");
    }
    return store;
  }

  const storeOf = (
    orgId: Types.ObjectId,
    period: Record<string, unknown>,
    who?: Person,
  ) => report({ ...period, orgIds: [String(orgId)] }, who);

  /** 進貨點收一本(真的 `createBook`)。 */
  async function purchase(
    orgId: Types.ObjectId,
    cost: number,
    at: Date,
    lastTicketNo = 100,
  ): Promise<Types.ObjectId> {
    bookSequence += 1;
    const { book } = await transactions().withTransaction((session) =>
      api.app
        .get(LotteryBooksService)
        .createBook(session, storeOperator(orgId), {
          orgId,
          gameId: game,
          bookNo: String(700_000 + bookSequence),
          lastTicketNo,
          rate: 92,
          cost,
          at,
        }),
    );
    return book._id;
  }

  const ticketIdsOf = async (bookIds: readonly Types.ObjectId[]) => {
    const tickets = await connection
      .collection(LOTTERY_TICKETS_COLLECTION)
      .find({ bookId: { $in: [...bookIds] } }, { projection: { _id: 1 } })
      .toArray();
    return tickets.map((ticket) => ticket._id);
  };

  /** 批售單的值(形狀同受管表單 `wholesale.r1`)。 */
  const valuesOf = (
    orgId: Types.ObjectId,
    mode: string,
    lines: readonly Line[],
  ) => ({
    [WHOLESALE_FIELD_KEYS.fromBranch]: { id: String(orgId), label: "分店" },
    [WHOLESALE_FIELD_KEYS.customer]: {
      id: String(customer),
      label: "好運彩券行 · 0912-000-111",
    },
    [WHOLESALE_FIELD_KEYS.paymentMode]: mode,
    [WHOLESALE_FIELD_KEYS.account]:
      mode === "auto_bank" ? { id: String(accountId), label: "台銀" } : null,
    [WHOLESALE_FIELD_KEYS.lines]: lines.map((line) => ({
      rowId: String(line.bookId),
      [WHOLESALE_FIELD_KEYS.game]: { id: String(game), label: "5164" },
      [WHOLESALE_FIELD_KEYS.book]: { id: String(line.bookId), label: "本" },
      [WHOLESALE_FIELD_KEYS.tickets]: 100,
      [WHOLESALE_FIELD_KEYS.bookPrice]: 20_000,
      [WHOLESALE_FIELD_KEYS.rate]: line.rate,
      [WHOLESALE_FIELD_KEYS.amount]: lineAmount(line.rate),
    })),
    [WHOLESALE_FIELD_KEYS.wholesaleTotal]: lines.reduce(
      (sum, line) => sum + lineAmount(line.rate),
      0,
    ),
  });

  /**
   * 一張批售單:送出(修訂時間 = 各次送出)、流程實例(各段的歷程)、鎖住明細的本;`status` 是現在的狀態。
   * 已完成的單照正式資料建結清標記(待確認)。
   */
  async function wholesaleDocument(input: {
    orgId: Types.ObjectId;
    serialNo: string;
    mode: "auto_bank" | "collect_first";
    lines: readonly Line[];
    status: string;
    submits: readonly Date[];
    /** 每次送出的流程實例歷程(started 之後的結束事件;沒有 = 還在審核) */
    ends: readonly ({ kind: string; at: Date } | null)[];
  }): Promise<Types.ObjectId> {
    const submissionId = new Types.ObjectId();
    const values = valuesOf(input.orgId, input.mode, input.lines);
    let currentInstanceId: Types.ObjectId | null = null;
    for (const [index, at] of input.submits.entries()) {
      const end = input.ends[index] ?? null;
      currentInstanceId = await insert("workflow_instances", {
        orgId: tenant,
        submissionId,
        revision: index + 1,
        formKey: WHOLESALE_FORM_KEY,
        status: end === null ? "running" : end.kind,
        history: [{ at, kind: "started" }, ...(end === null ? [] : [end])],
        finishedAt: end?.at ?? null,
        moduleKey: WHOLESALE_MODULE_KEY,
      });
    }
    await connection.collection("form_submissions").insertOne({
      _id: submissionId,
      orgId: tenant,
      tenantId: tenant,
      moduleKey: WHOLESALE_MODULE_KEY,
      formKey: WHOLESALE_FORM_KEY,
      version: 1,
      values,
      summary: null,
      status: input.status,
      revision: input.submits.length,
      revisions: input.submits.map((at, index) => ({
        revision: index + 1,
        values,
        ctx: { at, timezone: "Asia/Taipei", userId: null, orgId: null },
      })),
      editVersion: 1,
      touched: [],
      clientRequestId: String(submissionId),
      serialNo: input.serialNo,
      submittedAt: input.submits[0] ?? null,
      currentInstanceId,
      blocked: false,
      voidedAt: null,
      ...base(),
    });
    await transactions().withTransaction((session) =>
      ticketIdsOf(input.lines.map((line) => line.bookId)).then((ids) =>
        api.app
          .get(TicketLedgerService)
          .lockTicketsInTenant(
            session,
            tenant,
            ids,
            wholesaleLockOf(submissionId),
          ),
      ),
    );
    if (input.status === "completed") {
      await insert(LOTTERY_SETTLEMENT_MARKS_COLLECTION, {
        orgId: tenant,
        refType: WHOLESALE_MODULE_KEY,
        refId: submissionId,
        closedAsOf: null,
        rev: 0,
        moduleKey: "accounts",
      });
    }
    return submissionId;
  }

  const writeOf = async (submissionId: Types.ObjectId, at: Date) => ({
    reader: await tenantBoundaryContext(
      api.app.get(OrgsRepository),
      null,
      tenant,
    ),
    tenantId: tenant,
    submissionId,
    actorId: hq.userId,
    at,
  });

  /** 出貨(真的帳本:每張寫「批售」、改已批售、解鎖)。 */
  async function ship(
    submissionId: Types.ObjectId,
    lines: readonly Line[],
    at: Date,
  ) {
    const write = await writeOf(submissionId, at);
    await transactions().withTransaction((session) =>
      api.app.get(WholesaleLedger).ship(
        { ...write, session },
        lines.map((line): WholesaleLedgerLine => ({
          bookId: line.bookId,
          amount: lineAmount(line.rate),
          tickets: 100,
        })),
      ),
    );
  }

  /** 收付:銀行(收 / 退)或現金(進 / 出小金庫),掛在批售單出貨店那一邊。 */
  async function pay(input: {
    orgId: Types.ObjectId;
    submissionId: Types.ObjectId;
    method: "bank" | "cash";
    direction: "in" | "out";
    amount: number;
    at: Date;
  }) {
    const ref = {
      refType: WHOLESALE_MODULE_KEY,
      refId: input.submissionId,
      refRevision: 1,
      settlementSide: WHOLESALE_SETTLEMENT_SIDE,
      moduleKey: "accounts",
    };
    if (input.method === "bank") {
      await insert(LOTTERY_BANK_TRANSACTIONS_COLLECTION, {
        orgId: tenant,
        accountId,
        occurredAt: input.at,
        type:
          input.direction === "in" ? "wholesale_income" : "wholesale_expense",
        direction: input.direction,
        amount: input.amount,
        branchOrgId: input.orgId,
        reversalOf: null,
        summary: null,
        handler: null,
        note: null,
        ...ref,
      });
      return;
    }
    await insert(LOTTERY_CASH_MOVEMENTS_COLLECTION, {
      orgId: input.orgId,
      occurredAt: input.at,
      type: input.direction === "in" ? "wholesale_in" : "wholesale_out",
      from: input.direction === "in" ? "external" : "vault",
      to: input.direction === "in" ? "vault" : "external",
      reason: null,
      cashPointId: null,
      shiftId: null,
      attributedShiftId: null,
      postCloseOf: null,
      amount: input.amount,
      payee: null,
      note: null,
      reversalOf: null,
      bankTransactionId: null,
      ...ref,
    });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-reports-wholesale");
    connection = api.connection;
    const reportsModule = await connection
      .collection("modules")
      .findOne({ key: "reports" });
    if (reportsModule === null) {
      throw new Error("base seed did not create the reports module");
    }
    await connection.collection("permissions").insertOne({
      key: "reports.operations",
      moduleId: reportsModule._id,
      name: "reports.operations",
      enabled: true,
      isSystem: false,
      settings: {},
      source: "seed",
      retiredAt: null,
      ...base(),
    });
    await seedWholesaleAuthorization(connection);
    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    zhongshan = await createOrg(connection, {
      name: "中山店",
      parentId: tenant,
    });
    hsinchu = await createOrg(connection, {
      name: "新竹店",
      parentId: tenant,
    });
    taichung = await createOrg(connection, {
      name: "台中店",
      parentId: tenant,
    });
    chiayi = await createOrg(connection, {
      name: "嘉義店",
      parentId: tenant,
    });
    game = await insertGame(connection, tenant, {
      gameCode: "5164",
      name: "發大財",
      unitPrice: 200,
      ticketsPerBook: 100,
    });
    customer = await insertWholesaleCustomer(connection, tenant, {
      storeName: "好運彩券行",
      phone: "0912-000-111",
    });
    accountId = await insert(LOTTERY_BANK_ACCOUNTS_COLLECTION, {
      orgId: tenant,
      bankCode: "004",
      accountNo: "0001234512345",
      accountName: "台灣銀行",
      label: "台銀 ****12345",
      openingBalance: 0,
      openingDate: taipei("10-01"),
      status: "active",
      shareOrgs: [{ orgId: tenant, includeDescendants: true }],
      moduleKey: "accounts",
    });
    hq = await person(api, connection, tenant, tenant, {
      moduleKeys: ["reports"],
      permissionKeys: ["reports.operations", "reports.show-cost"],
    });
    noCost = await person(api, connection, tenant, tenant, {
      moduleKeys: ["reports"],
      permissionKeys: ["reports.operations"],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("#8 收到錢再核准的單 11/19 出貨:2b、區塊 4 淨批售核對 0、5b 現金、6 銀行;#18 下個月作廢:當月一列負數、11 月重跑不變", async () => {
    const bookA = await purchase(zhongshan, 18_400, taipei("11-01", "09:00"));
    const bookB = await purchase(zhongshan, 18_000, taipei("11-01", "09:00"));
    const lines = [
      { bookId: bookA, rate: 93 },
      { bookId: bookB, rate: 93 },
    ];
    const submissionId = await wholesaleDocument({
      orgId: zhongshan,
      serialNo: "W-0001",
      mode: "collect_first",
      lines,
      status: "completed",
      submits: [taipei("11-10", "10:00")],
      ends: [{ kind: "completed", at: taipei("11-19", "10:45") }],
    });
    const paid = { orgId: zhongshan, submissionId };
    await pay({
      ...paid,
      method: "cash",
      direction: "in",
      amount: 20_000,
      at: taipei("11-12", "10:00"),
    });
    await pay({
      ...paid,
      method: "bank",
      direction: "in",
      amount: 17_500,
      at: taipei("11-13", "10:00"),
    });
    await pay({
      ...paid,
      method: "bank",
      direction: "out",
      amount: 300,
      at: taipei("11-14", "10:00"),
    });
    await ship(submissionId, lines, taipei("11-19", "10:45"));

    const november = await storeOf(zhongshan, monthOf("11"));
    expect(november.wholesale.customers).toEqual([
      {
        customerName: "好運彩券行",
        documents: 1,
        books: 2,
        tickets: 200,
        amount: 37_200,
        cost: 36_400,
      },
    ]);
    expect(november.wholesale.documents).toEqual([
      {
        serialNo: "W-0001",
        voided: false,
        at: taipei("11-19", "10:45").toISOString(),
        customerName: "好運彩券行",
        books: 2,
        tickets: 200,
        amount: 37_200,
        cost: 36_400,
        paymentMode: "collect_first",
        receivedAtEnd: 37_200,
        toReceiveAtEnd: 0,
      },
    ]);
    expect(november.wholesale.receivedUnshipped).toEqual({
      count: 0,
      amount: 0,
      serialNos: [],
    });
    // 區塊 1 淨銷售不含批售;區塊 4「− 淨批售 200 張 / 36,400」、核對 0
    expect(november.sales.net).toEqual({ count: 0, amount: 0 });
    expect(november.inventory).toMatchObject({
      openingTickets: 0,
      purchaseTickets: 200,
      salesTickets: 0,
      wholesaleTickets: 200,
      wholesaleCost: 36_400,
      endingTickets: 0,
      checkTickets: 0,
      checkCost: 0,
    });
    // 5b 小金庫「批售收入 +20,000」;6 銀行「批售收入 17,500、批售支出 300」;不在待結清
    expect(movementOf(november, "wholesale_in")).toEqual({
      type: "wholesale_in",
      count: 1,
      drawer: 0,
      vault: 20_000,
    });
    expect(bankTypeOf(november, "wholesale_income")).toMatchObject({
      inAmount: 17_500,
      outAmount: 0,
    });
    expect(bankTypeOf(november, "wholesale_expense")).toMatchObject({
      inAmount: 0,
      outAmount: 300,
    });
    expect(outstandingOf(november, "wholesaleToReceive")?.count).toBe(0);
    expect(outstandingOf(november, "wholesaleToRefund")?.count).toBe(0);

    // 沒有 reports.show-cost:原成本是 null,批售金額照常
    const withoutCost = await storeOf(zhongshan, monthOf("11"), noCost);
    expect(withoutCost.wholesale.customers[0]).toMatchObject({
      amount: 37_200,
      cost: null,
    });
    expect(withoutCost.wholesale.documents[0]).toMatchObject({ cost: null });
    expect(withoutCost.inventory.wholesaleCost).toBeNull();

    // #18:12 月先退款到淨額 0 再作廢 → 200 張回中山店庫存未售、單張成本不變
    await pay({
      ...paid,
      method: "cash",
      direction: "out",
      amount: 20_000,
      at: taipei("12-05", "10:00"),
    });
    await pay({
      ...paid,
      method: "bank",
      direction: "out",
      amount: 17_200,
      at: taipei("12-05", "10:05"),
    });
    const voidWrite = await writeOf(submissionId, taipei("12-06", "10:00"));
    await transactions().withTransaction((session) =>
      api.app
        .get(WholesaleLedger)
        .cancel(
          { ...voidWrite, session },
          { reasonKey: "wrong", reasonNote: null },
        ),
    );
    await connection
      .collection("form_submissions")
      .updateOne(
        { _id: submissionId },
        { $set: { status: "voided", voidedAt: taipei("12-06", "10:00") } },
      );
    const tickets = await connection
      .collection(LOTTERY_TICKETS_COLLECTION)
      .find({ bookId: { $in: [bookA, bookB] } })
      .toArray();
    expect(new Set(tickets.map((ticket) => String(ticket.status)))).toEqual(
      new Set(["unsold"]),
    );
    expect(
      tickets.reduce((sum, ticket) => sum + Number(ticket.unitCost), 0),
    ).toBe(36_400);
    // 仍是未拆:本的第一次拆本時間仍是空
    const books = await connection
      .collection(LOTTERY_BOOKS_COLLECTION)
      .find({ _id: { $in: [bookA, bookB] } })
      .toArray();
    expect(
      books.map(
        (book) => (book.firstOpenedAt as Date | null | undefined) ?? null,
      ),
    ).toEqual([null, null]);

    const december = await storeOf(zhongshan, monthOf("12"));
    expect(december.wholesale.documents).toEqual([
      expect.objectContaining({
        serialNo: "W-0001",
        voided: true,
        at: taipei("12-06", "10:00").toISOString(),
        books: -2,
        tickets: -200,
        amount: -37_200,
        cost: -36_400,
        receivedAtEnd: 0,
        toReceiveAtEnd: 0,
      }),
    ]);
    expect(december.wholesale.customers).toEqual([
      expect.objectContaining({
        documents: -1,
        books: -2,
        tickets: -200,
        amount: -37_200,
        cost: -36_400,
      }),
    ]);
    expect(december.inventory).toMatchObject({
      openingTickets: 0,
      wholesaleTickets: -200,
      wholesaleCost: -36_400,
      endingTickets: 200,
      endingCost: 36_400,
      checkTickets: 0,
      checkCost: 0,
    });
    // 當月報表重跑數字不變
    expect(await storeOf(zhongshan, monthOf("11"))).toEqual(november);
  });

  it("#17 迄號 101(待標註 1)的未拆本批售:張數 100、庫存 −100、核對 0,待標註不留在這家店", async () => {
    const bookC = await purchase(
      hsinchu,
      18_400,
      taipei("11-02", "09:00"),
      101,
    );
    const lines = [{ bookId: bookC, rate: 92 }];
    const submissionId = await wholesaleDocument({
      orgId: hsinchu,
      serialNo: "W-0002",
      mode: "auto_bank",
      lines,
      status: "completed",
      submits: [taipei("11-03", "10:00")],
      ends: [{ kind: "completed", at: taipei("11-04", "10:00") }],
    });
    await ship(submissionId, lines, taipei("11-04", "10:00"));
    await pay({
      orgId: hsinchu,
      submissionId,
      method: "bank",
      direction: "in",
      amount: 18_400,
      at: taipei("11-04", "10:00"),
    });

    const november = await storeOf(hsinchu, monthOf("11"));
    expect(november.inventory).toMatchObject({
      purchaseTickets: 100,
      wholesaleTickets: 100,
      wholesaleCost: 18_400,
      pendingAdjustTickets: 0,
      endingTickets: 0,
      checkTickets: 0,
      checkCost: 0,
    });
    expect(november.wholesale.documents).toEqual([
      expect.objectContaining({
        serialNo: "W-0002",
        books: 1,
        tickets: 100,
        amount: 18_400,
        cost: 18_400,
        paymentMode: "auto_bank",
        receivedAtEnd: 18_400,
        toReceiveAtEnd: 0,
      }),
    ]);
    // 出貨那天的日報:期初有這本(100 張)、期末沒有
    const day = await storeOf(hsinchu, dayOf("11-04"));
    expect(day.inventory).toMatchObject({
      openingTickets: 100,
      wholesaleTickets: 100,
      endingTickets: 0,
      checkTickets: 0,
      checkCost: 0,
    });
  });

  it("#24 11/28 收現金 20,000、12/2 收齊並核准:11 月期末已收未出貨 20,000、12 月逐單列這張;11 月重跑不變", async () => {
    const bookE = await purchase(taichung, 18_400, taipei("11-01", "09:00"));
    const bookF = await purchase(taichung, 18_000, taipei("11-01", "09:00"));
    const lines = [
      { bookId: bookE, rate: 93 },
      { bookId: bookF, rate: 93 },
    ];
    const submissionId = await wholesaleDocument({
      orgId: taichung,
      serialNo: "W-0003",
      mode: "collect_first",
      lines,
      status: "completed",
      submits: [taipei("11-20", "10:00")],
      ends: [{ kind: "completed", at: taipei("12-02", "10:00") }],
    });
    const paid = { orgId: taichung, submissionId };
    await pay({
      ...paid,
      method: "cash",
      direction: "in",
      amount: 20_000,
      at: taipei("11-28", "10:00"),
    });
    await pay({
      ...paid,
      method: "bank",
      direction: "in",
      amount: 17_200,
      at: taipei("12-02", "09:00"),
    });
    await ship(submissionId, lines, taipei("12-02", "10:00"));

    const november = await storeOf(taichung, monthOf("11"));
    expect(november.wholesale.documents).toEqual([]);
    expect(november.wholesale.receivedUnshipped).toEqual({
      count: 1,
      amount: 20_000,
      serialNos: ["W-0003"],
    });
    expect(movementOf(november, "wholesale_in")?.vault).toBe(20_000);
    // 本仍在期末庫存、核對 0;期末還在審核中 → 待收 17,200、期末批售中 2 本
    expect(november.inventory).toMatchObject({
      wholesaleTickets: 0,
      endingTickets: 200,
      endingCost: 36_400,
      checkTickets: 0,
      checkCost: 0,
    });
    expect(outstandingOf(november, "wholesaleToReceive")).toEqual({
      kind: "wholesaleToReceive",
      count: 1,
      amount: 17_200,
      serialNos: ["W-0003"],
    });
    expect(november.wholesale.pendingAtEnd).toMatchObject({
      count: 1,
      books: 2,
      tickets: 200,
    });

    const december = await storeOf(taichung, monthOf("12"));
    expect(december.wholesale.documents).toEqual([
      expect.objectContaining({
        serialNo: "W-0003",
        tickets: 200,
        amount: 37_200,
        receivedAtEnd: 37_200,
        toReceiveAtEnd: 0,
      }),
    ]);
    expect(december.wholesale.receivedUnshipped).toEqual({
      count: 0,
      amount: 0,
      serialNos: [],
    });
    expect(december.inventory).toMatchObject({
      openingTickets: 200,
      wholesaleTickets: 200,
      endingTickets: 0,
      checkTickets: 0,
      checkCost: 0,
    });
    expect(await storeOf(taichung, monthOf("11"))).toEqual(november);
  });

  it("#25 11/25 送出、11/27 退回、11/29 重送、12/3 核准:11 月期末批售中 2 本 / 200 張 / 37,200;期末 11/28 是 0;12 月核准後重跑不變", async () => {
    const bookG = await purchase(chiayi, 18_400, taipei("11-01", "09:00"));
    const bookH = await purchase(chiayi, 18_000, taipei("11-01", "09:00"));
    const lines = [
      { bookId: bookG, rate: 93 },
      { bookId: bookH, rate: 93 },
    ];
    const submissionId = await wholesaleDocument({
      orgId: chiayi,
      serialNo: "W-0004",
      mode: "auto_bank",
      lines,
      status: "completed",
      submits: [taipei("11-25", "10:00"), taipei("11-29", "10:00")],
      ends: [
        { kind: "returned", at: taipei("11-27", "10:00") },
        { kind: "completed", at: taipei("12-03", "10:00") },
      ],
    });
    await ship(submissionId, lines, taipei("12-03", "10:00"));
    await pay({
      orgId: chiayi,
      submissionId,
      method: "bank",
      direction: "in",
      amount: 37_200,
      at: taipei("12-03", "10:00"),
    });

    const november = await storeOf(chiayi, monthOf("11"));
    expect(november.wholesale.pendingAtEnd).toEqual({
      count: 1,
      books: 2,
      tickets: 200,
      amount: 37_200,
      serialNos: ["W-0004"],
    });
    expect(november.inventory).toMatchObject({
      endingTickets: 200,
      checkTickets: 0,
      checkCost: 0,
    });
    // 期末 11/28(11/27 的日報):退回已解鎖 → 0;期末 11/26 還在審核 → 1
    const day27 = await storeOf(chiayi, dayOf("11-27"));
    expect(day27.wholesale.pendingAtEnd).toMatchObject({
      count: 0,
      books: 0,
      tickets: 0,
      amount: 0,
    });
    const day25 = await storeOf(chiayi, dayOf("11-25"));
    expect(day25.wholesale.pendingAtEnd).toMatchObject({
      count: 1,
      tickets: 200,
    });
    // 12 月核准、出貨:12 月期末不再批售中;11 月重跑不變
    const december = await storeOf(chiayi, monthOf("12"));
    expect(december.wholesale.pendingAtEnd.count).toBe(0);
    expect(december.inventory).toMatchObject({
      wholesaleTickets: 200,
      checkTickets: 0,
      checkCost: 0,
    });
    expect(await storeOf(chiayi, monthOf("11"))).toEqual(november);
  });
});
