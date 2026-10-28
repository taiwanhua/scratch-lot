import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  type TicketLocationKind,
  type TicketStatus,
  bookCountsOf,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../../auth/test-support/fixtures";
import type { OperatorContext } from "../../../database/operator-context";
import {
  countDbCommands,
  expectDbCommandsAtMost,
} from "../../../database/test-support/db-commands";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import {
  ASSIGN,
  CREATE_FORM,
  PASSWORD,
  type SubmissionRow,
  UPDATE_FORM,
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
import { LOTTERY_CASH_MOVEMENTS_COLLECTION } from "../../database/lottery-accounts/lottery-cash-movement.schema";
import { LOTTERY_SETTLEMENT_MARKS_COLLECTION } from "../../database/lottery-accounts/lottery-settlement-mark.schema";
import { InventoryActionsService } from "../inventory/inventory-actions.service";
import {
  insertBankAccount,
  insertGame,
  insertRequisition,
  seedInventoryModule,
} from "../purchase/test-support/purchase-fixtures";
import { ReportStock } from "../reports/report-stock";
import { inTransitBooksOf } from "../requisition/in-transit";
import { LotteryBooksService } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import {
  TRANSFER_MODULE_KEYS,
  TRANSFER_PERMISSION_KEYS,
  TRANSFER_SHARED_BY_FIELD_KEYS,
  seedTransferAuthorization,
  transferDefinition,
} from "./test-support/transfer-fixtures";
import { TransferRules } from "./transfer-rules.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const FORM = "transfer";
const MODULE = "purchasing.transfer";

/**
 * 多本調貨單的資料庫指令數上限(防退化,TX-06):整個請求的總數,與本數無關。
 * 批次寫入後實測送出約 110、出貨約 135、作廢約 80 次;逐張寫帳本時作廢 1 本(100 張)約 1,500 次、
 * 送出鎖定每張 3 次。
 */
const TRANSFER_SUBMIT_COMMANDS_LIMIT = 160;
const TRANSFER_SHIP_COMMANDS_LIMIT = 180;
const TRANSFER_VOID_COMMANDS_LIMIT = 130;
/** 3 本比 1 本可以多的指令數(只容許少量與本數無關的差異)。 */
const TRANSFER_COMMANDS_PER_EXTRA_BOOKS = 5;

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

const RECEIVE_TICKETS = /* GraphQL */ `
  mutation TestTransferReceiveTickets(
    $input: ReceiveLotteryTransferTicketsInput!
  ) {
    receiveLotteryTransferTickets(input: $input) {
      rowId
      ticketNos
    }
  }
`;

const COMPLETE_WITH_ROWS = /* GraphQL */ `
  mutation TestTransferCompleteRows(
    $input: CompleteLotteryTransferReceivingInput!
  ) {
    completeLotteryTransferReceiving(input: $input) {
      batch {
        rowIds
        rows {
          rowId
          ticketNos
        }
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
        receivedTickets
        shippedAt
        receivedTicketNos
      }
    }
  }
`;

const COMPLETE = /* GraphQL */ `
  mutation TestTransferComplete(
    $input: CompleteLotteryTransferReceivingInput!
  ) {
    completeLotteryTransferReceiving(input: $input) {
      batch {
        batchId
        no
        rowIds
      }
      receiving {
        rows {
          rowId
          batchId
        }
        batches {
          batchId
          no
          rowIds
        }
      }
    }
  }
`;

interface CompletePayload {
  batch: { batchId: string; no: number; rowIds: string[] } | null;
  receiving: {
    rows: { rowId: string; batchId: string | null }[];
    batches: { batchId: string; no: number; rowIds: string[] }[];
  };
}

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

  /**
   * 點收一本到某家店(100 張,整本金額 2,000;成本率 100、成本 2,000 → 單張 20)。
   * `lastTicketNo` > 100 = 有待標註的跳號(拆本前還沒標的)。
   */
  async function newBook(
    orgId: Types.ObjectId,
    other: { gameId: Types.ObjectId; bookNo: string } | null = null,
    cost = 2000,
    lastTicketNo = 100,
  ): Promise<{
    bookId: Types.ObjectId;
    bookNo: string;
  }> {
    bookSequence += 1;
    const bookNo = other?.bookNo ?? String(bookSequence).padStart(6, "0");
    const { book } = await transactions().withTransaction((session) =>
      api.app
        .get(LotteryBooksService)
        .createBook(session, storeOperator(orgId), {
          orgId,
          gameId: other?.gameId ?? game,
          bookNo,
          lastTicketNo,
          rate: 100,
          cost,
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
    gameId: string | null = null,
  ): Promise<Record<string, unknown>> {
    const result = await call(api, who.token, RECEIVE, {
      input: { submissionId, code, ...(gameId === null ? {} : { gameId }) },
    });
    return result.errors ? extensionsOf(result) : {};
  }

  /** 選張的列在格子上點收(點選格子 / 其餘全部到齊)。 */
  async function receiveTickets(
    who: Person,
    submissionId: string,
    rowId: string,
    ticketNos: string[],
  ): Promise<Record<string, unknown>> {
    const result = await call(api, who.token, RECEIVE_TICKETS, {
      input: { submissionId, rowId, ticketNos },
    });
    return result.errors ? extensionsOf(result) : {};
  }

  async function receivingOf(who: Person, id: string) {
    const data = await ok<{
      lotteryTransferReceiving: {
        receivedCount: number;
        totalCount: number;
        transferAmount: number;
        rows: {
          rowId: string;
          ticketNos: string[];
          received: boolean;
          receivedTickets: number;
          receivedTicketNos: string[];
        }[];
      };
    }>(api, who.token, RECEIVING, { id });
    return data.lotteryTransferReceiving;
  }

  /** 退回後(總部)改明細再送出;擋下回 reason。 */
  async function resubmit(id: string, lines: Line[]): Promise<string | null> {
    const row = await current(id);
    const saved = await call<{
      saveFormDraft: { submission: { editVersion: number } };
    }>(api, hq.token, SAVE_SUBMISSION, {
      input: {
        id,
        expectedEditVersion: row.editVersion,
        values: { ...header(), lines },
      },
    });
    const result = await call(api, hq.token, SUBMIT_SUBMISSION, {
      input: {
        id,
        expectedEditVersion: saved.data?.saveFormDraft.submission.editVersion,
      },
    });
    return result.errors ? reasonOf(extensionsOf(result)) : null;
  }

  /** 這本在某家店的庫存(未售、在庫存)張數。 */
  async function stockOf(
    bookId: Types.ObjectId,
    orgId: Types.ObjectId,
  ): Promise<number> {
    const tickets = await ticketsOf(bookId);
    return tickets.filter(
      (ticket) =>
        ticket.orgId.equals(orgId) &&
        ticket.status === "unsold" &&
        ticket.location.kind === "stock",
    ).length;
  }

  /** 本上的張數(帳本維護的 `ticketCounts`)= 依張重數(`bookCountsOf`)。 */
  async function expectCountsMatch(bookId: Types.ObjectId): Promise<void> {
    const tickets = await ticketsOf(bookId);
    const book = await db()
      .collection<{ ticketCounts: Record<string, number> }>("lottery_books")
      .findOne({ _id: bookId });
    expect(book?.ticketCounts).toEqual(
      bookCountsOf(
        tickets.map((ticket) => ({
          status: ticket.status as TicketStatus,
          locationKind: ticket.location.kind as TicketLocationKind,
        })),
      ),
    );
  }

  /** 搬進收貨店(新竹店)的張號。 */
  async function movedNos(bookId: Types.ObjectId): Promise<string[]> {
    const tickets = await ticketsOf(bookId);
    return tickets
      .filter((ticket) => ticket.orgId.equals(branchB))
      .map((ticket) => ticket.ticketNo);
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

  /** 對這張單送過幾次「調貨出貨通知」(收貨店、負責人提醒;點進去 = 這張調貨單)。 */
  function shippedNotices(id: string): number {
    return notify.mock.calls.filter(
      ([input]) =>
        input.type === "lottery.transfer-shipped" &&
        input.dedupeKey.startsWith(`transfer-shipped:${id}:`) &&
        input.ref?.type === "lottery-transfer" &&
        input.ref.id === id &&
        String(input.orgId) === String(branchB),
    ).length;
  }

  /** 小金庫放進一筆錢(還沒有日結,從 0 起算;以現金更正的流水放進去)。 */
  async function fundVault(
    orgId: Types.ObjectId,
    amount: number,
  ): Promise<void> {
    const now = new Date();
    await db().collection(LOTTERY_CASH_MOVEMENTS_COLLECTION).insertOne({
      orgId,
      tenantId: tenant,
      occurredAt: now,
      type: "correction_increase",
      from: "external",
      to: "vault",
      reason: null,
      cashPointId: null,
      shiftId: null,
      attributedShiftId: null,
      amount,
      refType: null,
      refId: null,
      refRevision: null,
      settlementSide: null,
      payee: null,
      note: null,
      reversalOf: null,
      bankTransactionId: null,
      moduleKey: "accounts",
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
    });
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
    // 受管表單的依欄位共用(`transfer.r3.seed.ts`):出貨店、收貨店都看得到這張單
    await ok(api, root, UPDATE_FORM, {
      input: { key: FORM, sharedByFieldKeys: TRANSFER_SHARED_BY_FIELD_KEYS },
    });
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
    it("正面條碼對到單上兩款遊戲同本號 → 擋下請選遊戲;選了遊戲才配對", async () => {
      const otherGame = await insertGame(db(), tenant, {
        gameCode: "5202",
        name: "金好運",
        unitPrice: 20,
        ticketsPerBook: 100,
      });
      const first = await newBook(branchA);
      const second = await newBook(branchA, {
        gameId: otherGame,
        bookNo: first.bookNo.slice(1),
      });
      const firstLine = whole(first.bookId);
      const secondLine = whole(second.bookId, { game: String(otherGame) });
      const id = await submit(hq, [firstLine, secondLine]);
      await ship(id);
      expect(
        await receive(managerB, id, codeOf(first.bookNo, 5)),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "TRANSFER_SCAN_AMBIGUOUS_GAME",
        gameIds: [String(game), String(otherGame)],
      });
      const picked = await ok<{
        receiveLotteryTransferBook: { rowId: string };
      }>(api, managerB.token, RECEIVE, {
        input: {
          submissionId: id,
          code: codeOf(first.bookNo, 5),
          gameId: String(otherGame),
        },
      });
      expect(picked.receiveLotteryTransferBook.rowId).toBe(secondLine.rowId);
    });

    it("改為收貨店庫存 + 「調入」事件,單張成本 = 該列批購金額 ÷ 張數;選張的列逐張點收(刷一張 / 選格子 / 其餘全部到齊)", async () => {
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
      // 刷一張:選張的列只點收刷到的那一張
      expect(await receive(managerB, id, codeOf(opened.bookNo, 13))).toEqual(
        {},
      );
      expect(await movedNos(opened.bookId)).toEqual(["013"]);
      const partly = await receivingOf(managerB, id);
      expect(partly.receivedCount).toBe(0);
      expect(partly.rows[0]).toMatchObject({
        received: false,
        receivedTickets: 1,
        receivedTicketNos: ["013"],
      });
      // 同一張再刷 → 這張已經點收
      expect(
        await receive(managerB, id, codeOf(opened.bookNo, 13)),
      ).toMatchObject({
        reason: "TRANSFER_ALREADY_RECEIVED",
        ticketNos: ["013"],
      });
      const rowId = String(partly.rows[0]?.rowId);
      // 點選格子 [點收選取的 N 張]:已點收的不能再選
      expect(
        await receiveTickets(managerB, id, rowId, ["012", "013"]),
      ).toMatchObject({
        reason: "TRANSFER_ALREADY_RECEIVED",
        ticketNos: ["013"],
      });
      // 不在這一列的張
      expect(await receiveTickets(managerB, id, rowId, ["050"])).toMatchObject({
        reason: "TRANSFER_BOOK_NOT_ON_TRANSFER",
      });
      expect(await receiveTickets(managerB, id, rowId, ["012"])).toEqual({});
      // [其餘全部到齊…]:剩下的 3 張一次點收(不限先刷過一張)
      expect(
        await receiveTickets(managerB, id, rowId, ["014", "015", "016"]),
      ).toEqual({});
      const tickets = await ticketsOf(opened.bookId);
      const moved = tickets.filter((ticket) => ticket.orgId.equals(branchB));
      expect(moved.map((ticket) => ticket.ticketNo)).toEqual([
        "012",
        "013",
        "014",
        "015",
        "016",
      ]);
      // 三次點收 = 三筆點收紀錄;批購金額合計 = 這一列的批購金額(5 張 × 20 × 92% = 92)
      const rows = await db()
        .collection<{ purchaseAmount: number; tickets: unknown[] }>(
          "lottery_transfer_receipts",
        )
        .find({ submissionId: new Types.ObjectId(id) })
        .toArray();
      expect(rows.map((row) => row.tickets.length)).toEqual([1, 1, 3]);
      // 逐張點收(在途 → 庫存)後,本上張數 = 重數
      await expectCountsMatch(opened.bookId);
      expect(rows.reduce((sum, row) => sum + row.purchaseAmount, 0)).toBe(92);
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
            // 點收紀錄實際搬進來的張(調貨點收單照它印號碼)
            receivedTicketNos: ["012", "013", "014", "015", "016"],
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

  describe("[完成這次點收](調貨點收單照點收批次印;同進貨點收)", () => {
    it("這一次的列標上點收批次(第 1 次、第 2 次);已在批次的列不重收;不是點收任務的人不能完成", async () => {
      const first = await newBook(branchA);
      const second = await newBook(branchA);
      const firstLine = whole(first.bookId);
      const secondLine = whole(second.bookId);
      const id = await submit(hq, [firstLine, secondLine]);
      await ship(id);
      const complete = (rowIds: string[]) =>
        ok<{ completeLotteryTransferReceiving: CompletePayload }>(
          api,
          managerB.token,
          COMPLETE,
          { input: { submissionId: id, rowIds } },
        );
      expect(await receive(managerB, id, codeOf(first.bookNo))).toEqual({});
      const one = await complete([firstLine.rowId]);
      expect(one.completeLotteryTransferReceiving.batch).toMatchObject({
        no: 1,
        rowIds: [firstLine.rowId],
      });
      expect(await receive(managerB, id, codeOf(second.bookNo))).toEqual({});
      // 帶上已在第 1 次的列也不會搬過來
      const two = await complete([firstLine.rowId, secondLine.rowId]);
      const { batch, receiving } = two.completeLotteryTransferReceiving;
      expect(batch).toMatchObject({ no: 2, rowIds: [secondLine.rowId] });
      expect(receiving.batches.map((item) => [item.no, item.rowIds])).toEqual([
        [1, [firstLine.rowId]],
        [2, [secondLine.rowId]],
      ]);
      expect(receiving.rows.map((row) => row.batchId)).toEqual([
        receiving.batches[0]?.batchId,
        batch?.batchId,
      ]);
      // 都已在批次裡:沒有新批次(不印)
      const again = await complete([secondLine.rowId]);
      expect(again.completeLotteryTransferReceiving.batch).toBeNull();
      // 出貨店的人(不是點收任務的人)
      const denied = await call(api, managerA.token, COMPLETE, {
        input: { submissionId: id, rowIds: [secondLine.rowId] },
      });
      expect(extensionsOf(denied)).toMatchObject({
        reason: "TRANSFER_NOT_RECEIVABLE",
      });
      const tooMany = await call(api, managerB.token, COMPLETE, {
        input: { submissionId: id, rowIds: ["a", "b", "c"] },
      });
      expect(extensionsOf(tooMany).code).toBe("VALIDATION_FAILED");
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
      // 完成時建結清標記(待確認;待結清只掃還沒結清的)
      expect(
        await db()
          .collection(LOTTERY_SETTLEMENT_MARKS_COLLECTION)
          .findOne({ refId: new Types.ObjectId(id) }),
      ).toMatchObject({ refType: "purchasing.transfer", closedAsOf: null });
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
      // 5 本還在途、沒點收就退回(退回後保持在途,規格 8.4)

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

      // 7 本都在途:沒新增就重送 → 送出成功、沒有新出貨
      await resubmit(lines);
      expect(await shippedAtOf()).toEqual(second);
      for (const book of books) {
        const tickets = await ticketsOf(book.bookId);
        expect(
          tickets.every(
            (ticket) =>
              ticket.location.kind === "in_transit" && ticket.lockedBy !== null,
          ),
        ).toBe(true);
      }
    });

    it("退回後把在途的列換成別的本(改本號)→ 擋下 TRANSFER_LINE_INVALID", async () => {
      const shippedBook = await newBook(branchA);
      const otherBook = await newBook(branchA);
      const line = whole(shippedBook.bookId);
      const id = await submit(hq, [line]);
      await ship(id);
      await decideOn(world(), managerB, id, "RETURN");
      const row = await current(id);
      const saved = await call<{
        saveFormDraft: { submission: { editVersion: number } };
      }>(api, hq.token, SAVE_SUBMISSION, {
        input: {
          id,
          expectedEditVersion: row.editVersion,
          values: {
            ...header(),
            lines: [{ ...line, book: String(otherBook.bookId) }],
          },
        },
      });
      const result = await call(api, hq.token, SUBMIT_SUBMISSION, {
        input: {
          id,
          expectedEditVersion: saved.data?.saveFormDraft.submission.editVersion,
        },
      });
      expect(extensionsOf(result)).toMatchObject({
        reason: "TRANSFER_LINE_INVALID",
      });
    });

    it("退回後改在途那一列的批購金額率 → 擋下 TRANSFER_LINE_INVALID(在途的列不能改,只能刪)", async () => {
      const shippedBook = await newBook(branchA);
      const line = whole(shippedBook.bookId);
      const id = await submit(hq, [line]);
      await ship(id);
      await decideOn(world(), managerB, id, "RETURN");
      const row = await current(id);
      const saved = await call<{
        saveFormDraft: { submission: { editVersion: number } };
      }>(api, hq.token, SAVE_SUBMISSION, {
        input: {
          id,
          expectedEditVersion: row.editVersion,
          values: { ...header(), lines: [{ ...line, rate: 90 }] },
        },
      });
      const result = await call(api, hq.token, SUBMIT_SUBMISSION, {
        input: {
          id,
          expectedEditVersion: saved.data?.saveFormDraft.submission.editVersion,
        },
      });
      expect(extensionsOf(result)).toMatchObject({
        reason: "TRANSFER_LINE_INVALID",
      });
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
      // (從小金庫付現不能超過小金庫應有:B 的小金庫先有 10,000)
      await fundVault(branchB, 10_000);
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

  describe("少張處理(選張的列逐張點收,使用者 10/26 定案做法 A)", () => {
    it("調 12 張只到 9 張:核准擋下 → 退回 → 出貨店移除沒到的 3 張(待查、金額重算)→ 重送 → 核准;兩店庫存、結算、報表調入 / 調出", async () => {
      const opened = await newBook(branchA);
      await openBook(branchA, opened.bookId);
      // 045–056 共 12 張 × 20 元 × 92% = 220.8 → 批購金額 221
      const line = partial(opened.bookId, 45, 56);
      // 出貨店的調出從出貨那一刻算
      const shipFrom = new Date();
      const id = await submit(hq, [line]);
      await ship(id);
      expect(await numbersOf(id)).toEqual({
        amount: 221,
        paid: 0,
        received: 0,
      });
      // 報表期間從這裡起(只算這張單的點收)
      const startedAt = new Date();
      // 點收 9 張:刷 1 張、選格子 8 張
      expect(await receive(managerB, id, codeOf(opened.bookNo, 45))).toEqual(
        {},
      );
      expect(
        await receiveTickets(managerB, id, line.rowId, [
          "046",
          "047",
          "048",
          "049",
          "050",
          "051",
          "052",
          "053",
        ]),
      ).toEqual({});
      const partly = await receivingOf(managerB, id);
      expect(partly.rows[0]).toMatchObject({
        received: false,
        receivedTickets: 9,
      });
      expect(partly.receivedCount).toBe(0);
      // 部分點收:收貨店 [付款] 先填 = 9 張 × 20 × 92% = 165.6 → 166
      expect(await buttonsOf(id)).toMatchObject({ pay: 166 });
      // 還有 3 張沒點收 → 核准擋下
      expect(await decideBlocked(managerB, id, "APPROVE")).toBe(
        "TRANSFER_UNRECEIVED_ROWS",
      );
      // 在途:沒到齊的列還算收貨店的在途本數(到齊後少 1)
      const transitPartly = await inTransitBooksOf({
        tenantId: tenant,
        orgId: branchB,
      });
      const inTransitPartly = transitPartly.get(String(game)) ?? 0;

      // 「點收那天」的期末(點收後、退回重送前):收貨店持有這本的張與成本(之後重送改了成本也要一樣)
      const reader = await api.app.get(TransferRules).readerOf(tenant);
      const stock = api.app.get(ReportStock);
      const receivedDayEnd = new Date();
      const heldCostOf = async (at: Date) => {
        const held = await stock.heldAt(reader, branchB, at);
        const mine = held.filter((ticket) =>
          ticket.bookId.equals(opened.bookId),
        );
        return {
          tickets: mine.length,
          cost: mine.reduce((sum, ticket) => sum + ticket.cost, 0),
        };
      };
      const heldOnReceivedDay = await heldCostOf(receivedDayEnd);
      expect(heldOnReceivedDay.tickets).toBe(9);
      // 點收時的單張成本 = 221 ÷ 12 → 9 張 165.75
      expect(Math.abs(heldOnReceivedDay.cost - 165.75)).toBeLessThan(1e-9);
      await decideOn(world(), managerB, id, "RETURN");
      // 「重送前一天」的期末(退回後、重送前)
      const beforeResubmit = new Date();
      const heldBeforeResubmit = await heldCostOf(beforeResubmit);
      // 拿掉已點收的張 → 擋下;加張 → 擋下
      expect(
        await resubmit(id, [
          { ...line, ticket_nos: "046-053", tickets: 8, amount: 160 },
        ]),
      ).toBe("TRANSFER_RECEIVED_ROW_CHANGED");
      expect(
        await resubmit(id, [
          { ...line, ticket_nos: "045-057", tickets: 13, amount: 260 },
        ]),
      ).toBe("TRANSFER_RECEIVED_ROW_CHANGED");
      // 出貨店取消勾選沒到的 054–056 → 重送
      expect(
        await resubmit(id, [
          { ...line, ticket_nos: "045-053", tickets: 9, amount: 180 },
        ]),
      ).toBeNull();
      const tickets = await ticketsOf(opened.bookId);
      const missing = tickets.filter((ticket) =>
        ["054", "055", "056"].includes(ticket.ticketNo),
      );
      expect(
        missing.map((ticket) => [
          ticket.status,
          String(ticket.orgId),
          String(ticket.responsibleOrgId),
          ticket.lockedBy,
        ]),
      ).toEqual(
        Array.from({ length: 3 }, () => [
          "investigating",
          String(branchA),
          String(branchA),
          null,
        ]),
      );
      // 已點收的 9 張不受影響(仍是收貨店庫存、沒有被鎖)
      expect(await stockOf(opened.bookId, branchB)).toBe(9);
      await ship(id);
      // 這一列全部到齊;調貨金額照剩下的 9 張重算 = 已點收金額
      const after = await receivingOf(managerB, id);
      expect(after.rows[0]).toMatchObject({
        received: true,
        receivedTickets: 9,
        ticketNos: [
          "045",
          "046",
          "047",
          "048",
          "049",
          "050",
          "051",
          "052",
          "053",
        ],
      });
      expect(after.receivedCount).toBe(1);
      const transitAfter = await inTransitBooksOf({
        tenantId: tenant,
        orgId: branchB,
      });
      expect(transitAfter.get(String(game)) ?? 0).toBe(inTransitPartly - 1);
      expect(await numbersOf(id)).toEqual({
        amount: 166,
        paid: 0,
        received: 0,
      });
      expect(await buttonsOf(id)).toMatchObject({ pay: 166 });
      await settle(id, 166);
      expect(await decideBlocked(managerB, id, "APPROVE")).toBeNull();
      const done = await current(id);
      expect(done.status).toBe("completed");

      // 兩店庫存:出貨店這本 100 − 檯面 10 − 調走 9 − 待查 3 = 78;收貨店 9
      expect(await stockOf(opened.bookId, branchA)).toBe(78);
      expect(await stockOf(opened.bookId, branchB)).toBe(9);
      // 報表的調入(依點收紀錄;調入金額 = 調貨金額)
      const until = new Date(Date.now() + 60_000);
      const inboundAll = await stock.inboundOf(
        reader,
        branchB,
        startedAt,
        until,
      );
      const inbound = inboundAll.filter((row) =>
        row.bookId.equals(opened.bookId),
      );
      expect({
        tickets: inbound.reduce((sum, row) => sum + row.sign * row.tickets, 0),
        amount: inbound.reduce((sum, row) => sum + row.sign * row.amount, 0),
      }).toEqual({ tickets: 9, amount: 166 });
      // 調出(出貨那一筆「調出」事件的金額快照;移除的 3 張在變待查那一刻算調出反向 + 新增待查)
      const outboundAll = await stock.outboundOf(
        reader,
        branchA,
        shipFrom,
        until,
      );
      const outbound = outboundAll.filter((row) =>
        row.bookId.equals(opened.bookId),
      );
      const outTickets = outbound.reduce((sum, row) => sum + row.sign, 0);
      const outAmount = outbound.reduce(
        (sum, row) => sum + row.sign * row.amount,
        0,
      );
      const outCost = outbound.reduce(
        (sum, row) => sum + row.sign * row.cost,
        0,
      );
      expect(outTickets).toBe(9);
      expect(outbound.filter((row) => row.lost)).toHaveLength(3);
      // 出貨時 12 張 × 221 ÷ 12,扣掉 3 張 → 165.75;原成本 9 × 20 = 180
      expect(Math.abs(outAmount - 165.75)).toBeLessThan(1e-9);
      expect(Math.abs(outCost - 180)).toBeLessThan(1e-9);
      // 重跑「點收那天」與「重送前一天」的期末:成本調整前的值不變
      expect(await heldCostOf(receivedDayEnd)).toEqual(heldOnReceivedDay);
      expect(await heldCostOf(beforeResubmit)).toEqual(heldBeforeResubmit);
      expect(heldBeforeResubmit).toEqual(heldOnReceivedDay);
      // 現在(重送之後):9 張 · 166
      const heldNow = await heldCostOf(new Date());
      expect(heldNow.tickets).toBe(9);
      expect(Math.abs(heldNow.cost - 166)).toBeLessThan(1e-9);
      // 成本調整經帳本:每張一筆「成本調整」事件,成本快照 = 調整前(221 ÷ 12)
      const adjusts = await db()
        .collection<{ cost: number }>("lottery_ticket_events")
        .find({ bookId: opened.bookId, type: "cost_adjust" })
        .toArray();
      expect(adjusts).toHaveLength(9);
      expect(adjusts.every((row) => Math.abs(row.cost - 221 / 12) < 1e-9)).toBe(
        true,
      );
      // 本上張數(帳本維護的欄位)= 依張重數
      await expectCountsMatch(opened.bookId);
      // 收貨店這 9 張的單張成本 = 縮小後這一列的批購金額 ÷ 張數(166 ÷ 9;使用者 10/27 定案),成本合計 = 調貨金額
      const finalTickets = await ticketsOf(opened.bookId);
      const moved = finalTickets.filter((ticket) =>
        ticket.orgId.equals(branchB),
      );
      expect(
        Math.abs(moved.reduce((sum, ticket) => sum + ticket.unitCost, 0) - 166),
      ).toBeLessThan(1e-9);
    });

    it("在途的選張列(還沒點收任何一張)也能只移除沒到的張;整本的列不能縮", async () => {
      const opened = await newBook(branchA);
      await openBook(branchA, opened.bookId);
      const book = await newBook(branchA);
      const partLine = partial(opened.bookId, 20, 24);
      const wholeLine = whole(book.bookId);
      const id = await submit(hq, [partLine, wholeLine]);
      await ship(id);
      await decideOn(world(), managerB, id, "RETURN");
      // 整本的列改成選張 → 擋下(在途的整本只能整列刪)
      expect(
        await resubmit(id, [
          partLine,
          {
            ...wholeLine,
            mode: "partial",
            ticket_nos: "001-050",
            tickets: 50,
            amount: 1000,
          },
        ]),
      ).toBe("TRANSFER_LINE_INVALID");
      expect(
        await resubmit(id, [
          { ...partLine, ticket_nos: "020-022", tickets: 3, amount: 60 },
          wholeLine,
        ]),
      ).toBeNull();
      const tickets = await ticketsOf(opened.bookId);
      expect(
        tickets
          .filter((ticket) => ticket.status === "investigating")
          .map((ticket) => ticket.ticketNo),
      ).toEqual(["023", "024"]);
    });

    it("[完成這次點收] 的點收批次帶這一次每一列點收的張", async () => {
      const opened = await newBook(branchA);
      await openBook(branchA, opened.bookId);
      const line = partial(opened.bookId, 30, 33);
      const id = await submit(hq, [line]);
      await ship(id);
      expect(
        await receiveTickets(managerB, id, line.rowId, ["030", "031"]),
      ).toEqual({});
      expect(await receive(managerB, id, codeOf(opened.bookNo, 32))).toEqual(
        {},
      );
      const first = await ok<{
        completeLotteryTransferReceiving: {
          batch: {
            rowIds: string[];
            rows: { rowId: string; ticketNos: string[] }[];
          } | null;
        };
      }>(api, managerB.token, COMPLETE_WITH_ROWS, {
        input: { submissionId: id, rowIds: [line.rowId] },
      });
      expect(first.completeLotteryTransferReceiving.batch).toEqual({
        rowIds: [line.rowId],
        rows: [{ rowId: line.rowId, ticketNos: ["030", "031", "032"] }],
      });
      expect(await receiveTickets(managerB, id, line.rowId, ["033"])).toEqual(
        {},
      );
      const second = await ok<{
        completeLotteryTransferReceiving: {
          batch: {
            rowIds: string[];
            rows: { rowId: string; ticketNos: string[] }[];
          } | null;
        };
      }>(api, managerB.token, COMPLETE_WITH_ROWS, {
        input: { submissionId: id, rowIds: [line.rowId] },
      });
      expect(second.completeLotteryTransferReceiving.batch).toEqual({
        rowIds: [line.rowId],
        rows: [{ rowId: line.rowId, ticketNos: ["033"] }],
      });
    });

    it("整本的列不能在格子上逐張點收(刷一張 = 整列)", async () => {
      const book = await newBook(branchA);
      const line = whole(book.bookId);
      const id = await submit(hq, [line]);
      await ship(id);
      expect(
        await receiveTickets(managerB, id, line.rowId, ["001"]),
      ).toMatchObject({ reason: "TRANSFER_WHOLE_ROW_TICKETS" });
      expect(await receive(managerB, id, codeOf(book.bookNo, 7))).toEqual({});
      expect(await stockOf(book.bookId, branchB)).toBe(100);
      expect(await receive(managerB, id, codeOf(book.bookNo, 8))).toMatchObject(
        { reason: "TRANSFER_ALREADY_RECEIVED" },
      );
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

    it("刪除只限草稿:被退回的單(在途、還沒點收)申請人刪 → TRANSFER_NOT_DRAFT,張仍在途鎖定;草稿可以刪", async () => {
      const book = await newBook(branchA);
      const id = await submit(hq, [whole(book.bookId)]);
      await ship(id);
      await decideOn(world(), managerB, id, "RETURN");
      const result = await call(api, hq.token, DELETE_SUBMISSION_MUTATION, {
        input: { id },
      });
      expect(extensionsOf(result).reason).toBe("TRANSFER_NOT_DRAFT");
      expect(
        await everyTicket(
          book.bookId,
          (ticket) =>
            ticket.location.kind === "in_transit" && ticket.lockedBy !== null,
        ),
      ).toBe(true);
      const draftBook = await newBook(branchA);
      const draft = await draftOf(hq, [whole(draftBook.bookId)]);
      const deleted = await call(api, hq.token, DELETE_SUBMISSION_MUTATION, {
        input: { id: draft.id },
      });
      expect(deleted.errors).toBeUndefined();
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

  /**
   * N 本整本調貨:送出(鎖定)→ 出貨(調出)→ 逐本點收 → 收付記平後核准 → 沖正歸零 → 作廢。
   * 回送出、出貨與作廢這三個請求各自的指令數。`costs` 給了就是每本進貨時的成本(各本單張成本不同,
   * 作廢時各本改回自己的)。
   */
  async function transferCommandsOf(books: number, costs?: readonly number[]) {
    const created = [];
    for (let index = 0; index < books; index += 1) {
      created.push(await newBook(branchA, null, costs?.[index] ?? 2000));
    }
    const draft = await draftOf(
      hq,
      created.map((book) => whole(book.bookId)),
    );
    const submitted = await countDbCommands(() =>
      call(api, hq.token, SUBMIT_SUBMISSION, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      }),
    );
    expect(submitted.result.errors).toBeUndefined();
    for (const book of created) {
      expect(
        await everyTicket(book.bookId, (ticket) => ticket.lockedBy !== null),
      ).toBe(true);
    }
    const shipped = await countDbCommands(() => ship(draft.id));
    for (const book of created) {
      expect(await receive(managerB, draft.id, codeOf(book.bookNo))).toEqual(
        {},
      );
    }
    await settle(draft.id, 2000 * books);
    await decideOn(world(), managerB, draft.id, "APPROVE");
    await reverseAll(draft.id);
    const fresh = await current(draft.id);
    const voided = await countDbCommands(() =>
      call(api, hq.token, FORM_VOID, {
        input: {
          id: draft.id,
          expectedEditVersion: fresh.editVersion,
          reasonNote: "輸入錯誤",
        },
      }),
    );
    expect(voided.result.errors).toBeUndefined();
    // 作廢後每一本都回到出貨店庫存(收貨店調出、出貨店調入)
    for (const book of created) {
      expect(
        await everyTicket(
          book.bookId,
          (ticket) =>
            ticket.orgId.equals(branchA) &&
            ticket.location.kind === "stock" &&
            ticket.lockedBy === null,
        ),
      ).toBe(true);
    }
    return { submitted, shipped, voided };
  }

  describe("多本調貨單的資料庫指令數(防退化,TX-06)", () => {
    it("送出(鎖定)、出貨(調出)、作廢的指令數與本數無關", async () => {
      const one = await transferCommandsOf(1);
      const three = await transferCommandsOf(3);
      for (const [label, key, limit] of [
        ["送出鎖定", "submitted", TRANSFER_SUBMIT_COMMANDS_LIMIT],
        ["出貨調出", "shipped", TRANSFER_SHIP_COMMANDS_LIMIT],
        ["作廢", "voided", TRANSFER_VOID_COMMANDS_LIMIT],
      ] as const) {
        expectDbCommandsAtMost(
          three[key],
          one[key].total + TRANSFER_COMMANDS_PER_EXTRA_BOOKS,
          `${label} 3 本(1 本 = ${String(one[key].total)} 次)`,
        );
        expectDbCommandsAtMost(three[key], limit, `${label} 3 本`);
      }
    });

    it("每本單張成本不同(作廢時各本改回自己的成本)→ 作廢只多「多出的成本種類數」次", async () => {
      const same = await transferCommandsOf(3);
      const varied = await transferCommandsOf(3, [2000, 1900, 1800]);
      // 確實測到「成本不同」:比同成本多出分組的那幾次
      expect(varied.voided.total).toBeGreaterThan(same.voided.total);
      // 3 種成本比 1 種多 2 組,每組多一次 updateMany(TX-06:組數隨值的種類成長)
      expectDbCommandsAtMost(
        varied.voided,
        same.voided.total + 2 + TRANSFER_COMMANDS_PER_EXTRA_BOOKS,
        `作廢 3 本不同成本(同成本 = ${String(same.voided.total)} 次)`,
      );
      expectDbCommandsAtMost(
        varied.voided,
        TRANSFER_VOID_COMMANDS_LIMIT,
        "作廢 3 本不同成本",
      );
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

  describe("調貨後對調跳號(做法 D;規格 7.x 例外:改回未售的張歸到做更正的那家店)", () => {
    it("中山店拆本標 #047 跳號 → 選張 041–060 調給新竹店、點收完成 → 新竹店對調 #047(跳號、記在中山店)↔ #048(未售、新竹店)", async () => {
      // 更正跳號原因(欄位管理類別,全域)
      const now = new Date();
      const stamp = {
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      };
      const categoryKey = LOTTERY_FIELD_CATEGORY_KEYS.skipCorrectionReason;
      if (
        (await db()
          .collection("field_categories")
          .countDocuments({ key: categoryKey })) === 0
      ) {
        const { insertedId: categoryId } = await db()
          .collection("field_categories")
          .insertOne({
            key: categoryKey,
            name: categoryKey,
            isSystem: true,
            enabled: true,
            ...stamp,
          });
        await db()
          .collection("fields")
          .insertOne({
            value: "mistake",
            label: "標註錯誤",
            key: `${categoryKey}.mistake`,
            categoryId,
            orgId: null,
            order: 1,
            enabled: true,
            isSystem: true,
            ...stamp,
          });
      }
      const opened = await newBook(branchA);
      await openBook(branchA, opened.bookId);
      const openedTickets = await ticketsOf(opened.bookId);
      const at047 = openedTickets.find((ticket) => ticket.ticketNo === "047");
      if (at047 === undefined) {
        throw new Error("沒有 #047");
      }
      await transactions().withTransaction((session) =>
        api.app
          .get(TicketLedgerService)
          .applyTicketEvents(session, { operator: storeOperator(branchA) }, [
            {
              ticketId: at047._id,
              expectedVersion: at047.version,
              type: "skip" as const,
              patch: { status: "skipped" as const },
            },
          ]),
      );
      // 041–060 扣掉跳號 #047 = 19 張 × 20 元 × 92% = 349.6 → 批購金額 350
      const line = partial(opened.bookId, 41, 60, {
        ticket_nos: "041-046,048-060",
        tickets: 19,
        amount: 380,
      });
      const id = await submit(hq, [line]);
      await ship(id);
      expect(
        await receiveTickets(managerB, id, line.rowId, [
          "041",
          "042",
          "043",
          "044",
          "045",
          "046",
          "048",
          "049",
          "050",
          "051",
          "052",
          "053",
          "054",
          "055",
          "056",
          "057",
          "058",
          "059",
          "060",
        ]),
      ).toEqual({});
      await settle(id, 350);
      expect(await decideBlocked(managerB, id, "APPROVE")).toBeNull();
      const stockA = async () => {
        const all = await ticketsOf(opened.bookId);
        return all.filter(
          (ticket) =>
            ticket.orgId.equals(branchA) &&
            ticket.status === "unsold" &&
            ticket.location.kind === "stock",
        ).length;
      };
      const stockABefore = await stockA();
      const tickets = await ticketsOf(opened.bookId);
      const t047 = tickets.find((ticket) => ticket.ticketNo === "047");
      const t048 = tickets.find((ticket) => ticket.ticketNo === "048");
      if (t047 === undefined || t048 === undefined) {
        throw new Error("沒有 #047 / #048");
      }
      expect(String(t047.orgId)).toBe(String(branchA));
      expect(t047.status).toBe("skipped");
      const swappedAt = new Date();
      await api.app
        .get(InventoryActionsService)
        .swapSkip(storeOperator(branchB), {
          bookId: String(opened.bookId),
          skipped: { ticketId: String(t047._id), version: t047.version },
          unsold: { ticketId: String(t048._id), version: t048.version },
          reasonKey: "mistake",
        });
      const after = await ticketsOf(opened.bookId);
      const a047 = after.find((ticket) => ticket.ticketNo === "047");
      const a048 = after.find((ticket) => ticket.ticketNo === "048");
      // #047 → 未售、歸新竹店、接手 #048 的位置與單張成本(350 ÷ 19)
      expect({
        status: a047?.status,
        orgId: String(a047?.orgId),
        location: a047?.location.kind,
        unitCost: a047?.unitCost,
      }).toEqual({
        status: "unsold",
        orgId: String(branchB),
        location: "stock",
        unitCost: t048.unitCost,
      });
      expect(Math.abs((a047?.unitCost ?? 0) - 350 / 19)).toBeLessThan(1e-9);
      expect({ status: a048?.status, orgId: String(a048?.orgId) }).toEqual({
        status: "skipped",
        orgId: String(branchB),
      });
      // 中山店庫存不變(100 − 檯面 10 − 調走 19 − 跳號 #047 = 70);新竹店仍是 19 張(#048 換成 #047)
      expect(stockABefore).toBe(70);
      expect(await stockA()).toBe(stockABefore);
      expect(
        after.filter(
          (ticket) =>
            ticket.orgId.equals(branchB) &&
            ticket.status === "unsold" &&
            ticket.location.kind === "stock",
        ),
      ).toHaveLength(19);
      // 兩張的時間軸
      expect(await eventTrail(t047._id)).toEqual([
        ["purchase", String(branchA)],
        ["skip", String(branchA)],
        ["unskip", String(branchB)],
      ]);
      expect(await eventTrail(t048._id)).toEqual([
        ["purchase", String(branchA)],
        ["transfer_out", String(branchA)],
        ["transfer_in", String(branchB)],
        ["skip", String(branchB)],
      ]);
      // 本上張數 = 重數(對調一張換一張)
      await expectCountsMatch(opened.bookId);
      // 新竹店報表的跳號(跳號 − 取消跳號,依事件的分店)淨額 0;中山店不受影響
      const skipNetOf = async (orgId: Types.ObjectId) => {
        const rows = await db()
          .collection<{ type: string }>("lottery_ticket_events")
          .find({
            orgId,
            bookId: opened.bookId,
            at: { $gte: swappedAt },
            type: { $in: ["skip", "unskip"] },
          })
          .toArray();
        return (
          rows.filter((row) => row.type === "skip").length -
          rows.filter((row) => row.type === "unskip").length
        );
      };
      expect(await skipNetOf(branchB)).toBe(0);
      expect(await skipNetOf(branchA)).toBe(0);
    });
  });

  describe("列表進度", () => {
    it("讀得到才有進度:可見範圍含收貨店的人(上層組織含下層、收貨店本身)讀得到;可見範圍不含兩邊店的人讀不到", async () => {
      const district = await createOrg(api.connection, {
        name: "北區",
        parentId: tenant,
      });
      const northStore = await createOrg(api.connection, {
        name: "北區分店",
        parentId: district,
      });
      const scope = {
        moduleKeys: [...TRANSFER_MODULE_KEYS],
        permissionKeys: [TRANSFER_PERMISSION_KEYS.view],
      };
      const districtManager = await person(
        api,
        api.connection,
        district,
        tenant,
        scope,
      );
      const northManager = await person(
        api,
        api.connection,
        northStore,
        tenant,
        scope,
      );
      const book = await newBook(branchA);
      const id = await submit(hq, [whole(book.bookId)], {
        to_branch: String(northStore),
      });
      const progressOf = async (who: Person) => {
        const data = await ok<{
          lotteryTransferProgress: { transferId: string }[];
        }>(api, who.token, PROGRESS, { ids: [id] });
        return data.lotteryTransferProgress.map((row) => row.transferId);
      };
      expect(await progressOf(districtManager)).toEqual([id]);
      expect(await progressOf(northManager)).toEqual([id]);
      // 台中店:可見範圍不含出貨店(中山店)也不含收貨店(北區分店)
      expect(await progressOf(managerC)).toEqual([]);
    });

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

  describe("待標註的跳號(使用者 10/27 定案甲):迄號 101、標準 100 張的未拆本整本調貨", () => {
    it("可調張數 100;單上 100 張才能送(101 擋下);點收後收貨店單張 = 調貨金額 ÷ 100;退回重送不被當成改了已點收的列;核准", async () => {
      const book = await newBook(branchA, null, 2000, 101);
      const data = await ok<{
        lotteryTransferOptions: {
          books: { bookId: string; isWhole: boolean; availableCount: number }[];
        };
      }>(api, managerA.token, OPTIONS, {
        from: String(branchA),
        to: String(branchB),
      });
      expect(
        data.lotteryTransferOptions.books.find(
          (item) => item.bookId === String(book.bookId),
        ),
      ).toMatchObject({ isWhole: true, availableCount: 100 });
      expect(
        await blockedOf(hq, [
          whole(book.bookId, { tickets: 101, ticket_nos: "001-101" }),
        ]),
      ).toBe("TRANSFER_LINE_INVALID");
      const lines = [whole(book.bookId)];
      const id = await submit(hq, lines);
      await ship(id);
      expect(await receive(managerB, id, codeOf(book.bookNo, 1))).toEqual({});
      const tickets = await ticketsOf(book.bookId);
      // 101 張紀錄(含待標註那張)整本搬到收貨店;單張 = 2,000 ÷ 100 = 20
      expect(tickets).toHaveLength(101);
      expect(
        tickets.every(
          (ticket) =>
            ticket.orgId.equals(branchB) &&
            Math.abs(ticket.unitCost - 20) < 1e-9,
        ),
      ).toBe(true);
      // 出貨當時的調貨金額快照記在「調出」事件上(2,000 ÷ 100 = 20)
      const shippedEvents = await db()
        .collection("lottery_ticket_events")
        .find({ bookId: book.bookId, type: "transfer_out" })
        .toArray();
      expect(shippedEvents).toHaveLength(101);
      expect(shippedEvents.every((event) => event.amount === 20)).toBe(true);
      // 收貨店退回;總部改了已點收的整本列 → 擋下(張數改 50 / 改成選張)
      await decideOn(world(), managerB, id, "RETURN");
      const resubmitWith = async (next: Line[]) => {
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
        const result = await call(api, hq.token, SUBMIT_SUBMISSION, {
          input: {
            id,
            expectedEditVersion:
              saved.data?.saveFormDraft.submission.editVersion,
          },
        });
        return result.errors ? reasonOf(extensionsOf(result)) : null;
      };
      const [line] = lines;
      if (line === undefined) throw new Error("no line");
      expect(await resubmitWith([{ ...line, tickets: 50 }])).toBe(
        "TRANSFER_RECEIVED_ROW_CHANGED",
      );
      expect(
        await resubmitWith([
          { ...line, mode: "partial", ticket_nos: "001-100", amount: 2000 },
        ]),
      ).toBe("TRANSFER_RECEIVED_ROW_CHANGED");
      // 原封不動重送:點收紀錄 101 張 vs 單上 100 張(標準張數),不算「改了已點收的列」
      expect(await resubmitWith(lines)).toBeNull();
      await ship(id);
      await record(managerB, id, "receiver", "out", 2000);
      await record(managerA, id, "shipper", "in", 2000);
      expect(await decideBlocked(managerB, id, "APPROVE")).toBeNull();
      expect(await current(id).then((value) => value.status)).toBe("completed");
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
