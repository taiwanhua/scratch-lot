import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import {
  ASSIGN,
  CREATE_FORM,
  type SubmissionRow,
  call,
  createDraft,
  extensionsOf,
  ok,
  publishDefinition,
  rootToken,
  submitDraft,
} from "../../../forms/test-support/form-fixtures";
import { createRole } from "../../../permission/test-support/fixtures";
import {
  type Person,
  SUBMIT_SUBMISSION,
  WITHDRAW,
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
import {
  PURCHASE_MODULE_KEYS,
  PURCHASE_PERMISSION_KEYS,
  insertBankAccount,
  insertDealer,
  insertGame,
  purchaseDefinition,
  seedPurchaseAuthorization,
} from "./test-support/purchase-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const FORM = "purchase";
const MODULE = "purchasing.purchase";

const SETTLEMENT = /* GraphQL */ `
  query TestSettlement($moduleKey: String!, $refId: ID!) {
    lotterySettlement(moduleKey: $moduleKey, refId: $refId) {
      item {
        payable
        sides {
          net
        }
      }
    }
  }
`;

const OPTIONS = /* GraphQL */ `
  query TestPurchaseRedemptions($orgId: ID!, $submissionId: ID) {
    lotteryPurchaseRedemptions(orgId: $orgId, submissionId: $submissionId) {
      items {
        id
        prizeAmount
        status
      }
    }
  }
`;

let rowSequence = 0;
const rowId = () => {
  rowSequence += 1;
  return `00000000-0000-4000-9000-${String(rowSequence).padStart(12, "0")}`;
};

/**
 * 進貨單的兌獎(規格 8.2「兌獎」、第 9 章驗算 ⑤、第 17 章第 7 題):勾選店內持有的兌獎紀錄 → 合計三列、
 * 扣款金額;送出後已送兌、兌獎剩餘記「兌獎入帳」(不算待結清);撤回 / 退回 / 駁回回到店內持有。
 * 兌獎紀錄直接寫進資料庫(登記兌獎見 `redemption/redemption.test.ts`)。
 */
describe("進貨單的兌獎(規格 8.2)", () => {
  let api: AuthTestApp;
  let tenant: Types.ObjectId;
  let branchA: Types.ObjectId;
  let branchB: Types.ObjectId;
  let hq: Person;
  let managerA: Person;
  let game: Types.ObjectId;
  let dealer: Types.ObjectId;
  let account: Types.ObjectId;
  let ticketSequence = 0;

  const db = () => api.connection;

  /** 一筆店內持有的兌獎紀錄(`orgId` 那家店)。 */
  async function redemption(
    orgId: Types.ObjectId,
    prizeAmount: number,
  ): Promise<string> {
    ticketSequence += 1;
    const ticketNo = String(ticketSequence).padStart(3, "0");
    const now = new Date();
    const { insertedId } = await db()
      .collection("lottery_redemptions")
      .insertOne({
        orgId,
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
        gameId: game,
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
    return String(insertedId);
  }

  /** 3 本、每本整本金額 20,000、批購金額率 100% → 批購合計 60,000。 */
  function lines() {
    return [1, 2, 3].map((index) => ({
      rowId: rowId(),
      game: String(game),
      book_no: `07${String(70_000 + index + rowSequence * 10).padStart(5, "0")}`,
      last_ticket_no: 100,
      tickets: 100,
      book_price: 20_000,
      rate: 100,
    }));
  }

  function values(
    redemptionIds: readonly string[],
    prizeOf: (id: string) => number,
    branch = branchA,
  ): Record<string, unknown> {
    return {
      branch: String(branch),
      dealer: String(dealer),
      self_purchase: true,
      purchase_date: "2026-10-12T16:00:00.000Z",
      account: String(account),
      lines: lines(),
      redemptions: redemptionIds.map((id) => ({
        rowId: rowId(),
        redemption: id,
        prize_amount: prizeOf(id),
      })),
    };
  }

  async function statusOf(id: string) {
    const doc = await db()
      .collection("lottery_redemptions")
      .findOne({ _id: new Types.ObjectId(id) });
    return {
      status: doc?.status as string,
      purchaseSubmissionId:
        doc?.purchaseSubmissionId == null
          ? null
          : String(doc.purchaseSubmissionId),
    };
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

  async function submitBlocked(
    draftValues: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const draft = await createDraft(api, hq.token, FORM, draftValues);
    const result = await call(api, hq.token, SUBMIT_SUBMISSION, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    return extensionsOf(result);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-purchase-redemption");
    const { connection } = api;
    await seedPurchaseAuthorization(connection);
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
    hq = await person(api, connection, tenant, tenant, {
      moduleKeys: purchaseModules,
      permissionKeys: [
        ...Object.values(PURCHASE_PERMISSION_KEYS),
        "apply-center.view",
      ],
    });
    managerA = await person(api, connection, branchA, tenant, {
      moduleKeys: purchaseModules,
      permissionKeys: [PURCHASE_PERMISSION_KEYS.view, "apply-center.view"],
    });
    const storeManager = await createRole(api.app, connection, {
      name: "店長",
      ownerOrgId: tenant,
      assignTo: [managerA.userId],
    });
    await ok(api, root, CREATE_FORM, {
      input: { key: FORM, moduleKey: MODULE, name: "進貨單" },
    });
    await publishDefinition(api, root, FORM, purchaseDefinition(), null);
    await ok(api, root, ASSIGN, {
      input: { formKey: FORM, tenantOrgIds: [String(tenant)] },
    });
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
    game = await insertGame(connection, tenant, {
      gameCode: "5164",
      name: "發大財",
    });
    dealer = await insertDealer(connection, tenant, { name: "林甲" });
    account = await insertBankAccount(connection, tenant, tenant);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  });

  it("新增頁的兌獎區:只列進貨分店店內持有的", async () => {
    const mine = await redemption(branchA, 500);
    await redemption(branchB, 500);
    const data = await ok<{
      lotteryPurchaseRedemptions: { items: { id: string }[] };
    }>(api, hq.token, OPTIONS, { orgId: String(branchA) });
    const ids = data.lotteryPurchaseRedemptions.items.map((item) => item.id);
    expect(ids).toContain(mine);
    const states = await Promise.all(ids.map((id) => statusOf(id)));
    expect(states.map((state) => state.status)).toEqual(
      ids.map(() => "in_store"),
    );
    // 用掉,免得影響後面的合計
    await db()
      .collection("lottery_redemptions")
      .updateMany({}, { $set: { status: "revoked", revokedAt: new Date() } });
  });

  it("規格 8.2 例:勾選合計 100,000、批購 60,000 → 折抵 60,000、扣款 0、兌獎剩餘 40,000;自動記兌獎入帳 40,000 且不在待結清", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      ids.push(await redemption(branchA, 5000));
    }
    const draft = await createDraft(
      api,
      hq.token,
      FORM,
      values(ids, () => 5000),
    );
    const purchase = await submitDraft(api, hq.token, draft);
    const doc = await db()
      .collection("form_submissions")
      .findOne({ _id: new Types.ObjectId(purchase.id) });
    const totals = [
      "purchase_total",
      "redemption_total",
      "redemption_offset",
      "deducted_amount",
      "redemption_remainder",
    ].map((key) => Number((doc?.values as Record<string, unknown>)[key]));
    expect(totals).toEqual([60_000, 100_000, 60_000, 0, 40_000]);
    const bank = await db()
      .collection("lottery_bank_transactions")
      .find({ refId: new Types.ObjectId(purchase.id) })
      .sort({ _id: 1 })
      .toArray();
    expect(
      bank.map((row): unknown[] => [row.type, row.amount, row.settlementSide]),
    ).toEqual([
      ["purchase_expense", 0, "hq"],
      ["redemption_income", 40_000, null],
    ]);
    const settlement = await ok<{
      lotterySettlement: {
        item: { payable: number; sides: { net: number }[] };
      };
    }>(api, hq.token, SETTLEMENT, { moduleKey: MODULE, refId: purchase.id });
    expect(settlement.lotterySettlement.item).toEqual({
      payable: 0,
      sides: [{ net: 0 }],
    });
    // 勾選的改「已送兌」
    for (const id of ids) {
      expect(await statusOf(id)).toEqual({
        status: "sent",
        purchaseSubmissionId: purchase.id,
      });
    }

    // 撤回 → 回到店內持有;重新送出 → 再送兌,不另記兌獎入帳
    const row = await current(purchase.id);
    await ok(api, hq.token, WITHDRAW, {
      input: { id: purchase.id, expectedEditVersion: row.editVersion },
    });
    expect(await statusOf(nthOf(ids, 0))).toEqual({
      status: "in_store",
      purchaseSubmissionId: null,
    });
    const withdrawn = await current(purchase.id);
    const resubmitted = await call(api, hq.token, SUBMIT_SUBMISSION, {
      input: { id: purchase.id, expectedEditVersion: withdrawn.editVersion },
    });
    expect(resubmitted.errors).toBeUndefined();
    expect(await statusOf(nthOf(ids, 0))).toMatchObject({ status: "sent" });
    expect(
      await db()
        .collection("lottery_bank_transactions")
        .countDocuments({
          refId: new Types.ObjectId(purchase.id),
          type: "redemption_income",
        }),
    ).toBe(1);

    // 退回 → 回到店內持有
    await decideOn({ api } as World, managerA, purchase.id, "RETURN");
    expect(await statusOf(nthOf(ids, 0))).toMatchObject({
      status: "in_store",
    });
  });

  it("送出前:別家店的、已勾在別張單的、金額和紀錄不同的 → 擋下", async () => {
    const other = await redemption(branchB, 500);
    expect(await submitBlocked(values([other], () => 500))).toMatchObject({
      reason: "PURCHASE_REDEMPTION_INVALID",
    });

    const own = await redemption(branchA, 500);
    expect(await submitBlocked(values([own], () => 600))).toMatchObject({
      reason: "PURCHASE_REDEMPTION_INVALID",
    });

    const taken = await redemption(branchA, 300);
    const first = await submitDraft(
      api,
      hq.token,
      await createDraft(
        api,
        hq.token,
        FORM,
        values([taken], () => 300),
      ),
    );
    expect(await statusOf(taken)).toMatchObject({
      status: "sent",
      purchaseSubmissionId: first.id,
    });
    // 已送兌的不在 lookup 的「店內持有」裡,表單引擎先擋(引用的資料不存在或無權讀取)
    expect(await submitBlocked(values([taken], () => 300))).toMatchObject({
      code: "VALIDATION_FAILED",
      fields: ["redemptions"],
    });
  });
});

function nthOf<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`沒有第 ${String(index)} 筆`);
  }
  return item;
}
