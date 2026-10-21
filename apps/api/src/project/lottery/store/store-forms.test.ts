import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";
import {
  CASH_CORRECTION_FORM_KEY,
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
import { OrgsRepository } from "../../../database/database.module";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
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
  VOID as FORM_VOID,
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
import {
  LOTTERY_SHIFTS_COLLECTION,
  LotteryShift,
} from "../../database/lottery-store/lottery-shift.schema";
import { CashLedgerService } from "../cash/cash-ledger.service";
import { seedReasonCategory } from "../test-support/master-data-fixtures";
import { LotteryBooksService } from "../tickets/books.service";
import { StoreFormsQueryService } from "./store-forms-query.service";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const BOARD = /* GraphQL */ `
  query Board($orgId: ID!) {
    lotteryStoreBoard(orgId: $orgId) {
      item {
        vaultExpected
        cashPoints {
          id
          shift {
            id
            expectedCash
          }
        }
      }
    }
  }
`;

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

const UNDO = /* GraphQL */ `
  mutation Undo($input: LotteryStoreTicketRefInput!) {
    undoLotteryTicketSale(input: $input) {
      item {
        ticketId
      }
    }
  }
`;

const SALE_REVERSALS = /* GraphQL */ `
  query SaleReversals($orgId: ID!) {
    lotteryStoreSaleReversals(orgId: $orgId) {
      items {
        id
        serialNo
        status
        ticketGroups
        ticketCount
        reasonLabel
        refund
        refundAmount
        refundShiftLabel
      }
    }
  }
`;

const CASH_CORRECTIONS = /* GraphQL */ `
  query CashCorrections($orgId: ID!) {
    lotteryStoreCashCorrections(orgId: $orgId) {
      items {
        id
        status
        direction
        amount
        place
        placeShiftLabel
        attributedShiftLabel
        reasonLabel
      }
    }
  }
`;

const SHIFT_OPTIONS = /* GraphQL */ `
  query ShiftOptions($orgId: ID!) {
    lotteryStoreShiftOptions(orgId: $orgId) {
      items {
        id
        label
        open
        mine
      }
    }
  }
`;

interface TicketDoc {
  _id: Types.ObjectId;
  ticketNo: string;
  status: string;
  version: number;
  location: { kind: string; cashPointId: Types.ObjectId | null };
  lockedBy: { refType: string; refId: Types.ObjectId } | null;
}

interface MovementDoc {
  type: string;
  from: string;
  to: string;
  amount: number;
  shiftId: Types.ObjectId | null;
  attributedShiftId: Types.ObjectId | null;
  postCloseOf: Types.ObjectId | null;
  refId: Types.ObjectId | null;
}

const reference = (provider: string, labelField: string) => ({
  source: { provider, labelField },
});

const options = (items: [string, string][]) => ({
  options: {
    kind: "static" as const,
    items: items.map(([value, label], index) => ({
      value,
      label,
      order: index + 1,
      enabled: true,
    })),
  },
});

/** 撤銷售出申請的定義(欄位 key 同受管表單 `seeds/project/revisions/sale_reversal.r1.seed.ts`)。 */
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
      ...options([
        ["yes", "是"],
        ["no", "否"],
      ]),
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

/** 現金更正單的定義(欄位 key 同受管表單 `seeds/project/revisions/cash_correction.r1.seed.ts`)。 */
function cashCorrectionDefinition(): FormDefinition {
  return definitionOf([
    field("note", "text", { rules: { required: true } }),
    field("branch", "reference", {
      ...reference("org", "name"),
      rules: { required: true },
    }),
    field("direction", "select", {
      ...options([
        ["increase", "現金增加"],
        ["decrease", "現金減少"],
      ]),
      rules: { required: true },
    }),
    field("amount", "number", { rules: { required: true, min: 1 } }),
    field("place", "select", {
      ...options([
        ["drawer", "某一班的抽屜"],
        ["vault", "小金庫"],
      ]),
      rules: { required: true },
    }),
    field("shift", "reference", {
      ...reference("lottery_shift", "label"),
      visibleWhen: { "==": [{ var: "place" }, "drawer"] },
      rules: { required: true },
    }),
    field("attributed_shift", "reference", reference("lottery_shift", "label")),
    field("reason", "select", {
      options: {
        kind: "fieldCategory",
        key: LOTTERY_FIELD_CATEGORY_KEYS.cashCorrectionReason,
      },
      rules: { required: true },
    }),
  ]);
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
 * 店面(五):撤銷售出申請、現金更正單(規格 8.5、8.8、6.12、第 17 章第 6 題):真的表單引擎 + 審核流程 + 掛接點,
 * 對真 MongoDB(TEST-07)。定義用受管表單的種子(`seeds/project/revisions/`);流程同開通腳本建的那一份:
 * 一關 店長限定「分店」+ 申請人是審核者時自動通過(B5)。每張 200 元。
 *
 * 組織樹:root ─ 租戶甲 ─┬─ 信義店(店內櫃台:王的班開著、期初 5,000;店外攤位:王的上一班,已結帳)
 *                        └─ 板橋店
 */
describe("撤銷售出申請與現金更正單(規格 8.5、8.8)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let world: World;

  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let banqiao: Types.ObjectId;
  let counter: Types.ObjectId;
  let stall: Types.ObjectId;
  let gameId: Types.ObjectId;

  /** 店員:銷售、拆本、兩張表單的新增 */
  let wang: Person;
  /** 只有檢視(沒有撤銷售出的新增) */
  let viewer: Person;
  /** 店長(角色「店長」、屬於信義店) */
  let manager: Person;

  let counterShift: Types.ObjectId;
  let closedShift: Types.ObjectId;

  let bookSequence = 81_000;

  const db = () => connection;

  async function shift(
    cashPointId: Types.ObjectId,
    openedBy: Types.ObjectId,
    label: string,
    closedAt: Date | null,
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
        closedAt,
        checkoutId: null,
        drawerVersion: 0,
        label,
        moduleKey: "store",
        ...base(),
      });
    return insertedId;
  }

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

  /** 點收一本到信義店、整本拆到店內櫃台。 */
  async function counterBook(): Promise<Types.ObjectId> {
    bookSequence += 1;
    const { book } = await api.app
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
            lastTicketNo: 100,
            rate: 92,
            cost: 18_400,
          },
        ),
      );
    const nos = (await ticketsOf(book._id)).map((ticket) => ticket.ticketNo);
    await ok(api, wang.token, SPLIT, {
      input: {
        orgId: String(xinyi),
        bookId: String(book._id),
        skippedTicketNos: [],
        assignments: [{ cashPointId: String(counter), ticketNos: nos }],
      },
    });
    return book._id;
  }

  async function ticketsOf(bookId: Types.ObjectId): Promise<TicketDoc[]> {
    return db()
      .collection<TicketDoc>(LOTTERY_TICKETS_COLLECTION)
      .find({ bookId })
      .sort({ ticketNo: 1 })
      .toArray();
  }

  async function ticketOf(
    bookId: Types.ObjectId,
    ticketNo: string,
  ): Promise<TicketDoc> {
    const found = (await ticketsOf(bookId)).find(
      (ticket) => ticket.ticketNo === ticketNo,
    );
    if (found === undefined) {
      throw new Error(`沒有 #${ticketNo}`);
    }
    return found;
  }

  /** 王在店內櫃台(自己開的班)賣掉這幾張。 */
  async function sell(bookId: Types.ObjectId, ticketNos: string[]) {
    const tickets = await Promise.all(
      ticketNos.map((no) => ticketOf(bookId, no)),
    );
    await ok(api, wang.token, SELL, {
      input: {
        orgId: String(xinyi),
        localCashPointId: String(counter),
        tickets: tickets.map((ticket) => ({
          ticketId: String(ticket._id),
          version: ticket.version,
        })),
        source: "scan",
      },
    });
  }

  async function board() {
    const data = await ok<{
      lotteryStoreBoard: {
        item: {
          vaultExpected: number;
          cashPoints: {
            id: string;
            shift: { expectedCash: number } | null;
          }[];
        };
      };
    }>(api, wang.token, BOARD, { orgId: String(xinyi) });
    return data.lotteryStoreBoard.item;
  }

  async function expectedOf(cashPointId: Types.ObjectId): Promise<number> {
    const item = await board();
    return (
      item.cashPoints.find((point) => point.id === String(cashPointId))?.shift
        ?.expectedCash ?? Number.NaN
    );
  }

  function reversalValues(
    bookId: Types.ObjectId,
    ticketNos: string,
    count: number,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      branch: String(xinyi),
      lines: [
        {
          rowId: randomUUID(),
          book: String(bookId),
          ticket_nos: ticketNos,
          tickets: count,
          amount: 200 * count,
        },
      ],
      reason: "customer-return",
      refund: "yes",
      refund_shift: String(counterShift),
      note: "客人退貨",
      ...overrides,
    };
  }

  function correctionValues(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      branch: String(xinyi),
      direction: "increase",
      amount: 500,
      place: "drawer",
      shift: String(counterShift),
      reason: "customer-top-up",
      note: "客人回來補付少給的 500",
      ...overrides,
    };
  }

  async function submit(
    who: Person,
    formKey: string,
    values: Record<string, unknown>,
  ): Promise<SubmissionRow> {
    return submitDraft(
      api,
      who.token,
      await createDraft(api, who.token, formKey, values),
    );
  }

  /** 送出失敗時的錯誤(`extensions`)。 */
  async function submitError(
    who: Person,
    formKey: string,
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const draft = await call<{
      createFormDraft: { submission: SubmissionRow };
    }>(api, who.token, CREATE_FORM_DRAFT, {
      input: {
        formKey,
        clientRequestId: `store-forms-${String(new Types.ObjectId())}`,
        values,
      },
    });
    const created = draft.data?.createFormDraft.submission;
    if (!created) {
      return extensionsOf(draft);
    }
    return extensionsOf(
      await call(api, who.token, SUBMIT, {
        input: { id: created.id, expectedEditVersion: created.editVersion },
      }),
    );
  }

  async function statusOf(id: string): Promise<string> {
    const row = await db()
      .collection<{ status: string }>("form_submissions")
      .findOne({ _id: new Types.ObjectId(id) });
    return row?.status ?? "";
  }

  async function voidError(id: string): Promise<Record<string, unknown>> {
    const row = await db()
      .collection<{ editVersion: number }>("form_submissions")
      .findOne({ _id: new Types.ObjectId(id) });
    return extensionsOf(
      await call(api, manager.token, FORM_VOID, {
        input: {
          id,
          expectedEditVersion: row?.editVersion ?? 0,
          reasonNote: "輸入錯誤",
        },
      }),
    );
  }

  async function movementsOf(id: string): Promise<MovementDoc[]> {
    return db()
      .collection<MovementDoc>("lottery_cash_movements")
      .find({ refId: new Types.ObjectId(id) })
      .toArray();
  }

  async function reader() {
    return tenantBoundaryContext(api.app.get(OrgsRepository), null, tenant);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-store-forms");
    connection = api.connection;
    await api.app
      .get<Model<LotteryShift>>(getModelToken(LotteryShift.name))
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
        { value: "wrong-ticket", label: "刷錯刮刮樂" },
        { value: "stocktake-error", label: "盤點錯誤" },
        { value: "other", label: "其他" },
      ],
    );
    await seedReasonCategory(
      db(),
      LOTTERY_FIELD_CATEGORY_KEYS.cashCorrectionReason,
      [
        { value: "customer-top-up", label: "客人補付" },
        { value: "counterfeit", label: "假鈔" },
        { value: "other", label: "其他" },
      ],
    );
    tenant = await createOrg(db(), {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    xinyi = await createOrg(db(), { name: "信義店", parentId: tenant });
    banqiao = await createOrg(db(), { name: "板橋店", parentId: tenant });
    counter = await cashPoint("店內櫃台", 1);
    stall = await cashPoint("店外攤位", 2);
    ({ insertedId: gameId } = await db()
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
        ...base(),
      }));

    // 兩張表單發布(開啟 B9b → 自動建 store.create-<formKey>)並分派給租戶
    const root = await rootToken(api);
    for (const [key, name, definition] of [
      [SALE_REVERSAL_FORM_KEY, "撤銷售出申請", saleReversalDefinition()],
      [CASH_CORRECTION_FORM_KEY, "現金更正單", cashCorrectionDefinition()],
    ] as const) {
      await ok(api, root, CREATE_FORM, {
        input: { key, moduleKey: "store", name },
      });
      await publishDefinition(api, root, key, definition, null);
      await ok(api, root, ASSIGN, {
        input: { formKey: key, tenantOrgIds: [String(tenant)] },
      });
    }

    const admin = await person(api, db(), tenant, tenant, {
      moduleKeys: ["system", "system.workflows", "system.forms"],
      permissionKeys: ["system.workflows.*", "system.forms.*"],
    });
    const modules = ["store", "apply-center", "apply-center.view-page"];
    const creates = [
      STORE_FORM_PERMISSIONS.createSaleReversal,
      STORE_FORM_PERMISSIONS.createCashCorrection,
    ];
    wang = await person(api, db(), xinyi, tenant, {
      moduleKeys: modules,
      permissionKeys: [
        S.view,
        S.sell,
        S.undoSale,
        S.split,
        ...creates,
        "apply-center.view",
      ],
    });
    await db()
      .collection("users")
      .updateOne({ _id: wang.userId }, { $set: { name: "王小明" } });
    viewer = await person(api, db(), xinyi, tenant, {
      moduleKeys: modules,
      permissionKeys: [S.view, "apply-center.view"],
    });
    manager = await person(api, db(), xinyi, tenant, {
      moduleKeys: modules,
      permissionKeys: [S.view, S.edit, ...creates, "apply-center.view"],
    });
    const managerRole = await createRole(api.app, db(), {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [manager.userId],
    });
    world = { api, connection: db(), admin } as unknown as World;
    for (const [key, formKey] of [
      ["sale_reversal_flow", SALE_REVERSAL_FORM_KEY],
      ["cash_correction_flow", CASH_CORRECTION_FORM_KEY],
    ] as const) {
      await publishWorkflow(world, key, {
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
        checkFormKey: formKey,
      } as Parameters<typeof publishWorkflow>[2]);
      await bindForm(world, key, formKey);
    }

    counterShift = await shift(counter, wang.userId, "店內櫃台 · 王小明", null);
    closedShift = await shift(
      stall,
      wang.userId,
      "店外攤位 · 王小明",
      new Date(),
    );
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("撤銷售出申請(規格 8.5)", () => {
    it("第 17 章第 6 題撤銷一側:完成前 5,200;完成後張改回未售、回原收銀點,記退貨退款,5,000", async () => {
      const bookId = await counterBook();
      const before = await expectedOf(counter);
      await sell(bookId, ["012"]);
      expect(await expectedOf(counter)).toBe(before + 200);

      const submitted = await submit(
        wang,
        SALE_REVERSAL_FORM_KEY,
        reversalValues(bookId, "012", 1),
      );
      expect(submitted.status).toBe("REVIEWING");
      // 送出後鎖定(盤點時「撤銷審核中」);錢還沒退
      const locked = await ticketOf(bookId, "012");
      expect(locked.lockedBy).toMatchObject({ refType: "sale_reversal" });
      expect(String(locked.lockedBy?.refId)).toBe(submitted.id);
      expect(await expectedOf(counter)).toBe(before + 200);
      // 鎖定中的張不能當下撤銷(帳本擋下,已被處理)
      const undo = await call(api, wang.token, UNDO, {
        input: { ticketId: String(locked._id), version: locked.version },
      });
      expect(extensionsOf(undo).code).toBeDefined();

      await decideOn(world, manager, submitted.id, "APPROVE");
      expect(await statusOf(submitted.id)).toBe("completed");
      const after = await ticketOf(bookId, "012");
      expect(after).toMatchObject({
        status: "unsold",
        lockedBy: null,
        location: { kind: "counter" },
      });
      expect(String(after.location.cashPointId)).toBe(String(counter));
      const lastEvent = await db()
        .collection<{
          type: string;
          refType: string;
          cashEffect: string;
          cashPointId: Types.ObjectId;
        }>("lottery_ticket_events")
        .find({ ticketId: after._id })
        .sort({ at: -1, _id: -1 })
        .limit(1)
        .next();
      expect(lastEvent).toMatchObject({
        type: "sale_undo",
        refType: "sale_reversal",
        cashEffect: "none",
      });
      expect(await movementsOf(submitted.id)).toEqual([
        expect.objectContaining({
          type: "refund",
          from: "drawer",
          to: "external",
          amount: 200,
          shiftId: counterShift,
          postCloseOf: null,
        }),
      ]);
      expect(await expectedOf(counter)).toBe(before);
    });

    it("只能選本店已售、不在其他未結束撤銷單上的張;退款金額要等於面額合計", async () => {
      const bookId = await counterBook();
      await sell(bookId, ["020", "021"]);
      // 未售的張
      expect(
        await submitError(
          wang,
          SALE_REVERSAL_FORM_KEY,
          reversalValues(bookId, "030", 1),
        ),
      ).toMatchObject({ reason: "SALE_REVERSAL_TICKET_NOT_REVERSIBLE" });
      // 已在另一張審核中的撤銷單上
      const first = await submit(
        wang,
        SALE_REVERSAL_FORM_KEY,
        reversalValues(bookId, "020", 1),
      );
      expect(
        await submitError(
          wang,
          SALE_REVERSAL_FORM_KEY,
          reversalValues(bookId, "020-021", 2),
        ),
      ).toMatchObject({ reason: "SALE_REVERSAL_TICKET_NOT_REVERSIBLE" });
      // 金額不是面額合計
      const wrongAmount = reversalValues(bookId, "021", 1, {
        lines: [
          {
            rowId: randomUUID(),
            book: String(bookId),
            ticket_nos: "021",
            tickets: 1,
            amount: 100,
          },
        ],
      });
      expect(
        await submitError(wang, SALE_REVERSAL_FORM_KEY, wrongAmount),
      ).toMatchObject({ reason: "SALE_REVERSAL_AMOUNT_MISMATCH" });
      // 退款 = 是,退款班次不是本店的班(看不到別家店的班:引用檢查先擋;看得到的人由掛接點擋 STORE_FORM_SHIFT_NOT_IN_BRANCH)
      const otherShift = await db()
        .collection(LOTTERY_SHIFTS_COLLECTION)
        .insertOne({
          orgId: banqiao,
          tenantId: tenant,
          cashPointId: new Types.ObjectId(),
          openedBy: wang.userId,
          openedAt: new Date(),
          openingFloat: 0,
          openingFloatSource: "none",
          closedAt: new Date(),
          drawerVersion: 0,
          label: "板橋店的班",
          moduleKey: "store",
          ...base(),
        });
      expect(
        await submitError(
          wang,
          SALE_REVERSAL_FORM_KEY,
          reversalValues(bookId, "021", 1, {
            refund_shift: String(otherShift.insertedId),
          }),
        ),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["refund_shift"] });
      await decideOn(world, manager, first.id, "REJECT");
    });

    it("駁回什麼都不記:張解除鎖定、還是已售;應有不變", async () => {
      const bookId = await counterBook();
      await sell(bookId, ["040"]);
      const before = await expectedOf(counter);
      const submitted = await submit(
        wang,
        SALE_REVERSAL_FORM_KEY,
        reversalValues(bookId, "040", 1),
      );
      await decideOn(world, manager, submitted.id, "REJECT");
      expect(await statusOf(submitted.id)).toBe("rejected");
      expect(await ticketOf(bookId, "040")).toMatchObject({
        status: "sold",
        lockedBy: null,
      });
      expect(await movementsOf(submitted.id)).toEqual([]);
      expect(await expectedOf(counter)).toBe(before);
    });

    it("完成後作廢一律擋下", async () => {
      const bookId = await counterBook();
      await sell(bookId, ["050"]);
      const submitted = await submit(
        wang,
        SALE_REVERSAL_FORM_KEY,
        reversalValues(bookId, "050", 1, { refund: "no" }),
      );
      await decideOn(world, manager, submitted.id, "APPROVE");
      // 退款 = 否:張改回未售,不記流水
      expect(await movementsOf(submitted.id)).toEqual([]);
      expect(await voidError(submitted.id)).toMatchObject({
        reason: "STORE_FORM_VOID_NOT_ALLOWED",
      });
      expect(await statusOf(submitted.id)).toBe("completed");
    });

    it("退款班次已結帳 → 記成那一班的事後更正(postCloseOf),結帳時的應有不變", async () => {
      const bookId = await counterBook();
      await sell(bookId, ["060", "061"]);
      const ledger = api.app.get(CashLedgerService);
      const closedBefore = await ledger.sumShiftMovements(
        await reader(),
        closedShift,
      );
      const submitted = await submit(
        wang,
        SALE_REVERSAL_FORM_KEY,
        reversalValues(bookId, "060-061", 2, {
          refund_shift: String(closedShift),
        }),
      );
      await decideOn(world, manager, submitted.id, "APPROVE");
      expect(await movementsOf(submitted.id)).toEqual([
        expect.objectContaining({
          type: "refund",
          amount: 400,
          shiftId: closedShift,
          postCloseOf: closedShift,
        }),
      ]);
      expect(await ledger.sumShiftMovements(await reader(), closedShift)).toBe(
        closedBefore,
      );
      expect(await ledger.postCloseNet(await reader(), closedShift)).toBe(-400);
    });

    it("店長自己送的申請自動通過(B5)", async () => {
      const bookId = await counterBook();
      await sell(bookId, ["070"]);
      const submitted = await submit(
        manager,
        SALE_REVERSAL_FORM_KEY,
        reversalValues(bookId, "070", 1),
      );
      expect(await statusOf(submitted.id)).toBe("completed");
      expect(await ticketOf(bookId, "070")).toMatchObject({
        status: "unsold",
      });
    });

    it("B9b:沒有 store.create-sale_reversal 的人不能新增", async () => {
      const bookId = await counterBook();
      await sell(bookId, ["080"]);
      const result = await call(api, viewer.token, CREATE_FORM_DRAFT, {
        input: {
          formKey: SALE_REVERSAL_FORM_KEY,
          clientRequestId: `store-forms-${String(new Types.ObjectId())}`,
          values: reversalValues(bookId, "080", 1),
        },
      });
      expect(extensionsOf(result).code).toBe("FORBIDDEN");
    });

    it("分頁列表:張數依本分組、原因、退款、退款班次、狀態", async () => {
      const data = await ok<{
        lotteryStoreSaleReversals: {
          items: {
            serialNo: string | null;
            status: string;
            ticketGroups: string[];
            ticketCount: number;
            reasonLabel: string;
            refund: boolean;
            refundAmount: number;
            refundShiftLabel: string | null;
          }[];
        };
      }>(api, wang.token, SALE_REVERSALS, { orgId: String(xinyi) });
      const rows = data.lotteryStoreSaleReversals.items;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows).toContainEqual(
        expect.objectContaining({
          status: "completed",
          ticketGroups: ["5164 #060–061"],
          ticketCount: 2,
          reasonLabel: "客人退貨",
          refund: true,
          refundAmount: 400,
          refundShiftLabel: "店外攤位 · 王小明",
        }),
      );
    });
  });

  describe("現金更正單(規格 8.8)", () => {
    it("位置 = 某一班的抽屜(開著)→ 完成時計入那一班的應有;駁回不記", async () => {
      const before = await expectedOf(counter);
      const rejected = await submit(
        wang,
        CASH_CORRECTION_FORM_KEY,
        correctionValues(),
      );
      await decideOn(world, manager, rejected.id, "REJECT");
      expect(await movementsOf(rejected.id)).toEqual([]);

      const submitted = await submit(
        wang,
        CASH_CORRECTION_FORM_KEY,
        correctionValues({ direction: "decrease", amount: 300 }),
      );
      expect(await expectedOf(counter)).toBe(before);
      await decideOn(world, manager, submitted.id, "APPROVE");
      expect(await movementsOf(submitted.id)).toEqual([
        expect.objectContaining({
          type: "correction_decrease",
          from: "drawer",
          to: "external",
          amount: 300,
          shiftId: counterShift,
          postCloseOf: null,
        }),
      ]);
      expect(await expectedOf(counter)).toBe(before - 300);
    });

    it("位置 = 小金庫 → 小金庫應有變化;歸屬班次可以選已結帳的班(只做歸屬)", async () => {
      const before = (await board()).vaultExpected;
      const submitted = await submit(
        wang,
        CASH_CORRECTION_FORM_KEY,
        correctionValues({
          place: "vault",
          shift: null,
          attributed_shift: String(closedShift),
        }),
      );
      await decideOn(world, manager, submitted.id, "APPROVE");
      expect(await movementsOf(submitted.id)).toEqual([
        expect.objectContaining({
          type: "correction_increase",
          from: "external",
          to: "vault",
          amount: 500,
          shiftId: null,
          attributedShiftId: closedShift,
          postCloseOf: null,
        }),
      ]);
      expect((await board()).vaultExpected).toBe(before + 500);
      const ledger = api.app.get(CashLedgerService);
      expect(await ledger.postCloseNet(await reader(), closedShift)).toBe(-400);
    });

    it("位置那一班已結帳 → 事後更正;完成後作廢一律擋下", async () => {
      const submitted = await submit(
        wang,
        CASH_CORRECTION_FORM_KEY,
        correctionValues({ shift: String(closedShift), amount: 100 }),
      );
      await decideOn(world, manager, submitted.id, "APPROVE");
      expect(await movementsOf(submitted.id)).toEqual([
        expect.objectContaining({
          type: "correction_increase",
          shiftId: closedShift,
          postCloseOf: closedShift,
        }),
      ]);
      const ledger = api.app.get(CashLedgerService);
      expect(await ledger.postCloseNet(await reader(), closedShift)).toBe(-300);
      expect(await voidError(submitted.id)).toMatchObject({
        reason: "STORE_FORM_VOID_NOT_ALLOWED",
      });
    });

    it("分頁列表:方向、金額、位置、歸屬班次、原因", async () => {
      const data = await ok<{
        lotteryStoreCashCorrections: {
          items: {
            status: string;
            direction: string;
            amount: number;
            place: string;
            placeShiftLabel: string | null;
            attributedShiftLabel: string | null;
            reasonLabel: string;
          }[];
        };
      }>(api, wang.token, CASH_CORRECTIONS, { orgId: String(xinyi) });
      expect(data.lotteryStoreCashCorrections.items).toContainEqual({
        id: expect.any(String),
        status: "completed",
        direction: "increase",
        amount: 500,
        place: "vault",
        placeShiftLabel: null,
        attributedShiftLabel: "店外攤位 · 王小明",
        reasonLabel: "客人補付",
      });
    });
  });

  describe("給交班結帳的查詢與新增頁的退款班次", () => {
    it("pendingCashImpacts:審核中的現金更正(位置 = 這一班)與撤銷售出(退款班次 = 這一班)", async () => {
      const bookId = await counterBook();
      await sell(bookId, ["090"]);
      const correction = await submit(
        wang,
        CASH_CORRECTION_FORM_KEY,
        correctionValues(),
      );
      const reversal = await submit(
        wang,
        SALE_REVERSAL_FORM_KEY,
        reversalValues(bookId, "090", 1),
      );
      const impacts = await api.app
        .get(StoreFormsQueryService)
        .pendingCashImpacts(await reader(), counterShift);
      expect(
        impacts.map((impact) => ({
          id: String(impact.submissionId),
          formKey: impact.formKey,
          amount: impact.amount,
        })),
      ).toEqual([
        {
          id: correction.id,
          formKey: CASH_CORRECTION_FORM_KEY,
          amount: 500,
        },
        { id: reversal.id, formKey: SALE_REVERSAL_FORM_KEY, amount: -200 },
      ]);
      await decideOn(world, manager, correction.id, "REJECT");
      await decideOn(world, manager, reversal.id, "REJECT");
    });

    it("退款班次的選項:本店的班,自己開著的標 mine", async () => {
      const data = await ok<{
        lotteryStoreShiftOptions: {
          items: { id: string; label: string; open: boolean; mine: boolean }[];
        };
      }>(api, wang.token, SHIFT_OPTIONS, { orgId: String(xinyi) });
      expect(data.lotteryStoreShiftOptions.items).toEqual(
        expect.arrayContaining([
          {
            id: String(counterShift),
            label: "店內櫃台 · 王小明",
            open: true,
            mine: true,
          },
          {
            id: String(closedShift),
            label: "店外攤位 · 王小明",
            open: false,
            mine: false,
          },
        ]),
      );
    });
  });
});
