import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type DefinitionNode, Kind, parse, print, visit } from "graphql";
import { type Model, Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";
import {
  INVENTORY_PERMISSIONS as INV,
  INVENTORY_BOOK_FILTER_STATES,
  INVENTORY_MODULE_KEYS,
  STORE_PERMISSIONS as S,
  SALE_REVERSAL_FORM_KEY,
  STOCKTAKE_CONFIRM_FORM_KEY,
  STOCKTAKE_STOCK_LINE,
  STORE_FORM_PERMISSIONS,
  type StocktakeDraft,
  type TicketLocationKind,
  type TicketStatus,
  bookCountsOf,
  serializeStocktakeDraft,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
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
  UPDATE_FORM,
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
  SUBMIT_SUBMISSION,
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
import { LotteryStocktake } from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import {
  LOTTERY_SHIFTS_COLLECTION,
  LotteryShift,
} from "../../database/lottery-store/lottery-shift.schema";
import { insertGame } from "../purchase/test-support/purchase-fixtures";
import { StoreClock } from "../store/store-clock";
import { seedReasonCategory } from "../test-support/master-data-fixtures";
import { LotteryBooksService } from "../tickets/books.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import {
  TRANSFER_MODULE_KEYS,
  TRANSFER_PERMISSION_KEYS,
  TRANSFER_SHARED_BY_FIELD_KEYS,
  seedTransferAuthorization,
  transferDefinition,
} from "../transfer/test-support/transfer-fixtures";

jest.setTimeout(600_000);

/**
 * 本狀態(使用者 10/27 定案 B)與再上檯面(定案 D)的整合測試:實測報告 `verify-book-states` 的 C01–C16 與
 * `verify-reopen` 的題 1–3 以畫面用的 operation(`packages/graphql/src/documents`)重跑,斷言顯示狀態、
 * 篩選、本上張數與重數一致。
 */

const RECEIVE = /* GraphQL */ `
  mutation VReceive($input: ReceiveLotteryTransferBookInput!) {
    receiveLotteryTransferBook(input: $input) {
      rowId
    }
  }
`;

interface TicketRow {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  ticketNo: string;
  status: string;
  version: number;
  location: { kind: string; cashPointId: Types.ObjectId | null };
  lockedBy: { refType: string; refId: Types.ObjectId } | null;
  responsibleOrgId: Types.ObjectId | null;
}

type Line = Record<string, unknown> & { rowId: string };

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

const reference = (provider: string, labelField: string) => ({
  source: { provider, labelField },
});

function saleReversalDefinition(): FormDefinition {
  return definitionOf([
    field("note", "text"),
    field("branch", "reference", {
      ...reference("org", "name"),
      rules: { required: true },
    }),
    field("lines", "array", {
      columns: [
        column("book", "reference", {
          ...reference("lottery_book", "bookKey"),
          rules: { required: true },
        }),
        column("ticket_nos", "text", { rules: { required: true } }),
        column("tickets", "number", { rules: { required: true, min: 1 } }),
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
      ...reference("lottery_shift", "label"),
      visibleWhen: { "==": [{ var: "refund" }, "yes"] },
      rules: { required: true },
    }),
    field("refund_amount", "number", {
      valueSource: { kind: "computed", expr: { sumOf: ["lines", "amount"] } },
    }),
  ]);
}

const nos = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) =>
    String(from + i).padStart(3, "0"),
  );

let bookSequence = 500_000;
let rowSequence = 0;
let minute = 0;
let requestSequence = 0;

/** 店面時鐘往前一分鐘(每一步的事件時間不同)。 */
function tick(): Date {
  minute += 1;
  const at = new Date(Date.UTC(2026, 10, 5, 1, 0) + minute * 60_000);
  jest.spyOn(StoreClock.prototype, "now").mockReturnValue(at);
  return at;
}

describe("本狀態與再上檯面(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let tenant: Types.ObjectId;
  let storeA: Types.ObjectId;
  let storeB: Types.ObjectId;
  let pointA: Types.ObjectId;
  let pointB: Types.ObjectId;
  let hq: Person;
  let managerA: Person;
  let managerB: Person;
  let clerkA: Person;
  let clerkB: Person;
  let world: World;
  let game: Types.ObjectId;
  const docs = new Map<string, DefinitionNode>();

  const db = () => api.connection;
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

  function docOf(name: string): string {
    const picked = new Set<string>();
    const walk = (key: string) => {
      if (picked.has(key)) return;
      const def = docs.get(key);
      if (!def) throw new Error(`沒有 ${key}`);
      picked.add(key);
      visit(def, {
        FragmentSpread(node) {
          walk(node.name.value);
        },
      });
    };
    walk(name);
    return [...picked]
      .flatMap((key) => {
        const def = docs.get(key);
        return def === undefined ? [] : [print(def)];
      })
      .join("\n");
  }

  async function q(
    who: Person,
    name: string,
    variables: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const result = await api.graphql(docOf(name), variables, {
      accessToken: who.token,
    });
    if (result.errors) {
      return {
        errors: result.errors.map((error) => ({
          message: error.message,
          ext: error.extensions,
        })),
      };
    }
    return result.data ?? {};
  }

  async function must(
    who: Person,
    name: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const data = await q(who, name, variables);
    if ("errors" in data) {
      throw new Error(`${name} 失敗:${JSON.stringify(data.errors)}`);
    }
    return data;
  }

  async function ticketsOf(bookId: Types.ObjectId): Promise<TicketRow[]> {
    return db()
      .collection<TicketRow>(LOTTERY_TICKETS_COLLECTION)
      .find({ bookId })
      .sort({ ticketNo: 1 })
      .toArray();
  }

  async function refs(bookId: Types.ObjectId, ticketNos: readonly string[]) {
    const all = await ticketsOf(bookId);
    return all
      .filter((ticket) => ticketNos.includes(ticket.ticketNo))
      .map((ticket) => ({
        ticketId: String(ticket._id),
        version: ticket.version,
      }));
  }

  /** 進貨點收建本(進貨點收用的同一個服務 `createBook`)。 */
  async function newBook(
    orgId: Types.ObjectId,
    lastTicketNo = 100,
  ): Promise<{ bookId: Types.ObjectId; bookNo: string }> {
    bookSequence += 1;
    const bookNo = String(bookSequence).padStart(6, "0");
    const { book } = await transactions().withTransaction((session) =>
      api.app
        .get(LotteryBooksService)
        .createBook(session, storeOperator(orgId), {
          orgId,
          gameId: game,
          bookNo,
          lastTicketNo,
          rate: 100,
          cost: 2000,
        }),
    );
    return { bookId: book._id, bookNo: `0${bookNo}` };
  }

  /** 拆本 / 上檯面:這家店庫存裡未售、沒被鎖的張全部放到一個收銀點;回放了幾張。 */
  async function split(
    who: Person,
    orgId: Types.ObjectId,
    point: Types.ObjectId,
    bookId: Types.ObjectId,
    skipped: string[] = [],
    reopen = false,
  ): Promise<number> {
    tick();
    const all = await ticketsOf(bookId);
    const mine = all
      .filter(
        (ticket) =>
          ticket.orgId.equals(orgId) &&
          ticket.status === "unsold" &&
          ticket.location.kind === "stock" &&
          ticket.lockedBy === null &&
          !skipped.includes(ticket.ticketNo),
      )
      .map((ticket) => ticket.ticketNo);
    if (reopen) {
      expect(skipped).toEqual([]);
    }
    const data = await must(who, "SplitLotteryBook", {
      input: {
        orgId: String(orgId),
        bookId: String(bookId),
        skippedTicketNos: skipped,
        assignments: [{ cashPointId: String(point), ticketNos: mine }],
      },
    });
    return (data.splitLotteryBook as { count: number }).count - skipped.length;
  }

  async function sell(
    who: Person,
    orgId: Types.ObjectId,
    point: Types.ObjectId,
    bookId: Types.ObjectId,
    ticketNos: string[],
  ) {
    tick();
    await must(who, "SellLotteryTickets", {
      input: {
        orgId: String(orgId),
        localCashPointId: String(point),
        tickets: await refs(bookId, ticketNos),
        source: "scan",
      },
    });
  }

  async function recall(
    who: Person,
    orgId: Types.ObjectId,
    bookId: Types.ObjectId,
    ticketNos: string[],
  ) {
    tick();
    await must(who, "RecallLotteryTickets", {
      input: { orgId: String(orgId), tickets: await refs(bookId, ticketNos) },
    });
  }

  // ---- 調貨單 ----

  function wholeLine(bookId: Types.ObjectId): Line {
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
    };
  }

  function partialLine(bookId: Types.ObjectId, from: number, to: number) {
    const count = to - from + 1;
    return {
      ...wholeLine(bookId),
      mode: "partial",
      ticket_nos: `${String(from).padStart(3, "0")}-${String(to).padStart(3, "0")}`,
      tickets: count,
      amount: 20 * count,
      rate: 92,
    };
  }

  async function submitTransfer(lines: Line[]): Promise<string> {
    tick();
    const draft = await createDraft(api, hq.token, "transfer", {
      from_branch: String(storeA),
      to_branch: String(storeB),
      lines,
    });
    const result = await call(api, hq.token, SUBMIT_SUBMISSION, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    if (result.errors) {
      throw new Error(`調貨單送出失敗:${JSON.stringify(extensionsOf(result))}`);
    }
    return draft.id;
  }

  async function ship(id: string) {
    tick();
    await decideOn(world, managerA, id, "APPROVE");
  }

  async function receive(id: string, bookNo: string, ticketNo: string) {
    tick();
    const result = await call(api, managerB.token, RECEIVE, {
      input: { submissionId: id, code: `${bookNo}${ticketNo}` },
    });
    if (result.errors) {
      throw new Error(`點收失敗:${JSON.stringify(extensionsOf(result))}`);
    }
  }

  // ---- 盤點確認申請 ----

  function draftOf(
    orgId: Types.ObjectId,
    startedAt: Date,
    extra: Partial<StocktakeDraft>,
  ): StocktakeDraft {
    return {
      version: 1,
      orgId: String(orgId),
      scopeCashPointId: null,
      startedAt: startedAt.toISOString(),
      lines: [],
      unopened: [],
      lostReview: [],
      ...extra,
    };
  }

  async function stocktake(
    clerk: Person,
    manager: Person,
    orgId: Types.ObjectId,
    build: (startedAt: Date, countedAt: Date) => Partial<StocktakeDraft>,
  ) {
    const startedAt = tick();
    const countedAt = tick();
    const draft = draftOf(orgId, startedAt, build(startedAt, countedAt));
    tick();
    requestSequence += 1;
    const result = await api.graphql(
      /* GraphQL */ `
        mutation VSubmit($input: CreateAndSubmitFormSubmissionInput!) {
          createAndSubmitFormSubmission(input: $input) {
            submission {
              id
            }
          }
        }
      `,
      {
        input: {
          formKey: STOCKTAKE_CONFIRM_FORM_KEY,
          clientRequestId: `verify-stocktake-${String(requestSequence)}`,
          values: {
            branch: String(orgId),
            scope_label: "全店",
            totals: "",
            draft: serializeStocktakeDraft(draft),
          },
        },
      },
      { accessToken: clerk.token },
    );
    if (result.errors) {
      throw new Error(`盤點送出失敗:${JSON.stringify(result.errors)}`);
    }
    const id = (
      result.data as {
        createAndSubmitFormSubmission: { submission: { id: string } };
      }
    ).createAndSubmitFormSubmission.submission.id;
    tick();
    await decideOn(world, manager, id, "APPROVE");
  }

  /** 檯面上的本盤到 `missing` 不在 → 待查。 */
  async function investigateCounter(
    clerk: Person,
    manager: Person,
    orgId: Types.ObjectId,
    point: Types.ObjectId,
    bookId: Types.ObjectId,
    missing: string[],
  ) {
    const all = await ticketsOf(bookId);
    const unsold = all
      .filter(
        (ticket) =>
          ticket.orgId.equals(orgId) &&
          ticket.status === "unsold" &&
          ticket.location.kind === "counter",
      )
      .map((ticket) => ticket.ticketNo);
    await stocktake(clerk, manager, orgId, (_s, countedAt) => ({
      lines: [
        {
          bookId: String(bookId),
          cashPointId: String(point),
          countedAt: countedAt.toISOString(),
          method: "grid",
          presentTicketNos: unsold.filter((no) => !missing.includes(no)),
          diffs: missing.map((ticketNo) => ({
            ticketNo,
            action: "investigate" as const,
          })),
        },
      ],
    }));
  }

  async function investigateUnopened(
    clerk: Person,
    manager: Person,
    orgId: Types.ObjectId,
    bookId: Types.ObjectId,
  ) {
    await stocktake(clerk, manager, orgId, () => ({
      unopened: [{ bookId: String(bookId), present: false }],
    }));
  }

  async function confirmLost(
    clerk: Person,
    manager: Person,
    orgId: Types.ObjectId,
    bookId: Types.ObjectId,
  ) {
    const all = await ticketsOf(bookId);
    const missing = all.filter((ticket) => ticket.status === "investigating");
    await stocktake(clerk, manager, orgId, () => ({
      lostReview: missing.map((ticket) => ({
        ticketId: String(ticket._id),
        action: "lost" as const,
        reasonKey: "not-found",
      })),
    }));
  }

  async function recover(
    who: Person,
    orgId: Types.ObjectId,
    bookId: Types.ObjectId,
    ticketNos: string[],
  ) {
    tick();
    await must(who, "RecoverLotteryTickets", {
      input: {
        tickets: await refs(bookId, ticketNos),
        orgId: String(orgId),
        reasonKey: "found",
      },
    });
  }

  async function scrap(
    who: Person,
    bookId: Types.ObjectId,
    ticketNos: string[],
  ) {
    tick();
    await must(who, "ScrapLotteryTickets", {
      input: { tickets: await refs(bookId, ticketNos), reasonKey: "damp" },
    });
  }

  async function saleReversal(bookId: Types.ObjectId, ticketNos: string[]) {
    tick();
    const draft = await createDraft(api, clerkA.token, SALE_REVERSAL_FORM_KEY, {
      branch: String(storeA),
      lines: [
        {
          rowId: randomUUID(),
          book: String(bookId),
          ticket_nos: `${ticketNos[0] ?? ""}-${ticketNos.at(-1) ?? ""}`,
          tickets: ticketNos.length,
          amount: 20 * ticketNos.length,
        },
      ],
      reason: "customer-return",
      refund: "no",
      note: "客人退貨",
    });
    await submitDraft(api, clerkA.token, draft);
  }

  /** 進貨單作廢的效果(同 `purchase-rules.service.ts` `revokeBooks`:每張寫進貨作廢事件、本 → revoked)。 */
  async function revoke(bookId: Types.ObjectId) {
    const tickets = await ticketsOf(bookId);
    const refId = new Types.ObjectId();
    await transactions().withTransaction(async (session) => {
      await api.app.get(TicketLedgerService).applyTicketEvents(
        session,
        { operator: null, crossStoreTenantId: tenant },
        tickets.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          type: "purchase_void" as const,
          patch: {},
          refType: "purchase",
          refId,
          reasonKey: null,
          reasonNote: null,
        })),
      );
    });
    await db()
      .collection("lottery_books")
      .updateOne({ _id: bookId }, { $set: { status: "revoked" } });
  }

  async function setup() {
    const dir = path.resolve(
      __dirname,
      "../../../../../../packages/graphql/src/documents/project/lottery",
    );
    for (const file of readdirSync(dir)) {
      const ast = parse(readFileSync(path.join(dir, file), "utf8"));
      for (const def of ast.definitions) {
        if (
          (def.kind === Kind.OPERATION_DEFINITION ||
            def.kind === Kind.FRAGMENT_DEFINITION) &&
          def.name
        ) {
          docs.set(def.name.value, def);
        }
      }
    }

    api = await startAuthTestApp("scratch-lot-test-book-state");
    const connection = api.connection;
    await api.app
      .get<Model<LotteryStocktake>>(getModelToken(LotteryStocktake.name))
      .init();
    await api.app
      .get<Model<LotteryShift>>(getModelToken(LotteryShift.name))
      .init();
    await seedTransferAuthorization(connection);

    // 庫存管理 + 本的詳情
    const { insertedId: listId } = await connection
      .collection("modules")
      .insertOne({
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
        ...base(),
      });
    await connection.collection("modules").insertOne({
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
      ...base(),
    });
    await connection.collection("permissions").insertMany(
      Object.values(INV).map((key) => ({
        key,
        moduleId: listId,
        name: key,
        enabled: true,
        isSystem: false,
        settings: {},
        source: "seed",
        retiredAt: null,
        ...base(),
      })),
    );
    // 店面管理
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
        perFormCreate: true,
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
    for (const [key, items] of [
      [LOTTERY_FIELD_CATEGORY_KEYS.lostReason, [["not-found", "找不到"]]],
      [LOTTERY_FIELD_CATEGORY_KEYS.recoverReason, [["found", "找到了"]]],
      [LOTTERY_FIELD_CATEGORY_KEYS.scrapReason, [["damp", "受潮"]]],
      [
        LOTTERY_FIELD_CATEGORY_KEYS.saleReversalReason,
        [["customer-return", "客人退貨"]],
      ],
    ] as const) {
      await seedReasonCategory(
        connection,
        key,
        items.map(([value, label]) => ({ value, label })),
      );
    }

    tenant = await createOrg(connection, {
      name: "好運彩券行",
      settings: { visibility: "subtree" },
    });
    storeA = await createOrg(connection, { name: "中山店", parentId: tenant });
    storeB = await createOrg(connection, { name: "新竹店", parentId: tenant });
    const points = connection.collection(LOTTERY_CASH_POINTS_COLLECTION);
    ({ insertedId: pointA } = await points.insertOne({
      orgId: storeA,
      tenantId: tenant,
      positionKey: "position-1",
      name: "中山櫃台",
      order: 1,
      enabled: true,
      printerId: null,
      note: null,
      moduleKey: "master-data",
      ...base(),
    }));
    ({ insertedId: pointB } = await points.insertOne({
      orgId: storeB,
      tenantId: tenant,
      positionKey: "position-1",
      name: "新竹櫃台",
      order: 1,
      enabled: true,
      printerId: null,
      note: null,
      moduleKey: "master-data",
      ...base(),
    }));
    game = await insertGame(connection, tenant, {
      gameCode: "5164",
      name: "發大財",
      unitPrice: 20,
      ticketsPerBook: 100,
    });

    // 表單:調貨單、盤點確認申請、撤銷售出申請
    const root = await rootToken(api);
    await ok(api, root, CREATE_FORM, {
      input: {
        key: "transfer",
        moduleKey: "purchasing.transfer",
        name: "調貨單",
      },
    });
    await publishDefinition(api, root, "transfer", transferDefinition(), null);
    await ok(api, root, UPDATE_FORM, {
      input: {
        key: "transfer",
        sharedByFieldKeys: TRANSFER_SHARED_BY_FIELD_KEYS,
      },
    });
    await ok(api, root, ASSIGN, {
      input: { formKey: "transfer", tenantOrgIds: [String(tenant)] },
    });
    await ok(api, root, CREATE_FORM, {
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
    await ok(api, root, ASSIGN, {
      input: {
        formKey: STOCKTAKE_CONFIRM_FORM_KEY,
        tenantOrgIds: [String(tenant)],
      },
    });
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

    const admin = await person(api, connection, tenant, tenant, {
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
      ...TRANSFER_MODULE_KEYS,
      "apply-center",
      "apply-center.view-page",
      "store",
      INVENTORY_MODULE_KEYS.list,
      INVENTORY_MODULE_KEYS.bookPage,
    ];
    const everything = [
      ...Object.values(TRANSFER_PERMISSION_KEYS),
      ...Object.values(S),
      ...Object.values(INV),
      STORE_FORM_PERMISSIONS.createSaleReversal,
      `store.create-${STOCKTAKE_CONFIRM_FORM_KEY}`,
      "apply-center.view",
    ];
    const scope = { moduleKeys: modules, permissionKeys: everything };
    hq = await person(api, connection, tenant, tenant, scope);
    managerA = await person(api, connection, storeA, tenant, scope);
    managerB = await person(api, connection, storeB, tenant, scope);
    clerkA = await person(api, connection, storeA, tenant, scope);
    clerkB = await person(api, connection, storeB, tenant, scope);
    const storeManager = await createRole(api.app, connection, {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [managerA.userId, managerB.userId],
    });
    world = { api, connection, admin } as unknown as World;
    await publishWorkflow(world, "transfer_flow", {
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
      checkFormKey: "transfer",
    });
    await bindForm(world, "transfer_flow", "transfer");
    for (const [key, formKey] of [
      ["stocktake_flow", STOCKTAKE_CONFIRM_FORM_KEY],
      ["sale_reversal_flow", SALE_REVERSAL_FORM_KEY],
    ] as const) {
      await publishWorkflow(world, key, {
        steps: [
          formKey === STOCKTAKE_CONFIRM_FORM_KEY
            ? reviewStep(
                "store_manager",
                audienceSource(audienceRow("role", [storeManager])),
              )
            : reviewStep(
                "store_manager",
                audienceSource(
                  audienceRow("role", [storeManager]),
                  audienceRow(
                    "org",
                    { kind: "dynamic", ref: "form-field:branch" },
                    "self",
                  ),
                ),
              ),
        ],
        checkFormKey: formKey,
      });
      await bindForm(world, key, formKey);
    }

    // 兩店櫃台的班開著(店員開的)
    const shifts = connection.collection(LOTTERY_SHIFTS_COLLECTION);
    for (const [orgId, point, clerk, label] of [
      [storeA, pointA, clerkA, "中山櫃台 · 店員A"],
      [storeB, pointB, clerkB, "新竹櫃台 · 店員B"],
    ] as const) {
      await shifts.insertOne({
        orgId,
        tenantId: tenant,
        cashPointId: point,
        openedBy: clerk.userId,
        openedAt: new Date(Date.UTC(2026, 10, 5, 0, 0)),
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
    }
  }

  // ---- 檢查 ----

  interface ListBook {
    id: string;
    state: string;
    remainingCount: number;
    totalCount: number;
    pendingSkipCount: number;
    holdings: { org: { name: string }; count: number }[];
  }

  async function listOf(
    who: Person,
    orgId: Types.ObjectId,
    state?: string,
  ): Promise<ListBook[]> {
    const data = await must(who, "LotteryInventoryBooks", {
      input: {
        orgId: String(orgId),
        pageSize: 100,
        ...(state === undefined ? {} : { state }),
      },
    });
    return (data.lotteryInventoryBooks as { items: ListBook[] }).items;
  }

  interface Detail {
    book: ListBook;
    investigation: { status: string } | null;
    locations: { place: { cashPoint: { name: string } | null } }[];
    events: { type: string; reopen: boolean }[];
  }

  async function detailOf(who: Person, bookId: Types.ObjectId) {
    const data = await must(who, "LotteryInventoryBook", {
      id: String(bookId),
    });
    return (data.lotteryInventoryBook as { item: Detail }).item;
  }

  /**
   * 一本的顯示狀態在各處一致:本上的張數 = 重數張;總部的列表 / 詳情頁首 = 預期;每個篩選只在狀態相符時列出
   * (和 `bookDisplayStateOf` 同一套)。記下實際數字給回報用。
   */
  async function expectState(
    label: string,
    bookId: Types.ObjectId,
    expected: string,
  ): Promise<Detail> {
    const tickets = await ticketsOf(bookId);
    const book = await db()
      .collection<{ ticketCounts: Record<string, number> }>("lottery_books")
      .findOne({ _id: bookId });
    const recount = bookCountsOf(
      tickets.map((ticket) => ({
        status: ticket.status as TicketStatus,
        locationKind: ticket.location.kind as TicketLocationKind,
      })),
    );
    expect({ label, counts: book?.ticketCounts }).toEqual({
      label,
      counts: recount,
    });
    const detail = await detailOf(hq, bookId);
    expect({ label, state: detail.book.state }).toEqual({
      label,
      state: expected,
    });
    const all = await listOf(hq, tenant);
    const row = all.find((item) => item.id === String(bookId));
    if (expected === "revoked") {
      expect(row).toBeUndefined();
    } else {
      expect({ label, state: row?.state }).toEqual({ label, state: expected });
      for (const state of INVENTORY_BOOK_FILTER_STATES) {
        if (state === "pending_skip") {
          continue;
        }
        const filtered = await listOf(hq, tenant, state);
        expect({
          label,
          state,
          listed: filtered.some((item) => item.id === String(bookId)),
        }).toEqual({ label, state, listed: state === expected });
      }
    }
    return detail;
  }

  interface SplitItem {
    bookId: string;
    ticketCount: number;
    pendingSkipCount: number;
    opened: boolean;
  }

  async function splitListItem(
    who: Person,
    orgId: Types.ObjectId,
    bookId: Types.ObjectId,
  ): Promise<SplitItem | undefined> {
    const data = await must(who, "LotteryStoreUnopenedBooks", {
      orgId: String(orgId),
    });
    return (
      data.lotteryStoreUnopenedBooks as { items: SplitItem[] }
    ).items.find((item) => item.bookId === String(bookId));
  }

  async function transferOption(
    who: Person,
    from: Types.ObjectId,
    to: Types.ObjectId,
    bookId: Types.ObjectId,
  ) {
    const data = await must(who, "LotteryTransferOptions", {
      fromOrgId: String(from),
      toOrgId: String(to),
    });
    return (
      data.lotteryTransferOptions as {
        books: { bookId: string; isWhole: boolean }[];
      }
    ).books.find((item) => item.bookId === String(bookId));
  }

  async function sheetOf(who: Person, orgId: Types.ObjectId) {
    const data = await must(who, "LotteryStocktakeSheet", {
      input: { orgId: String(orgId) },
    });
    return data.lotteryStocktakeSheet as {
      books: {
        bookId: string;
        cashPointId: string;
        tickets: { ticketNo: string; status: string }[];
      }[];
      unopenedBooks: { bookId: string; ticketCount: number }[];
    };
  }

  beforeAll(async () => {
    await setup();
  }, HOOK_TIMEOUT_MS * 4);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("每種情況的顯示狀態(實測表 C01–C16):列表、篩選、詳情頁首一致;本上張數 = 重數張", async () => {
    tick();
    const c01 = await newBook(storeA);
    await expectState("C01 未拆", c01.bookId, "unopened");

    const c02 = await newBook(storeA);
    const transferId = await submitTransfer([wholeLine(c02.bookId)]);
    await expectState("C02a 整本調貨送出(鎖住)", c02.bookId, "unopened");
    // 拆本清單排除被調貨單鎖住的本
    await expect(
      splitListItem(clerkA, storeA, c02.bookId),
    ).resolves.toBeUndefined();
    await ship(transferId);
    await expectState("C02 整本在途", c02.bookId, "in_transit");
    await receive(transferId, c02.bookNo, "100");
    await expectState("C02b 收貨店點收", c02.bookId, "unopened");

    const c03 = await newBook(storeA);
    await split(clerkA, storeA, pointA, c03.bookId);
    await expectState("C03 拆本在檯面", c03.bookId, "on_counter");
    await recall(clerkA, storeA, c03.bookId, nos(71, 100));
    await expectState("C04 收回 30", c03.bookId, "on_counter");
    await recall(clerkA, storeA, c03.bookId, nos(1, 70));
    await expectState("C04b 全部收回", c03.bookId, "in_stock");

    const c05 = await newBook(storeA);
    await split(clerkA, storeA, pointA, c05.bookId);
    await sell(clerkA, storeA, pointA, c05.bookId, nos(1, 100));
    await expectState("C05 賣完", c05.bookId, "sold_out");

    const c06 = await newBook(storeA);
    await investigateUnopened(clerkA, managerA, storeA, c06.bookId);
    const d06 = await expectState(
      "C06 未拆整本待查",
      c06.bookId,
      "investigating",
    );
    expect(d06.investigation?.status).toBe("investigating");
    await recover(managerA, storeA, c06.bookId, nos(1, 3));
    const d10 = await expectState("C10 尋回 3", c06.bookId, "in_stock");
    expect(d10.investigation).toBeNull();

    const c07 = await newBook(storeA);
    await investigateUnopened(clerkA, managerA, storeA, c07.bookId);
    await confirmLost(clerkA, managerA, storeA, c07.bookId);
    await expectState("C07 未拆整本遺失", c07.bookId, "lost");

    const c08 = await newBook(storeA);
    await split(clerkA, storeA, pointA, c08.bookId);
    await sell(clerkA, storeA, pointA, c08.bookId, nos(1, 10));
    await investigateCounter(
      clerkA,
      managerA,
      storeA,
      pointA,
      c08.bookId,
      nos(11, 100),
    );
    const d08 = await expectState(
      "C08 賣 10、90 待查",
      c08.bookId,
      "investigating",
    );
    // 狀態列放寬:沒有未售、而且有待查 / 遺失
    expect(d08.investigation?.status).toBe("investigating");
    await confirmLost(clerkA, managerA, storeA, c08.bookId);
    await expectState("C08b 賣 10、90 遺失", c08.bookId, "lost");

    const c09 = await newBook(storeA);
    await split(clerkA, storeA, pointA, c09.bookId);
    await sell(clerkA, storeA, pointA, c09.bookId, nos(1, 10));
    await scrap(managerA, c09.bookId, nos(11, 100));
    await expectState("C09 賣 10、90 報廢", c09.bookId, "sold_out");

    const c09c = await newBook(storeA);
    await scrap(managerA, c09c.bookId, nos(1, 100));
    await expectState("C09c 未拆整本報廢", c09c.bookId, "scrapped");

    const c11 = await newBook(storeA);
    await split(clerkA, storeA, pointA, c11.bookId);
    await investigateCounter(
      clerkA,
      managerA,
      storeA,
      pointA,
      c11.bookId,
      nos(99, 100),
    );
    await expectState("C11 檯面 98、待查 2", c11.bookId, "on_counter");

    const c11b = await newBook(storeA);
    await investigateUnopened(clerkA, managerA, storeA, c11b.bookId);
    await recover(managerA, storeA, c11b.bookId, nos(1, 98));
    await expectState("C11b 整本待查尋回 98", c11b.bookId, "in_stock");

    const c12 = await newBook(storeA);
    await split(clerkA, storeA, pointA, c12.bookId);
    await recall(clerkA, storeA, c12.bookId, nos(91, 100));
    await submitTransfer([partialLine(c12.bookId, 91, 100)]);
    await expectState("C12 10 張調貨鎖住", c12.bookId, "on_counter");

    const c13 = await newBook(storeA);
    await split(clerkA, storeA, pointA, c13.bookId);
    await recall(clerkA, storeA, c13.bookId, nos(81, 100));
    const partial = await submitTransfer([partialLine(c13.bookId, 81, 100)]);
    await ship(partial);
    await expectState("C13a 檯面 80、在途 20", c13.bookId, "on_counter");
    await receive(partial, c13.bookNo, "081");
    await expectState("C13b B 點收 20", c13.bookId, "on_counter");
    await split(clerkB, storeB, pointB, c13.bookId, [], true);
    await expectState("C13c B 上檯面 20", c13.bookId, "on_counter");
    // 對方收銀點名稱:B 看得到 A 的收銀點、A 看得到 B 的
    const seenByB = await detailOf(managerB, c13.bookId);
    expect(
      seenByB.locations.map((location) => location.place.cashPoint?.name),
    ).toEqual(expect.arrayContaining(["中山櫃台", "新竹櫃台"]));
    const seenByA = await detailOf(managerA, c13.bookId);
    expect(
      seenByA.locations.map((location) => location.place.cashPoint?.name),
    ).toEqual(expect.arrayContaining(["中山櫃台", "新竹櫃台"]));
    await sell(clerkA, storeA, pointA, c13.bookId, nos(1, 80));
    await expectState("C13d A 賣完 80", c13.bookId, "on_counter");
    // 所在分店只算未售的張
    const listA = await listOf(managerA, storeA);
    expect(
      listA.find((item) => item.id === String(c13.bookId))?.holdings,
    ).toEqual([{ org: { id: String(storeB), name: "新竹店" }, count: 20 }]);
    await sell(clerkB, storeB, pointB, c13.bookId, nos(81, 100));
    await expectState("C13e 兩店都賣完", c13.bookId, "sold_out");

    const c13f = await newBook(storeA);
    await split(clerkA, storeA, pointA, c13f.bookId);
    await recall(clerkA, storeA, c13f.bookId, nos(81, 100));
    const partialF = await submitTransfer([partialLine(c13f.bookId, 81, 100)]);
    await ship(partialF);
    await sell(clerkA, storeA, pointA, c13f.bookId, nos(1, 80));
    await expectState("C13f A 賣完、20 在途", c13f.bookId, "in_transit");

    const c14 = await newBook(storeA, 102);
    await expectState("C14 待標註 2 未拆", c14.bookId, "unopened");
    const pending = await listOf(hq, tenant, "pending_skip");
    expect(pending.map((item) => item.id)).toContain(String(c14.bookId));

    const c15 = await newBook(storeA);
    await split(clerkA, storeA, pointA, c15.bookId);
    await sell(clerkA, storeA, pointA, c15.bookId, nos(1, 5));
    await saleReversal(c15.bookId, nos(1, 2));
    await expectState("C15 撤銷申請審核中", c15.bookId, "on_counter");

    const c16 = await newBook(storeA);
    await revoke(c16.bookId);
    await expectState("C16 進貨作廢", c16.bookId, "revoked");
  });

  it("再上檯面(題 1–3):拆過的本收回 / 賣過 / 尋回的庫存張能放上檯面;拆過就只能選張調、刷到維持擋下", async () => {
    // 題 1:拆過、全部收回 → 清單標拆過,不能整本調;再放上檯面,時間軸第二次寫「上檯面」
    const q1 = await newBook(storeA, 102);
    await split(clerkA, storeA, pointA, q1.bookId, ["037", "064"]);
    await recall(
      clerkA,
      storeA,
      q1.bookId,
      nos(1, 102).filter((no) => no !== "037" && no !== "064"),
    );
    await expectState("題1 拆過全部收回", q1.bookId, "in_stock");
    await expect(
      splitListItem(clerkA, storeA, q1.bookId),
    ).resolves.toMatchObject({
      bookId: String(q1.bookId),
      ticketCount: 100,
      pendingSkipCount: 0,
      opened: true,
    });
    await expect(
      transferOption(hq, storeA, storeB, q1.bookId),
    ).resolves.toMatchObject({ isWhole: false });
    await split(clerkA, storeA, pointA, q1.bookId, [], true);
    const d1 = await expectState("題1 再上檯面", q1.bookId, "on_counter");
    expect(
      d1.events
        .filter((event) => event.type === "open")
        .map((event) => event.reopen),
    ).toEqual([true, false]);

    // 題 2:拆本、賣 10、其餘 90 收回 → 拆本清單「拆過 · 庫存 90」,90 張上檯面
    const q2 = await newBook(storeA);
    await split(clerkA, storeA, pointA, q2.bookId);
    await sell(clerkA, storeA, pointA, q2.bookId, nos(1, 10));
    await recall(clerkA, storeA, q2.bookId, nos(11, 100));
    await expectState("題2 賣 10、收回 90", q2.bookId, "in_stock");
    await expect(
      splitListItem(clerkA, storeA, q2.bookId),
    ).resolves.toMatchObject({
      bookId: String(q2.bookId),
      ticketCount: 90,
      pendingSkipCount: 0,
      opened: true,
    });
    // 刷到庫存的張:維持擋下(in_stock)
    const scanned = await must(clerkA, "LotteryStoreScan", {
      input: {
        orgId: String(storeA),
        localCashPointId: String(pointA),
        code: `${q2.bookNo}050`,
      },
    });
    expect(
      (
        scanned.lotteryStoreScan as {
          items: { outcome: string; blockReason: string | null }[];
        }
      ).items[0],
    ).toMatchObject({ outcome: "blocked", blockReason: "in_stock" });
    // 庫存概況:拆過的庫存張不再消失
    const overview = await must(hq, "LotteryStockOverview", {
      input: { orgId: String(storeA) },
    });
    const overviewRow = (
      overview.lotteryStockOverview as {
        items: { openedStockTickets: number; unopenedBooks: number }[];
      }
    ).items[0];
    expect(overviewRow?.openedStockTickets).toBeGreaterThanOrEqual(90);
    const placed = await split(clerkA, storeA, pointA, q2.bookId, [], true);
    expect(placed).toBe(90);
    await expectState("題2 90 張上檯面", q2.bookId, "on_counter");

    // 題 3:整本待查 → 尋回 3 張 → 能上檯面(從沒拆過:清單標未拆);全部尋回的本可以整本調
    const q3 = await newBook(storeA);
    await investigateUnopened(clerkA, managerA, storeA, q3.bookId);
    await recover(managerA, storeA, q3.bookId, nos(1, 3));
    await expect(
      splitListItem(clerkA, storeA, q3.bookId),
    ).resolves.toMatchObject({
      bookId: String(q3.bookId),
      ticketCount: 3,
      pendingSkipCount: 0,
      opened: false,
    });
    await split(clerkA, storeA, pointA, q3.bookId, [], true);
    await expectState("題3 尋回 3 張上檯面", q3.bookId, "on_counter");

    const q3b = await newBook(storeA);
    await investigateUnopened(clerkA, managerA, storeA, q3b.bookId);
    await recover(managerA, storeA, q3b.bookId, nos(1, 100));
    await expectState("題3 後段全部尋回", q3b.bookId, "unopened");
    await expect(
      transferOption(hq, storeA, storeB, q3b.bookId),
    ).resolves.toMatchObject({ isWhole: true });
  });

  it("盤點頁列出拆過、在庫存的張並能盤出待查;「未拆的本 · 不在」只收真的未拆的本", async () => {
    const book = await newBook(storeA);
    await split(clerkA, storeA, pointA, book.bookId);
    await sell(clerkA, storeA, pointA, book.bookId, nos(1, 10));
    await recall(clerkA, storeA, book.bookId, nos(11, 100));
    const sheet = await sheetOf(clerkA, storeA);
    const line = sheet.books.find(
      (item) => item.bookId === String(book.bookId),
    );
    expect(line?.cashPointId).toBe(STOCKTAKE_STOCK_LINE);
    expect(line?.tickets).toHaveLength(90);
    expect(
      sheet.unopenedBooks.some((item) => item.bookId === String(book.bookId)),
    ).toBe(false);

    // 拆過的本放進「未拆的本 · 不在」→ 已被處理(不會整本變待查)
    const startedAt = tick();
    const stale = await must(managerA, "LotteryStocktakeReview", {
      input: {
        draft: serializeStocktakeDraft(
          draftOf(storeA, startedAt, {
            unopened: [{ bookId: String(book.bookId), present: false }],
          }),
        ),
      },
    });
    expect(
      (stale.lotteryStocktakeReview as { staleCount: number }).staleCount,
    ).toBe(1);

    // 庫存那一區盤到 #099、#100 不在 → 只能待查;核准後 2 張待查
    const missing = ["099", "100"];
    await stocktake(clerkA, managerA, storeA, (_s, countedAt) => ({
      lines: [
        {
          bookId: String(book.bookId),
          cashPointId: STOCKTAKE_STOCK_LINE,
          countedAt: countedAt.toISOString(),
          method: "grid",
          presentTicketNos: nos(11, 98),
          diffs: missing.map((ticketNo) => ({
            ticketNo,
            action: "investigate" as const,
          })),
        },
      ],
    }));
    const after = await ticketsOf(book.bookId);
    expect(
      after
        .filter((ticket) => ticket.status === "investigating")
        .map((ticket) => ticket.ticketNo),
    ).toEqual(missing);
    await expectState("盤點庫存區 2 張待查", book.bookId, "in_stock");
  });

  it("本上張數依本整批 $inc:一次賣 4 本(張數相同)比 1 本不多指令(防退化,TX-06)", async () => {
    const books: { bookId: Types.ObjectId; bookNo: string }[] = [];
    for (let index = 0; index < 5; index += 1) {
      const book = await newBook(storeA);
      await split(clerkA, storeA, pointA, book.bookId);
      books.push(book);
    }
    const sellOne = async (list: typeof books) => {
      const tickets: { ticketId: string; version: number }[] = [];
      for (const book of list) {
        tickets.push(...(await refs(book.bookId, ["001"])));
      }
      tick();
      return countDbCommands(() =>
        must(clerkA, "SellLotteryTickets", {
          input: {
            orgId: String(storeA),
            localCashPointId: String(pointA),
            tickets,
            source: "scan",
          },
        }),
      );
    };
    const one = await sellOne(books.slice(0, 1));
    const four = await sellOne(books.slice(1));
    expectDbCommandsAtMost(four, one.total + 2, "賣 4 本各 1 張");
    for (const book of books) {
      await expectState(`指令數 ${book.bookNo}`, book.bookId, "on_counter");
    }
  });
});
