import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";
import { SKIP_ORG_TENANT, type StepDef } from "@repo/domain/workflow";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import {
  ASSIGN,
  CREATE_FORM,
  SUBMIT,
  type SubmissionRow,
  call,
  codeOf,
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
  bindForm,
  decideOn,
  person,
  publishWorkflow,
  reviewStep,
  roleSource,
} from "../../../workflows/test-support/workflow-fixtures";
import { isGameInUse } from "../games/game-usage";
import { RequisitionReference } from "./requisition-reference";
import {
  PURCHASING_MODULE_KEYS,
  REQUISITION_PERMISSIONS,
  insertGame,
  insertSaleEvent,
  insertStockTickets,
  seedPurchasingAuthorization,
} from "./test-support/requisition-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const FORM = "requisition";
const DAY = 24 * 60 * 60 * 1000;

const CANDIDATES = /* GraphQL */ `
  query TestRequisitionCandidates($orgId: ID!) {
    lotteryRequisitionCandidates(orgId: $orgId) {
      gameId
      gameCode
      isNew
      stockTickets
      inTransitBooks
      sold7
      sold30
      plannedBooks
      givenBooks
    }
  }
`;

const PURCHASE_LIST = /* GraphQL */ `
  query TestPurchaseList {
    lotteryPurchaseList {
      orgIds
      rows {
        gameCode
        branches {
          orgId
          books
        }
        totalBooks
        estimatedAmount
      }
      requisitions {
        requisitionId
        serialNo
        orgId
        books
        estimatedAmount
      }
    }
  }
`;

const STATES = /* GraphQL */ `
  query TestRequisitionStates($ids: [ID!]!) {
    lotteryRequisitionStates(requisitionIds: $ids) {
      requisitionId
      state
    }
  }
`;

interface Candidate {
  gameId: string;
  gameCode: string;
  isNew: boolean;
  stockTickets: number;
  inTransitBooks: number;
  sold7: number | null;
  sold30: number | null;
  plannedBooks: number | null;
  givenBooks: number;
}

interface PurchaseList {
  orgIds: string[];
  rows: {
    gameCode: string;
    branches: { orgId: string; books: number }[];
    totalBooks: number;
    estimatedAmount: number;
  }[];
  requisitions: {
    requisitionId: string;
    serialNo: string | null;
    orgId: string;
    books: number;
    estimatedAmount: number;
  }[];
}

/** 叫貨單的定義(欄位 key 同受管表單 `seeds/project/revisions/requisition.r1.seed.ts`)。 */
function requisitionDefinition(): FormDefinition {
  return definitionOf([
    field("note", "text"),
    field("branch", "reference", {
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("expected_date", "date"),
    field("lines", "array", {
      columns: [
        column("game", "reference", {
          source: {
            provider: "lottery_game",
            labelField: "name",
            filter: { status: "on_sale" },
          },
          rules: { required: true },
        }),
        column("books", "number", { rules: { required: true, min: 1 } }),
        column("note", "text"),
      ],
      rules: { required: true },
    }),
    field("total_books", "number", {
      valueSource: { kind: "computed", expr: { sumOf: ["lines", "books"] } },
    }),
  ]);
}

let rowSequence = 0;

function line(gameId: Types.ObjectId, books: number): Record<string, unknown> {
  rowSequence += 1;
  return {
    rowId: `00000000-0000-4000-8000-${String(rowSequence).padStart(12, "0")}`,
    game: String(gameId),
    books,
  };
}

/**
 * 叫貨單(專案規格 8 共通、8.1):真的表單引擎 + 審核流程 + 掛接點。
 * 流程同開通腳本建的那一份:一關 角色 總部管理、B4 跳過組織 = 租戶。
 */
describe("叫貨單(規格 8.1)", () => {
  let api: AuthTestApp;
  let tenant: Types.ObjectId;
  let branchA: Types.ObjectId;
  let branchB: Types.ObjectId;
  let hq: Person;
  let managerA: Person;
  let managerNoList: Person;
  let reference: RequisitionReference;
  let transactions: TransactionService;
  let gameOld: Types.ObjectId;
  let gameHot: Types.ObjectId;
  let gameNew: Types.ObjectId;
  let gameNewSold: Types.ObjectId;
  let gameStopped: Types.ObjectId;
  let gameUnused: Types.ObjectId;

  const lines = () => api.connection.collection("lottery_requisition_lines");

  async function submitAs(
    who: Person,
    branch: Types.ObjectId,
    rows: Record<string, unknown>[],
  ): Promise<SubmissionRow> {
    const draft = await createDraft(api, who.token, FORM, {
      branch: String(branch),
      lines: rows,
    });
    return submitDraft(api, who.token, draft);
  }

  async function linesOf(submissionId: string) {
    return lines()
      .find({ requisitionId: new Types.ObjectId(submissionId) })
      .toArray();
  }

  async function purchaseList(token = hq.token): Promise<PurchaseList> {
    const data = await ok<{ lotteryPurchaseList: PurchaseList }>(
      api,
      token,
      PURCHASE_LIST,
    );
    return data.lotteryPurchaseList;
  }

  async function candidates(
    token: string,
    orgId: Types.ObjectId,
  ): Promise<Candidate[]> {
    const data = await ok<{ lotteryRequisitionCandidates: Candidate[] }>(
      api,
      token,
      CANDIDATES,
      { orgId: String(orgId) },
    );
    return data.lotteryRequisitionCandidates;
  }

  async function candidateOf(
    token: string,
    orgId: Types.ObjectId,
    gameId: Types.ObjectId,
  ): Promise<Candidate | undefined> {
    const rows = await candidates(token, orgId);
    return rows.find((row) => row.gameId === String(gameId));
  }

  async function pendingIds(): Promise<string[]> {
    const list = await purchaseList();
    return list.requisitions.map((row) => row.requisitionId);
  }

  async function stateOf(submissionId: string): Promise<string | null> {
    const data = await ok<{
      lotteryRequisitionStates: { requisitionId: string; state: string }[];
    }>(api, hq.token, STATES, { ids: [submissionId] });
    return data.lotteryRequisitionStates[0]?.state ?? null;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-requisition");
    const { connection } = api;
    await seedPurchasingAuthorization(connection);
    reference = api.app.get(RequisitionReference);
    transactions = api.app.get(TransactionService);
    const root = await rootToken(api);
    tenant = await createOrg(connection, {
      name: "好運彩券行",
      settings: { visibility: "subtree" },
    });
    branchA = await createOrg(connection, { name: "中山店", parentId: tenant });
    branchB = await createOrg(connection, { name: "新竹店", parentId: tenant });

    const requisitionScope = {
      moduleKeys: [
        ...PURCHASING_MODULE_KEYS,
        "apply-center",
        "apply-center.view-page",
      ],
      permissionKeys: [
        ...Object.values(REQUISITION_PERMISSIONS),
        "apply-center.view",
      ],
    };
    const admin = await person(api, connection, tenant, tenant, {
      moduleKeys: [
        "system",
        "system.workflows",
        "system.forms",
        ...PURCHASING_MODULE_KEYS,
      ],
      permissionKeys: ["system.workflows.*", "system.forms.*"],
    });
    hq = await person(api, connection, tenant, tenant, requisitionScope);
    managerA = await person(api, connection, branchA, tenant, {
      moduleKeys: [...PURCHASING_MODULE_KEYS],
      permissionKeys: [
        REQUISITION_PERMISSIONS.view,
        REQUISITION_PERMISSIONS.create,
        REQUISITION_PERMISSIONS.edit,
      ],
    });
    managerNoList = managerA;
    const hqRoleId = await createRole(api.app, connection, {
      name: "總部管理",
      ownerOrgId: tenant,
      assignTo: [hq.userId],
    });

    // 共用的受管表單(root 建、發布、分派給租戶)
    await ok(api, root, CREATE_FORM, {
      input: {
        key: FORM,
        moduleKey: "purchasing.requisition",
        name: "叫貨單",
      },
    });
    await publishDefinition(api, root, FORM, requisitionDefinition(), null);
    await ok(api, root, ASSIGN, {
      input: { formKey: FORM, tenantOrgIds: [String(tenant)] },
    });
    // 開通腳本建的流程:一關 角色 總部管理;申請人屬於租戶就跳過
    const world = { api, connection, admin } as unknown as World;
    const step: StepDef = reviewStep("hq", roleSource(hqRoleId), {
      skipOrgs: { orgIds: [SKIP_ORG_TENANT], includeDescendants: false },
    });
    await publishWorkflow(world, "requisition_flow", {
      steps: [step],
      checkFormKey: FORM,
    });
    await bindForm(world, "requisition_flow", FORM);

    const now = Date.now();
    gameOld = await insertGame(connection, tenant, {
      gameCode: "5150",
      name: "好運旺旺",
      launchedAt: new Date(now - 400 * DAY),
    });
    gameHot = await insertGame(connection, tenant, {
      gameCode: "5164",
      name: "發大財",
    });
    gameNew = await insertGame(connection, tenant, {
      gameCode: "5201",
      name: "金好運",
      launchedAt: new Date(now - 2 * DAY),
    });
    gameNewSold = await insertGame(connection, tenant, {
      gameCode: "5198",
      name: "鼠來寶",
      unitPrice: 100,
      launchedAt: new Date(now - 10 * DAY),
    });
    gameStopped = await insertGame(connection, tenant, {
      gameCode: "4980",
      name: "舊彩",
      status: "discontinued",
    });
    gameUnused = await insertGame(connection, tenant, {
      gameCode: "5000",
      name: "沒人叫",
    });
    // 中山店:發大財近 30 天賣 3 張(其中近 7 天 2 張,撤銷 1 張)、好運旺旺 1 張、鼠來寶近 7 天 1 張
    for (const days of [1, 3, 20]) {
      await insertSaleEvent(
        connection,
        tenant,
        branchA,
        gameHot,
        new Date(now - days * DAY),
      );
    }
    await insertSaleEvent(
      connection,
      tenant,
      branchA,
      gameHot,
      new Date(now - 2 * DAY),
      "sale_undo",
    );
    await insertSaleEvent(
      connection,
      tenant,
      branchA,
      gameHot,
      new Date(now - 40 * DAY),
    );
    await insertSaleEvent(
      connection,
      tenant,
      branchA,
      gameOld,
      new Date(now - 10 * DAY),
    );
    await insertSaleEvent(
      connection,
      tenant,
      branchA,
      gameNewSold,
      new Date(now - DAY),
    );
    // 別家店的銷售不算
    await insertSaleEvent(
      connection,
      tenant,
      branchB,
      gameOld,
      new Date(now - DAY),
    );
    await insertStockTickets(connection, tenant, branchA, gameHot, 3);
    await insertStockTickets(
      connection,
      tenant,
      branchA,
      gameHot,
      2,
      "counter",
    );
    await insertStockTickets(
      connection,
      tenant,
      branchA,
      gameHot,
      4,
      "in_transit",
    );
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  });

  describe("B4:申請人屬於租戶 → 跳過審核(規格 2.1、8.1)", () => {
    let hqSubmission: SubmissionRow;

    it("總部人員替中山店送出 → 直接完成,寫叫貨明細副本(分店 = 叫貨分店)", async () => {
      hqSubmission = await submitAs(hq, branchA, [
        line(gameHot, 2),
        line(gameNew, 1),
      ]);
      expect(hqSubmission.status).toBe("COMPLETED");
      const rows = await linesOf(hqSubmission.id);
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            gameId: gameHot,
            books: 2,
            orgId: branchA,
          }),
          expect.objectContaining({
            gameId: gameNew,
            books: 1,
            orgId: branchA,
          }),
        ]),
      );
      expect(rows[0]).toMatchObject({
        tenantId: tenant,
        voidedAt: null,
        referencedBy: null,
      });
      expect(await stateOf(hqSubmission.id)).toBe("pending");
    });

    it("中山店店長送出 → 審核中、沒有副本;總部核准後完成才寫", async () => {
      const submitted = await submitAs(managerA, branchA, [line(gameHot, 1)]);
      expect(submitted.status).toBe("REVIEWING");
      expect(await linesOf(submitted.id)).toEqual([]);
      const world = { api } as unknown as World;
      await decideOn(world, hq, submitted.id, "APPROVE");
      expect(await linesOf(submitted.id)).toEqual([
        expect.objectContaining({ books: 1, orgId: branchA }),
      ]);
    });
  });

  describe("草稿不影響任何統計(規格 8 共通)", () => {
    it("草稿沒有副本:採購清單、在途、遊戲引用都不算", async () => {
      const before = await purchaseList();
      const draft = await createDraft(api, managerA.token, FORM, {
        branch: String(branchA),
        lines: [line(gameUnused, 5)],
      });
      expect(draft.status).toBe("DRAFT");
      expect(await linesOf(draft.id)).toEqual([]);
      expect(await purchaseList()).toEqual(before);
      const unused = await candidateOf(managerA.token, branchA, gameUnused);
      expect(unused?.inTransitBooks).toBe(0);
      await expect(isGameInUse(tenant, gameUnused)).resolves.toBe(false);
    });
  });

  describe("新增頁的遊戲清單(PU-02)", () => {
    it("只列販售中;新遊戲最上(上市日新到舊)標新,其他依近 30 天賣出多到少", async () => {
      const rows = await candidates(managerA.token, branchA);
      expect(rows.map((row) => row.gameCode)).toEqual([
        "5201",
        "5198",
        "5164",
        "5150",
        "5000",
      ]);
      expect(rows.map((row) => row.isNew)).toEqual([
        true,
        true,
        false,
        false,
        false,
      ]);
    });

    it("新遊戲還沒賣過 → 銷售欄 null(畫面「—」);有賣照實際;舊遊戲沒賣是 0", async () => {
      const rows = await candidates(managerA.token, branchA);
      const of = (gameId: Types.ObjectId) =>
        rows.find((row) => row.gameId === String(gameId));
      expect(of(gameNew)).toMatchObject({ sold7: null, sold30: null });
      expect(of(gameNewSold)).toMatchObject({ sold7: 1, sold30: 1 });
      expect(of(gameUnused)).toMatchObject({ sold7: 0, sold30: 0 });
      // 發大財:近 7 天 2 賣 − 1 撤銷;近 30 天 3 賣 − 1 撤銷(40 天前那張不算)
      expect(of(gameHot)).toMatchObject({ sold7: 1, sold30: 2 });
      // 好運旺旺:只算中山店的
      expect(of(gameOld)).toMatchObject({ sold7: 0, sold30: 1 });
    });

    it("目前庫存 = 庫存 + 檯面的未售張數(在途的不算);在途 = 待購買的叫貨單本數", async () => {
      const hot = await candidateOf(managerA.token, branchA, gameHot);
      // 總部那張 2 本 + 店長核准那張 1 本
      expect(hot).toMatchObject({ stockTickets: 5, inTransitBooks: 3 });
      const otherBranch = await candidateOf(hq.token, branchB, gameHot);
      expect(otherBranch).toMatchObject({ stockTickets: 0, inTransitBooks: 0 });
    });

    it("看不到的分店 → NOT_FOUND", async () => {
      const result = await call(api, managerA.token, CANDIDATES, {
        orgId: String(branchB),
      });
      expect(codeOf(result)).toBe("NOT_FOUND");
    });
  });

  describe("採購清單(PU-03)", () => {
    it("依遊戲 × 分店加總,預估批購金額 = 整本金額 × 預設批購金額率 × 本數", async () => {
      const list = await purchaseList();
      const hot = list.rows.find((row) => row.gameCode === "5164");
      expect(hot).toMatchObject({
        branches: [{ orgId: String(branchA), books: 3 }],
        totalBooks: 3,
        // 200 × 100 × 92% × 3
        estimatedAmount: 55_200,
      });
      expect(list.orgIds).toEqual([String(branchA)]);
      expect(list.requisitions).toHaveLength(2);
    });

    it("沒有 purchase-list 權限 → FORBIDDEN", async () => {
      const result = await call(api, managerNoList.token, PURCHASE_LIST);
      expect(codeOf(result)).toBe("FORBIDDEN");
    });
  });

  describe("停售遊戲不能出現在新的叫貨單(規格 5.1)", () => {
    it("送出時明細有停售遊戲 → 擋下,不完成、不寫副本", async () => {
      const draft = await createDraft(api, hq.token, FORM, {
        branch: String(branchA),
        lines: [line(gameStopped, 1)],
      });
      const result = await call(api, hq.token, SUBMIT, {
        input: { id: draft.id, expectedEditVersion: draft.editVersion },
      });
      // 表單定義的固定條件「只列販售中」先擋(引擎的引用驗證);掛接點 beforeSubmit 再擋一次
      // (租戶複製表單拿掉固定條件時)
      expect(codeOf(result)).toBe("VALIDATION_FAILED");
      expect(await linesOf(draft.id)).toEqual([]);
    });
  });

  describe("引用介面與作廢(規格 8.1)", () => {
    let requisition: SubmissionRow;

    beforeAll(async () => {
      requisition = await submitAs(hq, branchB, [line(gameOld, 4)]);
    });

    it("拿別租戶的叫貨單 id 來引用 → 不是待購買,資料不動", async () => {
      const otherTenant = await createOrg(api.connection, { name: "租戶乙" });
      const requisitionId = new Types.ObjectId(requisition.id);
      const before = await linesOf(requisition.id);
      await expect(
        transactions.withTransaction((session) =>
          reference.markRequisitionReferenced(session, {
            tenantId: otherTenant,
            requisitionId,
            type: "purchase",
            submissionId: new Types.ObjectId(),
          }),
        ),
      ).rejects.toMatchObject({
        extensions: { reason: "REQUISITION_NOT_PENDING" },
      });
      await transactions.withTransaction((session) =>
        reference.unmarkRequisitionReferenced(session, {
          tenantId: otherTenant,
          requisitionId,
        }),
      );
      expect(await linesOf(requisition.id)).toEqual(before);
      expect(await stateOf(requisition.id)).toBe("pending");
    });

    it("被進貨單引用 → 已進貨、不在採購清單;第二張不能再引用;同一張重送不重複寫", async () => {
      const purchaseId = new Types.ObjectId();
      const requisitionId = new Types.ObjectId(requisition.id);
      await transactions.withTransaction((session) =>
        reference.markRequisitionReferenced(session, {
          tenantId: tenant,
          requisitionId,
          type: "purchase",
          submissionId: purchaseId,
        }),
      );
      expect(await stateOf(requisition.id)).toBe("purchased");
      expect(await pendingIds()).not.toContain(requisition.id);
      await expect(
        transactions.withTransaction((session) =>
          reference.markRequisitionReferenced(session, {
            tenantId: tenant,
            requisitionId,
            type: "transfer",
            submissionId: new Types.ObjectId(),
          }),
        ),
      ).rejects.toMatchObject({
        extensions: { code: "CONFLICT", reason: "REQUISITION_REFERENCED" },
      });
      await transactions.withTransaction((session) =>
        reference.markRequisitionReferenced(session, {
          tenantId: tenant,
          requisitionId,
          type: "purchase",
          submissionId: purchaseId,
        }),
      );
      expect(await stateOf(requisition.id)).toBe("purchased");
    });

    it("被引用中不能作廢;引用的單作廢(解除引用)→ 回到待購買", async () => {
      const blocked = await call(api, hq.token, FORM_VOID, {
        input: {
          id: requisition.id,
          expectedEditVersion: requisition.editVersion,
          reasonNote: "輸入錯誤",
        },
      });
      expect(extensionsOf(blocked)).toMatchObject({
        code: "FORBIDDEN",
        reason: "REQUISITION_REFERENCED",
      });
      await transactions.withTransaction((session) =>
        reference.unmarkRequisitionReferenced(session, {
          tenantId: tenant,
          requisitionId: new Types.ObjectId(requisition.id),
        }),
      );
      expect(await stateOf(requisition.id)).toBe("pending");
    });

    it("作廢 → 副本補 voidedAt(不刪除),不在採購清單、不算在途;作廢後不能被引用", async () => {
      await ok(api, hq.token, FORM_VOID, {
        input: {
          id: requisition.id,
          expectedEditVersion: requisition.editVersion,
          reasonNote: "輸入錯誤",
        },
      });
      const rows = await linesOf(requisition.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).toBeInstanceOf(Date);
      expect(await stateOf(requisition.id)).toBeNull();
      expect(await pendingIds()).not.toContain(requisition.id);
      const old = await candidateOf(hq.token, branchB, gameOld);
      expect(old?.inTransitBooks).toBe(0);
      await expect(
        transactions.withTransaction((session) =>
          reference.markRequisitionReferenced(session, {
            tenantId: tenant,
            requisitionId: new Types.ObjectId(requisition.id),
            type: "purchase",
            submissionId: new Types.ObjectId(),
          }),
        ),
      ).rejects.toMatchObject({
        extensions: { reason: "REQUISITION_NOT_PENDING" },
      });
    });
  });

  describe("遊戲引用檢查(規格 5.1)", () => {
    it("被叫貨單引用過(草稿以外)→ 遊戲有庫存、不能刪", async () => {
      await expect(isGameInUse(tenant, gameNew)).resolves.toBe(true);
      await expect(isGameInUse(tenant, gameUnused)).resolves.toBe(false);
    });
  });
});
