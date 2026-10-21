import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../../auth/test-support/fixtures";
import type { OperatorContext } from "../../../database/operator-context";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import {
  ASSIGN,
  CREATE_FORM,
  PASSWORD,
  type SubmissionRow,
  call,
  createDraft,
  extensionsOf,
  login,
  ok,
  publishDefinition,
  rootToken,
} from "../../../forms/test-support/form-fixtures";
import { NotificationService } from "../../../notifications/notification.service";
import { createRole } from "../../../permission/test-support/fixtures";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import {
  VOID as FORM_VOID,
  type Person,
  REASSIGN,
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
import {
  insertBankAccount,
  insertGame,
  insertRequisition,
  seedInventoryModule,
} from "../purchase/test-support/purchase-fixtures";
import { inTransitBooksOf } from "../requisition/in-transit";
import { LotteryBooksService } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import {
  TRANSFER_MODULE_KEYS,
  TRANSFER_PERMISSION_KEYS,
  seedTransferAuthorization,
  transferDefinition,
} from "./test-support/transfer-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const FORM = "transfer";
const MODULE = "purchasing.transfer";

const RECEIVE = /* GraphQL */ `
  mutation TestTransferReceive($input: ReceiveLotteryTransferBookInput!) {
    receiveLotteryTransferBook(input: $input) {
      rowId
      receiving {
        canReceive
        receivedCount
        totalCount
      }
    }
  }
`;

const RECEIVING = /* GraphQL */ `
  query TestTransferReceiving($id: ID!) {
    lotteryTransferReceiving(submissionId: $id) {
      canReceive
      receivedCount
      totalCount
      transferAmount
      fromBranchName
      toBranchName
      rows {
        rowId
        mode
        ticketNos
        shipped
        received
        shippedAt
      }
    }
  }
`;

const OPTIONS = /* GraphQL */ `
  query TestTransferOptions($from: ID!, $to: ID) {
    lotteryTransferOptions(fromOrgId: $from, toOrgId: $to) {
      books {
        bookId
        isWhole
        availableCount
        rate
      }
      requisitions {
        serialNo
        books
      }
      allocations {
        gameId
        plannedBooks
        givenBooks
        inTransitBooks
      }
    }
  }
`;

const BOOK_TICKETS = /* GraphQL */ `
  query TestTransferBookTickets($from: ID!, $book: ID!) {
    lotteryTransferBookTickets(fromOrgId: $from, bookId: $book) {
      ticketNo
      state
    }
  }
`;

const PROGRESS = /* GraphQL */ `
  query TestTransferProgress($ids: [ID!]!) {
    lotteryTransferProgress(transferIds: $ids) {
      transferId
      wholeBooks
      partialTickets
      receivedCount
      totalCount
      inTransit
      settlementKind
      settlementAmount
    }
  }
`;

const SETTLEMENT = /* GraphQL */ `
  query TestTransferSettlement($moduleKey: String!, $refId: ID!) {
    lotterySettlement(moduleKey: $moduleKey, refId: $refId) {
      item {
        payable
        pendingPayee
        sides {
          side
          net
          canSettle
          buttons {
            button
            defaultAmount
          }
        }
        records {
          method
          side
          direction
          cashPlace
          handler
        }
      }
    }
  }
`;

const RECORD = /* GraphQL */ `
  mutation TestTransferRecord($input: RecordLotterySettlementInput!) {
    recordLotterySettlement(input: $input) {
      recordId
    }
  }
`;

const NOTIFY_WRONG_STORE = /* GraphQL */ `
  mutation TestTransferWrongStore($input: ReceiveLotteryTransferBookInput!) {
    notifyLotteryTransferWrongStore(input: $input)
  }
`;

const REVERSE = /* GraphQL */ `
  mutation TestTransferReverse($input: ReverseLotterySettlementInput!) {
    reverseLotterySettlement(input: $input) {
      recordId
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

const DECIDE_MUTATION = /* GraphQL */ `
  mutation TestDecide($input: DecideTaskInput!) {
    decideTask(input: $input) {
      result
    }
  }
`;

const DELETE_SUBMISSION_MUTATION = /* GraphQL */ `
  mutation TestDeleteSubmission($input: DeleteFormSubmissionInput!) {
    deleteFormSubmission(input: $input) {
      success
    }
  }
`;

interface Settlement {
  payable: number;
  pendingPayee: number;
  sides: {
    side: string;
    net: number;
    canSettle: boolean;
    buttons: { button: string; defaultAmount: number }[];
  }[];
  records: {
    method: string;
    side: string;
    direction: string;
    cashPlace: string | null;
    handler: string | null;
  }[];
}

interface TicketRow {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  ticketNo: string;
  status: string;
  version: number;
  unitCost: number;
  responsibleOrgId: Types.ObjectId | null;
  location: { kind: string };
  lockedBy: { refType: string; refId: Types.ObjectId } | null;
}

/** 一列(表單存值)。 */
type Line = Record<string, unknown> & { rowId: string };

let bookSequence = 300_000;
let rowSequence = 0;
let dualSequence = 0;

describe("調貨單(規格 8.4、第 9 章)", () => {
  let api: AuthTestApp;
  let tenant: Types.ObjectId;
  let branchA: Types.ObjectId;
  let branchB: Types.ObjectId;
  let branchC: Types.ObjectId;
  let hq: Person;
  let managerA: Person;
  let managerB: Person;
  let managerC: Person;
  let helperB: Person;
  let clerkA: Person;
  let supervisorA: Person;
  let admin: Person;
  let game: Types.ObjectId;
  let gameCode: string;
  let account: Types.ObjectId;
  let publishBadge: jest.SpiedFunction<RealtimePublisher["publishBadge"]>;
  let notify: jest.SpiedFunction<NotificationService["notify"]>;

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

  /** 同時屬於出貨店(中山店)與最上層組織的人;登入後當前組織 = 中山店。 */
  async function dualPerson(
    connection: AuthTestApp["connection"],
    permissionKeys: string[],
  ): Promise<Person> {
    dualSequence += 1;
    const account = `transfer-dual-${String(dualSequence)}`;
    const userId = await createUser(connection, {
      account,
      password: PASSWORD,
      orgIds: [branchA, tenant],
    });
    await createRole(api.app, connection, {
      name: `調貨測試角色 ${account}`,
      ownerOrgId: tenant,
      moduleKeys: [
        ...TRANSFER_MODULE_KEYS,
        "apply-center",
        "apply-center.view-page",
      ],
      permissionKeys,
      assignTo: [userId],
    });
    return { userId, account, token: await login(api, account, PASSWORD) };
  }

  /** 點收一本到某家店(100 張,整本金額 2,000;成本率 100、成本 2,000 → 單張 20)。 */
  async function newBook(orgId: Types.ObjectId): Promise<{
    bookId: Types.ObjectId;
    bookNo: string;
  }> {
    bookSequence += 1;
    const bookNo = String(bookSequence).padStart(6, "0");
    const { book } = await transactions().withTransaction((session) =>
      api.app
        .get(LotteryBooksService)
        .createBook(session, storeOperator(orgId), {
          orgId,
          gameId: game,
          bookNo,
          lastTicketNo: 100,
          rate: 100,
          cost: 2000,
        }),
    );
    return { bookId: book._id, bookNo: `0${bookNo}` };
  }

  async function ticketsOf(bookId: Types.ObjectId): Promise<TicketRow[]> {
    return db()
      .collection<TicketRow>("lottery_tickets")
      .find({ bookId })
      .sort({ ticketNo: 1 })
      .toArray();
  }

  /** 拆本:前 10 張移到檯面(之後只能選張)。 */
  async function openBook(
    orgId: Types.ObjectId,
    bookId: Types.ObjectId,
  ): Promise<void> {
    const all = await ticketsOf(bookId);
    const tickets = all.slice(0, 10);
    const cashPointId = new Types.ObjectId();
    await transactions().withTransaction((session) =>
      api.app.get(TicketLedgerService).applyTicketEvents(
        session,
        { operator: storeOperator(orgId) },
        tickets.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          type: "open" as const,
          patch: { location: { kind: "counter" as const, cashPointId } },
        })),
      ),
    );
  }

  function whole(bookId: Types.ObjectId, overrides: Partial<Line> = {}): Line {
    rowSequence += 1;
    return {
      rowId: `00000000-0000-4000-9000-${String(rowSequence).padStart(12, "0")}`,
      game: String(game),
      book: String(bookId),
      mode: "whole",
      ticket_nos: "001-100",
      tickets: 100,
      amount: 2000,
      rate: 100,
      ...overrides,
    };
  }

  function partial(
    bookId: Types.ObjectId,
    from: number,
    to: number,
    overrides: Partial<Line> = {},
  ): Line {
    const count = to - from + 1;
    return whole(bookId, {
      mode: "partial",
      ticket_nos: `${String(from).padStart(3, "0")}-${String(to).padStart(3, "0")}`,
      tickets: count,
      amount: 20 * count,
      rate: 92,
      ...overrides,
    });
  }

  function header(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      from_branch: String(branchA),
      to_branch: String(branchB),
      ...overrides,
    };
  }

  async function draftOf(
    who: Person,
    lines: Line[],
    overrides: Record<string, unknown> = {},
  ): Promise<SubmissionRow> {
    return createDraft(api, who.token, FORM, { ...header(overrides), lines });
  }

  /** 送出;擋下時回 reason(或 code),成功回 null。 */
  async function trySubmit(
    who: Person,
    lines: Line[],
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; blocked: string | null }> {
    const draft = await draftOf(who, lines, overrides);
    const result = await call(api, who.token, SUBMIT_SUBMISSION, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    const errors = result.errors ? extensionsOf(result) : null;
    return {
      id: draft.id,
      blocked: errors === null ? null : reasonOf(errors),
    };
  }

  async function submit(
    who: Person,
    lines: Line[],
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const { id, blocked } = await trySubmit(who, lines, overrides);
    expect(blocked).toBeNull();
    return id;
  }

  async function blockedOf(
    who: Person,
    lines: Line[],
    overrides: Record<string, unknown> = {},
  ): Promise<string | null> {
    const { blocked } = await trySubmit(who, lines, overrides);
    return blocked;
  }

  async function everyTicket(
    bookId: Types.ObjectId,
    predicate: (ticket: TicketRow) => boolean,
  ): Promise<boolean> {
    const tickets = await ticketsOf(bookId);
    return tickets.every((ticket) => predicate(ticket));
  }

  async function eventTypes(ticketId: Types.ObjectId): Promise<string[]> {
    const events = await eventsOf(ticketId);
    return events.map((event) => event.type);
  }

  async function eventTrail(ticketId: Types.ObjectId): Promise<string[][]> {
    const events = await eventsOf(ticketId);
    return events.map((event) => [event.type, String(event.orgId)]);
  }

  async function current(id: string): Promise<SubmissionRow> {
    const doc = await db()
      .collection("form_submissions")
      .findOne({ _id: new Types.ObjectId(id) });
    return {
      id,
      editVersion: Number(doc?.editVersion ?? 0),
      status: String(doc?.status ?? ""),
      revision: Number(doc?.revision ?? 0),
    } as SubmissionRow;
  }

  /** 第一關:出貨店店長確認出貨。 */
  async function ship(id: string): Promise<void> {
    await decideOn(world(), managerA, id, "APPROVE");
  }

  async function receive(
    who: Person,
    submissionId: string,
    code: string,
  ): Promise<Record<string, unknown>> {
    const result = await call(api, who.token, RECEIVE, {
      input: { submissionId, code },
    });
    return result.errors ? extensionsOf(result) : {};
  }

  async function decideBlocked(
    who: Person,
    id: string,
    decision: "APPROVE" | "REJECT",
  ): Promise<string | null> {
    const task = await pendingTaskOf(world(), who, id);
    const result = await call(api, who.token, DECIDE_MUTATION, {
      input: {
        taskId: task.id,
        expectedEditVersion: task.editVersion,
        decision,
        ...(decision === "REJECT" ? { comment: "理由" } : {}),
      },
    });
    return result.errors ? reasonOf(extensionsOf(result)) : null;
  }

  async function settlementOf(id: string, who = hq): Promise<Settlement> {
    const data = await ok<{ lotterySettlement: { item: Settlement } }>(
      api,
      who.token,
      SETTLEMENT,
      { moduleKey: MODULE, refId: id },
    );
    return data.lotterySettlement.item;
  }

  /** 四顆按鈕的先填值:B 付款 / B 收到退款 / A 收款 / A 退款。 */
  async function buttonsOf(id: string) {
    const item = await settlementOf(id);
    const of = (side: string, button: string): number =>
      item.sides
        .find((row) => row.side === side)
        ?.buttons.find((row) => row.button === button)?.defaultAmount ?? -1;
    return {
      pay: of("receiver", "out"),
      refundIn: of("receiver", "in"),
      collect: of("shipper", "in"),
      refundOut: of("shipper", "out"),
    };
  }

  /** 三個數字:調貨金額、收貨店已付、出貨店已收。 */
  async function numbersOf(id: string) {
    const item = await settlementOf(id);
    const net = (side: string) =>
      item.sides.find((row) => row.side === side)?.net ?? 0;
    return {
      amount: item.payable,
      paid: net("receiver"),
      received: net("shipper"),
    };
  }

  async function record(
    who: Person,
    id: string,
    side: "receiver" | "shipper",
    button: "out" | "in",
    amount: number,
    method: "bank" | "cash" = "bank",
  ): Promise<Record<string, unknown>> {
    const result = await call(api, who.token, RECORD, {
      input: {
        moduleKey: MODULE,
        refId: id,
        side,
        button,
        method,
        amount,
        ...(method === "bank"
          ? { accountId: String(account) }
          : { cashSource: "vault", handler: "王小明(送貨人)" }),
      },
    });
    return result.errors ? extensionsOf(result) : {};
  }

  async function eventsOf(
    ticketId: Types.ObjectId,
  ): Promise<{ type: string; orgId: Types.ObjectId }[]> {
    return db()
      .collection<{ type: string; orgId: Types.ObjectId }>(
        "lottery_ticket_events",
      )
      .find({ ticketId })
      .sort({ at: 1, _id: 1 })
      .toArray();
  }

  async function badgeOf(who: Person): Promise<number> {
    const data = await ok<{
      sidebarBadges: { moduleKey: string; count: number }[];
    }>(api, who.token, BADGES);
    return (
      data.sidebarBadges.find((badge) => badge.moduleKey === MODULE)?.count ?? 0
    );
  }

  function badgeSignalsTo(who: Person): number {
    return publishBadge.mock.calls.filter(
      ([, moduleKey, users]) =>
        moduleKey === MODULE &&
        users.some((id) => String(id) === String(who.userId)),
    ).length;
  }

  /** 對這張單送過幾次「調貨出貨通知」(收貨店、負責人提醒)。 */
  function shippedNotices(id: string): number {
    return notify.mock.calls.filter(
      ([input]) =>
        input.type === "lottery.transfer-shipped" &&
        input.dedupeKey.startsWith(`transfer-shipped:${id}:`) &&
        String(input.orgId) === String(branchB),
    ).length;
  }

  /** 直接記一筆收付(模擬銀行 [登記交易] 掛單據;按鈕在點收前都停用)。 */
  async function insertSettlementRow(
    id: string,
    direction: "in" | "out",
    amount: number,
  ): Promise<void> {
    const now = new Date();
    await db()
      .collection("lottery_bank_transactions")
      .insertOne({
        orgId: tenant,
        tenantId: tenant,
        accountId: account,
        occurredAt: now,
        type: direction === "out" ? "transfer_expense" : "transfer_income",
        direction,
        amount,
        branchOrgId: branchB,
        refType: MODULE,
        refId: new Types.ObjectId(id),
        refRevision: 1,
        settlementSide: "receiver",
        reversalOf: null,
        summary: "測試",
        handler: null,
        note: null,
        moduleKey: "accounts",
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
  }

  /** 沖正這張單的人工收付(兩邊各自的人沖自己那一邊),淨額歸 0。 */
  async function reverseAll(id: string): Promise<void> {
    const rows = await db()
      .collection<{ _id: Types.ObjectId; settlementSide: string }>(
        "lottery_bank_transactions",
      )
      .find({ refId: new Types.ObjectId(id), reversalOf: null })
      .toArray();
    for (const row of rows) {
      const who = row.settlementSide === "receiver" ? managerB : managerA;
      await ok(api, who.token, REVERSE, {
        input: { id: String(row._id), method: "bank", reason: "測試沖正" },
      });
    }
  }

  /** 送出(總部)→ 出貨 → 收貨店把每本都點收。 */
  async function shippedAndReceived(
    books: { bookId: Types.ObjectId; bookNo: string }[],
  ): Promise<string> {
    const id = await submit(
      hq,
      books.map((book) => whole(book.bookId)),
    );
    await ship(id);
    for (const book of books) {
      expect(await receive(managerB, id, codeOf(book.bookNo))).toEqual({});
    }
    return id;
  }

  /** 收付記平:收貨店付、出貨店收(調貨金額)。 */
  async function settle(id: string, amount: number): Promise<void> {
    expect(await record(managerB, id, "receiver", "out", amount)).toEqual({});
    expect(await record(managerA, id, "shipper", "in", amount)).toEqual({});
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-transfer");
    const { connection } = api;
    await seedTransferAuthorization(connection);
    await seedInventoryModule(connection);
    publishBadge = jest.spyOn(api.app.get(RealtimePublisher), "publishBadge");
    notify = jest.spyOn(api.app.get(NotificationService), "notify");
    const root = await rootToken(api);
    tenant = await createOrg(connection, {
      name: "好運彩券行",
      settings: { visibility: "subtree" },
    });
    branchA = await createOrg(connection, { name: "中山店", parentId: tenant });
    branchB = await createOrg(connection, { name: "新竹店", parentId: tenant });
    branchC = await createOrg(connection, { name: "台中店", parentId: tenant });

    const modules = [
      ...TRANSFER_MODULE_KEYS,
      "apply-center",
      "apply-center.view-page",
    ];
    const all = Object.values(TRANSFER_PERMISSION_KEYS);
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
    hq = await person(api, connection, tenant, tenant, {
      moduleKeys: [...modules, "inventory"],
      permissionKeys: [...all, "apply-center.view"],
    });
    const managerScope = {
      moduleKeys: modules,
      permissionKeys: [...all, "apply-center.view"],
    };
    managerA = await person(api, connection, branchA, tenant, managerScope);
    managerB = await person(api, connection, branchB, tenant, managerScope);
    managerC = await person(api, connection, branchC, tenant, managerScope);
    helperB = await person(api, connection, branchB, tenant, managerScope);
    // 出貨店的人要選得到收貨分店(組織引用照可見範圍):同時屬於出貨店與最上層組織、當前組織 = 出貨店
    clerkA = await dualPerson(connection, [
      TRANSFER_PERMISSION_KEYS.view,
      TRANSFER_PERMISSION_KEYS.create,
      "apply-center.view",
    ]);
    supervisorA = await dualPerson(connection, [...all, "apply-center.view"]);
    const storeManager = await createRole(api.app, connection, {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [managerA.userId, managerB.userId, managerC.userId],
    });

    await ok(api, root, CREATE_FORM, {
      input: { key: FORM, moduleKey: MODULE, name: "調貨單" },
    });
    await publishDefinition(api, root, FORM, transferDefinition(), null);
    await ok(api, root, ASSIGN, {
      input: { formKey: FORM, tenantOrgIds: [String(tenant)] },
    });
    // 開通腳本建的流程:第一關 店長限定「出貨分店」(申請人當前組織 = 出貨分店時跳過);
    // 第二關 店長限定「收貨分店」
    const flow = { api, connection, admin } as unknown as World;
    await publishWorkflow(flow, "transfer_flow", {
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
          {
            skipWhen: {
              "==": [{ var: "ctx.user.orgId" }, { var: "from_branch" }],
            },
          },
        ),
        reviewStep(
          "receive",
          audienceSource(
            audienceRow("role", [storeManager]),
            audienceRow("org", {
              kind: "dynamic",
              ref: "form-field:to_branch",
            }),
          ),
        ),
      ],
      checkFormKey: FORM,
    });
    await bindForm(flow, "transfer_flow", FORM);

    gameCode = "5164";
    game = await insertGame(connection, tenant, {
      gameCode,
      name: "發大財",
      unitPrice: 20,
      ticketsPerBook: 100,
    });
    account = await insertBankAccount(connection, tenant, tenant);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    publishBadge.mockRestore();
    notify.mockRestore();
    await api.close();
  });

  describe("新增頁的選項", () => {
    it("出貨店能調的本(整本 / 只能選張)、成本率;收貨店待購買的叫貨單;格子每一張能不能調", async () => {
      const intact = await newBook(branchA);
      const opened = await newBook(branchA);
      await openBook(branchA, opened.bookId);
      await insertRequisition(db(), tenant, branchB, "R-7001", [
        { gameId: game, books: 2 },
      ]);
      const data = await ok<{
        lotteryTransferOptions: {
          books: {
            bookId: string;
            isWhole: boolean;
            availableCount: number;
            rate: number;
          }[];
          requisitions: { serialNo: string; books: number }[];
          allocations: {
            gameId: string;
            plannedBooks: number | null;
            givenBooks: number;
            inTransitBooks: number;
          }[];
        };
      }>(api, managerA.token, OPTIONS, {
        from: String(branchA),
        to: String(branchB),
      });
      const options = data.lotteryTransferOptions;
      expect(
        options.books.find((book) => book.bookId === String(intact.bookId)),
      ).toEqual({
        bookId: String(intact.bookId),
        isWhole: true,
        availableCount: 100,
        rate: 100,
      });
      expect(
        options.books.find((book) => book.bookId === String(opened.bookId)),
      ).toMatchObject({ isWhole: false, availableCount: 100 });
      expect(options.requisitions).toContainEqual({
        serialNo: "R-7001",
        books: 2,
      });
      // 收貨店的預計要給本數 / 已給 / 在途(新增頁「超過只警告」用;規格 7.6)
      await db().collection("lottery_allocations").insertOne({
        orgId: branchB,
        tenantId: tenant,
        gameId: game,
        plannedBooks: 3,
        note: null,
        moduleKey: "inventory",
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
      const withPlan = await ok<{
        lotteryTransferOptions: {
          allocations: {
            gameId: string;
            plannedBooks: number | null;
            inTransitBooks: number;
          }[];
        };
      }>(api, managerA.token, OPTIONS, {
        from: String(branchA),
        to: String(branchB),
      });
      expect(withPlan.lotteryTransferOptions.allocations).toEqual([
        expect.objectContaining({
          gameId: String(game),
          plannedBooks: 3,
          inTransitBooks: 2,
        }),
      ]);
      // 看不到的出貨店 → NOT_FOUND
      const hidden = await call(api, managerB.token, OPTIONS, {
        from: String(branchA),
      });
      expect(extensionsOf(hidden).code).toBe("NOT_FOUND");
      const cells = await ok<{
        lotteryTransferBookTickets: { ticketNo: string; state: string }[];
      }>(api, managerA.token, BOOK_TICKETS, {
        from: String(branchA),
        book: String(opened.bookId),
      });
      expect(cells.lotteryTransferBookTickets).toHaveLength(100);
      expect(
        cells.lotteryTransferBookTickets.every(
          (cell) => cell.state === "available",
        ),
      ).toBe(true);
    });
  });

  describe("送出前(規格 8.4 掛接點表)", () => {
    it("本和張都在出貨店才能送;不在出貨店 / 已在其他未結束的調貨單上 → 擋下", async () => {
      const inB = await newBook(branchB);
      expect(await blockedOf(hq, [whole(inB.bookId)])).toBe(
        "TRANSFER_TICKETS_UNAVAILABLE",
      );
      const book = await newBook(branchA);
      await submit(hq, [whole(book.bookId)]);
      // 同一本已被送出的調貨單鎖定
      expect(await blockedOf(hq, [whole(book.bookId)])).toBe(
        "TRANSFER_TICKETS_UNAVAILABLE",
      );
      // 退回後(還沒出貨的解鎖),仍在那張未結束的調貨單上 → 照樣擋
      const other = await newBook(branchA);
      const first = await submit(hq, [whole(other.bookId)]);
      await decideOn(world(), managerA, first, "RETURN");
      expect(
        await everyTicket(other.bookId, (ticket) => ticket.lockedBy === null),
      ).toBe(true);
      expect(await blockedOf(hq, [whole(other.bookId)])).toBe(
        "TRANSFER_TICKETS_UNAVAILABLE",
      );
    });

    it("出貨分店 = 收貨分店、方式不合(沒拆過的本選張 / 拆過的本整本)、金額不合 → 擋下", async () => {
      const book = await newBook(branchA);
      expect(
        await blockedOf(hq, [whole(book.bookId)], {
          to_branch: String(branchA),
        }),
      ).toBe("TRANSFER_BRANCH_INVALID");
      expect(await blockedOf(hq, [partial(book.bookId, 12, 16)])).toBe(
        "TRANSFER_LINE_INVALID",
      );
      expect(await blockedOf(hq, [whole(book.bookId, { amount: 1999 })])).toBe(
        "TRANSFER_LINE_INVALID",
      );
      const opened = await newBook(branchA);
      await openBook(branchA, opened.bookId);
      expect(await blockedOf(hq, [whole(opened.bookId)])).toBe(
        "TRANSFER_LINE_INVALID",
      );
      expect(await blockedOf(hq, [partial(opened.bookId, 12, 16)])).toBeNull();
    });

    it("沒有 `partial-tickets` 不能選張(L784)", async () => {
      const opened = await newBook(branchA);
      await openBook(branchA, opened.bookId);
      expect(await blockedOf(clerkA, [partial(opened.bookId, 20, 22)])).toBe(
        "TRANSFER_PARTIAL_FORBIDDEN",
      );
    });

    it("叫貨單要是收貨分店、待購買的", async () => {
      await insertRequisition(db(), tenant, branchA, "R-7101", [
        { gameId: game, books: 1 },
      ]);
      const book = await newBook(branchA);
      expect(
        await blockedOf(hq, [whole(book.bookId)], { requisition: "R-7101" }),
      ).toBe("TRANSFER_REQUISITION_INVALID");
    });
  });

  describe("送出後(規格 8.4)", () => {
    it("鎖定 = 調貨中、不能賣(帳本售出 → CONFLICT);叫貨單 → 已調貨", async () => {
      const requisitionId = await insertRequisition(
        db(),
        tenant,
        branchB,
        "R-7201",
        [{ gameId: game, books: 1 }],
      );
      const book = await newBook(branchA);
      const id = await submit(hq, [whole(book.bookId)], {
        requisition: "R-7201",
      });
      const tickets = await ticketsOf(book.bookId);
      expect(
        tickets.every(
          (ticket) =>
            ticket.lockedBy?.refType === "transfer" &&
            String(ticket.lockedBy.refId) === id,
        ),
      ).toBe(true);
      const [first] = tickets;
      await expect(
        transactions().withTransaction((session) =>
          api.app
            .get(TicketLedgerService)
            .applyTicketEvents(session, { operator: storeOperator(branchA) }, [
              {
                ticketId: first?._id ?? new Types.ObjectId(),
                expectedVersion: first?.version ?? 0,
                type: "sale",
                patch: { status: "sold" },
              },
            ]),
        ),
      ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
      const line = await db()
        .collection("lottery_requisition_lines")
        .findOne({ requisitionId });
      expect(line?.referencedBy).toMatchObject({ type: "transfer" });
    });

    it("草稿不鎖定、不算在途", async () => {
      const book = await newBook(branchA);
      await draftOf(hq, [whole(book.bookId)]);
      expect(
        await everyTicket(book.bookId, (ticket) => ticket.lockedBy === null),
      ).toBe(true);
    });
  });

  describe("第一關通過後(含跳過)", () => {
    it("總部送出 → 店長確認出貨:在途 + 「調出」事件 + 調貨出貨通知;收貨店的在途本數 +1", async () => {
      const book = await newBook(branchA);
      const id = await submit(hq, [whole(book.bookId)]);
      const before = await inTransitBooksOf({
        tenantId: tenant,
        orgId: branchB,
      });
      expect(shippedNotices(id)).toBe(0);
      await ship(id);
      const tickets = await ticketsOf(book.bookId);
      expect(
        tickets.every((ticket) => ticket.location.kind === "in_transit"),
      ).toBe(true);
      expect(await eventTypes(nthTicket(tickets, 0)._id)).toEqual([
        "purchase",
        "transfer_out",
      ]);
      expect(shippedNotices(id)).toBe(1);
      const after = await inTransitBooksOf({
        tenantId: tenant,
        orgId: branchB,
      });
      expect(after.get(String(game))).toBe(before.get(String(game)) ?? 0);
      expect(after.get(String(game))).toBeGreaterThanOrEqual(1);
    });

    it("當前組織是出貨店的人送出 → 第一關跳過(skipped)也寫調出與通知", async () => {
      const book = await newBook(branchA);
      const id = await submit(supervisorA, [whole(book.bookId)]);
      const tickets = await ticketsOf(book.bookId);
      expect(
        tickets.every((ticket) => ticket.location.kind === "in_transit"),
      ).toBe(true);
      expect(shippedNotices(id)).toBe(1);
      // 直接到第二關:收貨店店長的任務
      expect(
        await pendingTaskOf(world(), managerB, id).then(
          (value) => value.submissionId,
        ),
      ).toBe(id);
    });
  });

  describe("點收一本", () => {
    it("改為收貨店庫存 + 「調入」事件,單張成本 = 該列批購金額 ÷ 張數;選張只搬選的張", async () => {
      const opened = await newBook(branchA);
      await openBook(branchA, opened.bookId);
      const id = await submit(hq, [partial(opened.bookId, 12, 16)]);
      // 第一關還沒通過 → 收貨店沒有點收任務
      expect(
        await receive(managerB, id, codeOf(opened.bookNo, 12)),
      ).toMatchObject({ reason: "TRANSFER_NOT_RECEIVABLE" });
      await ship(id);
      expect(
        await receive(managerB, id, codeOf(opened.bookNo, 50)),
      ).toMatchObject({ reason: "TRANSFER_BOOK_NOT_ON_TRANSFER" });
      expect(await receive(managerB, id, codeOf(opened.bookNo, 13))).toEqual(
        {},
      );
      const tickets = await ticketsOf(opened.bookId);
      const moved = tickets.filter((ticket) => ticket.orgId.equals(branchB));
      expect(moved.map((ticket) => ticket.ticketNo)).toEqual([
        "012",
        "013",
        "014",
        "015",
        "016",
      ]);
      // 5 張 × 20 × 92% = 92 → 單張 18.4
      expect(
        moved.every((ticket) => Math.abs(ticket.unitCost - 18.4) < 1e-9),
      ).toBe(true);
      expect(
        moved.every(
          (ticket) =>
            ticket.location.kind === "stock" && ticket.lockedBy === null,
        ),
      ).toBe(true);
      expect(await eventTrail(nthTicket(moved, 0)._id)).toEqual([
        ["purchase", String(branchA)],
        ["transfer_out", String(branchA)],
        ["transfer_in", String(branchB)],
      ]);
      expect(
        await receive(managerB, id, codeOf(opened.bookNo, 14)),
      ).toMatchObject({ reason: "TRANSFER_ALREADY_RECEIVED" });
      // 不是點收任務的人
      expect(
        await receive(managerC, id, codeOf(opened.bookNo, 14)),
      ).toMatchObject({ code: "NOT_FOUND" });
      const receiving = await ok<{
        lotteryTransferReceiving: {
          receivedCount: number;
          totalCount: number;
          rows: { ticketNos: string[]; shipped: boolean; received: boolean }[];
        };
      }>(api, managerA.token, RECEIVING, { id });
      expect(receiving.lotteryTransferReceiving).toMatchObject({
        receivedCount: 1,
        totalCount: 1,
        rows: [
          {
            ticketNos: ["012", "013", "014", "015", "016"],
            shipped: true,
            received: true,
          },
        ],
      });
    });

    it("送錯分店:刷到送往別家店的調貨單上的本 → 擋下、不入庫,錯誤帶那家店與單號", async () => {
      const book = await newBook(branchA);
      const toC = await submit(hq, [whole(book.bookId)], {
        to_branch: String(branchC),
      });
      await ship(toC);
      const other = await newBook(branchA);
      const toB = await submit(hq, [whole(other.bookId)]);
      await ship(toB);
      const result = await receive(managerB, toB, codeOf(book.bookNo));
      expect(result).toMatchObject({
        reason: "TRANSFER_WRONG_STORE",
        ownerBranchName: "台中店",
      });
      expect(
        await everyTicket(book.bookId, (ticket) =>
          ticket.orgId.equals(branchA),
        ),
      ).toBe(true);
      // [通知總部更正] → 那張(送往台中店的)調貨單的建立者收到當事人通知,連到調貨單詳情
      const before = notify.mock.calls.length;
      await ok(api, managerB.token, NOTIFY_WRONG_STORE, {
        input: { submissionId: toB, code: codeOf(book.bookNo) },
      });
      const sent = notify.mock.calls.slice(before).map(([input]) => input);
      expect(sent).toEqual([
        expect.objectContaining({
          type: "lottery.transfer-wrong-store",
          recipients: { kind: "users", userIds: [hq.userId] },
          params: expect.objectContaining({ orgName: "新竹店" }),
          ref: { type: "lottery-transfer", id: toC },
          dedupeKey: expect.stringMatching(
            new RegExp(`^transfer-wrong-store:${toC}:.+:${toB}$`),
          ),
        }),
      ]);
      // 不是別家店調貨單上的本 → NOT_FOUND
      const missing = await call(api, managerB.token, NOTIFY_WRONG_STORE, {
        input: { submissionId: toB, code: "0099999010" },
      });
      expect(extensionsOf(missing).code).toBe("NOT_FOUND");
    });
  });

  describe("核准前(點收關卡)", () => {
    it("還有沒點收的列 → 擋下;全部點收後,三個數字不相等 → 擋下並提示哪一邊;相等才能核准", async () => {
      const first = await newBook(branchA);
      const second = await newBook(branchA);
      const id = await submit(hq, [whole(first.bookId), whole(second.bookId)]);
      await ship(id);
      await receive(managerB, id, codeOf(first.bookNo));
      expect(await decideBlocked(managerB, id, "APPROVE")).toBe(
        "TRANSFER_UNRECEIVED_ROWS",
      );
      await receive(managerB, id, codeOf(second.bookNo));
      expect(await decideBlocked(managerB, id, "APPROVE")).toBe(
        "TRANSFER_RECEIVER_UNDERPAID",
      );
      await record(managerB, id, "receiver", "out", 5000);
      expect(await decideBlocked(managerB, id, "APPROVE")).toBe(
        "TRANSFER_SHIPPER_UNRECEIVED",
      );
      await record(managerA, id, "shipper", "in", 5000);
      expect(await decideBlocked(managerB, id, "APPROVE")).toBe(
        "TRANSFER_SHIPPER_OVERRECEIVED",
      );
      await record(managerA, id, "shipper", "out", 1000);
      expect(await decideBlocked(managerB, id, "APPROVE")).toBe(
        "TRANSFER_RECEIVER_OVERPAID",
      );
      await record(managerB, id, "receiver", "in", 1000);
      expect(await decideBlocked(managerB, id, "APPROVE")).toBeNull();
      expect(await current(id).then((value) => value.status)).toBe("completed");
    });
  });

  describe("退回 / 撤回後", () => {
    it("還沒出貨的解除鎖定;已在途的保持在途;結算紀錄保留", async () => {
      const book = await newBook(branchA);
      const notShipped = await submit(hq, [whole(book.bookId)]);
      const row = await current(notShipped);
      await ok(api, hq.token, WITHDRAW, {
        input: { id: notShipped, expectedEditVersion: row.editVersion },
      });
      expect(
        await everyTicket(book.bookId, (ticket) => ticket.lockedBy === null),
      ).toBe(true);

      const receivedBook = await newBook(branchA);
      const shippedBook = await newBook(branchA);
      const shipped = await submit(hq, [
        whole(receivedBook.bookId),
        whole(shippedBook.bookId),
      ]);
      await ship(shipped);
      await receive(managerB, shipped, codeOf(receivedBook.bookNo));
      expect(await record(managerB, shipped, "receiver", "out", 500)).toEqual(
        {},
      );
      await decideOn(world(), managerB, shipped, "RETURN");
      expect(await current(shipped).then((value) => value.status)).toBe(
        "returned",
      );
      const tickets = await ticketsOf(shippedBook.bookId);
      expect(
        tickets.every(
          (ticket) =>
            ticket.location.kind === "in_transit" && ticket.lockedBy !== null,
        ),
      ).toBe(true);
      expect(await numbersOf(shipped).then((value) => value.paid)).toBe(500);
    });
  });

  describe("出貨時間(調貨出貨單只印這次才出貨的列;使用者 10/21 定案)", () => {
    it("第一次出貨 5 本 → 都有出貨時間;退回補 2 本重送 → 只有那 2 本換新時間;再退回、沒新增就重送 → 時間都不變", async () => {
      const books = [];
      for (let index = 0; index < 7; index += 1) {
        books.push(await newBook(branchA));
      }
      const lines = books.map((book) => whole(book.bookId));
      const id = await submit(hq, lines.slice(0, 5));
      await ship(id);
      const shippedAtOf = async () => {
        const data = await ok<{
          lotteryTransferReceiving: {
            rows: { rowId: string; shippedAt: string | null }[];
          };
        }>(api, hq.token, RECEIVING, { id });
        return new Map(
          data.lotteryTransferReceiving.rows.map((row) => [
            row.rowId,
            row.shippedAt,
          ]),
        );
      };
      const first = await shippedAtOf();
      expect([...first.values()].every((at) => at !== null)).toBe(true);
      // 5 本都點收了(在途沒點收的整本列重送會被送出前檢查擋下,另案)
      for (const book of books.slice(0, 5)) {
        expect(await receive(managerB, id, codeOf(book.bookNo))).toEqual({});
      }

      const resubmit = async (next: Line[]) => {
        await decideOn(world(), managerB, id, "RETURN");
        const row = await current(id);
        const saved = await call<{
          saveFormDraft: { submission: { editVersion: number } };
        }>(api, hq.token, SAVE_SUBMISSION, {
          input: {
            id,
            expectedEditVersion: row.editVersion,
            values: { ...header(), lines: next },
          },
        });
        await ok(api, hq.token, SUBMIT_SUBMISSION, {
          input: {
            id,
            expectedEditVersion:
              saved.data?.saveFormDraft.submission.editVersion,
          },
        });
        await ship(id);
      };
      await resubmit(lines);
      const second = await shippedAtOf();
      for (const line of lines.slice(0, 5)) {
        expect(second.get(line.rowId)).toBe(first.get(line.rowId));
      }
      const added = lines.slice(5).map((line) => second.get(line.rowId));
      expect(added.every((at) => at !== null && at !== undefined)).toBe(true);
      const firstLatest = Math.max(
        ...[...first.values()].map((at) => Date.parse(at ?? "")),
      );
      expect(added.every((at) => Date.parse(at ?? "") > firstLatest)).toBe(
        true,
      );

      for (const book of books.slice(5)) {
        expect(await receive(managerB, id, codeOf(book.bookNo))).toEqual({});
      }
      await resubmit(lines);
      expect(await shippedAtOf()).toEqual(second);
    });
  });

  describe("在途的列被刪除", () => {
    it("退回後刪掉在途的那一列再送出 → 那幾張待查,責任分店 = 出貨店;規格第 9 章 5 步驟例逐步驗證", async () => {
      const books = [
        await newBook(branchA),
        await newBook(branchA),
        await newBook(branchA),
        await newBook(branchA),
        await newBook(branchA),
      ];
      const lines = books.map((book) => whole(book.bookId));
      const id = await submit(hq, lines);
      await ship(id);
      for (const book of books.slice(0, 4)) {
        expect(await receive(managerB, id, codeOf(book.bookNo))).toEqual({});
      }
      // 第 5 本遺失:退回,刪掉那一列再送出(總部重送 → 第一關照樣派給出貨店;都已出貨)
      await decideOn(world(), managerB, id, "RETURN");
      const row = await current(id);
      const saved = await call<{
        saveFormDraft: { submission: { id: string; editVersion: number } };
      }>(api, hq.token, SAVE_SUBMISSION, {
        input: {
          id,
          expectedEditVersion: row.editVersion,
          values: { ...header(), lines: lines.slice(0, 4) },
        },
      });
      const submission = saved.data?.saveFormDraft.submission;
      await ok(api, hq.token, SUBMIT_SUBMISSION, {
        input: { id, expectedEditVersion: submission?.editVersion },
      });
      const lost = await ticketsOf(nthBook(books, 4).bookId);
      expect(
        lost.every(
          (ticket) =>
            ticket.status === "investigating" &&
            String(ticket.responsibleOrgId) === String(branchA) &&
            ticket.lockedBy === null,
        ),
      ).toBe(true);
      await ship(id);

      // 步驟 1:調貨金額 8,000;B [付款] 8,000
      expect(await numbersOf(id)).toEqual({
        amount: 8000,
        paid: 0,
        received: 0,
      });
      expect(await buttonsOf(id)).toEqual({
        pay: 8000,
        refundIn: 0,
        collect: 0,
        refundOut: 0,
      });
      // 步驟 2:B 付現 10,000(付給送貨人)→ A [收款] 10,000;B [收到退款] 2,000;N 待出貨店入帳
      expect(
        await record(managerB, id, "receiver", "out", 10_000, "cash"),
      ).toEqual({});
      expect(await numbersOf(id)).toEqual({
        amount: 8000,
        paid: 10_000,
        received: 0,
      });
      expect(await buttonsOf(id)).toEqual({
        pay: 0,
        refundIn: 2000,
        collect: 10_000,
        refundOut: 0,
      });
      expect(await settlementOf(id).then((value) => value.pendingPayee)).toBe(
        10_000,
      );
      // 現金那一筆帶現金從哪裡出(付款收據印「付款店 · 小金庫」);銀行的沒有
      expect(await settlementOf(id).then((value) => value.records)).toEqual([
        {
          method: "cash",
          side: "receiver",
          direction: "out",
          cashPlace: "vault",
          handler: "王小明(送貨人)",
        },
      ]);
      // 步驟 3:A 收款 10,000 → A [退款] 2,000
      await record(managerA, id, "shipper", "in", 10_000);
      expect(await buttonsOf(id)).toEqual({
        pay: 0,
        refundIn: 2000,
        collect: 0,
        refundOut: 2000,
      });
      // 步驟 4:A 退款 2,000 → A 兩顆都停用
      await record(managerA, id, "shipper", "out", 2000);
      expect(await numbersOf(id)).toEqual({
        amount: 8000,
        paid: 10_000,
        received: 8000,
      });
      expect(await buttonsOf(id)).toEqual({
        pay: 0,
        refundIn: 2000,
        collect: 0,
        refundOut: 0,
      });
      // 步驟 5:B 收到退款 2,000 → 全部停用;三個數字相等,可以核准
      await record(managerB, id, "receiver", "in", 2000);
      expect(await numbersOf(id)).toEqual({
        amount: 8000,
        paid: 8000,
        received: 8000,
      });
      expect(await buttonsOf(id)).toEqual({
        pay: 0,
        refundIn: 0,
        collect: 0,
        refundOut: 0,
      });
      // 停用的按鈕不能記
      expect(await record(managerB, id, "receiver", "out", 100)).toMatchObject({
        reason: "SETTLEMENT_NOTHING_DUE",
      });
      expect(await decideBlocked(managerB, id, "APPROVE")).toBeNull();
    });
  });

  describe("收付", () => {
    it("分次付款例:A [收款] 先填 6,000 → 停用 → 2,000 → 停用", async () => {
      const books = [];
      for (let index = 0; index < 4; index += 1) {
        books.push(await newBook(branchA));
      }
      const id = await shippedAndReceived(books);
      expect(await numbersOf(id).then((value) => value.amount)).toBe(8000);
      await record(managerB, id, "receiver", "out", 6000);
      expect(await buttonsOf(id).then((value) => value.collect)).toBe(6000);
      await record(managerA, id, "shipper", "in", 6000);
      expect(await buttonsOf(id).then((value) => value.collect)).toBe(0);
      await record(managerB, id, "receiver", "out", 2000);
      expect(await buttonsOf(id).then((value) => value.collect)).toBe(2000);
      await record(managerA, id, "shipper", "in", 2000);
      expect(await buttonsOf(id).then((value) => value.collect)).toBe(0);
      expect(await numbersOf(id)).toEqual({
        amount: 8000,
        paid: 8000,
        received: 8000,
      });
    });

    it("兩邊店都看得到收付;只能記自己那一邊;沒有 `pay` / `receive` 的人按鈕不能用(L784)", async () => {
      const book = await newBook(branchA);
      const id = await submit(hq, [whole(book.bookId)]);
      await ship(id);
      // 收貨店看得到單據的收付(單據歸屬總部)
      const forB = await settlementOf(id, managerB);
      expect(forB.sides.map((side) => [side.side, side.canSettle])).toEqual([
        ["receiver", true],
        ["shipper", false],
      ]);
      expect(await record(managerB, id, "shipper", "in", 100)).toMatchObject({
        code: "FORBIDDEN",
      });
      const forClerk = await settlementOf(id, clerkA);
      expect(forClerk.sides.every((side) => !side.canSettle)).toBe(true);
    });
  });

  describe("駁回 / 作廢", () => {
    it("駁回前:已有點收 → 擋下;淨額 ≠ 0 → 擋下;駁回後全部回到出貨店(反向事件)、叫貨單回到待購買", async () => {
      const received = await newBook(branchA);
      const withReceipt = await submit(hq, [whole(received.bookId)]);
      await ship(withReceipt);
      await receive(managerB, withReceipt, codeOf(received.bookNo));
      expect(await decideBlocked(managerB, withReceipt, "REJECT")).toBe(
        "TRANSFER_HAS_RECEIPTS",
      );

      const requisitionId = await insertRequisition(
        db(),
        tenant,
        branchB,
        "R-7301",
        [{ gameId: game, books: 1 }],
      );
      const book = await newBook(branchA);
      const id = await submit(hq, [whole(book.bookId)], {
        requisition: "R-7301",
      });
      await ship(id);
      await insertSettlementRow(id, "out", 300);
      expect(await decideBlocked(managerB, id, "REJECT")).toBe(
        "SETTLEMENT_NOT_CLEARED",
      );
      await insertSettlementRow(id, "in", 300);
      expect(await decideBlocked(managerB, id, "REJECT")).toBeNull();
      const tickets = await ticketsOf(book.bookId);
      expect(
        tickets.every(
          (ticket) =>
            ticket.orgId.equals(branchA) &&
            ticket.location.kind === "stock" &&
            ticket.lockedBy === null,
        ),
      ).toBe(true);
      expect(await eventTypes(nthTicket(tickets, 0)._id)).toEqual([
        "purchase",
        "transfer_out",
        "transfer_in",
      ]);
      const line = await db()
        .collection("lottery_requisition_lines")
        .findOne({ requisitionId });
      expect(line?.referencedBy).toBeNull();
    });

    it("刪除前:已有點收 → 擋下", async () => {
      const book = await newBook(branchA);
      const id = await submit(hq, [whole(book.bookId)]);
      await ship(id);
      await receive(managerB, id, codeOf(book.bookNo));
      await decideOn(world(), managerB, id, "RETURN");
      const result = await call(api, hq.token, DELETE_SUBMISSION_MUTATION, {
        input: { id },
      });
      expect(extensionsOf(result).reason).toBe("TRANSFER_HAS_RECEIPTS");
    });

    it("作廢前:調入後已售 → 擋下;淨額 ≠ 0 → 擋下;作廢後全部回到出貨店(收貨店調出、出貨店調入)、單張成本改回、叫貨單回到待購買", async () => {
      const sold = await newBook(branchA);
      const soldId = await shippedAndReceived([sold]);
      await settle(soldId, 2000);
      await decideOn(world(), managerB, soldId, "APPROVE");
      const soldTicket = nthTicket(await ticketsOf(sold.bookId), 0);
      await transactions().withTransaction((session) =>
        api.app
          .get(TicketLedgerService)
          .applyTicketEvents(session, { operator: storeOperator(branchB) }, [
            {
              ticketId: soldTicket._id,
              expectedVersion: soldTicket.version,
              type: "sale",
              patch: { status: "sold" },
            },
          ]),
      );
      const soldRow = await current(soldId);
      const blocked = await call(api, hq.token, FORM_VOID, {
        input: {
          id: soldId,
          expectedEditVersion: soldRow.editVersion,
          reasonNote: "輸入錯誤",
        },
      });
      expect(extensionsOf(blocked).reason).toBe("TRANSFER_BOOKS_IN_USE");

      const requisitionId = await insertRequisition(
        db(),
        tenant,
        branchB,
        "R-7401",
        [{ gameId: game, books: 1 }],
      );
      const book = await newBook(branchA);
      const id = await submit(hq, [whole(book.bookId, { rate: 90 })], {
        requisition: "R-7401",
      });
      await ship(id);
      await receive(managerB, id, codeOf(book.bookNo));
      await settle(id, 1800);
      await decideOn(world(), managerB, id, "APPROVE");
      const row = await current(id);
      const notCleared = await call(api, hq.token, FORM_VOID, {
        input: {
          id,
          expectedEditVersion: row.editVersion,
          reasonNote: "輸入錯誤",
        },
      });
      expect(extensionsOf(notCleared).reason).toBe("SETTLEMENT_NOT_CLEARED");
      await reverseAll(id);
      const fresh = await current(id);
      await ok(api, hq.token, FORM_VOID, {
        input: {
          id,
          expectedEditVersion: fresh.editVersion,
          reasonNote: "輸入錯誤",
        },
      });
      const tickets = await ticketsOf(book.bookId);
      expect(
        tickets.every(
          (ticket) =>
            ticket.orgId.equals(branchA) &&
            ticket.location.kind === "stock" &&
            ticket.unitCost === 20,
        ),
      ).toBe(true);
      expect(await eventTrail(nthTicket(tickets, 0)._id)).toEqual([
        ["purchase", String(branchA)],
        ["transfer_out", String(branchA)],
        ["transfer_in", String(branchB)],
        ["transfer_out", String(branchB)],
        ["transfer_in", String(branchA)],
      ]);
      const bookDoc = await db()
        .collection("lottery_books")
        .findOne({ _id: book.bookId });
      expect(String(bookDoc?.orgId)).toBe(String(branchA));
      const line = await db()
        .collection("lottery_requisition_lines")
        .findOne({ requisitionId });
      expect(line?.referencedBy).toBeNull();
    });
  });

  describe("側欄計數「調貨單」待點收(規格 3.1)", () => {
    it("還在第一關(出貨確認)不算:收貨店不算,出貨店店長手上的第一關任務也不算", async () => {
      const before = await badgeOf(managerB);
      const book = await newBook(branchA);
      await submit(hq, [whole(book.bookId)]);
      expect(await badgeOf(managerB)).toBe(before);
      expect(await badgeOf(managerA)).toBe(0);
    });

    it("第一關通過派給收貨店店長 B → B +1、對 B 送 badge:purchasing.transfer", async () => {
      const book = await newBook(branchA);
      const id = await submit(hq, [whole(book.bookId)]);
      const before = await badgeOf(managerB);
      const signals = badgeSignalsTo(managerB);
      await ship(id);
      expect(await badgeOf(managerB)).toBe(before + 1);
      expect(badgeSignalsTo(managerB)).toBeGreaterThan(signals);
    });

    it("任務結束(核准 / 退回)→ B −1", async () => {
      const book = await newBook(branchA);
      const id = await submit(hq, [whole(book.bookId)]);
      await ship(id);
      const before = await badgeOf(managerB);
      await decideOn(world(), managerB, id, "RETURN");
      expect(await badgeOf(managerB)).toBe(before - 1);
    });

    it("點收關卡任務改派 B → 同店的 C:B −1、C +1", async () => {
      const book = await newBook(branchA);
      const id = await submit(hq, [whole(book.bookId)]);
      await ship(id);
      const fromBefore = await badgeOf(managerB);
      const toBefore = await badgeOf(helperB);
      const task = await pendingTaskOf(world(), managerB, id);
      await ok(api, admin.token, REASSIGN, {
        input: { taskId: task.id, toUserId: String(helperB.userId) },
      });
      expect(await badgeOf(managerB)).toBe(fromBefore - 1);
      expect(await badgeOf(helperB)).toBe(toBefore + 1);
    });
  });

  describe("列表進度", () => {
    it("本數 / 張數、點收進度、在途、結算", async () => {
      const book = await newBook(branchA);
      const opened = await newBook(branchA);
      await openBook(branchA, opened.bookId);
      const id = await submit(hq, [
        whole(book.bookId),
        partial(opened.bookId, 40, 49),
      ]);
      await ship(id);
      await receive(managerB, id, codeOf(book.bookNo));
      const data = await ok<{
        lotteryTransferProgress: Record<string, unknown>[];
      }>(api, managerB.token, PROGRESS, { ids: [id] });
      expect(data.lotteryTransferProgress).toEqual([
        {
          transferId: id,
          wholeBooks: 1,
          partialTickets: 10,
          receivedCount: 1,
          totalCount: 2,
          inTransit: true,
          settlementKind: "to_pay",
          settlementAmount: 2000,
        },
      ]);
    });
  });
});

/** 錯誤的細分原因(沒有就用通用碼)。 */
function reasonOf(extensions: Record<string, unknown>): string {
  const value = extensions.reason ?? extensions.code;
  return typeof value === "string" ? value : "";
}

/** 刷這本的某一張(正面條碼:7 位本號 + 3 位張號)。 */
const codeOf = (bookNo: string, ticketNo = 100): string =>
  `${bookNo}${String(ticketNo).padStart(3, "0")}`;

function nthTicket<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`沒有第 ${String(index)} 筆`);
  }
  return item;
}

const nthBook = nthTicket;
