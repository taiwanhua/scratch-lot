import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  PURCHASE_FIELD_KEYS,
  PURCHASE_SETTLEMENT_SIDE,
} from "@repo/domain/project/lottery";

import {
  type AuthTestApp,
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
  FORM_SUBMISSION,
  FORM_SUBMISSIONS,
  type SubmissionRow,
  UPDATE_FORM,
  call,
  createDraft,
  extensionsOf,
  ok,
  publishDefinition,
  rootToken,
  submitDraft,
} from "../../../forms/test-support/form-fixtures";
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
import { isGameInUse } from "../games/game-usage";
import { inTransitBooksOf } from "../requisition/in-transit";
import { PURCHASE_REASONS } from "./purchase-error";
import {
  PURCHASE_MODULE_KEYS,
  PURCHASE_PERMISSION_KEYS,
  insertBankAccount,
  insertDealer,
  insertGame,
  insertRequisition,
  insertTrustee,
  purchaseDefinition,
  seedInventoryModule,
  seedPurchaseAuthorization,
} from "./test-support/purchase-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const FORM = "purchase";
const MODULE = "purchasing.purchase";

/**
 * 進貨單作廢的資料庫指令數上限(防退化,TX-06):整個作廢請求(守門、狀態、事後動作、稽核)的總數,
 * 與多出的本數無關(批次寫入後實測約 75 次)。逐張寫帳本時每本約 500 次,1 本就超過。
 */
const VOID_COMMANDS_LIMIT = 120;
/** 4 本比 1 本可以多的指令數(只容許少量與本數無關的差異)。 */
const VOID_COMMANDS_PER_EXTRA_BOOKS = 5;

const RECEIVE = /* GraphQL */ `
  mutation TestReceive($input: ReceiveLotteryPurchaseBookInput!) {
    receiveLotteryPurchaseBook(input: $input) {
      rowId
      receiving {
        canReceive
        receivedCount
        totalCount
        groups {
          gameCode
          requestedBooks
          receivedBooks
          rows {
            rowId
            received
          }
        }
      }
    }
  }
`;

const RECEIVING = /* GraphQL */ `
  query TestReceiving($id: ID!) {
    lotteryPurchaseReceiving(submissionId: $id) {
      canReceive
      receivedCount
      totalCount
      groups {
        gameCode
        requestedBooks
        receivedBooks
      }
    }
  }
`;

const COMPLETE = /* GraphQL */ `
  mutation TestComplete($input: CompleteLotteryPurchaseReceivingInput!) {
    completeLotteryPurchaseReceiving(input: $input) {
      batch {
        batchId
        no
        rowIds
      }
      receiving {
        batches {
          batchId
          no
          rowIds
        }
        groups {
          rows {
            rowId
            batchId
          }
        }
      }
      receiptLinks {
        purchaseView
      }
    }
  }
`;

interface CompletePayload {
  batch: { batchId: string; no: number; rowIds: string[] } | null;
  receiptLinks: { purchaseView: string | null };
  receiving: {
    batches: { batchId: string; no: number; rowIds: string[] }[];
    groups: { rows: { rowId: string; batchId: string | null }[] }[];
  };
}

const NOTIFY_WRONG_STORE = /* GraphQL */ `
  mutation TestWrongStore($input: ReceiveLotteryPurchaseBookInput!) {
    notifyLotteryPurchaseWrongStore(input: $input)
  }
`;

const SETTLEMENT = /* GraphQL */ `
  query TestSettlement($moduleKey: String!, $refId: ID!) {
    lotterySettlement(moduleKey: $moduleKey, refId: $refId) {
      item {
        payable
        sides {
          side
          net
          canSettle
          buttons {
            button
            defaultAmount
          }
        }
      }
    }
  }
`;

const REVERSE_SETTLEMENT = /* GraphQL */ `
  mutation TestReverseSettlement($input: ReverseLotterySettlementInput!) {
    reverseLotterySettlement(input: $input) {
      recordId
    }
  }
`;

const RECORD_SETTLEMENT = /* GraphQL */ `
  mutation TestRecordSettlement($input: RecordLotterySettlementInput!) {
    recordLotterySettlement(input: $input) {
      recordId
    }
  }
`;

const PROGRESS = /* GraphQL */ `
  query TestProgress($ids: [ID!]!) {
    lotteryPurchaseProgress(purchaseIds: $ids) {
      purchaseId
      receivedCount
      totalCount
      settlementKind
      settlementAmount
    }
  }
`;

const DEALER_PURCHASES = /* GraphQL */ `
  query TestDealerPurchases($dealerId: ID!) {
    lotteryDealerPurchases(dealerId: $dealerId) {
      purchaseId
      selfPurchase
      books
      purchaseTotal
    }
  }
`;

const OPTIONS = /* GraphQL */ `
  query TestOptions($orgId: ID!, $submissionId: ID) {
    lotteryPurchaseOptions(orgId: $orgId, submissionId: $submissionId) {
      dealers {
        id
      }
      trustees {
        dealerId
        id
      }
      accounts {
        id
      }
      requisitions {
        serialNo
        lines {
          books
        }
      }
      games {
        gameCode
      }
      allocations {
        gameId
        plannedBooks
        inTransitBooks
      }
    }
  }
`;

const STOCK = /* GraphQL */ `
  query TestStock($input: LotteryStockOverviewInput!) {
    lotteryStockOverview(input: $input) {
      items {
        unopenedBooks
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

interface Settlement {
  payable: number;
  sides: {
    side: string;
    net: number;
    canSettle: boolean;
    buttons: { button: string; defaultAmount: number }[];
  }[];
}

function defaultsOf(settlement: Settlement): Record<string, number> {
  return Object.fromEntries(
    (settlement.sides[0]?.buttons ?? []).map((item) => [
      item.button,
      item.defaultAmount,
    ]),
  );
}

function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`沒有第 ${String(index)} 筆`);
  }
  return item;
}

let bookSequence = 100_000;
let rowSequence = 0;

/** 一本:遊戲、本號(7 位)、最後張號、批購金額率。 */
interface BookLine {
  rowId: string;
  game: string;
  book_no: string;
  last_ticket_no: number;
  tickets: number;
  book_price: number;
  rate: number;
}

describe("進貨單(規格 8.2、8.3)", () => {
  let api: AuthTestApp;
  let tenant: Types.ObjectId;
  let branchA: Types.ObjectId;
  let branchB: Types.ObjectId;
  let hq: Person;
  let hqNoSettle: Person;
  let managerA: Person;
  let managerB: Person;
  /** 分店 A、有進貨單 `view` + `settle`(依欄位共用進來的單:看得到收付、不能按) */
  let settlerA: Person;
  let helperA: Person;
  let admin: Person;
  let gameHot: Types.ObjectId;
  let gameGold: Types.ObjectId;
  let gameStopped: Types.ObjectId;
  let dealer: Types.ObjectId;
  let dealerSuspended: Types.ObjectId;
  let dealerOther: Types.ObjectId;
  let trustee: Types.ObjectId;
  let strangerTrustee: Types.ObjectId;
  let account: Types.ObjectId;
  let accountOnlyB: Types.ObjectId;
  let publishBadge: jest.SpiedFunction<RealtimePublisher["publishBadge"]>;

  const db = () => api.connection;

  function book(
    gameId: Types.ObjectId,
    overrides: Partial<BookLine> = {},
  ): BookLine {
    bookSequence += 1;
    rowSequence += 1;
    const isGold = gameId.equals(gameGold);
    return {
      rowId: `00000000-0000-4000-8000-${String(rowSequence).padStart(12, "0")}`,
      game: String(gameId),
      book_no: `0${String(bookSequence).padStart(6, "0")}`,
      last_ticket_no: 100,
      tickets: 100,
      book_price: isGold ? 10_000 : 20_000,
      rate: 92,
      ...overrides,
    };
  }

  function header(
    branch: Types.ObjectId,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      branch: String(branch),
      dealer: String(dealer),
      self_purchase: true,
      purchase_date: "2026-10-12T16:00:00.000Z",
      account: String(account),
      ...overrides,
    };
  }

  async function draftOf(
    lines: BookLine[],
    branch = branchA,
    overrides: Record<string, unknown> = {},
  ): Promise<SubmissionRow> {
    return createDraft(api, hq.token, FORM, {
      ...header(branch, overrides),
      lines,
    });
  }

  async function submit(
    lines: BookLine[],
    branch = branchA,
    overrides: Record<string, unknown> = {},
  ): Promise<SubmissionRow> {
    return submitDraft(api, hq.token, await draftOf(lines, branch, overrides));
  }

  async function submitBlocked(
    lines: BookLine[],
    branch = branchA,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const draft = await draftOf(lines, branch, overrides);
    const result = await call(api, hq.token, SUBMIT_SUBMISSION, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    return extensionsOf(result);
  }

  /** 刷這本的最後一張(背面編號)。 */
  function codeOf(line: BookLine, lastTicketNo = line.last_ticket_no): string {
    const gameCode = line.game === String(gameGold) ? "5201" : "5164";
    return `${gameCode}-1-${line.book_no.slice(1)}-${String(lastTicketNo).padStart(3, "0")}-0-6`;
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

  async function receiveAll(
    submissionId: string,
    lines: readonly BookLine[],
  ): Promise<void> {
    for (const line of lines) {
      expect(await receive(managerA, submissionId, codeOf(line))).toEqual({});
    }
  }

  async function settlementOf(submissionId: string): Promise<Settlement> {
    const data = await ok<{ lotterySettlement: { item: Settlement } }>(
      api,
      hq.token,
      SETTLEMENT,
      { moduleKey: MODULE, refId: submissionId },
    );
    return data.lotterySettlement.item;
  }

  /** 進貨單列表(底座表單列表)裡這個人看得到的單。 */
  async function listedTo(person: Person): Promise<string[]> {
    const data = await ok<{
      formSubmissions: { items: { id: string }[] };
    }>(api, person.token, FORM_SUBMISSIONS, {
      input: { moduleKey: MODULE, formKey: FORM, pageSize: 100 },
    });
    return data.formSubmissions.items.map((item) => item.id);
  }

  async function bankRowsOf(submissionId: string) {
    return db()
      .collection("lottery_bank_transactions")
      .find({ refId: new Types.ObjectId(submissionId) })
      .toArray();
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

  async function returnToHq(id: string): Promise<void> {
    await decideOn({ api } as World, managerA, id, "RETURN");
  }

  async function resubmit(
    id: string,
    lines: BookLine[],
    branch = branchA,
  ): Promise<string[]> {
    const row = await current(id);
    const saved = await call<{
      saveFormDraft: { submission: { id: string; editVersion: number } };
    }>(api, hq.token, SAVE_SUBMISSION, {
      input: {
        id,
        expectedEditVersion: row.editVersion,
        values: { ...header(branch), lines },
      },
    });
    if (saved.errors) {
      return [String(extensionsOf(saved).reason ?? extensionsOf(saved).code)];
    }
    const submission = saved.data?.saveFormDraft.submission;
    const result = await call(api, hq.token, SUBMIT_SUBMISSION, {
      input: {
        id: submission?.id,
        expectedEditVersion: submission?.editVersion,
      },
    });
    return result.errors
      ? [String(extensionsOf(result).reason ?? extensionsOf(result).code)]
      : [];
  }

  /** 沖正送出時自動記的那一筆「進貨支出」(淨額歸 0)。 */
  async function reverseAutomatic(submissionId: string): Promise<void> {
    const [row] = await bankRowsOf(submissionId);
    await ok(api, hq.token, REVERSE_SETTLEMENT, {
      input: { id: String(row?._id), method: "bank", reason: "測試沖正" },
    });
  }

  async function dealerDates(id: Types.ObjectId) {
    const doc = await db().collection("lottery_dealers").findOne({ _id: id });
    return {
      lastPurchaseDate: doc?.lastPurchaseDate as Date | null,
      lastSelfPurchaseDate: doc?.lastSelfPurchaseDate as Date | null,
      /** 系統資訊的修改者:讓批購日變了的人(送出 / 駁回 / 作廢這張單的人) */
      updatedBy: doc?.updatedBy === null ? null : String(doc?.updatedBy),
    };
  }

  /** 中山店某個遊戲的未拆本數(庫存概況)。 */
  async function unopenedOf(gameId: Types.ObjectId): Promise<number> {
    const data = await ok<{
      lotteryStockOverview: { items: { unopenedBooks: number }[] };
    }>(api, hq.token, STOCK, {
      input: { orgId: String(branchA), gameId: String(gameId) },
    });
    return data.lotteryStockOverview.items.reduce(
      (sum, item) => sum + item.unopenedBooks,
      0,
    );
  }

  /** 建一本、點收、核准、淨額歸 0,動一下這本(`tamper`)再作廢:回擋下的 reason(沒擋 → undefined)。 */
  async function voidBlockedBy(
    tamper: (bookId: Types.ObjectId) => Promise<void>,
  ): Promise<unknown> {
    const line = book(gameHot);
    const purchase = await submit([line]);
    await receiveAll(purchase.id, [line]);
    await decideOn({ api } as World, managerA, purchase.id, "APPROVE");
    await reverseAutomatic(purchase.id);
    const received = await db()
      .collection("lottery_books")
      .findOne({ bookNo: line.book_no });
    await tamper(received?._id as Types.ObjectId);
    const row = await current(purchase.id);
    const result = await call(api, hq.token, FORM_VOID, {
      input: {
        id: purchase.id,
        expectedEditVersion: row.editVersion,
        reasonNote: "輸入錯誤",
      },
    });
    return extensionsOf(result).reason;
  }

  /** 在這本的第一張補一筆 `type` 張數事件(點收後被動過)。 */
  function eventOn(type: string) {
    return async (bookId: Types.ObjectId): Promise<void> => {
      const ticket = await db()
        .collection("lottery_tickets")
        .findOne({ bookId });
      await db()
        .collection("lottery_ticket_events")
        .insertOne({
          eventId: `${type}-${String(bookId)}`,
          bookId,
          ticketId: ticket?._id,
          gameId: gameHot,
          orgId: branchA,
          tenantId: tenant,
          at: new Date(),
          type,
          moduleKey: "inventory",
          deletedAt: null,
        });
    };
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

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-purchase");
    const { connection } = api;
    await seedPurchaseAuthorization(connection);
    await seedInventoryModule(connection);
    publishBadge = jest.spyOn(api.app.get(RealtimePublisher), "publishBadge");
    const root = await rootToken(api);
    tenant = await createOrg(connection, {
      name: "好運彩券行",
      settings: { visibility: "subtree" },
    });
    branchA = await createOrg(connection, { name: "中山店", parentId: tenant });
    branchB = await createOrg(connection, { name: "新竹店", parentId: tenant });

    const purchaseModules = [
      ...PURCHASE_MODULE_KEYS,
      "apply-center",
      "apply-center.view-page",
    ];
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
      moduleKeys: [...purchaseModules, "inventory"],
      permissionKeys: [
        ...Object.values(PURCHASE_PERMISSION_KEYS),
        "apply-center.view",
      ],
    });
    hqNoSettle = await person(api, connection, tenant, tenant, {
      moduleKeys: purchaseModules,
      permissionKeys: [
        PURCHASE_PERMISSION_KEYS.view,
        PURCHASE_PERMISSION_KEYS.create,
      ],
    });
    const managerScope = {
      moduleKeys: purchaseModules,
      permissionKeys: [PURCHASE_PERMISSION_KEYS.view, "apply-center.view"],
    };
    managerA = await person(api, connection, branchA, tenant, managerScope);
    managerB = await person(api, connection, branchB, tenant, managerScope);
    settlerA = await person(api, connection, branchA, tenant, {
      moduleKeys: purchaseModules,
      permissionKeys: [
        PURCHASE_PERMISSION_KEYS.view,
        PURCHASE_PERMISSION_KEYS.settle,
      ],
    });
    helperA = await person(api, connection, branchA, tenant, managerScope);
    const storeManager = await createRole(api.app, connection, {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [managerA.userId, managerB.userId],
    });

    await ok(api, root, CREATE_FORM, {
      input: { key: FORM, moduleKey: MODULE, name: "進貨單" },
    });
    await publishDefinition(api, root, FORM, purchaseDefinition(), null);
    // 受管表單的依欄位共用(`purchase.r5.seed.ts`):進貨分店看得到這張單
    await ok(api, root, UPDATE_FORM, {
      input: { key: FORM, sharedByFieldKeys: [PURCHASE_FIELD_KEYS.branch] },
    });
    await ok(api, root, ASSIGN, {
      input: { formKey: FORM, tenantOrgIds: [String(tenant)] },
    });
    // 開通腳本建的流程:一關 角色 店長 且 所屬組織屬於「進貨分店」
    const world = { api, connection, admin } as unknown as World;
    await publishWorkflow(world, "purchase_flow", {
      steps: [
        reviewStep(
          "receive",
          audienceSource(
            audienceRow("role", [storeManager]),
            audienceRow("org", { kind: "dynamic", ref: "form-field:branch" }),
          ),
        ),
      ],
      checkFormKey: FORM,
    });
    await bindForm(world, "purchase_flow", FORM);

    gameHot = await insertGame(connection, tenant, {
      gameCode: "5164",
      name: "發大財",
    });
    gameGold = await insertGame(connection, tenant, {
      gameCode: "5201",
      name: "金好運",
      unitPrice: 100,
    });
    gameStopped = await insertGame(connection, tenant, {
      gameCode: "4980",
      name: "舊彩",
      status: "discontinued",
    });
    dealer = await insertDealer(connection, tenant, {
      name: "林甲",
      lastPurchaseBaseDate: new Date("2026-01-01T00:00:00.000Z"),
    });
    dealerSuspended = await insertDealer(connection, tenant, {
      name: "停權甲",
      status: "suspended",
    });
    dealerOther = await insertDealer(connection, tenant, { name: "陳甲" });
    trustee = await insertTrustee(connection, tenant, dealer, "林受託");
    strangerTrustee = await insertTrustee(
      connection,
      tenant,
      dealerOther,
      "陳受託",
    );
    account = await insertBankAccount(connection, tenant, tenant);
    accountOnlyB = await insertBankAccount(connection, tenant, branchB);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    publishBadge.mockRestore();
    await api.close();
  });

  describe("新增頁的選項", () => {
    it("營業中的甲類、受託人、能用的扣款帳戶、待購買的叫貨單、販售中的遊戲", async () => {
      await insertRequisition(db(), tenant, branchA, "R-9001", [
        { gameId: gameHot, books: 5 },
      ]);
      const data = await ok<{
        lotteryPurchaseOptions: {
          dealers: { id: string }[];
          trustees: { dealerId: string; id: string }[];
          accounts: { id: string }[];
          requisitions: { serialNo: string; lines: { books: number }[] }[];
          games: { gameCode: string }[];
          allocations: {
            gameId: string;
            plannedBooks: number | null;
            inTransitBooks: number;
          }[];
        };
      }>(api, hq.token, OPTIONS, { orgId: String(branchA) });
      const options = data.lotteryPurchaseOptions;
      expect(options.dealers.map((item) => item.id)).toEqual(
        expect.arrayContaining([String(dealer), String(dealerOther)]),
      );
      expect(options.dealers.map((item) => item.id)).not.toContain(
        String(dealerSuspended),
      );
      expect(options.trustees).toContainEqual({
        dealerId: String(dealer),
        id: String(trustee),
      });
      expect(options.accounts.map((item) => item.id)).toEqual([
        String(account),
      ]);
      expect(options.requisitions.map((item) => item.serialNo)).toContain(
        "R-9001",
      );
      expect(options.games.map((item) => item.gameCode)).toEqual([
        "5164",
        "5201",
      ]);
      // 超過預計要給本數只警告用:每個販售中遊戲的預計 / 在途(叫貨單待購買 5 本)
      expect(options.allocations).toContainEqual({
        gameId: String(gameHot),
        plannedBooks: null,
        inTransitBooks: 5,
      });
    });
  });

  describe("送出前(規格 8.2 掛接點表)", () => {
    it("同一張單本號重複 → 擋下", async () => {
      const first = book(gameHot);
      const ext = await submitBlocked([
        first,
        book(gameHot, { book_no: first.book_no }),
      ]);
      expect(ext).toMatchObject({
        code: "FORBIDDEN",
        reason: "PURCHASE_BOOK_DUPLICATE",
      });
    });

    it("本號和其他有效進貨單重複 → 擋下", async () => {
      const line = book(gameHot);
      await submit([line]);
      const ext = await submitBlocked([
        book(gameHot, { book_no: line.book_no }),
      ]);
      expect(ext.reason).toBe("PURCHASE_BOOK_DUPLICATE");
    });

    it("本號和既有的本重複 → 擋下;同本號不同遊戲不算重複", async () => {
      const line = book(gameHot);
      const purchase = await submit([line]);
      await receiveAll(purchase.id, [line]);
      await decideOn({ api } as World, managerA, purchase.id, "APPROVE");
      expect(
        await submitBlocked([book(gameHot, { book_no: line.book_no })]).then(
          (value) => value.reason,
        ),
      ).toBe("PURCHASE_BOOK_DUPLICATE");
      const other = await submit([book(gameGold, { book_no: line.book_no })]);
      expect(other.status).toBe("REVIEWING");
    });

    it("停售遊戲 → 擋下", async () => {
      const ext = await submitBlocked([
        book(gameStopped, { book_price: 20_000 }),
      ]);
      expect(ext.code).toBeDefined();
    });

    it("張數 / 整本金額和遊戲不符、最後張號小於標準張數 → 擋下", async () => {
      expect(
        await submitBlocked([book(gameHot, { book_price: 1 })]).then(
          (value) => value.reason,
        ),
      ).toBe("PURCHASE_LINE_INVALID");
      expect(
        await submitBlocked([book(gameHot, { last_ticket_no: 99 })]).then(
          (value) => value.reason,
        ),
      ).toBe("PURCHASE_LINE_INVALID");
    });

    it("叫貨單要是同一家分店、待購買的", async () => {
      await insertRequisition(db(), tenant, branchB, "R-9002", [
        { gameId: gameHot, books: 1 },
      ]);
      expect(
        await submitBlocked([book(gameHot)], branchA, {
          requisition: "R-9002",
        }).then((value) => value.reason),
      ).toBe("PURCHASE_REQUISITION_INVALID");
      expect(
        await submitBlocked([book(gameHot)], branchA, {
          requisition: "R-0000",
        }).then((value) => value.reason),
      ).toBe("PURCHASE_REQUISITION_INVALID");
    });

    it("本人批購 = 否:受託人必填(表單 r4),且要是這位甲類啟用中的受託人", async () => {
      // 沒填 → 表單引擎的必填檢查(本人批購 = 是時受託人隱藏,不檢查;其他案例都是這樣送)
      expect(
        await submitBlocked([book(gameHot)], branchA, {
          self_purchase: false,
        }),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        fieldErrors: [
          expect.objectContaining({ fieldKey: "trustee", code: "REQUIRED" }),
        ],
      });
      expect(
        await submitBlocked([book(gameHot)], branchA, {
          self_purchase: false,
          trustee: String(strangerTrustee),
        }).then((value) => value.reason),
      ).toBe("PURCHASE_TRUSTEE_INVALID");
      const ok = await submit([book(gameHot)], branchA, {
        self_purchase: false,
        trustee: String(trustee),
      });
      expect(ok.status).toBe("REVIEWING");
    });

    it("扣款帳戶的使用組織不含進貨分店 → 擋下", async () => {
      expect(
        await submitBlocked([book(gameHot)], branchA, {
          account: String(accountOnlyB),
        }).then((value) => value.reason),
      ).toBe("PURCHASE_ACCOUNT_INVALID");
    });

    it("已點收的列不能被改或刪(rowId 比對);沒點收的列可以改", async () => {
      const done = book(gameHot);
      const pending = book(gameHot);
      const purchase = await submit([done, pending]);
      expect(await receive(managerA, purchase.id, codeOf(done))).toEqual({});
      await returnToHq(purchase.id);
      // 改已點收那一列的批購金額率
      expect(
        await resubmit(purchase.id, [{ ...done, rate: 90 }, pending]),
      ).toEqual(["PURCHASE_RECEIVED_ROW_CHANGED"]);
      // 刪掉已點收那一列
      expect(await resubmit(purchase.id, [pending])).toEqual([
        "PURCHASE_RECEIVED_ROW_CHANGED",
      ]);
      // 只改沒點收的列:可以
      expect(
        await resubmit(purchase.id, [done, { ...pending, rate: 90 }]),
      ).toEqual([]);
    });

    it("已點收的列以點收時的本比對:遊戲的整本金額之後改了,退回修改照樣送得出去(沒點收的列照遊戲現值)", async () => {
      const done = book(gameHot);
      const pending = book(gameHot);
      const purchase = await submit([done, pending]);
      expect(await receive(managerA, purchase.id, codeOf(done))).toEqual({});
      await returnToHq(purchase.id);
      const games = db().collection("lottery_games");
      await games.updateOne({ _id: gameHot }, { $set: { bookPrice: 30_000 } });
      try {
        // 沒點收的列還是舊的整本金額 → 和遊戲不符
        expect(await resubmit(purchase.id, [done, pending])).toEqual([
          "PURCHASE_LINE_INVALID",
        ]);
        expect(
          await resubmit(purchase.id, [
            done,
            { ...pending, book_price: 30_000 },
          ]),
        ).toEqual([]);
      } finally {
        await games.updateOne(
          { _id: gameHot },
          { $set: { bookPrice: 20_000 } },
        );
      }
    });
  });

  describe("送出後(規格 8.2、第 9 章)", () => {
    it("自動記「進貨支出」= 扣款金額(總部、銀行、歸屬分店 = 進貨分店);甲類批購日 max 更新;叫貨單 → 已進貨", async () => {
      const requisitionId = await insertRequisition(
        db(),
        tenant,
        branchA,
        "R-9010",
        [{ gameId: gameHot, books: 2 }],
      );
      const purchase = await submit([book(gameHot), book(gameHot)], branchA, {
        requisition: "R-9010",
        purchase_date: "2026-10-15T16:00:00.000Z",
      });
      const rows = await bankRowsOf(purchase.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "purchase_expense",
        direction: "out",
        amount: 36_800,
        settlementSide: "hq",
        refType: MODULE,
        branchOrgId: branchA,
      });
      const dates = await dealerDates(dealer);
      expect(dates.lastPurchaseDate?.toISOString()).toBe(
        "2026-10-15T16:00:00.000Z",
      );
      expect(dates.lastSelfPurchaseDate?.toISOString()).toBe(
        "2026-10-15T16:00:00.000Z",
      );
      expect(dates.updatedBy).toBe(String(hq.userId));
      const line = await db()
        .collection("lottery_requisition_lines")
        .findOne({ requisitionId });
      const referencedBy = line?.referencedBy as {
        submissionId?: Types.ObjectId;
      } | null;
      expect(String(referencedBy?.submissionId)).toBe(purchase.id);
      // 編輯這張單(退回修改)時,叫貨單清單另含它已引用的 R-9010;新增頁(不帶單號)不列
      const listed = async (submissionId: string | null) => {
        const data = await ok<{
          lotteryPurchaseOptions: { requisitions: { serialNo: string }[] };
        }>(api, hq.token, OPTIONS, { orgId: String(branchA), submissionId });
        return data.lotteryPurchaseOptions.requisitions.map(
          (item) => item.serialNo,
        );
      };
      expect(await listed(null)).not.toContain("R-9010");
      expect(await listed(purchase.id)).toContain("R-9010");
      // 不是進貨單(或讀不到)的 id → 當作新增頁
      expect(await listed(String(requisitionId))).not.toContain("R-9010");
      // 點收區塊顯示「叫貨 2,已刷 0」
      const receiving = await ok<{
        lotteryPurchaseReceiving: {
          groups: { requestedBooks: number | null; receivedBooks: number }[];
        };
      }>(api, managerA.token, RECEIVING, { id: purchase.id });
      expect(receiving.lotteryPurchaseReceiving.groups[0]).toMatchObject({
        requestedBooks: 2,
        receivedBooks: 0,
      });
    });

    it("扣款金額 0:照記一筆 0 元進貨支出(掛這張單);應付 0 = 已結清", async () => {
      const purchase = await submit([book(gameHot, { rate: 0 })]);
      const rows = await bankRowsOf(purchase.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "purchase_expense",
        direction: "out",
        amount: 0,
        settlementSide: "hq",
      });
      const settlement = await settlementOf(purchase.id);
      expect(settlement.payable).toBe(0);
      expect(defaultsOf(settlement)).toEqual({ out: 0, in: 0 });
    });

    it("草稿不記帳、不算在途", async () => {
      const draft = await draftOf([book(gameGold)]);
      expect(await bankRowsOf(draft.id)).toHaveLength(0);
      const transit = await inTransitBooksOf({
        tenantId: tenant,
        orgId: branchA,
      });
      const before = transit.get(String(gameGold)) ?? 0;
      await submit([book(gameGold)]);
      const after = await inTransitBooksOf({
        tenantId: tenant,
        orgId: branchA,
      });
      expect(after.get(String(gameGold))).toBe(before + 1);
    });
  });

  describe("收付(規格 9 進貨單驗算的 5 情境)", () => {
    it("① 送出記進貨支出、全部點收 → [付款] [收到退款] 都 0", async () => {
      const lines = [book(gameHot), book(gameHot)];
      const purchase = await submit(lines);
      await receiveAll(purchase.id, lines);
      expect(defaultsOf(await settlementOf(purchase.id))).toEqual({
        out: 0,
        in: 0,
      });
    });

    it("② 還沒點收也一樣已結清(應付在點收前就確定)", async () => {
      const purchase = await submit([book(gameHot)]);
      expect(defaultsOf(await settlementOf(purchase.id))).toEqual({
        out: 0,
        in: 0,
      });
    });

    it("③ 少一本:退回刪掉那一列再送出 → 不自動調整,[收到退款] = 那一本的批購金額", async () => {
      const keep = book(gameHot);
      const missing = book(gameGold);
      const purchase = await submit([keep, missing]);
      await returnToHq(purchase.id);
      expect(await resubmit(purchase.id, [keep])).toEqual([]);
      expect(await bankRowsOf(purchase.id)).toHaveLength(1);
      const settlement = await settlementOf(purchase.id);
      expect(settlement.payable).toBe(18_400);
      expect(defaultsOf(settlement)).toEqual({ out: 0, in: 9200 });
    });

    it("④ 退回後多加一本再送出 → 不自動調整,[付款] = 多的那一本", async () => {
      const first = book(gameHot);
      const purchase = await submit([first]);
      await returnToHq(purchase.id);
      expect(await resubmit(purchase.id, [first, book(gameGold)])).toEqual([]);
      expect(await bankRowsOf(purchase.id)).toHaveLength(1);
      expect(defaultsOf(await settlementOf(purchase.id))).toEqual({
        out: 9200,
        in: 0,
      });
      // 列表的結算:待付 9,200
      const progress = await ok<{
        lotteryPurchaseProgress: {
          settlementKind: string | null;
          settlementAmount: number;
          receivedCount: number;
          totalCount: number;
        }[];
      }>(api, hq.token, PROGRESS, { ids: [purchase.id] });
      expect(progress.lotteryPurchaseProgress[0]).toMatchObject({
        settlementKind: "to_pay",
        settlementAmount: 9200,
        receivedCount: 0,
        totalCount: 2,
      });
    });

    it("⑤ 扣款金額 0 → 記 0 元進貨支出、已結清", async () => {
      const purchase = await submit([book(gameGold, { rate: 0 })]);
      expect(await bankRowsOf(purchase.id)).toEqual([
        expect.objectContaining({ amount: 0 }),
      ]);
      expect(defaultsOf(await settlementOf(purchase.id))).toEqual({
        out: 0,
        in: 0,
      });
    });

    it("沒有 `purchasing.purchase.settle` 不能用結算按鈕(canSettle = false)", async () => {
      const purchase = await submit([book(gameHot)]);
      const data = await ok<{ lotterySettlement: { item: Settlement } }>(
        api,
        hqNoSettle.token,
        SETTLEMENT,
        { moduleKey: MODULE, refId: purchase.id },
      );
      expect(data.lotterySettlement.item.sides[0]?.canSettle).toBe(false);
      const withSettle = await settlementOf(purchase.id);
      expect(withSettle.sides[0]?.canSettle).toBe(true);
    });
  });

  describe("依欄位共用(總部建的單,進貨分店看得到)", () => {
    it("進貨分店 A:列表看得到、不能改;B 店看不到;收付看得到但不能按(單據歸屬總部)", async () => {
      const purchase = await submit([book(gameHot)]);
      expect(await listedTo(settlerA)).toContain(purchase.id);
      expect(await listedTo(managerB)).not.toContain(purchase.id);
      const viewed = await ok<{
        formSubmission: {
          submission: { abilities: { canEdit: boolean; canDelete: boolean } };
        };
      }>(api, settlerA.token, FORM_SUBMISSION, { id: purchase.id });
      expect(viewed.formSubmission.submission.abilities).toMatchObject({
        canEdit: false,
        canDelete: false,
      });
      const data = await ok<{ lotterySettlement: { item: Settlement } }>(
        api,
        settlerA.token,
        SETTLEMENT,
        { moduleKey: MODULE, refId: purchase.id },
      );
      expect(data.lotterySettlement.item.sides[0]?.canSettle).toBe(false);
      const forHq = await settlementOf(purchase.id);
      expect(forHq.sides[0]?.canSettle).toBe(true);
    });

    it("進貨分店的人實際記帳 / 沖正 → FORBIDDEN(共用進來的只能看;寫入不放大)", async () => {
      const purchase = await submit([book(gameHot)]);
      const recorded = await call(api, settlerA.token, RECORD_SETTLEMENT, {
        input: {
          moduleKey: MODULE,
          refId: purchase.id,
          side: PURCHASE_SETTLEMENT_SIDE,
          button: "out",
          method: "bank",
          amount: 100,
          accountId: String(account),
        },
      });
      expect(extensionsOf(recorded).code).toBe("FORBIDDEN");
      const [automatic] = await bankRowsOf(purchase.id);
      const reversed = await call(api, settlerA.token, REVERSE_SETTLEMENT, {
        input: {
          id: String(automatic?._id),
          method: "bank",
          reason: "分店沖正",
        },
      });
      expect(extensionsOf(reversed).code).toBe("FORBIDDEN");
      expect(await bankRowsOf(purchase.id)).toHaveLength(1);
    });

    it("改了進貨分店(退回後改成 B 再送出):看得到的店跟著變", async () => {
      const lines = [book(gameHot)];
      const purchase = await submit(lines);
      await returnToHq(purchase.id);
      expect(await resubmit(purchase.id, lines, branchB)).toEqual([]);
      expect(await listedTo(managerB)).toContain(purchase.id);
      expect(await listedTo(settlerA)).not.toContain(purchase.id);
    });
  });

  describe("點收一本(規格 8.2、8.3)", () => {
    it("寫點收紀錄、本、張與「進貨」事件;進度 1 / 2", async () => {
      const lines = [book(gameHot), book(gameHot)];
      const purchase = await submit(lines);
      const result = await ok<{
        receiveLotteryPurchaseBook: {
          rowId: string;
          receiving: { receivedCount: number; totalCount: number };
        };
      }>(api, managerA.token, RECEIVE, {
        input: {
          submissionId: purchase.id,
          code: codeOf(nth(lines, 0)),
        },
      });
      expect(result.receiveLotteryPurchaseBook.rowId).toBe(lines[0]?.rowId);
      expect(result.receiveLotteryPurchaseBook.receiving).toMatchObject({
        receivedCount: 1,
        totalCount: 2,
      });
      const receipt = await db()
        .collection("lottery_purchase_receipts")
        .findOne({ submissionId: new Types.ObjectId(purchase.id) });
      expect(receipt).toMatchObject({
        rowId: lines[0]?.rowId,
        orgId: branchA,
        receivedBy: managerA.userId,
      });
      const created = await db()
        .collection("lottery_books")
        .findOne({ _id: receipt?.bookId as Types.ObjectId });
      expect(created).toMatchObject({
        orgId: branchA,
        bookNo: lines[0]?.book_no,
        rate: 92,
        cost: 18_400,
        purchaseSubmissionId: new Types.ObjectId(purchase.id),
        purchaseDealerId: dealer,
      });
      expect(
        await db()
          .collection("lottery_ticket_events")
          .countDocuments({ bookId: receipt?.bookId, type: "purchase" }),
      ).toBe(100);
    });

    it("[完成這次點收]:這一次的列標上點收批次(第 1 次、第 2 次);已在批次的列不重收;不是點收任務的人不能完成", async () => {
      const lines = [book(gameHot), book(gameHot), book(gameHot)];
      const purchase = await submit(lines);
      const [first, second, third] = [
        nth(lines, 0),
        nth(lines, 1),
        nth(lines, 2),
      ];
      const complete = async (who: Person, rowIds: string[]) =>
        call(api, who.token, COMPLETE, {
          input: { submissionId: purchase.id, rowIds },
        });
      await receiveAll(purchase.id, [first, second]);
      const one = await ok<{
        completeLotteryPurchaseReceiving: CompletePayload;
      }>(api, managerA.token, COMPLETE, {
        input: {
          submissionId: purchase.id,
          rowIds: [first.rowId, second.rowId],
        },
      });
      expect(one.completeLotteryPurchaseReceiving.batch).toMatchObject({
        no: 1,
        rowIds: [first.rowId, second.rowId],
      });
      // 同一次請求帶回單據 QR 的路由(依模組樹;交易後的自動列印不另查)。這個測試庫沒有種模組樹 →
      // 路由是 null,寫入照樣成功(畫面照印、不印 QR);組路由的規則見 `receipt-links.service.test.ts`
      expect(one.completeLotteryPurchaseReceiving.receiptLinks).toEqual({
        purchaseView: null,
      });
      // 第二次:另一本;帶上已在第 1 次的列也不會搬過來
      await receiveAll(purchase.id, [third]);
      const two = await ok<{
        completeLotteryPurchaseReceiving: CompletePayload;
      }>(api, managerA.token, COMPLETE, {
        input: {
          submissionId: purchase.id,
          rowIds: [first.rowId, third.rowId],
        },
      });
      const { batch, receiving } = two.completeLotteryPurchaseReceiving;
      expect(batch).toMatchObject({ no: 2, rowIds: [third.rowId] });
      expect(receiving.batches.map((item) => [item.no, item.rowIds])).toEqual([
        [1, [first.rowId, second.rowId]],
        [2, [third.rowId]],
      ]);
      expect(
        receiving.groups
          .flatMap((group) => group.rows)
          .map((row) => row.batchId),
      ).toEqual([
        receiving.batches[0]?.batchId,
        receiving.batches[0]?.batchId,
        batch?.batchId,
      ]);
      // 都已在批次裡:沒有新批次(不印)
      const again = await ok<{
        completeLotteryPurchaseReceiving: CompletePayload;
      }>(api, managerA.token, COMPLETE, {
        input: { submissionId: purchase.id, rowIds: [third.rowId] },
      });
      expect(again.completeLotteryPurchaseReceiving.batch).toBeNull();
      expect(extensionsOf(await complete(hq, [third.rowId]))).toMatchObject({
        reason: "PURCHASE_NOT_RECEIVABLE",
      });
      // 以點收人自己的身分寫:更新者記點收人
      const stamped = await db()
        .collection("lottery_purchase_receipts")
        .findOne({
          submissionId: new Types.ObjectId(purchase.id),
          rowId: third.rowId,
        });
      expect(stamped?.updatedBy).toEqual(managerA.userId);
    });

    it("[完成這次點收] 只收這張單的列:別的 rowId 不算;送的列數超過這張單的列數 → 擋下", async () => {
      const lines = [book(gameHot)];
      const purchase = await submit(lines);
      const [only] = [nth(lines, 0)];
      await receiveAll(purchase.id, [only]);
      const tooMany = await call(api, managerA.token, COMPLETE, {
        input: { submissionId: purchase.id, rowIds: [only.rowId, "x", "y"] },
      });
      expect(extensionsOf(tooMany)).toMatchObject({
        code: "VALIDATION_FAILED",
      });
      const foreign = await ok<{
        completeLotteryPurchaseReceiving: CompletePayload;
      }>(api, managerA.token, COMPLETE, {
        input: { submissionId: purchase.id, rowIds: ["not-on-this-purchase"] },
      });
      expect(foreign.completeLotteryPurchaseReceiving.batch).toBeNull();
      const done = await ok<{
        completeLotteryPurchaseReceiving: CompletePayload;
      }>(api, managerA.token, COMPLETE, {
        input: { submissionId: purchase.id, rowIds: [only.rowId] },
      });
      expect(done.completeLotteryPurchaseReceiving.batch?.rowIds).toEqual([
        only.rowId,
      ]);
    });

    it("刷到的最後張號和單上不同 → 擋下「請退回更正」,不入庫", async () => {
      const line = book(gameHot, { last_ticket_no: 102 });
      const purchase = await submit([line]);
      expect(
        await receive(managerA, purchase.id, codeOf(line, 100)),
      ).toMatchObject({ reason: "PURCHASE_LAST_TICKET_MISMATCH" });
      expect(
        await db()
          .collection("lottery_books")
          .countDocuments({ bookNo: line.book_no }),
      ).toBe(0);
    });

    it("同一本再刷 → 已點收;不是點收任務的人 → 不能點收", async () => {
      const line = book(gameHot);
      const purchase = await submit([line]);
      expect(await receive(managerA, purchase.id, codeOf(line))).toEqual({});
      expect(await receive(managerA, purchase.id, codeOf(line))).toMatchObject({
        reason: "PURCHASE_ALREADY_RECEIVED",
      });
      // 同店的另一個人:依欄位共用看得到這張單(進貨分店 = A),但點收任務不在他手上
      const another = await submit([book(gameHot)]);
      expect(await receive(helperA, another.id, codeOf(line))).toMatchObject({
        code: "FORBIDDEN",
        reason: PURCHASE_REASONS.notReceivable,
      });
    });

    it("正面條碼對到單上兩款遊戲同本號 → 擋下請選遊戲;選了遊戲 / 刷背面編號才配對", async () => {
      const hot = book(gameHot);
      const gold = book(gameGold, { book_no: hot.book_no });
      const purchase = await submit([hot, gold]);
      const front = `0${hot.book_no.slice(1)}100`;
      expect(await receive(managerA, purchase.id, front)).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: PURCHASE_REASONS.scanAmbiguousGame,
        gameIds: [String(gameHot), String(gameGold)],
      });
      expect(
        await db()
          .collection("lottery_purchase_receipts")
          .countDocuments({ submissionId: new Types.ObjectId(purchase.id) }),
      ).toBe(0);
      expect(
        await receive(managerA, purchase.id, front, String(gameGold)),
      ).toEqual({});
      const receipt = await db()
        .collection("lottery_purchase_receipts")
        .findOne({ submissionId: new Types.ObjectId(purchase.id) });
      expect(receipt?.rowId).toBe(gold.rowId);
      expect(await receive(managerA, purchase.id, codeOf(hot))).toEqual({});
    });

    it("同一本同時刷兩次:一個點收成功,另一個是「已點收」(撞唯一索引也一樣)", async () => {
      const line = book(gameHot);
      const purchase = await submit([line]);
      const results = await Promise.all([
        receive(managerA, purchase.id, codeOf(line)),
        receive(managerA, purchase.id, codeOf(line)),
      ]);
      expect(results).toEqual(
        expect.arrayContaining([
          {},
          expect.objectContaining({ reason: "PURCHASE_ALREADY_RECEIVED" }),
        ]),
      );
      expect(
        await db()
          .collection("lottery_purchase_receipts")
          .countDocuments({ submissionId: new Types.ObjectId(purchase.id) }),
      ).toBe(1);
    });

    it("單據不在審核中(退回)→ 不能點收", async () => {
      const line = book(gameHot);
      const purchase = await submit([line]);
      await returnToHq(purchase.id);
      expect(await receive(managerA, purchase.id, codeOf(line))).toMatchObject({
        reason: "PURCHASE_NOT_RECEIVABLE",
      });
    });
  });

  describe("送錯分店(規格 8.2 錯誤情境、PU-11)", () => {
    it("A 店刷到 B 店單上的本 → 擋下、不入庫,錯誤帶 B 店與單號;[通知總部更正] → 建立者收到通知", async () => {
      const lineB = book(gameGold);
      const forB = await submit([lineB], branchB);
      const forA = await submit([book(gameHot)]);
      const ext = await receive(managerA, forA.id, codeOf(lineB));
      expect(ext).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "PURCHASE_WRONG_STORE",
        ownerBranchName: "新竹店",
        gameName: "金好運",
        bookNo: lineB.book_no.slice(1),
      });
      expect(
        await db()
          .collection("lottery_books")
          .countDocuments({ bookNo: lineB.book_no }),
      ).toBe(0);
      const doc = await db()
        .collection("form_submissions")
        .findOne({ _id: new Types.ObjectId(forB.id) });
      expect(ext.serialNo).toBe(doc?.serialNo ?? null);

      await ok(api, managerA.token, NOTIFY_WRONG_STORE, {
        input: { submissionId: forA.id, code: codeOf(lineB) },
      });
      const notices = await db()
        .collection("notifications")
        .find({
          recipientId: hq.userId,
          type: "lottery.purchase-wrong-store",
        })
        .toArray();
      expect(notices).toHaveLength(1);
      // 點進去是那張進貨單(B 店的)詳情頁
      expect(notices[0]).toMatchObject({
        refType: "lottery-purchase",
        refId: forB.id,
      });
      // B 店照常點收
      expect(await receive(managerB, forB.id, codeOf(lineB))).toEqual({});
    });

    it("單上沒有、也不是別家店的 → 這本不在這張單上", async () => {
      const purchase = await submit([book(gameHot)]);
      expect(
        await receive(managerA, purchase.id, "5164-1-999999-100-0-6"),
      ).toMatchObject({ reason: "PURCHASE_BOOK_NOT_ON_PURCHASE" });
    });
  });

  describe("核准、駁回、刪除、作廢(規格 8.2 掛接點表)", () => {
    it("核准前還有沒點收的列 → 擋下;全部點收後核准 → 完成時不寫帳", async () => {
      const lines = [book(gameHot), book(gameHot)];
      const purchase = await submit(lines);
      await receive(managerA, purchase.id, codeOf(nth(lines, 0)));
      const task = await pendingTaskOf({ api } as World, managerA, purchase.id);
      const blocked = await call(api, managerA.token, DECIDE_MUTATION, {
        input: {
          taskId: task.id,
          expectedEditVersion: task.editVersion,
          decision: "APPROVE",
        },
      });
      expect(extensionsOf(blocked)).toMatchObject({
        code: "FORBIDDEN",
        reason: "PURCHASE_UNRECEIVED_ROWS",
      });
      await receive(managerA, purchase.id, codeOf(nth(lines, 1)));
      await decideOn({ api } as World, managerA, purchase.id, "APPROVE");
      expect(await current(purchase.id).then((value) => value.status)).toBe(
        "completed",
      );
      expect(await bankRowsOf(purchase.id)).toHaveLength(1);
    });

    it("駁回前:已有點收 → 擋下;沒點收但淨額 ≠ 0 → 擋下;淨額 = 0 才能駁回,駁回後叫貨單回到待購買、批購日重算", async () => {
      const received = book(gameHot);
      const withReceipt = await submit([received]);
      await receive(managerA, withReceipt.id, codeOf(received));
      const task = await pendingTaskOf(
        { api } as World,
        managerA,
        withReceipt.id,
      );
      const blocked = await call(api, managerA.token, DECIDE_MUTATION, {
        input: {
          taskId: task.id,
          expectedEditVersion: task.editVersion,
          decision: "REJECT",
          comment: "理由",
        },
      });
      expect(extensionsOf(blocked).reason).toBe("PURCHASE_HAS_RECEIPTS");

      const requisitionId = await insertRequisition(
        db(),
        tenant,
        branchA,
        "R-9020",
        [{ gameId: gameGold, books: 1 }],
      );
      const lateDealer = await insertDealer(db(), tenant, {
        name: "晚甲",
        lastPurchaseBaseDate: new Date("2026-02-01T00:00:00.000Z"),
      });
      const unpaid = await submit([book(gameGold)], branchA, {
        requisition: "R-9020",
        dealer: String(lateDealer),
        purchase_date: "2026-10-20T16:00:00.000Z",
      });
      expect(
        await dealerDates(lateDealer).then((value) =>
          value.lastPurchaseDate?.toISOString(),
        ),
      ).toBe("2026-10-20T16:00:00.000Z");
      const unpaidTask = await pendingTaskOf(
        { api } as World,
        managerA,
        unpaid.id,
      );
      const notCleared = await call(api, managerA.token, DECIDE_MUTATION, {
        input: {
          taskId: unpaidTask.id,
          expectedEditVersion: unpaidTask.editVersion,
          decision: "REJECT",
          comment: "理由",
        },
      });
      expect(extensionsOf(notCleared).reason).toBe("SETTLEMENT_NOT_CLEARED");
      // 收到退款把淨額歸 0 後才能駁回
      await reverseAutomatic(unpaid.id);
      await decideOn({ api } as World, managerA, unpaid.id, "REJECT");
      // 修改者 = 駁回的人(不是送出的人)
      expect(
        await dealerDates(lateDealer).then((value) => value.updatedBy),
      ).toBe(String(managerA.userId));
      const line = await db()
        .collection("lottery_requisition_lines")
        .findOne({ requisitionId });
      expect(line?.referencedBy).toBeNull();
      expect(
        await dealerDates(lateDealer).then((value) =>
          value.lastPurchaseDate?.toISOString(),
        ),
      ).toBe("2026-02-01T00:00:00.000Z");
    });

    it("刪除只限草稿:被退回的單(申請人刪)→ PURCHASE_NOT_DRAFT;草稿可以刪", async () => {
      const line = book(gameHot);
      const purchase = await submit([line]);
      await returnToHq(purchase.id);
      const result = await call(api, hq.token, DELETE_SUBMISSION_MUTATION, {
        input: { id: purchase.id },
      });
      expect(extensionsOf(result).reason).toBe("PURCHASE_NOT_DRAFT");
      const draft = await draftOf([book(gameHot)]);
      const deleted = await call(api, hq.token, DELETE_SUBMISSION_MUTATION, {
        input: { id: draft.id },
      });
      expect(deleted.errors).toBeUndefined();
    });

    it("作廢前:有張已售 → 擋下;淨額 ≠ 0 → 擋下;作廢後本 → 已撤銷、寫「進貨作廢」事件、叫貨單回到待購買、批購日重算", async () => {
      const sold = book(gameHot);
      const soldPurchase = await submit([sold]);
      await receiveAll(soldPurchase.id, [sold]);
      await decideOn({ api } as World, managerA, soldPurchase.id, "APPROVE");
      const soldBook = await db()
        .collection("lottery_books")
        .findOne({ bookNo: sold.book_no });
      await db()
        .collection("lottery_ticket_events")
        .insertOne({
          eventId: `sold-${String(soldBook?._id)}`,
          bookId: soldBook?._id,
          ticketId: new Types.ObjectId(),
          gameId: gameHot,
          orgId: branchA,
          tenantId: tenant,
          at: new Date(),
          type: "sale",
          moduleKey: "inventory",
          deletedAt: null,
        });
      const soldRow = await current(soldPurchase.id);
      const blocked = await call(api, hq.token, FORM_VOID, {
        input: {
          id: soldPurchase.id,
          expectedEditVersion: soldRow.editVersion,
          reasonNote: "輸入錯誤",
        },
      });
      expect(extensionsOf(blocked)).toMatchObject({
        reason: "PURCHASE_BOOKS_IN_USE",
      });

      const requisitionId = await insertRequisition(
        db(),
        tenant,
        branchA,
        "R-9030",
        [{ gameId: gameHot, books: 1 }],
      );
      const voidDealer = await insertDealer(db(), tenant, { name: "作甲" });
      const line = book(gameHot);
      const purchase = await submit([line], branchA, {
        requisition: "R-9030",
        dealer: String(voidDealer),
      });
      await receiveAll(purchase.id, [line]);
      await decideOn({ api } as World, managerA, purchase.id, "APPROVE");
      const row = await current(purchase.id);
      const notCleared = await call(api, hq.token, FORM_VOID, {
        input: {
          id: purchase.id,
          expectedEditVersion: row.editVersion,
          reasonNote: "輸入錯誤",
        },
      });
      expect(extensionsOf(notCleared).reason).toBe("SETTLEMENT_NOT_CLEARED");
      await reverseAutomatic(purchase.id);
      // 先清掉送出時記的修改者,才分得出作廢這一次有沒有記到人
      await db()
        .collection("lottery_dealers")
        .updateOne({ _id: voidDealer }, { $set: { updatedBy: null } });
      const stockBefore = await unopenedOf(gameHot);
      const fresh = await current(purchase.id);
      await ok(api, hq.token, FORM_VOID, {
        input: {
          id: purchase.id,
          expectedEditVersion: fresh.editVersion,
          reasonNote: "輸入錯誤",
        },
      });
      const voidedBook = await db()
        .collection("lottery_books")
        .findOne({ bookNo: line.book_no });
      expect(voidedBook?.status).toBe("revoked");
      // 作廢後這本移出庫存(規格 7.1、8.2)
      expect(await unopenedOf(gameHot)).toBe(stockBefore - 1);
      expect(
        await db()
          .collection("lottery_ticket_events")
          .countDocuments({ bookId: voidedBook?._id, type: "purchase_void" }),
      ).toBe(100);
      const requisition = await db()
        .collection("lottery_requisition_lines")
        .findOne({ requisitionId });
      expect(requisition?.referencedBy).toBeNull();
      const voidedDates = await dealerDates(voidDealer);
      expect(voidedDates.lastPurchaseDate).toBeNull();
      expect(voidedDates.updatedBy).toBe(String(hq.userId));
    });

    it("作廢前:有張已調出、已拆本,或被調貨單鎖定(調貨中)→ 擋下", async () => {
      // 已調出(調貨單的「調出」事件)
      expect(await voidBlockedBy(eventOn("transfer_out"))).toBe(
        "PURCHASE_BOOKS_IN_USE",
      );
      // 已拆本(「拆本」事件)
      expect(await voidBlockedBy(eventOn("open"))).toBe(
        "PURCHASE_BOOKS_IN_USE",
      );
      // 調貨中:張被調貨單鎖定(還沒出貨,沒有任何事件)
      expect(
        await voidBlockedBy(async (bookId) => {
          await db()
            .collection("lottery_tickets")
            .updateOne(
              { bookId },
              {
                $set: {
                  lockedBy: {
                    refType: "transfer",
                    refId: new Types.ObjectId(),
                  },
                },
              },
            );
        }),
      ).toBe("PURCHASE_BOOKS_IN_USE");
    });

    it("作廢後勾選的兌獎紀錄回到「店內持有」;多本作廢的資料庫指令數不隨本數成長(防退化)", async () => {
      /** 一筆店內持有的兌獎紀錄(分店 A)。 */
      let redemptionNo = 0;
      const inStoreRedemption = async (prizeAmount: number) => {
        redemptionNo += 1;
        const ticketNo = String(redemptionNo).padStart(3, "0");
        const now = new Date();
        const { insertedId } = await db()
          .collection("lottery_redemptions")
          .insertOne({
            orgId: branchA,
            tenantId: tenant,
            shiftId: new Types.ObjectId(),
            cashPointId: new Types.ObjectId(),
            redeemedAt: now,
            redeemedBy: managerA.userId,
            gameCode: "5164",
            bookNo: "0056527",
            ticketNo,
            ticketLabel: `5164-056527-${ticketNo}`,
            rawInput: `5164-1-056527-${ticketNo}-0-6`,
            ticketId: null,
            gameId: gameHot,
            prizeAmount,
            status: "in_store",
            purchaseSubmissionId: null,
            sentAt: null,
            revokedAt: null,
            revokedBy: null,
            revokeReasonKey: null,
            revokeReason: null,
            revokeNote: null,
            replacesId: null,
            postCloseOf: null,
            revokePostCloseOf: null,
            note: null,
            version: 0,
            moduleKey: "store",
            createdAt: now,
            updatedAt: now,
            createdBy: null,
            updatedBy: null,
            deletedAt: null,
          });
        return insertedId;
      };
      /** 建單 N 本(勾一筆兌獎)→ 全部點收 → 核准 → 淨額歸 0 → 作廢,回作廢這一次的指令數。 */
      const voidCommandsOf = async (books: number) => {
        const redemptionId = await inStoreRedemption(500);
        const lines = Array.from({ length: books }, () => book(gameHot));
        const purchase = await submit(lines, branchA, {
          redemptions: [
            {
              rowId: `00000000-0000-4000-8888-${String(books).padStart(12, "0")}`,
              redemption: String(redemptionId),
              prize_amount: 500,
            },
          ],
        });
        const sent = await db()
          .collection("lottery_redemptions")
          .findOne({ _id: redemptionId });
        expect(sent?.status).toBe("sent");
        // 送兌歷程(營運報表判斷期末那一刻是否已送兌)
        expect(sent?.sentHistory).toEqual([
          expect.objectContaining({ releasedAt: null }),
        ]);
        await receiveAll(purchase.id, lines);
        await decideOn({ api } as World, managerA, purchase.id, "APPROVE");
        await reverseAutomatic(purchase.id);
        const fresh = await current(purchase.id);
        const counted = await countDbCommands(() =>
          call(api, hq.token, FORM_VOID, {
            input: {
              id: purchase.id,
              expectedEditVersion: fresh.editVersion,
              reasonNote: "輸入錯誤",
            },
          }),
        );
        expect(counted.result.errors).toBeUndefined();
        // 作廢後:勾選的兌獎回到店內持有(規格 8.2「兌獎」)
        const released = await db()
          .collection("lottery_redemptions")
          .findOne({ _id: redemptionId });
        expect(released).toMatchObject({
          status: "in_store",
          purchaseSubmissionId: null,
          sentAt: null,
          // 歷程保留那一段送兌,記回到店內持有的時間(舊報表重跑不變)
          sentHistory: [
            expect.objectContaining({
              sentAt: expect.any(Date),
              releasedAt: expect.any(Date),
            }),
          ],
        });
        const voidedBooks = await db()
          .collection("lottery_books")
          .find({ bookNo: { $in: lines.map((line) => line.book_no) } })
          .toArray();
        const bookIds = voidedBooks.map((row) => row._id);
        expect(
          await db()
            .collection("lottery_ticket_events")
            .countDocuments({
              bookId: { $in: bookIds },
              type: "purchase_void",
            }),
        ).toBe(books * 100);
        return counted;
      };
      const one = await voidCommandsOf(1);
      const four = await voidCommandsOf(4);
      // 逐張寫帳本時每本約 500 次;批次寫入後只差幾次(與本數 / 張數無關)
      expectDbCommandsAtMost(
        four,
        one.total + VOID_COMMANDS_PER_EXTRA_BOOKS,
        `作廢 4 本(1 本 = ${String(one.total)} 次)`,
      );
      expectDbCommandsAtMost(four, VOID_COMMANDS_LIMIT, "作廢 4 本");
    });

    it("撤回、退回不擋", async () => {
      const line = book(gameHot);
      const purchase = await submit([line]);
      await receive(managerA, purchase.id, codeOf(line));
      await returnToHq(purchase.id);
      expect(await current(purchase.id).then((value) => value.status)).toBe(
        "returned",
      );
      expect(await resubmit(purchase.id, [line])).toEqual([]);
      const row = await current(purchase.id);
      await ok(api, hq.token, WITHDRAW, {
        input: { id: purchase.id, expectedEditVersion: row.editVersion },
      });
      expect(await current(purchase.id).then((value) => value.status)).toBe(
        "withdrawn",
      );
    });
  });

  describe("側欄計數「進貨單」待點收(規格 3.1)", () => {
    it("送出、點收關卡任務派給店長 A → A 的計數 +1、對 A 送 badge:purchasing.purchase", async () => {
      const before = await badgeOf(managerB);
      const signals = badgeSignalsTo(managerB);
      const purchase = await submit([book(gameHot)], branchB);
      expect(await badgeOf(managerB)).toBe(before + 1);
      expect(badgeSignalsTo(managerB)).toBe(signals + 1);
      // 任務結束(退回)→ 計數 −1、再送一次
      await decideOn({ api } as World, managerB, purchase.id, "RETURN");
      expect(await badgeOf(managerB)).toBe(before);
      expect(badgeSignalsTo(managerB)).toBe(signals + 2);
    });

    it("點收關卡任務改派 A → C:A −1、C +1", async () => {
      const purchase = await submit([book(gameHot)], branchB);
      const fromBefore = await badgeOf(managerB);
      const toBefore = await badgeOf(helperA);
      const task = await pendingTaskOf({ api } as World, managerB, purchase.id);
      await ok(api, admin.token, REASSIGN, {
        input: { taskId: task.id, toUserId: String(helperA.userId) },
      });
      expect(await badgeOf(managerB)).toBe(fromBefore - 1);
      expect(await badgeOf(helperA)).toBe(toBefore + 1);
    });
  });

  describe("給其他功能", () => {
    it("遊戲引用檢查:草稿以外的進貨單引用過的遊戲 = 有庫存", async () => {
      const lonely = await insertGame(db(), tenant, {
        gameCode: "5300",
        name: "只在草稿",
      });
      await createDraft(api, hq.token, FORM, {
        ...header(branchA),
        lines: [book(lonely, { book_price: 20_000 })],
      });
      expect(await isGameInUse(tenant, lonely)).toBe(false);
      await submit([book(lonely, { book_price: 20_000 })]);
      expect(await isGameInUse(tenant, lonely)).toBe(true);
    });

    it("甲類詳情的批購紀錄:有效進貨單(本人 / 受託人、本數、批購合計)", async () => {
      const recordDealer = await insertDealer(db(), tenant, { name: "紀甲" });
      await insertTrustee(db(), tenant, recordDealer, "紀受託").then(
        async (contact) => {
          await submit([book(gameHot), book(gameGold)], branchA, {
            dealer: String(recordDealer),
            self_purchase: false,
            trustee: String(contact),
          });
        },
      );
      const data = await ok<{
        lotteryDealerPurchases: {
          selfPurchase: boolean;
          books: number;
          purchaseTotal: number;
        }[];
      }>(api, hq.token, DEALER_PURCHASES, { dealerId: String(recordDealer) });
      expect(data.lotteryDealerPurchases).toEqual([
        expect.objectContaining({
          selfPurchase: false,
          books: 2,
          purchaseTotal: 27_600,
        }),
      ]);
    });
  });
});

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
