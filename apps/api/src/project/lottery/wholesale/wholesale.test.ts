import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import { bookCountsOf } from "@repo/domain/project/lottery";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import type { OperatorContext } from "../../../database/operator-context";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import {
  ASSIGN,
  CREATE_FORM,
  UPDATE_FORM,
  call,
  createDraft,
  extensionsOf,
  ok,
  publishDefinition,
  rootToken,
} from "../../../forms/test-support/form-fixtures";
import { createRole } from "../../../permission/test-support/fixtures";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import {
  VOID as FORM_VOID,
  type Person,
  SAVE_SUBMISSION,
  SUBMIT_SUBMISSION,
  WITHDRAW,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  audienceRow,
  audienceSource,
  bindForm,
  decideOn,
  pendingTaskOf,
  person,
  publishWorkflow,
  reviewStep,
} from "../../../workflows/test-support/workflow-fixtures";
import { LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION } from "../../database/lottery-dealers/lottery-wholesale-customer.schema";
import { LOTTERY_STORE_COUNT_MODES_COLLECTION } from "../../database/lottery-settings/lottery-store-count-mode.schema";
import { CashLedgerService } from "../cash/cash-ledger.service";
import { seedDealersAuthorization } from "../dealers/test-support/dealers-fixtures";
import {
  insertBankAccount,
  insertGame,
} from "../purchase/test-support/purchase-fixtures";
import { StoreMatching } from "../store/store-matching";
import { LotteryBooksService } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import {
  WHOLESALE_MODULE_KEYS,
  WHOLESALE_PERMISSION_KEYS,
  WHOLESALE_SHARED_BY_FIELD_KEYS,
  insertWholesaleCustomer,
  seedWholesaleAuthorization,
  wholesaleDefinition,
} from "./test-support/wholesale-fixtures";
import { WholesaleRules } from "./wholesale-rules.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const FORM = "wholesale";
const MODULE = "purchasing.wholesale";

const OPTIONS = /* GraphQL */ `
  query TestOptions($from: ID!) {
    lotteryWholesaleOptions(fromOrgId: $from) {
      books {
        bookId
        tickets
        bookPrice
        defaultRate
        cost
      }
      customers {
        label
      }
      accounts {
        id
      }
    }
  }
`;

const SCAN_MATCHES = /* GraphQL */ `
  query TestScanMatches($from: ID!, $bookNo: String!) {
    lotteryWholesaleScanMatches(fromOrgId: $from, bookNo: $bookNo) {
      bookId
      problem
      lockedSerialNo
    }
  }
`;

const LIST = /* GraphQL */ `
  query TestList($input: LotteryWholesalesInput!) {
    lotteryWholesales(input: $input) {
      items {
        id
        serialNo
        fromBranchName
        customerName
        paymentMode
        books
        amount
        received
        settlementKind
        settlementAmount
        inSettlement
        status
        canDelete
      }
      totalCount
    }
  }
`;

const CUSTOMER_DOCUMENTS = /* GraphQL */ `
  query TestCustomerDocuments($id: ID!) {
    lotteryCustomerWholesales(customerId: $id) {
      id
      serialNo
      books
      amount
      received
      status
    }
  }
`;

const DETAIL = /* GraphQL */ `
  query TestDetail($id: ID!) {
    lotteryWholesaleDetail(submissionId: $id) {
      customerName
      paymentMode
      accountLabel
      amount
      received
      shippedAt
      rows {
        bookId
        state
      }
    }
  }
`;

const SETTLEMENT = /* GraphQL */ `
  query TestSettlement($refId: ID!) {
    lotterySettlement(moduleKey: "purchasing.wholesale", refId: $refId) {
      item {
        payable
        counterparty
        sides {
          side
          role
          methods
          net
          canSettle
          buttons {
            button
            defaultAmount
          }
        }
        records {
          id
          method
          type
          amount
          canReverse
        }
      }
    }
  }
`;

const RECORD = /* GraphQL */ `
  mutation TestRecord($input: RecordLotterySettlementInput!) {
    recordLotterySettlement(input: $input) {
      recordId
    }
  }
`;

const REVERSE = /* GraphQL */ `
  mutation TestReverse($input: ReverseLotterySettlementInput!) {
    reverseLotterySettlement(input: $input) {
      recordId
    }
  }
`;

const OUTSTANDING = /* GraphQL */ `
  query TestOutstanding {
    lotteryOutstandingSettlements {
      items {
        refId
        kind
        amount
        counterparty
      }
    }
  }
`;

const DECIDE_MUTATION = /* GraphQL */ `
  mutation TestDecide($input: DecideTaskInput!) {
    decideTask(input: $input) {
      result
    }
  }
`;

const DELETE_SUBMISSION = /* GraphQL */ `
  mutation TestDeleteSubmission($input: DeleteFormSubmissionInput!) {
    deleteFormSubmission(input: $input) {
      success
    }
  }
`;

const DELETE_CUSTOMER = /* GraphQL */ `
  mutation TestDeleteCustomer($input: DeleteLotteryWholesaleCustomerInput!) {
    deleteLotteryWholesaleCustomer(input: $input) {
      success
    }
  }
`;

const CUSTOMERS = /* GraphQL */ `
  query TestCustomers {
    lotteryWholesaleCustomers(input: {}) {
      items {
        id
        lastWholesaleAt
      }
    }
  }
`;

const STORE_SCAN = /* GraphQL */ `
  query TestStoreScan($input: LotteryStoreScanInput!) {
    lotteryStoreScan(input: $input) {
      items {
        outcome
        blockReason
        lockRefType
        lockSerialNo
      }
    }
  }
`;

const STOCKTAKE_SHEET = /* GraphQL */ `
  query TestSheet($input: LotteryStocktakeSheetInput!) {
    lotteryStocktakeSheet(input: $input) {
      books {
        bookId
      }
      unopenedBooks {
        bookId
      }
    }
  }
`;

const BADGES = /* GraphQL */ `
  query TestBadges {
    sidebarBadges {
      moduleKey
      count
    }
  }
`;

const ME_MODULES = /* GraphQL */ `
  query TestMeModules {
    me {
      modules {
        key
      }
    }
  }
`;

interface TicketRow {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  ticketNo: string;
  status: string;
  version: number;
  unitCost: number;
  location: { kind: string };
  lockedBy: { refType: string; refId: Types.ObjectId } | null;
}

interface Settlement {
  payable: number;
  counterparty: string;
  sides: {
    side: string;
    role: string;
    methods: string[];
    net: number;
    canSettle: boolean;
    buttons: { button: string; defaultAmount: number }[];
  }[];
  records: {
    id: string;
    method: string;
    type: string;
    amount: number;
    canReverse: boolean;
  }[];
}

type Line = Record<string, unknown> & { rowId: string };

let bookSequence = 56_600;
let rowSequence = 0;

/**
 * 批售單(規格第 21 章;驗算情境 21.9 #1–#7、#9–#16、#18–#23 與 21.4 掛接點表的每一列)。
 *
 * 組織樹:root ─ 好運彩券行 ─┬─ 中山店
 *                            └─ 新竹店
 * 遊戲 5164:單張 200 元、每本 100 張、整本金額 20,000、預設批購金額率 92。
 */
describe("批售單(規格第 21 章)", () => {
  let api: AuthTestApp;
  let tenant: Types.ObjectId;
  let branch: Types.ObjectId;
  let otherBranch: Types.ObjectId;
  /** 總部(站在最上層組織;全部權限) */
  let hq: Person;
  /** 中山店店長(開單、收錢、核准) */
  let manager: Person;
  /** 新竹店店長 */
  let otherManager: Person;
  /** 店員:沒有批售單與批售客戶 */
  let clerk: Person;
  let admin: Person;
  let game: Types.ObjectId;
  let account: Types.ObjectId;
  let customer: Types.ObjectId;
  let publishBadge: jest.SpiedFunction<RealtimePublisher["publishBadge"]>;

  const db = () => api.connection;
  const world = () => ({ api }) as World;
  const transactions = () => api.app.get(TransactionService);

  function storeOperator(orgId: Types.ObjectId): OperatorContext {
    return {
      actorId: new Types.ObjectId(),
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

  /** 進一本到某家店(本 A:批購金額率 92、成本 18,400)。 */
  async function newBook(
    options: {
      orgId?: Types.ObjectId;
      rate?: number;
      cost?: number;
      lastTicketNo?: number;
    } = {},
  ): Promise<{ bookId: Types.ObjectId; bookNo: string }> {
    bookSequence += 1;
    const bookNo = String(bookSequence).padStart(6, "0");
    const orgId = options.orgId ?? branch;
    const { book } = await transactions().withTransaction((session) =>
      api.app
        .get(LotteryBooksService)
        .createBook(session, storeOperator(orgId), {
          orgId,
          gameId: game,
          bookNo,
          lastTicketNo: options.lastTicketNo ?? 100,
          rate: options.rate ?? 92,
          cost: options.cost ?? 18_400,
        }),
    );
    return { bookId: book._id, bookNo: `0${bookNo}` };
  }

  async function newBookId(): Promise<Types.ObjectId> {
    const { bookId } = await newBook();
    return bookId;
  }

  async function ticketsOf(bookId: Types.ObjectId): Promise<TicketRow[]> {
    return db()
      .collection<TicketRow>("lottery_tickets")
      .find({ bookId })
      .sort({ ticketNo: 1 })
      .toArray();
  }

  async function everyTicket(
    bookId: Types.ObjectId,
    predicate: (ticket: TicketRow) => boolean,
  ): Promise<boolean> {
    const tickets = await ticketsOf(bookId);
    return tickets.length > 0 && tickets.every((ticket) => predicate(ticket));
  }

  const isFree = (ticket: TicketRow): boolean =>
    ticket.status === "unsold" &&
    ticket.location.kind === "stock" &&
    ticket.lockedBy === null &&
    ticket.orgId.equals(branch);

  /** 本維護的張數合計 = 依張重數。 */
  async function expectCountsMatch(bookId: Types.ObjectId): Promise<void> {
    const tickets = await ticketsOf(bookId);
    const book = await db()
      .collection<{ ticketCounts: Record<string, number> }>("lottery_books")
      .findOne({ _id: bookId });
    expect(book?.ticketCounts).toEqual(
      bookCountsOf(
        tickets.map((ticket) => ({
          status: ticket.status as never,
          locationKind: ticket.location.kind as never,
        })),
      ),
    );
  }

  /** 拆本(前 10 張移到檯面),再全部收回到庫存。 */
  async function openAndReturn(bookId: Types.ObjectId): Promise<void> {
    const cashPointId = new Types.ObjectId();
    for (const step of ["open", "recall"] as const) {
      const all = await ticketsOf(bookId);
      await transactions().withTransaction((session) =>
        api.app.get(TicketLedgerService).applyTicketEvents(
          session,
          { operator: storeOperator(branch) },
          all.slice(0, 10).map((ticket) => ({
            ticketId: ticket._id,
            expectedVersion: ticket.version,
            type: step,
            patch: {
              location:
                step === "open"
                  ? { kind: "counter" as const, cashPointId }
                  : { kind: "stock" as const, cashPointId: null },
            },
          })),
        ),
      );
    }
  }

  function line(bookId: Types.ObjectId, overrides: Partial<Line> = {}): Line {
    rowSequence += 1;
    return {
      rowId: `00000000-0000-4000-9000-${String(rowSequence).padStart(12, "0")}`,
      game: String(game),
      book: String(bookId),
      tickets: 100,
      book_price: 20_000,
      rate: 93,
      ...overrides,
    };
  }

  function header(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      from_branch: String(branch),
      customer: String(customer),
      payment_mode: "collect_first",
      ...overrides,
    };
  }

  const autoBank = (overrides: Record<string, unknown> = {}) => ({
    payment_mode: "auto_bank",
    account: String(account),
    ...overrides,
  });

  /** 送出(新單);擋下時回錯誤的 extensions。 */
  async function trySubmit(
    who: Person,
    lines: Line[],
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; error: Record<string, unknown> | null }> {
    const draft = await createDraft(api, who.token, FORM, {
      ...header(overrides),
      lines,
    });
    const result = await call(api, who.token, SUBMIT_SUBMISSION, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    return {
      id: draft.id,
      error: result.errors ? extensionsOf(result) : null,
    };
  }

  async function submit(
    lines: Line[],
    overrides: Record<string, unknown> = {},
    who = manager,
  ): Promise<string> {
    const { id, error } = await trySubmit(who, lines, overrides);
    expect(error).toBeNull();
    return id;
  }

  async function docOf(id: string) {
    const doc = await db()
      .collection<{
        status: string;
        editVersion: number;
        serialNo: string;
      }>("form_submissions")
      .findOne({ _id: new Types.ObjectId(id) });
    if (doc === null) {
      throw new Error(`沒有 ${id}`);
    }
    return doc;
  }

  async function statusOf(id: string): Promise<string> {
    const { status } = await docOf(id);
    return status;
  }

  async function serialOf(id: string): Promise<string> {
    const { serialNo } = await docOf(id);
    return serialNo;
  }

  /** 退回 / 撤回後:先存內容(不送出)。 */
  async function save(
    id: string,
    values: Record<string, unknown>,
    who = manager,
  ): Promise<void> {
    const { editVersion } = await docOf(id);
    await ok(api, who.token, SAVE_SUBMISSION, {
      input: { id, expectedEditVersion: editVersion, values },
    });
  }

  async function resubmit(id: string, who = manager): Promise<string | null> {
    const { editVersion } = await docOf(id);
    const result = await call(api, who.token, SUBMIT_SUBMISSION, {
      input: { id, expectedEditVersion: editVersion },
    });
    return result.errors ? reasonOf(extensionsOf(result)) : null;
  }

  async function decideBlocked(
    id: string,
    decision: "APPROVE" | "REJECT",
    who = manager,
  ): Promise<{ reason: string; message: string } | null> {
    const task = await pendingTaskOf(world(), who, id);
    const result = await call(api, who.token, DECIDE_MUTATION, {
      input: {
        taskId: task.id,
        expectedEditVersion: task.editVersion,
        decision,
        ...(decision === "REJECT" ? { comment: "理由" } : {}),
      },
    });
    return result.errors
      ? {
          reason: reasonOf(extensionsOf(result)),
          message: String(result.errors[0]?.message),
        }
      : null;
  }

  const approve = (id: string) => decideOn(world(), manager, id, "APPROVE");

  async function voidBlocked(id: string, who = manager) {
    const { editVersion } = await docOf(id);
    const result = await call(api, who.token, FORM_VOID, {
      input: { id, expectedEditVersion: editVersion, reasonNote: "登記錯誤" },
    });
    return result.errors ? reasonOf(extensionsOf(result)) : null;
  }

  async function settlementOf(id: string, who = manager): Promise<Settlement> {
    const data = await ok<{ lotterySettlement: { item: Settlement } }>(
      api,
      who.token,
      SETTLEMENT,
      { refId: id },
    );
    return data.lotterySettlement.item;
  }

  /** 已收淨額。 */
  async function netOf(id: string): Promise<number | undefined> {
    const { sides } = await settlementOf(id);
    return sides[0]?.net;
  }

  /** 結算區讀不到(不參與收付)時的 reason。 */
  async function settlementError(id: string): Promise<string | null> {
    const result = await call(api, manager.token, SETTLEMENT, { refId: id });
    return result.errors ? reasonOf(extensionsOf(result)) : null;
  }

  async function record(
    id: string,
    button: "in" | "out",
    amount: number,
    method: "bank" | "cash" = "bank",
    who = manager,
  ): Promise<string | null> {
    const result = await call(api, who.token, RECORD, {
      input: {
        moduleKey: MODULE,
        refId: id,
        side: "shipper",
        button,
        method,
        amount,
        ...(method === "bank"
          ? { accountId: String(account) }
          : { cashSource: "vault", handler: "王小明" }),
      },
    });
    return result.errors ? reasonOf(extensionsOf(result)) : null;
  }

  async function reverseAll(id: string): Promise<void> {
    const item = await settlementOf(id);
    for (const row of item.records.filter((one) => one.canReverse)) {
      await ok(api, manager.token, REVERSE, {
        input: { id: row.id, method: row.method, reason: "測試沖正" },
      });
    }
  }

  async function outstandingOf(id: string) {
    const data = await ok<{
      lotteryOutstandingSettlements: {
        items: {
          refId: string;
          kind: string;
          amount: number;
          counterparty: string;
        }[];
      };
    }>(api, hq.token, OUTSTANDING);
    const row = data.lotteryOutstandingSettlements.items.find(
      (item) => item.refId === id,
    );
    return row === undefined
      ? null
      : {
          kind: row.kind,
          amount: row.amount,
          counterparty: row.counterparty,
        };
  }

  async function vaultExpected(): Promise<number> {
    const vault = await api.app
      .get(CashLedgerService)
      .vaultExpected(storeOperator(branch), tenant, branch);
    return vault.amount;
  }

  async function bankRowsOf(id: string) {
    return db()
      .collection<{
        type: string;
        direction: string;
        amount: number;
        branchOrgId: Types.ObjectId;
        accountId: Types.ObjectId;
        summary: string;
      }>("lottery_bank_transactions")
      .find({ refId: new Types.ObjectId(id) })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
  }

  async function eventsOf(bookId: Types.ObjectId, type: string) {
    return db()
      .collection<{
        amount: number;
        cost: number;
        by: Types.ObjectId | null;
        refType: string;
        refId: Types.ObjectId;
        reasonNote: string | null;
      }>("lottery_ticket_events")
      .find({ bookId, type })
      .toArray();
  }

  interface ListRow {
    id: string;
    serialNo: string | null;
    customerName: string;
    paymentMode: string | null;
    books: number;
    amount: number;
    received: number;
    settlementKind: string | null;
    settlementAmount: number;
    inSettlement: boolean;
    status: string;
    canDelete: boolean;
  }

  async function listOf(
    input: Record<string, unknown> = {},
    who = manager,
  ): Promise<ListRow[]> {
    const data = await ok<{ lotteryWholesales: { items: ListRow[] } }>(
      api,
      who.token,
      LIST,
      { input: { pageSize: 100, ...input } },
    );
    return data.lotteryWholesales.items;
  }

  async function isListed(id: string, who: Person): Promise<boolean> {
    const rows = await listOf({}, who);
    return rows.some((row) => row.id === id);
  }

  async function optionsOf(who = manager) {
    const data = await ok<{
      lotteryWholesaleOptions: {
        books: {
          bookId: string;
          tickets: number;
          bookPrice: number;
          defaultRate: number;
          cost: number | null;
        }[];
        customers: { label: string }[];
        accounts: { id: string }[];
      };
    }>(api, who.token, OPTIONS, { from: String(branch) });
    return data.lotteryWholesaleOptions;
  }

  async function isOption(bookId: Types.ObjectId): Promise<boolean> {
    const { books } = await optionsOf();
    return books.some((book) => book.bookId === String(bookId));
  }

  async function scanProblem(bookNo: string) {
    const data = await ok<{
      lotteryWholesaleScanMatches: {
        problem: string | null;
        lockedSerialNo: string | null;
      }[];
    }>(api, manager.token, SCAN_MATCHES, { from: String(branch), bookNo });
    const [match] = data.lotteryWholesaleScanMatches;
    return match === undefined
      ? null
      : { problem: match.problem, lockedSerialNo: match.lockedSerialNo };
  }

  async function badgeOf(who: Person): Promise<number> {
    const data = await ok<{
      sidebarBadges: { moduleKey: string; count: number }[];
    }>(api, who.token, BADGES);
    return (
      data.sidebarBadges.find((badge) => badge.moduleKey === MODULE)?.count ?? 0
    );
  }

  /** 一張已收齊、核准完成的單。 */
  async function completed(
    books: readonly Types.ObjectId[],
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const id = await submit(
      books.map((bookId) => line(bookId)),
      overrides,
    );
    expect(await record(id, "in", 18_600 * books.length)).toBeNull();
    await approve(id);
    return id;
  }

  /** 直接問規則(引擎的引用檢查、四捨五入走不到這些錯誤碼;送出的人 = 總部的可見範圍)。 */
  async function problemOf(
    values: Record<string, unknown>,
    lines: Line[],
  ): Promise<string | null> {
    const result = await api.app.get(WholesaleRules).beforeSubmit(
      { ...storeOperator(branch), visibleOrgIds: [tenant, branch] },
      {
        _id: new Types.ObjectId(),
        tenantId: tenant,
        orgId: branch,
        moduleKey: MODULE,
        formKey: FORM,
        status: "draft",
        revision: 0,
        values: {},
      },
      {
        from_branch: { id: String(branch), label: "中山店" },
        customer: { id: String(customer), label: "好運彩券行" },
        payment_mode: "collect_first",
        ...values,
        lines: lines.map((row) => ({
          ...row,
          amount: row.amount ?? 18_600,
        })),
      },
    );
    return result?.code ?? null;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-wholesale");
    const { connection } = api;
    await seedWholesaleAuthorization(connection);
    await seedDealersAuthorization(connection);
    publishBadge = jest.spyOn(api.app.get(RealtimePublisher), "publishBadge");
    const root = await rootToken(api);
    tenant = await createOrg(connection, {
      name: "好運彩券行",
      settings: { visibility: "subtree" },
    });
    branch = await createOrg(connection, { name: "中山店", parentId: tenant });
    otherBranch = await createOrg(connection, {
      name: "新竹店",
      parentId: tenant,
    });
    const all = Object.values(WHOLESALE_PERMISSION_KEYS);
    admin = await person(api, connection, tenant, tenant, {
      moduleKeys: [
        "system",
        "system.workflows",
        "system.workflows.blocked-page",
        "system.forms",
      ],
      permissionKeys: [
        "system.workflows.*",
        "system.workflows.blocked-page.*",
        "system.forms.*",
      ],
    });
    const modules = [
      ...WHOLESALE_MODULE_KEYS,
      "apply-center",
      "apply-center.view-page",
      "store",
    ];
    const managerScope = {
      moduleKeys: modules,
      permissionKeys: [
        ...all,
        "apply-center.view",
        "store.view",
        "store.sell",
        "store.stocktake",
      ],
    };
    hq = await person(api, connection, tenant, tenant, {
      moduleKeys: [
        ...modules,
        "inventory",
        "accounts",
        "dealers",
        "dealers.wholesale-customers",
      ],
      permissionKeys: [
        ...managerScope.permissionKeys,
        "inventory.show-cost",
        "accounts.view-outstanding",
        "dealers.wholesale-customers.create",
        "dealers.wholesale-customers.edit",
      ],
    });
    manager = await person(api, connection, branch, tenant, managerScope);
    otherManager = await person(
      api,
      connection,
      otherBranch,
      tenant,
      managerScope,
    );
    clerk = await person(api, connection, branch, tenant, {
      moduleKeys: ["apply-center", "store"],
      permissionKeys: ["apply-center.view", "store.view", "store.sell"],
    });
    const storeManager = await createRole(api.app, connection, {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [manager.userId, otherManager.userId],
    });

    await ok(api, root, CREATE_FORM, {
      input: { key: FORM, moduleKey: MODULE, name: "批售單" },
    });
    await publishDefinition(api, root, FORM, wholesaleDefinition(), null);
    await ok(api, root, UPDATE_FORM, {
      input: {
        key: FORM,
        sharedByFieldKeys: WHOLESALE_SHARED_BY_FIELD_KEYS,
        serial: { prefix: "W", period: "none", digits: 4 },
      },
    });
    await ok(api, root, ASSIGN, {
      input: { formKey: FORM, tenantOrgIds: [String(tenant)] },
    });
    // 開通腳本建的流程:一關「出貨確認」店長限定「出貨分店」;不跳過、申請人也是審核者時照常審核
    const flow = { api, connection, admin } as unknown as World;
    await publishWorkflow(flow, "wholesale_flow", {
      steps: [
        reviewStep(
          "ship",
          audienceSource(
            audienceRow("role", [storeManager]),
            audienceRow("org", {
              kind: "dynamic",
              ref: "form-field:from_branch",
            }),
          ),
          { autoApprove: { applicant: "review" } },
        ),
      ],
      checkFormKey: FORM,
    });
    await bindForm(flow, "wholesale_flow", FORM);
    game = await insertGame(connection, tenant, {
      gameCode: "5164",
      name: "發大財",
      unitPrice: 200,
      ticketsPerBook: 100,
      defaultRate: 92,
    });
    account = await insertBankAccount(connection, tenant, tenant);
    customer = await insertWholesaleCustomer(connection, tenant, {
      storeName: "好運彩券行",
      phone: "0223456789",
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    publishBadge.mockRestore();
    await api.close();
  });

  describe("驗算情境(21.9)", () => {
    it("#1 新增頁加入本 A:批購金額率帶 92、整本 20,000、100 張;有 `inventory.show-cost` 看得到原成本 18,400(預估獲利 0),照樣可送", async () => {
      const book = await newBook();
      const seen = await optionsOf(hq);
      expect(
        seen.books.find((item) => item.bookId === String(book.bookId)),
      ).toEqual({
        bookId: String(book.bookId),
        tickets: 100,
        bookPrice: 20_000,
        defaultRate: 92,
        cost: 18_400,
      });
      expect(seen.customers).toContainEqual({
        label: "好運彩券行 · 0223456789",
      });
      expect(seen.accounts).toContainEqual({ id: String(account) });
      // 沒有 show-cost:成本不回
      const managers = await optionsOf();
      expect(
        managers.books.find((item) => item.bookId === String(book.bookId)),
      ).toMatchObject({ cost: null });
      const id = await submit([line(book.bookId, { rate: 92 })]);
      expect(await outstandingOf(id)).toMatchObject({ amount: 18_400 });
    });

    it("#2–#7 收到錢再核准:鎖 200 張、待收 37,200、刷到擋下、核准擋下(少收 / 多收)、收齊後核准 = 出貨", async () => {
      const bookA = await newBook({ rate: 92, cost: 18_400 });
      const bookB = await newBook({ rate: 90, cost: 18_000 });
      const badgeBefore = await badgeOf(manager);

      // #2
      publishBadge.mockClear();
      const id = await submit([line(bookA.bookId), line(bookB.bookId)]);
      const { serialNo } = await docOf(id);
      expect(serialNo).toMatch(/^W-\d{4}$/);
      for (const book of [bookA, bookB]) {
        expect(await everyTicket(book.bookId, isLockedBy(id))).toBe(true);
      }
      expect(await outstandingOf(id)).toEqual({
        kind: "to_receive",
        amount: 37_200,
        counterparty: "好運彩券行",
      });
      expect(await badgeOf(manager)).toBe(badgeBefore + 1);
      expect(
        publishBadge.mock.calls.some(
          ([, moduleKey, users]) =>
            moduleKey === MODULE &&
            users.map(String).includes(String(manager.userId)),
        ),
      ).toBe(true);
      const reviewing = await ok<{
        lotteryWholesaleDetail: { rows: { state: string | null }[] };
      }>(api, manager.token, DETAIL, { id });
      expect(
        reviewing.lotteryWholesaleDetail.rows.map((row) => row.state),
      ).toEqual(["wholesaling", "wholesaling"]);

      // #3
      const scanned = await ok<{
        lotteryStoreScan: { items: Record<string, unknown>[] };
      }>(api, manager.token, STORE_SCAN, {
        input: { orgId: String(branch), code: `${bookA.bookNo}040` },
      });
      expect(scanned.lotteryStoreScan.items).toEqual([
        {
          outcome: "blocked",
          blockReason: "locked",
          lockRefType: "wholesale",
          lockSerialNo: serialNo,
        },
      ]);

      // #4
      expect(await decideBlocked(id, "APPROVE")).toEqual({
        reason: "WHOLESALE_UNRECEIVED",
        message: "還差 37200 元沒收",
      });

      // #5
      const vaultBefore = await vaultExpected();
      const opened = await settlementOf(id);
      expect(opened).toMatchObject({
        payable: 37_200,
        counterparty: "好運彩券行",
        sides: [
          {
            side: "shipper",
            role: "payee",
            methods: ["bank", "cash"],
            net: 0,
            canSettle: true,
            buttons: [
              { button: "out", defaultAmount: 0 },
              { button: "in", defaultAmount: 37_200 },
            ],
          },
        ],
      });
      expect(await record(id, "in", 20_000, "cash")).toBeNull();
      expect((await vaultExpected()) - vaultBefore).toBe(20_000);
      expect(await outstandingOf(id)).toMatchObject({
        kind: "to_receive",
        amount: 17_200,
      });
      expect(await decideBlocked(id, "APPROVE")).toMatchObject({
        reason: "WHOLESALE_UNRECEIVED",
        message: "還差 17200 元沒收",
      });

      // #6
      expect(await record(id, "in", 17_500)).toBeNull();
      expect(await outstandingOf(id)).toMatchObject({
        kind: "to_refund",
        amount: 300,
      });
      expect(await decideBlocked(id, "APPROVE")).toEqual({
        reason: "WHOLESALE_OVERRECEIVED",
        message: "多收 300 元,請先記退款",
      });

      // #7
      expect(await record(id, "out", 300)).toBeNull();
      publishBadge.mockClear();
      await approve(id);
      expect(await statusOf(id)).toBe("completed");
      expect(await outstandingOf(id)).toBeNull();
      expect(await badgeOf(manager)).toBe(badgeBefore);
      expect(
        publishBadge.mock.calls.some(([, moduleKey]) => moduleKey === MODULE),
      ).toBe(true);
      for (const [book, cost] of [
        [bookA, 18_400],
        [bookB, 18_000],
      ] as const) {
        expect(
          await everyTicket(
            book.bookId,
            (ticket) =>
              ticket.status === "wholesaled" &&
              ticket.lockedBy === null &&
              ticket.orgId.equals(branch),
          ),
        ).toBe(true);
        const events = await eventsOf(book.bookId, "wholesale");
        expect(events).toHaveLength(100);
        expect(events.reduce((sum, event) => sum + event.amount, 0)).toBe(
          18_600,
        );
        expect(
          Math.round(events.reduce((sum, event) => sum + event.cost, 0)),
        ).toBe(cost);
        // 事件的「誰」= 核准的人
        expect(
          events.every(
            (event) =>
              event.by?.equals(manager.userId) === true &&
              event.refType === "wholesale" &&
              String(event.refId) === id,
          ),
        ).toBe(true);
        await expectCountsMatch(book.bookId);
      }
      // 收到錢再核准:核准時不另記帳
      const bankRows = await bankRowsOf(id);
      expect(bankRows.map((row) => [row.type, row.amount])).toEqual([
        ["wholesale_income", 17_500],
        ["wholesale_expense", 300],
      ]);
      const shipped = await ok<{
        lotteryWholesaleDetail: {
          received: number;
          shippedAt: string | null;
          rows: { state: string | null }[];
        };
      }>(api, manager.token, DETAIL, { id });
      expect(shipped.lotteryWholesaleDetail).toMatchObject({
        received: 37_200,
        rows: [{ state: "wholesaled" }, { state: "wholesaled" }],
      });
      expect(shipped.lotteryWholesaleDetail.shippedAt).not.toBeNull();
      const listed = await listOf();
      expect(listed.find((row) => row.id === id)).toMatchObject({
        serialNo,
        customerName: "好運彩券行",
        paymentMode: "collect_first",
        books: 2,
        amount: 37_200,
        received: 37_200,
        inSettlement: true,
        settlementKind: null,
        status: "COMPLETED",
      });
    });

    it("#9、#10 從帳戶入帳:核准前鎖定、不在待結清、結算區沒有 [收款];核准時同一個交易出貨 + 自動記「批售收入 19,000」", async () => {
      const book = await newBook();
      const id = await submit([line(book.bookId, { rate: 95 })], autoBank());
      expect(await everyTicket(book.bookId, isLockedBy(id))).toBe(true);
      expect(await outstandingOf(id)).toBeNull();
      expect(await settlementError(id)).toBe("SETTLEMENT_UNKNOWN");
      expect(await record(id, "in", 19_000)).toBe("SETTLEMENT_UNKNOWN");
      const detail = await ok<{
        lotteryWholesaleDetail: Record<string, unknown>;
      }>(api, manager.token, DETAIL, { id });
      expect(detail.lotteryWholesaleDetail).toMatchObject({
        paymentMode: "auto_bank",
        amount: 19_000,
        received: 0,
      });
      expect(detail.lotteryWholesaleDetail.accountLabel).not.toBeNull();

      await approve(id);
      expect(
        await everyTicket(
          book.bookId,
          (ticket) => ticket.status === "wholesaled",
        ),
      ).toBe(true);
      const [income, ...rest] = await bankRowsOf(id);
      expect(rest).toEqual([]);
      expect(income).toMatchObject({
        type: "wholesale_income",
        direction: "in",
        amount: 19_000,
        branchOrgId: branch,
        accountId: account,
      });
      expect(income?.summary).toContain("好運彩券行");
      expect(income?.summary).not.toContain("0223456789");
      expect(await outstandingOf(id)).toBeNull();
      // 沖正自動那筆 → 重新列待收
      await reverseAll(id);
      expect(await outstandingOf(id)).toMatchObject({
        kind: "to_receive",
        amount: 19_000,
      });
    });

    it("#11 核准前帳戶被停用:核准擋下;退回改收款方式可以重送", async () => {
      const other = await insertBankAccount(db(), tenant, tenant);
      const book = await newBook();
      const row = line(book.bookId, { rate: 95 });
      const id = await submit([row], autoBank({ account: String(other) }));
      await db()
        .collection("lottery_bank_accounts")
        .updateOne({ _id: other }, { $set: { status: "inactive" } });
      expect(await decideBlocked(id, "APPROVE")).toMatchObject({
        reason: "WHOLESALE_ACCOUNT_INVALID",
      });
      expect(await everyTicket(book.bookId, isLockedBy(id))).toBe(true);
      await decideOn(world(), manager, id, "RETURN");
      await save(id, { ...header(), lines: [row] });
      expect(await resubmit(id)).toBeNull();
      expect(await outstandingOf(id)).toMatchObject({ amount: 19_000 });
    });

    it("#12 已收 20,000 的單按 [駁回]:擋下;[退款] 20,000 後駁回 → 解鎖", async () => {
      const book = await newBook();
      const id = await submit([line(book.bookId, { rate: 100 })]);
      expect(await record(id, "in", 25_000)).toBeNull();
      expect(await decideBlocked(id, "REJECT")).toMatchObject({
        reason: "SETTLEMENT_NOT_CLEARED",
      });
      // 超過批售金額的部分先退款,剩下的沖正
      expect(await record(id, "out", 5000)).toBeNull();
      expect(await decideBlocked(id, "REJECT")).toMatchObject({
        reason: "SETTLEMENT_NOT_CLEARED",
      });
      await reverseAll(id);
      expect(await decideBlocked(id, "REJECT")).toBeNull();
      expect(await statusOf(id)).toBe("rejected");
      expect(await everyTicket(book.bookId, isFree)).toBe(true);
      expect(await isOption(book.bookId)).toBe(true);
      expect(await outstandingOf(id)).toBeNull();
    });

    it("#13 退回(與撤回)解鎖、收付保留;重新送出重新檢查、重新鎖,不再單上的本解鎖", async () => {
      const kept = await newBook();
      const dropped = await newBook();
      const added = await newBook();
      const keptLine = line(kept.bookId);
      const id = await submit([keptLine, line(dropped.bookId)]);
      expect(await record(id, "in", 5000)).toBeNull();
      await decideOn(world(), manager, id, "RETURN");
      for (const book of [kept, dropped]) {
        expect(await everyTicket(book.bookId, isFree)).toBe(true);
      }
      // 結算紀錄保留、照樣列待收
      expect(await netOf(id)).toBe(5000);

      // 退回期間,本被別張單鎖走 → 重送擋下
      const other = await submit([line(kept.bookId)]);
      expect(await resubmit(id)).toBe("WHOLESALE_BOOK_UNAVAILABLE");
      await decideOn(world(), manager, other, "REJECT");

      await save(id, { ...header(), lines: [keptLine, line(added.bookId)] });
      expect(await resubmit(id)).toBeNull();
      expect(await everyTicket(kept.bookId, isLockedBy(id))).toBe(true);
      expect(await everyTicket(added.bookId, isLockedBy(id))).toBe(true);
      expect(await everyTicket(dropped.bookId, isFree)).toBe(true);

      // 申請人撤回:解鎖
      const { editVersion } = await docOf(id);
      await ok(api, manager.token, WITHDRAW, {
        input: { id, expectedEditVersion: editVersion },
      });
      expect(await statusOf(id)).toBe("withdrawn");
      expect(await everyTicket(kept.bookId, isFree)).toBe(true);
      expect(await resubmit(id)).toBeNull();
      expect(await everyTicket(kept.bookId, isLockedBy(id))).toBe(true);
    });

    it("#14 退回後把已收 5,000 的「收到錢再核准」改成「從帳戶入帳」:送出擋下;存了沒送出時收款照樣看得到、能沖正,歸 0 後可以送", async () => {
      const book = await newBook();
      const row = line(book.bookId);
      const id = await submit([row]);
      expect(await record(id, "in", 5000)).toBeNull();
      await decideOn(world(), manager, id, "RETURN");
      await save(id, { ...header(autoBank()), lines: [row] });
      expect(await resubmit(id)).toBe("WHOLESALE_MODE_HAS_RECEIPTS");
      // 還沒重送:照上一次送出的收款方式,收款不會卡住(看得到、列待結清、能沖正)
      expect(await netOf(id)).toBe(5000);
      expect(await outstandingOf(id)).toMatchObject({ kind: "to_receive" });
      await reverseAll(id);
      expect(await netOf(id)).toBe(0);
      expect(await resubmit(id)).toBeNull();
      expect(await outstandingOf(id)).toBeNull();
    });

    it("#15 拆過又全部收回的本:選項不列、刷到說拆過了、送出擋下並列出是哪一本", async () => {
      const book = await newBook();
      await openAndReturn(book.bookId);
      expect(await everyTicket(book.bookId, isFree)).toBe(true);
      expect(await isOption(book.bookId)).toBe(false);
      expect(await scanProblem(book.bookNo)).toEqual({
        problem: "opened",
        lockedSerialNo: null,
      });
      const row = line(book.bookId);
      const { error } = await trySubmit(manager, [row]);
      expect(error).toMatchObject({
        code: "FORBIDDEN",
        reason: "WHOLESALE_BOOK_UNAVAILABLE",
        books: [
          {
            rowId: row.rowId,
            bookId: String(book.bookId),
            gameCode: "5164",
            bookNo: book.bookNo,
            problem: "opened",
            lockedSerialNo: null,
          },
        ],
      });
    });

    it("#16 正在調貨單 / 另一張批售單上的本:擋下並寫出哪一張單;在別家店、已撤銷也各有原因", async () => {
      const book = await newBook();
      const transfer = await db()
        .collection("form_submissions")
        .insertOne({
          orgId: tenant,
          tenantId: tenant,
          moduleKey: "purchasing.transfer",
          formKey: "transfer",
          version: 1,
          values: {},
          summary: null,
          status: "reviewing",
          revision: 1,
          revisions: [],
          editVersion: 1,
          touched: [],
          clientRequestId: String(new Types.ObjectId()),
          serialNo: "T-0009",
          submittedAt: new Date(),
          currentInstanceId: null,
          blocked: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: null,
          updatedBy: null,
          deletedAt: null,
        });
      const locked = await ticketsOf(book.bookId);
      await transactions().withTransaction((session) =>
        api.app.get(TicketLedgerService).lockTicketsInTenant(
          session,
          tenant,
          locked.map((ticket) => ticket._id),
          { refType: "transfer", refId: transfer.insertedId },
        ),
      );
      expect(await isOption(book.bookId)).toBe(false);
      expect(await scanProblem(book.bookNo)).toEqual({
        problem: "transferring",
        lockedSerialNo: "T-0009",
      });
      const { error } = await trySubmit(manager, [line(book.bookId)]);
      expect(error).toMatchObject({
        reason: "WHOLESALE_BOOK_UNAVAILABLE",
        books: [{ problem: "transferring", lockedSerialNo: "T-0009" }],
      });

      const onWholesale = await newBook();
      const id = await submit([line(onWholesale.bookId)]);
      expect(await scanProblem(onWholesale.bookNo)).toEqual({
        problem: "wholesaling",
        lockedSerialNo: await serialOf(id),
      });

      const elsewhere = await newBook({ orgId: otherBranch });
      expect(await scanProblem(elsewhere.bookNo)).toMatchObject({
        problem: "elsewhere",
      });
      const revoked = await newBook();
      await db()
        .collection("lottery_books")
        .updateOne({ _id: revoked.bookId }, { $set: { status: "revoked" } });
      expect(await scanProblem(revoked.bookNo)).toMatchObject({
        problem: "revoked",
      });
      expect(await scanProblem("0999999")).toBeNull();
    });

    it("#17(張數與成本部分)迄號 101、待標註 1 的未拆本:張數 100,整本的張都改已批售,批售金額合計不多算", async () => {
      const book = await newBook({ lastTicketNo: 101 });
      const { books } = await optionsOf(hq);
      expect(
        books.find((item) => item.bookId === String(book.bookId)),
      ).toMatchObject({ tickets: 100, cost: 18_400 });
      const { error } = await trySubmit(manager, [
        line(book.bookId, { tickets: 101 }),
      ]);
      expect(error).toMatchObject({ reason: "WHOLESALE_LINE_INVALID" });
      const id = await completed([book.bookId]);
      expect(await statusOf(id)).toBe("completed");
      expect(
        await everyTicket(
          book.bookId,
          (ticket) => ticket.status === "wholesaled",
        ),
      ).toBe(true);
    });

    it("#18 作廢(先沖正到淨額 0):回到出貨分店庫存的未售、仍未拆、單張成本不變,寫「取消批售」事件帶作廢原因", async () => {
      const book = await newBook();
      const id = await completed([book.bookId]);
      await reverseAll(id);
      expect(await voidBlocked(id)).toBeNull();
      expect(await everyTicket(book.bookId, isFree)).toBe(true);
      expect(
        await everyTicket(
          book.bookId,
          (ticket) => Math.round(ticket.unitCost) === 184,
        ),
      ).toBe(true);
      const events = await eventsOf(book.bookId, "wholesale_void");
      expect(events).toHaveLength(100);
      expect(events[0]).toMatchObject({
        amount: 186,
        refType: "wholesale",
        reasonNote: "登記錯誤",
      });
      expect(events[0]?.by?.equals(manager.userId)).toBe(true);
      const stored = await db()
        .collection("lottery_books")
        .findOne({ _id: book.bookId });
      expect(stored?.firstOpenedAt ?? null).toBeNull();
      await expectCountsMatch(book.bookId);
      // 可以再批售
      expect(await isOption(book.bookId)).toBe(true);
    });

    it("#19 作廢時淨額不是 0:擋下(從帳戶入帳的自動那筆要先沖正)", async () => {
      const collected = await newBook();
      const automatic = await newBook();
      const first = await completed([collected.bookId]);
      const second = await submit([line(automatic.bookId)], autoBank());
      await approve(second);
      for (const id of [first, second]) {
        expect(await voidBlocked(id)).toBe("SETTLEMENT_NOT_CLEARED");
      }
      await reverseAll(second);
      expect(await voidBlocked(second)).toBeNull();
    });

    it("#20 張數店批售一本未拆本:和編號店一樣;批售中、已批售的張不會被挑來當配對張", async () => {
      await db().collection(LOTTERY_STORE_COUNT_MODES_COLLECTION).insertOne({
        orgId: branch,
        tenantId: tenant,
        moduleKey: "store",
        mode: "count",
        since: null,
        lastRenumberAt: null,
        lastRenumberStocktakeId: null,
        history: [],
        movePauses: [],
        stocktakeSessions: [],
        version: 0,
      });
      try {
        // 只剩這款遊戲的這一本在庫存,才看得出有沒有被挑
        const onlyGame = await insertGame(db(), tenant, {
          gameCode: "5888",
          name: "獨家",
          unitPrice: 200,
          ticketsPerBook: 100,
        });
        const { book } = await transactions().withTransaction((session) =>
          api.app
            .get(LotteryBooksService)
            .createBook(session, storeOperator(branch), {
              orgId: branch,
              gameId: onlyGame,
              bookNo: "088001",
              lastTicketNo: 100,
              rate: 92,
              cost: 18_400,
            }),
        );
        // 配對張只挑拆過的本:量的時候暫時標成拆過,證明擋下它的是鎖與狀態
        const setOpened = async (firstOpenedAt: Date | null) => {
          await db()
            .collection("lottery_books")
            .updateOne({ _id: book._id }, { $set: { firstOpenedAt } });
        };
        const partnerOf = async (): Promise<number> => {
          await setOpened(new Date());
          const partners = await api.app
            .get(StoreMatching)
            .partnersOf(storeOperator(branch), branch, [
              {
                ticket: { _id: new Types.ObjectId(), gameId: onlyGame },
                places: [{ locationKind: "stock", cashPointId: null }],
              },
            ]);
          await setOpened(null);
          return partners.size;
        };
        expect(await partnerOf()).toBe(1);
        const id = await submit([line(book._id, { game: String(onlyGame) })]);
        expect(await partnerOf()).toBe(0);
        expect(await record(id, "in", 18_600)).toBeNull();
        await approve(id);
        expect(
          await everyTicket(
            book._id,
            (ticket) => ticket.status === "wholesaled",
          ),
        ).toBe(true);
        expect(await partnerOf()).toBe(0);
      } finally {
        await db()
          .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
          .deleteMany({ orgId: branch });
      }
    });

    it("#21 盤點時有一本批售中:不列進盤點", async () => {
      const free = await newBook();
      const book = await newBook();
      await submit([line(book.bookId)]);
      const data = await ok<{
        lotteryStocktakeSheet: {
          books: { bookId: string }[];
          unopenedBooks: { bookId: string }[];
        };
      }>(api, manager.token, STOCKTAKE_SHEET, {
        input: { orgId: String(branch) },
      });
      const listed = [
        ...data.lotteryStocktakeSheet.books,
        ...data.lotteryStocktakeSheet.unopenedBooks,
      ].map((item) => item.bookId);
      expect(listed).toContain(String(free.bookId));
      expect(listed).not.toContain(String(book.bookId));
    });

    it("#22 店員:選單沒有批售單與批售客戶分頁,讀取都擋下", async () => {
      const me = await ok<{ me: { modules: { key: string }[] } }>(
        api,
        clerk.token,
        ME_MODULES,
      );
      expect(
        me.me.modules.filter(
          (module) =>
            module.key.startsWith("purchasing.wholesale") ||
            module.key.startsWith("dealers.wholesale-customers"),
        ),
      ).toEqual([]);
      for (const [query, variables] of [
        [LIST, { input: {} }],
        [OPTIONS, { from: String(branch) }],
        [SCAN_MATCHES, { from: String(branch), bookNo: "056601" }],
        [CUSTOMER_DOCUMENTS, { id: String(customer) }],
        [CUSTOMERS, {}],
      ] as const) {
        const result = await call(api, clerk.token, query, variables);
        expect(extensionsOf(result).code).toBe("FORBIDDEN");
      }
    });

    it("#23 被批售單引用(含草稿、別人的草稿)的客戶不能刪;沒有引用的可以;最近一次批售日 = 已完成單的出貨時間", async () => {
      const remove = async (id: Types.ObjectId): Promise<string | null> => {
        const result = await call(api, hq.token, DELETE_CUSTOMER, {
          input: { id: String(id) },
        });
        return result.errors ? reasonOf(extensionsOf(result)) : null;
      };
      const lastOf = async (id: Types.ObjectId): Promise<string | null> => {
        const data = await ok<{
          lotteryWholesaleCustomers: {
            items: { id: string; lastWholesaleAt: string | null }[];
          };
        }>(api, hq.token, CUSTOMERS);
        return (
          data.lotteryWholesaleCustomers.items.find(
            (item) => item.id === String(id),
          )?.lastWholesaleAt ?? null
        );
      };
      const unused = await insertWholesaleCustomer(db(), tenant, {
        storeName: "沒用過彩券行",
      });
      expect(await remove(unused)).toBeNull();

      const used = await insertWholesaleCustomer(db(), tenant, {
        storeName: "大發彩券行",
      });
      const book = await newBook();
      // 店長的草稿,總部看不到(草稿只給本人),照樣擋
      const draft = await createDraft(api, manager.token, FORM, {
        ...header({ customer: String(used) }),
        lines: [line(book.bookId)],
      });
      expect(await remove(used)).toBe("WHOLESALE_CUSTOMER_IN_USE");
      expect(await lastOf(used)).toBeNull();

      const submitted = await call(api, manager.token, SUBMIT_SUBMISSION, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      expect(submitted.errors).toBeUndefined();
      expect(await lastOf(used)).toBeNull();
      expect(await record(draft.id, "in", 18_600)).toBeNull();
      await approve(draft.id);
      const [event] = await db()
        .collection<{ at: Date }>("lottery_ticket_events")
        .find({ bookId: book.bookId, type: "wholesale" })
        .toArray();
      expect(await lastOf(used)).toBe(event?.at.toISOString());
      expect(await remove(used)).toBe("WHOLESALE_CUSTOMER_IN_USE");

      // 批售紀錄
      const history = await ok<{
        lotteryCustomerWholesales: Record<string, unknown>[];
      }>(api, manager.token, CUSTOMER_DOCUMENTS, { id: String(used) });
      expect(history.lotteryCustomerWholesales).toEqual([
        {
          id: draft.id,
          serialNo: await serialOf(draft.id),
          books: 1,
          amount: 18_600,
          received: 18_600,
          status: "COMPLETED",
        },
      ]);

      // 作廢後不算最近一次批售日,仍不能刪
      await reverseAll(draft.id);
      expect(await voidBlocked(draft.id)).toBeNull();
      expect(await lastOf(used)).toBeNull();
      expect(await remove(used)).toBe("WHOLESALE_CUSTOMER_IN_USE");
    });

    it("#23 刪除客戶與送出批售單同時發生:不會留下指到已刪除客戶的審核中單據", async () => {
      for (let round = 0; round < 3; round += 1) {
        const raced = await insertWholesaleCustomer(db(), tenant, {
          storeName: `競爭彩券行 ${String(round)}`,
        });
        const book = await newBook();
        // 草稿先指到別的客戶,送出時才帶這位(刪除看不到引用,只能靠兩個交易互相衝突)
        const draft = await createDraft(api, manager.token, FORM, {
          ...header(),
          lines: [line(book.bookId)],
        });
        const [submitted, removed] = await Promise.all([
          call(api, manager.token, SUBMIT_SUBMISSION, {
            input: {
              id: draft.id,
              expectedEditVersion: draft.editVersion,
              values: { customer: String(raced) },
            },
          }),
          call(api, hq.token, DELETE_CUSTOMER, {
            input: { id: String(raced) },
          }),
        ]);
        const stored = await db()
          .collection(LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION)
          .findOne({ _id: raced });
        const isDeleted = (stored?.deletedAt ?? null) !== null;
        expect(isDeleted).toBe(removed.errors === undefined);
        expect((await statusOf(draft.id)) === "reviewing").toBe(
          submitted.errors === undefined,
        );
        expect(isDeleted && submitted.errors === undefined).toBe(false);
      }
    });
  });

  describe("掛接點:送出前(21.4 `beforeSubmit`)", () => {
    it("出貨分店不在送出的人的可見範圍 → 擋下", async () => {
      const book = await newBook({ orgId: otherBranch });
      const { error } = await trySubmit(manager, [line(book.bookId)], {
        from_branch: String(otherBranch),
      });
      expect(error).not.toBeNull();
      const { error: none } = await trySubmit(
        hq,
        [line(await newBookId())],
        {},
      );
      expect(none).toBeNull();
    });

    it("停用的批售客戶 → 擋下;既有的單(已送出)照常核准", async () => {
      const inactive = await insertWholesaleCustomer(db(), tenant, {
        storeName: "停用彩券行",
      });
      const id = await submit([line(await newBookId())], {
        customer: String(inactive),
      });
      await db()
        .collection(LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION)
        .updateOne({ _id: inactive }, { $set: { status: "inactive" } });
      const { error } = await trySubmit(manager, [line(await newBookId())], {
        customer: String(inactive),
      });
      expect(error).not.toBeNull();
      expect(await record(id, "in", 18_600)).toBeNull();
      await approve(id);
      expect(await statusOf(id)).toBe("completed");
    });

    it.each([
      ["張數不合", { tickets: 99 }],
      ["整本金額不合", { book_price: 19_000 }],
    ])("明細 %s → WHOLESALE_LINE_INVALID", async (_name, overrides) => {
      const book = await newBook();
      const { error } = await trySubmit(manager, [
        line(book.bookId, overrides),
      ]);
      expect(error).toMatchObject({ reason: "WHOLESALE_LINE_INVALID" });
      expect(await everyTicket(book.bookId, isFree)).toBe(true);
    });

    it("同一本重複、遊戲和本不同、本已撤銷 → 擋下", async () => {
      const book = await newBook();
      const repeated = await trySubmit(manager, [
        line(book.bookId),
        line(book.bookId),
      ]);
      expect(repeated.error).toMatchObject({
        reason: "WHOLESALE_LINE_INVALID",
      });
      const otherGame = await insertGame(db(), tenant, {
        gameCode: "5201",
        name: "金好運",
      });
      const mismatched = await trySubmit(manager, [
        line(book.bookId, { game: String(otherGame) }),
      ]);
      expect(mismatched.error).toMatchObject({
        reason: "WHOLESALE_LINE_INVALID",
      });
      const { error: empty } = await trySubmit(manager, []);
      expect(empty).not.toBeNull();
    });

    it("從帳戶入帳:帳戶停用或使用組織不含出貨分店 → 擋下", async () => {
      const onlyOther = await insertBankAccount(db(), tenant, otherBranch);
      const { error } = await trySubmit(
        hq,
        [line(await newBookId())],
        autoBank({ account: String(onlyOther) }),
      );
      expect(error).toMatchObject({ reason: "WHOLESALE_ACCOUNT_INVALID" });
      const inactive = await insertBankAccount(db(), tenant, tenant);
      const draft = await createDraft(api, manager.token, FORM, {
        ...header(autoBank({ account: String(inactive) })),
        lines: [line(await newBookId())],
      });
      await db()
        .collection("lottery_bank_accounts")
        .updateOne({ _id: inactive }, { $set: { status: "inactive" } });
      const result = await call(api, manager.token, SUBMIT_SUBMISSION, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      expect(result.errors).toBeDefined();
    });
  });

  describe("掛接點:送出前,表單引擎先擋下的也再檢查一次(規則本身)", () => {
    it("分店、客戶、明細、批購金額率、批售金額、帳戶各自的錯誤碼", async () => {
      const { bookId } = await newBook();
      const inactive = await insertWholesaleCustomer(db(), tenant, {
        storeName: "停用彩券行",
        status: "inactive",
      });
      const stopped = await insertBankAccount(db(), tenant, tenant, "inactive");
      const good = [line(bookId)];
      expect(await problemOf({}, good)).toBeNull();
      const cases: [Record<string, unknown>, Line[], string][] = [
        [{ from_branch: null }, good, "WHOLESALE_BRANCH_INVALID"],
        [
          { from_branch: { id: String(otherBranch), label: "新竹店" } },
          good,
          "WHOLESALE_BRANCH_INVALID",
        ],
        [{ customer: null }, good, "WHOLESALE_CUSTOMER_INVALID"],
        [
          { customer: { id: String(inactive), label: "停用彩券行" } },
          good,
          "WHOLESALE_CUSTOMER_INVALID",
        ],
        [{}, [], "WHOLESALE_NO_LINES"],
        [{}, [line(bookId, { rate: 92.5 })], "WHOLESALE_LINE_INVALID"],
        [
          {},
          [line(bookId, { rate: 101, amount: 20_200 })],
          "WHOLESALE_LINE_INVALID",
        ],
        [{}, [line(bookId, { amount: 1 })], "WHOLESALE_LINE_INVALID"],
        [{ payment_mode: "auto_bank" }, good, "WHOLESALE_ACCOUNT_INVALID"],
        [
          {
            payment_mode: "auto_bank",
            account: { id: String(stopped), label: "" },
          },
          good,
          "WHOLESALE_ACCOUNT_INVALID",
        ],
      ];
      for (const [values, lines, expected] of cases) {
        expect(await problemOf(values, lines)).toBe(expected);
      }
    });
  });

  describe("掛接點:核准前、刪除、作廢的保險", () => {
    it("`beforeApprove`:張不再鎖在這張單 → WHOLESALE_BOOK_UNAVAILABLE", async () => {
      const book = await newBook();
      const id = await submit([line(book.bookId)], autoBank());
      await db()
        .collection("lottery_tickets")
        .updateOne(
          { bookId: book.bookId, ticketNo: "001" },
          { $set: { lockedBy: null } },
        );
      expect(await decideBlocked(id, "APPROVE")).toMatchObject({
        reason: "WHOLESALE_BOOK_UNAVAILABLE",
      });
      expect(await bankRowsOf(id)).toEqual([]);
    });

    it("`beforeDelete`:只限草稿;被退回的單刪 → WHOLESALE_NOT_DRAFT", async () => {
      const book = await newBook();
      const id = await submit([line(book.bookId)]);
      await decideOn(world(), manager, id, "RETURN");
      const remove = async (target: string): Promise<string | null> => {
        const result = await call(api, manager.token, DELETE_SUBMISSION, {
          input: { id: target },
        });
        return result.errors ? reasonOf(extensionsOf(result)) : null;
      };
      expect(await remove(id)).toBe("WHOLESALE_NOT_DRAFT");
      const draft = await createDraft(api, manager.token, FORM, {
        ...header(),
        lines: [line(book.bookId)],
      });
      expect(await remove(draft.id)).toBeNull();
    });

    it("`beforeVoid`:張已不是已批售 → WHOLESALE_BOOKS_IN_USE", async () => {
      const book = await newBook();
      const id = await completed([book.bookId]);
      await reverseAll(id);
      await db()
        .collection("lottery_tickets")
        .updateOne(
          { bookId: book.bookId, ticketNo: "001" },
          { $set: { status: "unsold" } },
        );
      expect(await voidBlocked(id)).toBe("WHOLESALE_BOOKS_IN_USE");
    });
  });

  describe("列表、可見範圍、收款權限", () => {
    it("篩選:狀態(含草稿,只有自己的)、出貨分店、批售客戶、收款方式;草稿本人可刪", async () => {
      const filtered = await insertWholesaleCustomer(db(), tenant, {
        storeName: "篩選彩券行",
        phone: "0911222333",
      });
      const only = { customer: String(filtered) };
      const draft = await createDraft(api, manager.token, FORM, {
        ...header(only),
        lines: [line(await newBookId())],
      });
      const collect = await submit([line(await newBookId())], only);
      const automatic = await submit([line(await newBookId())], autoBank(only));
      const ids = async (input: Record<string, unknown>, who = manager) => {
        const rows = await listOf(
          { customerId: String(filtered), ...input },
          who,
        );
        return new Set(rows.map((row) => row.id));
      };
      expect(await ids({})).toEqual(new Set([draft.id, collect, automatic]));
      expect(await ids({ status: "DRAFT" })).toEqual(new Set([draft.id]));
      expect(await ids({ paymentMode: "auto_bank" })).toEqual(
        new Set([automatic]),
      );
      expect(await ids({ fromOrgId: String(otherBranch) })).toEqual(new Set());
      expect(
        await ids({ fromOrgId: String(branch), status: "REVIEWING" }),
      ).toEqual(new Set([collect, automatic]));
      // 別人的草稿看不到
      expect(await ids({}, hq)).toEqual(new Set([collect, automatic]));
      const rows = await listOf({ customerId: String(filtered) });
      expect(rows.find((row) => row.id === draft.id)).toMatchObject({
        canDelete: true,
        inSettlement: false,
        customerName: "篩選彩券行",
      });
      expect(rows.find((row) => row.id === collect)).toMatchObject({
        canDelete: false,
        settlementKind: "to_receive",
        settlementAmount: 18_600,
      });
      expect(rows.find((row) => row.id === automatic)).toMatchObject({
        inSettlement: false,
        settlementKind: null,
      });
    });

    it("總部替分店開的單:出貨分店看得到(依欄位共用)、能收款核准;別家店看不到", async () => {
      const book = await newBook();
      const id = await submit([line(book.bookId)], {}, hq);
      expect(await isListed(id, manager)).toBe(true);
      expect(await isListed(id, otherManager)).toBe(false);
      const hidden = await call(api, otherManager.token, DETAIL, { id });
      expect(extensionsOf(hidden).code).toBe("NOT_FOUND");
      expect(await record(id, "in", 18_600, "bank", otherManager)).toBe(
        "NOT_FOUND",
      );
      expect(await record(id, "in", 18_600)).toBeNull();
      await approve(id);
      expect(await statusOf(id)).toBe("completed");
    });
  });
});

/** 這張批售單鎖住的未售張。 */
const isLockedBy =
  (id: string) =>
  (ticket: TicketRow): boolean =>
    ticket.status === "unsold" &&
    ticket.lockedBy?.refType === "wholesale" &&
    String(ticket.lockedBy.refId) === id;

function reasonOf(extensions: Record<string, unknown>): string {
  const value = extensions.reason ?? extensions.code;
  return typeof value === "string" ? value : "";
}
