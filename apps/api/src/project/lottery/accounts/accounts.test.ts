import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  ACCOUNTS_PERMISSIONS as P,
  payeeDefaultAmount,
  payerDefaultAmount,
  totalsOf,
} from "@repo/domain/project/lottery-accounts";

import { AuditService } from "../../../audit/audit.service";
import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { TransactionService } from "../../../database/transaction";
import type { FormGuardContext } from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import {
  AppendOnlyLedgerError,
  LotteryBankTransactionsRepository,
  LotteryCashMovementsRepository,
} from "../../database/lottery-accounts/lottery-accounts.repositories";
import { LotteryCashMovementSchema } from "../../database/lottery-accounts/lottery-cash-movement.schema";
import { LOTTERY_SHIFTS_COLLECTION } from "../../database/lottery-store/lottery-shift.schema";
import {
  CashLedgerOutsideTransactionError,
  CashLedgerService,
  type CashMovementInput,
} from "../cash/cash-ledger.service";
import { settlementClearedGuard } from "../settlement/settlement-guard";
import {
  type SettlementSubmission,
  registerSettlementDocument,
} from "../settlement/settlement-registry";
import { SettlementService } from "../settlement/settlement.service";
import { errorOf, ok } from "../test-support/master-data-fixtures";
import {
  TEST_SETTLE_PERMISSION,
  createAccountsOperator,
  insertTestSubmission,
  seedAccountsAuthorization,
} from "./test-support/accounts-fixtures";

const ACCOUNT_FIELDS = /* GraphQL */ `
  fragment TestBankAccountFields on LotteryBankAccount {
    id
    label
    openingBalance
    openingDate
    status
    balance
    hasTransactions
    shareOrgs {
      orgId
      includeDescendants
    }
    usageOrgs {
      id
      name
    }
    abilities {
      canEdit
      canDelete
      canRecordTransaction
      canReverse
    }
  }
`;

const LIST = /* GraphQL */ `
  ${ACCOUNT_FIELDS}
  query TestBankAccounts($input: LotteryBankAccountsInput!) {
    lotteryBankAccounts(input: $input) {
      items {
        ...TestBankAccountFields
      }
      totalCount
    }
  }
`;

const ONE = /* GraphQL */ `
  ${ACCOUNT_FIELDS}
  query TestBankAccount($id: ID!) {
    lotteryBankAccount(id: $id) {
      item {
        ...TestBankAccountFields
      }
    }
  }
`;

const CREATE = /* GraphQL */ `
  ${ACCOUNT_FIELDS}
  mutation TestCreateBankAccount($input: CreateLotteryBankAccountInput!) {
    createLotteryBankAccount(input: $input) {
      item {
        ...TestBankAccountFields
      }
    }
  }
`;

const UPDATE = /* GraphQL */ `
  ${ACCOUNT_FIELDS}
  mutation TestUpdateBankAccount($input: UpdateLotteryBankAccountInput!) {
    updateLotteryBankAccount(input: $input) {
      item {
        ...TestBankAccountFields
      }
    }
  }
`;

const DELETE = /* GraphQL */ `
  mutation TestDeleteBankAccount($id: ID!) {
    deleteLotteryBankAccount(id: $id) {
      id
    }
  }
`;

const TX_FIELDS = /* GraphQL */ `
  fragment TestBankTransactionFields on LotteryBankTransaction {
    id
    type
    direction
    amount
    balanceAfter
    reversalOf
    reversedById
    settlementSide
    note
    abilities {
      canReverse
    }
  }
`;

const RECORD = /* GraphQL */ `
  ${TX_FIELDS}
  mutation TestRecordBankTransaction(
    $input: RecordLotteryBankTransactionInput!
  ) {
    recordLotteryBankTransaction(input: $input) {
      item {
        ...TestBankTransactionFields
      }
    }
  }
`;

const REVERSE = /* GraphQL */ `
  ${TX_FIELDS}
  mutation TestReverseBankTransaction(
    $input: ReverseLotteryBankTransactionInput!
  ) {
    reverseLotteryBankTransaction(input: $input) {
      item {
        ...TestBankTransactionFields
      }
    }
  }
`;

const TRANSACTIONS = /* GraphQL */ `
  ${TX_FIELDS}
  query TestBankTransactions($input: LotteryBankTransactionsInput!) {
    lotteryBankTransactions(input: $input) {
      items {
        ...TestBankTransactionFields
      }
      totalIn
      totalOut
    }
  }
`;

const CASH_LEDGER = /* GraphQL */ `
  query TestCashLedger($input: LotteryCashLedgerInput!) {
    lotteryCashLedger(input: $input) {
      vault {
        amount
        baselineAmount
        baselineAt
      }
      items {
        id
        type
        from
        to
        amount
        reversalOf
        reversedById
      }
      totalCount
    }
  }
`;

const SETTLEMENT = /* GraphQL */ `
  query TestSettlement($moduleKey: String!, $refId: ID!) {
    lotterySettlement(moduleKey: $moduleKey, refId: $refId) {
      item {
        payable
        pendingPayee
        sides {
          side
          net
          totalOut
          totalIn
          canSettle
          buttons {
            button
            defaultAmount
            canUse
          }
        }
        records {
          id
          method
          side
          direction
          amount
          handler
          reversedById
          canReverse
        }
      }
    }
  }
`;

const CASH_POINT_RECORDS = /* GraphQL */ `
  query TestCashPointRecords($moduleKey: String!, $refId: ID!) {
    lotterySettlement(moduleKey: $moduleKey, refId: $refId) {
      item {
        records {
          cashPlace
          cashPointName
          cashPointPrinterId
        }
      }
    }
  }
`;

const RECORD_SETTLEMENT = /* GraphQL */ `
  mutation TestRecordSettlement($input: RecordLotterySettlementInput!) {
    recordLotterySettlement(input: $input) {
      recordId
      item {
        sides {
          side
          net
        }
      }
    }
  }
`;

const REVERSE_SETTLEMENT = /* GraphQL */ `
  mutation TestReverseSettlement($input: ReverseLotterySettlementInput!) {
    reverseLotterySettlement(input: $input) {
      recordId
      item {
        sides {
          side
          net
        }
      }
    }
  }
`;

const SETTLEMENT_ACCOUNTS = /* GraphQL */ `
  query TestSettlementAccounts(
    $moduleKey: String!
    $refId: ID!
    $side: String!
  ) {
    lotterySettlementAccounts(
      moduleKey: $moduleKey
      refId: $refId
      side: $side
    ) {
      items {
        id
        name
      }
    }
  }
`;

const OUTSTANDING = /* GraphQL */ `
  query TestOutstanding {
    lotteryOutstandingSettlements {
      items {
        moduleKey
        docNo
        side
        branch {
          name
        }
        payable
        net
        kind
        amount
        button
        canSettle
      }
      totalCount
    }
  }
`;

const CANDIDATES = /* GraphQL */ `
  query TestCandidates($input: LotterySettlementCandidatesInput!) {
    lotterySettlementCandidates(input: $input) {
      items {
        refId
        kind
      }
    }
  }
`;

interface AccountRow {
  id: string;
  label: string;
  openingBalance: number;
  status: string;
  balance: number;
  hasTransactions: boolean;
  shareOrgs: { orgId: string; includeDescendants: boolean }[];
  usageOrgs: { id: string; name: string }[];
  abilities: {
    canEdit: boolean;
    canDelete: boolean;
    canRecordTransaction: boolean;
    canReverse: boolean;
  };
}

interface TransactionRow {
  id: string;
  type: string;
  direction: string;
  amount: number;
  balanceAfter: number;
  reversalOf: string | null;
  reversedById: string | null;
  settlementSide: string | null;
  note: string | null;
  abilities: { canReverse: boolean };
}

interface SettlementData {
  lotterySettlement: {
    item: {
      payable: number;
      pendingPayee: number;
      sides: {
        side: string;
        net: number;
        totalOut: number;
        totalIn: number;
        canSettle: boolean;
        buttons: { button: string; defaultAmount: number; canUse: boolean }[];
      }[];
      records: {
        id: string;
        method: string;
        side: string;
        direction: string;
        amount: number;
        handler: string | null;
        reversedById: string | null;
        canReverse: boolean;
      }[];
    };
  };
}

interface OutstandingData {
  lotteryOutstandingSettlements: {
    items: {
      moduleKey: string;
      docNo: string;
      side: string;
      branch: { name: string };
      payable: number;
      net: number;
      kind: string;
      amount: number;
      button: string;
      canSettle: boolean;
    }[];
    totalCount: number;
  };
}

const TEST_PURCHASE = "test.purchase";
const TEST_TRANSFER = "test.transfer";

const ALL_ACCOUNTS = Object.values(P);

/**
 * 帳戶管理(專案規格第 9 章、10.1–10.3):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 * 組織樹:root ─ 租戶甲(含下層可見)─┬─ 中山店
 *                                  └─ 新竹店
 * 收付機制用兩種測試單據登記驗(進貨型:總部一邊只能銀行;調貨型:收貨店付款方 + 出貨店收款方)。
 */
describe("帳戶管理(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let tenantA: Types.ObjectId;
  let storeA: Types.ObjectId;
  let storeB: Types.ObjectId;
  /** 總部:帳戶管理全部 + 測試單據的收付權限。 */
  let hq: string;
  /** 中山店店長:三個分頁 + 測試單據的收付權限,沒有新增 / 編輯 / 登記 / 沖正。 */
  let managerA: string;
  /** 總部、只綁模組沒有任何權限。 */
  let nobody: string;
  const unregister: (() => void)[] = [];

  const create = (input: Record<string, unknown>, token = hq) =>
    ok<{ createLotteryBankAccount: { item: AccountRow } }>(api, token, CREATE, {
      input: {
        bankCode: "004",
        accountName: "好運彩券行",
        openingBalance: 1000,
        openingDate: "2026-10-01T00:00:00.000Z",
        ...input,
      },
    }).then((data) => data.createLotteryBankAccount.item);

  const record = (input: Record<string, unknown>, token = hq) =>
    ok<{ recordLotteryBankTransaction: { item: TransactionRow } }>(
      api,
      token,
      RECORD,
      { input: { occurredAt: "2026-10-10T02:00:00.000Z", ...input } },
    ).then((data) => data.recordLotteryBankTransaction.item);

  const settlement = (moduleKey: string, refId: Types.ObjectId, token = hq) =>
    ok<SettlementData>(api, token, SETTLEMENT, {
      moduleKey,
      refId: String(refId),
    }).then((data) => data.lotterySettlement.item);

  /** 現金流水一律在交易內寫(`CashLedgerService` 不在交易內會拋錯)。 */
  const recordCash = (input: CashMovementInput) =>
    api.app
      .get(TransactionService)
      .withTransaction((session) =>
        api.app.get(CashLedgerService).recordCashMovement(session, input),
      );

  /** 把一家店的小金庫應有補成剛好 `target`(以現金更正的流水增減;收付從小金庫付現不能超過應有)。 */
  const fillVault = async (orgId: Types.ObjectId, target: number) => {
    const operator = await operatorOf(api, tenantA);
    const { amount } = await api.app
      .get(CashLedgerService)
      .vaultExpected(operator, tenantA, orgId);
    if (amount === target) {
      return;
    }
    const isShort = amount < target;
    await recordCash({
      operator,
      orgId,
      type: isShort ? "correction_increase" : "correction_decrease",
      from: isShort ? "external" : "vault",
      to: isShort ? "vault" : "external",
      amount: Math.abs(target - amount),
    });
  };

  const reverseCash = (
    id: Types.ObjectId,
    by: { operator: OperatorContext; note?: string | null },
  ) =>
    api.app
      .get(TransactionService)
      .withTransaction((session) =>
        api.app.get(CashLedgerService).reverseCashMovement(session, id, by),
      );

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-accounts");
    await seedAccountsAuthorization(api.connection);
    tenantA = await createOrg(api.connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    storeA = await createOrg(api.connection, {
      name: "中山店",
      parentId: tenantA,
    });
    storeB = await createOrg(api.connection, {
      name: "新竹店",
      parentId: tenantA,
    });
    ({ token: hq } = await createAccountsOperator(api, api.connection, {
      orgId: tenantA,
      permissionKeys: [...ALL_ACCOUNTS, TEST_SETTLE_PERMISSION],
    }));
    ({ token: managerA } = await createAccountsOperator(api, api.connection, {
      orgId: storeA,
      ownerOrgId: tenantA,
      permissionKeys: [
        P.viewBankAccounts,
        P.viewCash,
        P.viewOutstanding,
        TEST_SETTLE_PERMISSION,
      ],
    }));
    ({ token: nobody } = await createAccountsOperator(api, api.connection, {
      orgId: tenantA,
      permissionKeys: [],
    }));
    unregister.push(
      registerSettlementDocument({
        moduleKey: TEST_PURCHASE,
        label: "測試進貨單",
        kind: "purchase",
        payable: (submission) => ({
          amount: Number(submission.values.payable),
          branchOrgId: new Types.ObjectId(String(submission.values.store)),
          docNo: String(submission.values.docNo),
          counterparty: "陳志明",
        }),
        sides: [
          {
            side: "hq",
            label: "總部",
            role: "payer",
            permission: TEST_SETTLE_PERMISSION,
            methods: ["bank"],
            defaultAmount: (button, state) =>
              payerDefaultAmount(button, state.payable, totalsOf(state, "hq")),
          },
        ],
      }),
      registerSettlementDocument({
        moduleKey: TEST_TRANSFER,
        label: "測試調貨單",
        kind: "transfer",
        payable: (submission) => ({
          amount: Number(submission.values.payable),
          branchOrgId: new Types.ObjectId(String(submission.values.store)),
          docNo: String(submission.values.docNo),
          counterparty: "出貨店",
        }),
        sides: [
          {
            side: "receiver",
            label: "收貨店",
            role: "payer",
            permission: TEST_SETTLE_PERMISSION,
            methods: ["bank", "cash"],
            defaultAmount: (button, state) =>
              payerDefaultAmount(
                button,
                state.payable,
                totalsOf(state, "receiver"),
              ),
          },
          {
            side: "shipper",
            label: "出貨店",
            role: "payee",
            permission: TEST_SETTLE_PERMISSION,
            methods: ["bank"],
            defaultAmount: (button, state) =>
              payeeDefaultAmount(
                button,
                state.payable,
                totalsOf(state, "receiver"),
                totalsOf(state, "shipper"),
              ),
            branchOf: (submission) =>
              new Types.ObjectId(String(submission.values.shipper)),
          },
        ],
      }),
    );
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    for (const undo of unregister) {
      undo();
    }
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("銀行帳戶", () => {
    it("有交易後期初餘額 / 日期鎖定;沒有交易可刪除、有交易只能停用", async () => {
      const empty = await create({ accountNo: "0001-00001" });
      expect(empty.abilities).toMatchObject({ canEdit: true, canDelete: true });
      // 沒有交易:期初可改、可刪除
      await ok(api, hq, UPDATE, {
        input: { id: empty.id, openingBalance: 2000 },
      });
      await ok(api, hq, DELETE, { id: empty.id });
      expect(await errorOf(api, hq, ONE, { id: empty.id })).toMatchObject({
        code: "NOT_FOUND",
      });

      const used = await create({ accountNo: "0001-00002" });
      await record({ accountId: used.id, type: "deposit", amount: 500 });
      const after = await ok<{ lotteryBankAccount: { item: AccountRow } }>(
        api,
        hq,
        ONE,
        { id: used.id },
      );
      expect(after.lotteryBankAccount.item).toMatchObject({
        balance: 1500,
        hasTransactions: true,
        abilities: { canDelete: false },
      });
      expect(
        await errorOf(api, hq, UPDATE, {
          input: { id: used.id, openingBalance: 9 },
        }),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "BANK_ACCOUNT_HAS_TRANSACTIONS",
        fields: ["openingBalance"],
      });
      expect(
        await errorOf(api, hq, UPDATE, {
          input: { id: used.id, openingDate: "2026-09-01T00:00:00.000Z" },
        }),
      ).toMatchObject({ reason: "BANK_ACCOUNT_HAS_TRANSACTIONS" });
      expect(await errorOf(api, hq, DELETE, { id: used.id })).toMatchObject({
        reason: "BANK_ACCOUNT_HAS_TRANSACTIONS",
      });
      // 其他欄位隨時可改;停用
      const edited = await ok<{
        updateLotteryBankAccount: { item: AccountRow };
      }>(api, hq, UPDATE, {
        input: { id: used.id, accountName: "好運二號", status: "inactive" },
      });
      expect(edited.updateLotteryBankAccount.item).toMatchObject({
        label: "好運二號 末 00002",
        status: "inactive",
      });
      // 停用的帳戶不能登記交易
      expect(
        await errorOf(api, hq, RECORD, {
          input: {
            accountId: used.id,
            type: "deposit",
            amount: 1,
            occurredAt: "2026-10-11T00:00:00.000Z",
          },
        }),
      ).toMatchObject({ reason: "BANK_ACCOUNT_INACTIVE" });
    });

    it("同租戶銀行代碼 + 帳號重複 → BANK_ACCOUNT_DUPLICATE", async () => {
      await create({ accountNo: "0001-00003" });
      expect(
        await errorOf(api, hq, CREATE, {
          input: {
            bankCode: "004",
            accountNo: "0001-00003",
            accountName: "重複",
            openingBalance: 0,
            openingDate: "2026-10-01T00:00:00.000Z",
          },
        }),
      ).toMatchObject({ reason: "BANK_ACCOUNT_DUPLICATE" });
    });

    it("可見範圍:分店看不到使用組織不含自己的帳戶(列表與單筆都 NOT_FOUND);含下層的共用看得到;共用進來的只能看", async () => {
      const hidden = await create({
        accountNo: "0002-00001",
        shareOrgs: [{ orgId: String(storeB) }],
      });
      const sharedA = await create({
        accountNo: "0002-00002",
        shareOrgs: [{ orgId: String(storeA) }],
      });
      const allBranches = await create({
        accountNo: "0002-00003",
        shareOrgs: [{ orgId: String(tenantA), includeDescendants: true }],
      });
      const list = await ok<{
        lotteryBankAccounts: { items: AccountRow[] };
      }>(api, managerA, LIST, { input: {} });
      const ids = list.lotteryBankAccounts.items.map((item) => item.id);
      expect(ids).toEqual(expect.arrayContaining([sharedA.id, allBranches.id]));
      expect(ids).not.toContain(hidden.id);
      expect(
        await errorOf(api, managerA, ONE, { id: hidden.id }),
      ).toMatchObject({ code: "NOT_FOUND" });
      expect(
        await errorOf(api, managerA, TRANSACTIONS, {
          input: { accountId: hidden.id },
        }),
      ).toMatchObject({ code: "NOT_FOUND" });
      const shared = list.lotteryBankAccounts.items.find(
        (item) => item.id === sharedA.id,
      );
      expect(shared?.abilities).toEqual({
        canEdit: false,
        canDelete: false,
        canRecordTransaction: false,
        canReverse: false,
      });
      expect(shared?.usageOrgs).toEqual([
        { id: String(storeA), name: "中山店" },
      ]);
      // 總部看全部
      const hqList = await ok<{
        lotteryBankAccounts: { items: AccountRow[] };
      }>(api, hq, LIST, { input: {} });
      expect(hqList.lotteryBankAccounts.items.map((item) => item.id)).toEqual(
        expect.arrayContaining([hidden.id, sharedA.id, allBranches.id]),
      );
    });

    it("店長(開通配方:銀行帳戶只看):看得到自己分店使用的帳戶與餘額;共用帳戶的餘額與交易清單含別家分店的交易;沒有編輯 / 登記 / 沖正", async () => {
      const shared = await create({
        accountNo: "0003-00002",
        openingBalance: 1000,
        shareOrgs: [{ orgId: String(storeA) }, { orgId: String(storeB) }],
      });
      // 新竹店的進貨支出(總部登記)
      await record({
        accountId: shared.id,
        type: "purchase_expense",
        amount: 300,
        branchOrgId: String(storeB),
      });
      const one = await ok<{ lotteryBankAccount: { item: AccountRow } }>(
        api,
        managerA,
        ONE,
        { id: shared.id },
      );
      expect(one.lotteryBankAccount.item).toMatchObject({
        balance: 700,
        abilities: {
          canEdit: false,
          canDelete: false,
          canRecordTransaction: false,
          canReverse: false,
        },
      });
      const list = await ok<{
        lotteryBankTransactions: { items: TransactionRow[] };
      }>(api, managerA, TRANSACTIONS, { input: { accountId: shared.id } });
      expect(list.lotteryBankTransactions.items).toEqual([
        expect.objectContaining({
          type: "purchase_expense",
          amount: 300,
          abilities: { canReverse: false },
        }),
      ]);
      const [transaction] = list.lotteryBankTransactions.items;
      expect(
        await errorOf(api, managerA, REVERSE, {
          input: { id: transaction?.id, reason: "測試" },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
    });

    it("權限:沒有 view-bank-accounts 讀不到;沒有 record / reverse 寫不了", async () => {
      expect(await errorOf(api, nobody, LIST, { input: {} })).toMatchObject({
        code: "FORBIDDEN",
      });
      const account = await create({
        accountNo: "0003-00001",
        shareOrgs: [{ orgId: String(storeA) }],
      });
      expect(
        await errorOf(api, managerA, RECORD, {
          input: {
            accountId: account.id,
            type: "deposit",
            amount: 1,
            occurredAt: "2026-10-01T00:00:00.000Z",
          },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
      expect(
        await errorOf(api, managerA, CREATE, {
          input: {
            bankCode: "004",
            accountNo: "x",
            accountName: "x",
            openingBalance: 0,
            openingDate: "2026-10-01T00:00:00.000Z",
          },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("銀行交易", () => {
    it("方向照類型;調整 / 其他要選方向、說明必填;批貨歸屬分店必填;餘額依時間累加、負數照記", async () => {
      const account = await create({
        accountNo: "0004-00001",
        openingBalance: 100,
      });
      expect(
        await errorOf(api, hq, RECORD, {
          input: {
            accountId: account.id,
            type: "adjustment",
            amount: 10,
            occurredAt: "2026-10-02T00:00:00.000Z",
          },
        }),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: expect.arrayContaining(["direction", "summary"]),
      });
      expect(
        await errorOf(api, hq, RECORD, {
          input: {
            accountId: account.id,
            type: "purchase_expense",
            amount: 10,
            occurredAt: "2026-10-02T00:00:00.000Z",
          },
        }),
      ).toMatchObject({ fields: ["branchOrgId"] });
      const rent = await record({
        accountId: account.id,
        type: "license_rent",
        direction: "in",
        amount: 300,
        occurredAt: "2026-10-03T00:00:00.000Z",
      });
      expect(rent.direction).toBe("out");
      await record({
        accountId: account.id,
        type: "other",
        direction: "in",
        summary: "利息",
        amount: 50,
        occurredAt: "2026-10-04T00:00:00.000Z",
      });
      const list = await ok<{
        lotteryBankTransactions: {
          items: TransactionRow[];
          totalIn: number;
          totalOut: number;
        };
      }>(api, hq, TRANSACTIONS, { input: { accountId: account.id } });
      // 新的在前;每列是那一筆之後的餘額
      expect(
        list.lotteryBankTransactions.items.map((item) => [
          item.type,
          item.balanceAfter,
        ]),
      ).toEqual([
        ["other", -150],
        ["license_rent", -200],
      ]);
      expect(list.lotteryBankTransactions).toMatchObject({
        totalIn: 50,
        totalOut: 300,
      });
    });

    it("沖正:產生方向相反的一筆、原交易不改;同一筆不能沖兩次;沖正的那一筆不能再沖", async () => {
      const account = await create({ accountNo: "0004-00002" });
      const original = await record({
        accountId: account.id,
        type: "withdrawal",
        amount: 400,
      });
      const reversal = await ok<{
        reverseLotteryBankTransaction: { item: TransactionRow };
      }>(api, hq, REVERSE, { input: { id: original.id, reason: "金額記錯" } });
      expect(reversal.reverseLotteryBankTransaction.item).toMatchObject({
        type: "withdrawal",
        direction: "in",
        amount: 400,
        reversalOf: original.id,
        note: "金額記錯",
      });
      const stored = await api.connection
        .collection("lottery_bank_transactions")
        .findOne({ _id: new Types.ObjectId(original.id) });
      expect(stored).toMatchObject({ direction: "out", amount: 400 });
      const list = await ok<{
        lotteryBankTransactions: { items: TransactionRow[] };
      }>(api, hq, TRANSACTIONS, { input: { accountId: account.id } });
      expect(
        list.lotteryBankTransactions.items.find(
          (item) => item.id === original.id,
        ),
      ).toMatchObject({
        reversedById: reversal.reverseLotteryBankTransaction.item.id,
        abilities: { canReverse: false },
      });
      expect(
        await errorOf(api, hq, REVERSE, {
          input: { id: original.id, reason: "再一次" },
        }),
      ).toMatchObject({ reason: "ALREADY_REVERSED" });
      expect(
        await errorOf(api, hq, REVERSE, {
          input: {
            id: reversal.reverseLotteryBankTransaction.item.id,
            reason: "沖正沖正",
          },
        }),
      ).toMatchObject({ reason: "ALREADY_REVERSED" });
      expect(
        await errorOf(api, hq, REVERSE, {
          input: { id: original.id, reason: " " },
        }),
      ).toMatchObject({ fields: ["reason"] });
    });

    it("沖正「存入」→ 連結的「存銀行」流水自動反向", async () => {
      const account = await create({ accountNo: "0004-00003" });
      const deposit = await record({
        accountId: account.id,
        type: "deposit",
        amount: 20_000,
        branchOrgId: String(storeA),
      });
      const operator = await operatorOf(api, tenantA);
      const movement = await recordCash({
        operator,
        orgId: storeA,
        type: "bank_deposit",
        from: "vault",
        to: "bank",
        amount: 20_000,
        bankTransactionId: new Types.ObjectId(deposit.id),
      });
      await ok(api, hq, REVERSE, { input: { id: deposit.id, reason: "重複" } });
      const reversed = await api.connection
        .collection("lottery_cash_movements")
        .findOne({ reversalOf: movement._id });
      expect(reversed).toMatchObject({
        type: "bank_deposit",
        from: "bank",
        to: "vault",
        amount: 20_000,
      });
    });
  });

  describe("即時現金帳", () => {
    it("小金庫應有只從流水計算(沒有日結從 0 起算);沖正反向抵銷", async () => {
      const operator = await operatorOf(api, tenantA);
      await recordCash({
        operator,
        orgId: storeB,
        type: "correction_increase",
        from: "external",
        to: "vault",
        amount: 5000,
      });
      const out = await recordCash({
        operator,
        orgId: storeB,
        type: "transfer_out",
        from: "vault",
        to: "external",
        amount: 1840,
        payee: "王小明",
      });
      const view = (token: string) =>
        ok<{
          lotteryCashLedger: {
            vault: { amount: number; baselineAt: string | null };
            totalCount: number;
          };
        }>(api, token, CASH_LEDGER, { input: { orgId: String(storeB) } });
      const first = await view(hq);
      expect(first.lotteryCashLedger.vault).toEqual({
        amount: 3160,
        baselineAmount: 0,
        baselineAt: null,
      });
      await reverseCash(out._id, { operator });
      const second = await view(hq);
      expect(second.lotteryCashLedger.vault.amount).toBe(5000);
      // 分店看不到別家分店的現金帳
      expect(
        await errorOf(api, managerA, CASH_LEDGER, {
          input: { orgId: String(storeB) },
        }),
      ).toMatchObject({ code: "NOT_FOUND" });
      expect(
        await errorOf(api, nobody, CASH_LEDGER, {
          input: { orgId: String(storeB) },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
      // 從 → 到不合類型、出庫沒原因、抽屜沒有班次 → 擋下
      await expect(
        recordCash({
          operator,
          orgId: storeB,
          type: "withdraw",
          from: "vault",
          to: "drawer",
          amount: 100,
        }),
      ).rejects.toMatchObject({
        extensions: { fields: expect.arrayContaining(["shiftId", "reason"]) },
      }); // 不在交易內 → 拋錯(流水要與同一個動作的其他寫入一起回復)
      await expect(
        api.app.get(CashLedgerService).recordCashMovement(undefined, {
          operator,
          orgId: storeB,
          type: "correction_increase",
          from: "external",
          to: "vault",
          amount: 1,
        }),
      ).rejects.toBeInstanceOf(CashLedgerOutsideTransactionError);
    });

    it("應有現金沒有可改寫的數字欄位:schema 沒有餘額欄、帳本不能修改或刪除", async () => {
      const paths = Object.keys(LotteryCashMovementSchema.paths);
      expect(
        paths.filter((path) => /balance|expected|total/i.test(path)),
      ).toEqual([]);
      const operator = await operatorOf(api, tenantA);
      const movements = api.app.get(LotteryCashMovementsRepository);
      const transactions = api.app.get(LotteryBankTransactionsRepository);
      expect(() => movements.updateById()).toThrow(AppendOnlyLedgerError);
      expect(() => movements.softDeleteById()).toThrow(AppendOnlyLedgerError);
      expect(() => transactions.updateMany()).toThrow(AppendOnlyLedgerError);
      expect(() => transactions.findOneAndUpdate()).toThrow(
        AppendOnlyLedgerError,
      );
      expect(operator.actorId).not.toBeNull();
    });
  });

  describe("收付機制(測試單據登記)", () => {
    it("已付淨額 = 支出 − 收入;分次付款;待結清與側欄數字;作廢 / 駁回前淨額 ≠ 0 → 擋下", async () => {
      const account = await create({
        accountNo: "0005-00001",
        openingBalance: 0,
        shareOrgs: [{ orgId: String(tenantA), includeDescendants: true }],
      });
      const doc = await insertTestSubmission(api.connection, {
        orgId: storeA,
        tenantId: tenantA,
        moduleKey: TEST_PURCHASE,
        values: { payable: 17_000, store: String(storeA), docNo: "P-0031" },
      });
      const pay = (amount: number, button = "out") =>
        ok<{
          recordLotterySettlement: {
            recordId: string;
            item: { sides: { side: string; net: number }[] };
          };
        }>(api, hq, RECORD_SETTLEMENT, {
          input: {
            moduleKey: TEST_PURCHASE,
            refId: String(doc),
            side: "hq",
            button,
            method: "bank",
            accountId: account.id,
            amount,
          },
        }).then((data) => data.recordLotterySettlement);

      // 一開始:待付 17,000
      const before = await settlement(TEST_PURCHASE, doc);
      expect(before.sides[0]?.buttons).toEqual([
        { button: "out", defaultAmount: 17_000, canUse: true },
        { button: "in", defaultAmount: 0, canUse: false },
      ]);
      const outstanding = await ok<OutstandingData>(api, hq, OUTSTANDING);
      expect(
        outstanding.lotteryOutstandingSettlements.items.find(
          (item) => item.docNo === "P-0031",
        ),
      ).toMatchObject({
        side: "hq",
        branch: { name: "中山店" },
        payable: 17_000,
        net: 0,
        kind: "to_pay",
        amount: 17_000,
        button: "out",
        canSettle: true,
      });

      // 分次付款:10,000 + 9,000 → 多付 2,000 → 待退
      const first = await pay(10_000);
      expect(first.item.sides).toEqual([{ side: "hq", net: 10_000 }]);
      await pay(9000);
      const over = await settlement(TEST_PURCHASE, doc);
      expect(over.sides[0]).toMatchObject({
        net: 19_000,
        totalOut: 19_000,
        totalIn: 0,
      });
      expect(over.sides[0]?.buttons).toEqual([
        { button: "out", defaultAmount: 0, canUse: false },
        { button: "in", defaultAmount: 2000, canUse: true },
      ]);
      // 按鈕先填 0 的那一顆不能按
      expect(
        await errorOf(api, hq, RECORD_SETTLEMENT, {
          input: {
            moduleKey: TEST_PURCHASE,
            refId: String(doc),
            side: "hq",
            button: "out",
            method: "bank",
            accountId: account.id,
            amount: 1,
          },
        }),
      ).toMatchObject({ reason: "SETTLEMENT_NOTHING_DUE" });
      // 進貨型只能銀行
      expect(
        await errorOf(api, hq, RECORD_SETTLEMENT, {
          input: {
            moduleKey: TEST_PURCHASE,
            refId: String(doc),
            side: "hq",
            button: "in",
            method: "cash",
            cashSource: "vault",
            handler: "王小明",
            amount: 1,
          },
        }),
      ).toMatchObject({ fields: ["method"] });

      // 作廢 / 駁回守門:淨額 ≠ 0 → 擋下
      const operator = await operatorOf(api, tenantA);
      const guard = async () =>
        settlementClearedGuard(guardContext(api, operator, tenantA, doc));
      expect(await guard()).toMatchObject({
        code: "SETTLEMENT_NOT_CLEARED",
      });

      // 銀行 [登記交易] 選進貨收入:只列有待退的單據;收到退款 2,000 → 已付淨額 = 19,000 − 2,000
      const candidates = await ok<{
        lotterySettlementCandidates: { items: { refId: string }[] };
      }>(api, hq, CANDIDATES, { input: { type: "purchase_income" } });
      expect(
        candidates.lotterySettlementCandidates.items.map((item) => item.refId),
      ).toContain(String(doc));
      const refund = await record({
        accountId: account.id,
        type: "purchase_income",
        amount: 2000,
        refType: TEST_PURCHASE,
        refId: String(doc),
      });
      expect(refund.settlementSide).toBe("hq");
      const cleared = await settlement(TEST_PURCHASE, doc);
      expect(cleared.sides[0]).toMatchObject({
        net: 17_000,
        totalOut: 19_000,
        totalIn: 2000,
      });
      const afterRefund = await ok<OutstandingData>(api, hq, OUTSTANDING);
      expect(
        afterRefund.lotteryOutstandingSettlements.items.filter(
          (item) => item.docNo === "P-0031",
        ),
      ).toEqual([]);
      // 已結清的單據不再是候選
      expect(
        await errorOf(api, hq, RECORD, {
          input: {
            accountId: account.id,
            type: "purchase_income",
            amount: 1,
            occurredAt: "2026-10-10T00:00:00.000Z",
            refType: TEST_PURCHASE,
            refId: String(doc),
          },
        }),
      ).toMatchObject({ reason: "SETTLEMENT_NOTHING_DUE" });

      // 淨額仍 ≠ 0(已付 17,000);沖正全部之後 = 0 → 放行
      expect(await guard()).not.toBeNull();
      for (const row of cleared.records.filter((item) => item.canReverse)) {
        await ok(api, hq, REVERSE_SETTLEMENT, {
          input: { method: row.method, id: row.id, reason: "單據作廢" },
        });
      }
      const zero = await settlement(TEST_PURCHASE, doc);
      expect(zero.sides[0]?.net).toBe(0);
      expect(await guard()).toBeNull();
    });

    it("收付的權限沿用單據那一邊:沒有 → FORBIDDEN;帳戶的使用組織不含這家分店 → BANK_ACCOUNT_NOT_USABLE", async () => {
      const onlyB = await create({
        accountNo: "0005-00002",
        shareOrgs: [{ orgId: String(storeB) }],
      });
      const doc = await insertTestSubmission(api.connection, {
        orgId: storeA,
        tenantId: tenantA,
        moduleKey: TEST_PURCHASE,
        values: { payable: 500, store: String(storeA), docNo: "P-0032" },
      });
      const input = {
        moduleKey: TEST_PURCHASE,
        refId: String(doc),
        side: "hq",
        button: "out",
        method: "bank",
        accountId: onlyB.id,
        amount: 500,
      };
      expect(
        await errorOf(api, hq, RECORD_SETTLEMENT, { input }),
      ).toMatchObject({ reason: "BANK_ACCOUNT_NOT_USABLE" });
      // 付款視窗的帳戶選項:只列使用中、使用組織包含這一邊分店(中山店)的
      const options = await ok<{
        lotterySettlementAccounts: { items: { id: string; name: string }[] };
      }>(api, hq, SETTLEMENT_ACCOUNTS, {
        moduleKey: TEST_PURCHASE,
        refId: String(doc),
        side: "hq",
      });
      const optionIds = options.lotterySettlementAccounts.items.map(
        (item) => item.id,
      );
      expect(optionIds).not.toContain(onlyB.id);
      expect(optionIds.length).toBeGreaterThan(0);
      expect(
        await errorOf(api, nobody, RECORD_SETTLEMENT, { input }),
      ).toMatchObject({ code: "FORBIDDEN" });
      expect(await errorOf(api, nobody, OUTSTANDING, {})).toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("帳戶交易清單 [沖正]:掛在單據上的交易還要那一邊的收付權限(同單據結算區);沒掛單據的照舊只看 reverse-bank-transaction", async () => {
      const { token: reverser } = await createAccountsOperator(
        api,
        api.connection,
        {
          orgId: tenantA,
          permissionKeys: [P.viewBankAccounts, P.reverseBankTransaction],
        },
      );
      const account = await create({
        accountNo: "0005-00009",
        openingBalance: 0,
        shareOrgs: [{ orgId: String(tenantA), includeDescendants: true }],
      });
      const doc = await insertTestSubmission(api.connection, {
        orgId: storeA,
        tenantId: tenantA,
        moduleKey: TEST_PURCHASE,
        values: { payable: 800, store: String(storeA), docNo: "P-0039" },
      });
      await ok(api, hq, RECORD_SETTLEMENT, {
        input: {
          moduleKey: TEST_PURCHASE,
          refId: String(doc),
          side: "hq",
          button: "out",
          method: "bank",
          accountId: account.id,
          amount: 800,
        },
      });
      const manual = await record({
        accountId: account.id,
        type: "withdrawal",
        amount: 100,
      });
      const rows = await ok<{
        lotteryBankTransactions: { items: TransactionRow[] };
      }>(api, reverser, TRANSACTIONS, {
        input: { accountId: account.id },
      }).then((data) => data.lotteryBankTransactions.items);
      const linked = rows.find((row) => row.settlementSide === "hq");
      expect(linked?.abilities.canReverse).toBe(false);
      expect(
        rows.find((row) => row.id === manual.id)?.abilities.canReverse,
      ).toBe(true);
      // 有沖正權限、沒有那一邊的收付權限 → FORBIDDEN;手動交易照舊可沖
      expect(
        await errorOf(api, reverser, REVERSE, {
          input: { id: linked?.id ?? "", reason: "記錯" },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
      await ok(api, reverser, REVERSE, {
        input: { id: manual.id, reason: "記錯" },
      });
      // 有那一邊權限的人(總部)照樣可沖,清單按鈕也開
      const hqRows = await ok<{
        lotteryBankTransactions: { items: TransactionRow[] };
      }>(api, hq, TRANSACTIONS, {
        input: { accountId: account.id },
      }).then((data) => data.lotteryBankTransactions.items);
      expect(
        hqRows.find((row) => row.id === linked?.id)?.abilities.canReverse,
      ).toBe(true);
      await ok(api, hq, REVERSE, {
        input: { id: linked?.id ?? "", reason: "記錯" },
      });
    });

    it("調貨型:收貨店從收銀點抽屜付現 → 收付紀錄帶抽屜來源、收銀點名稱與它的印表機(付款收據用)", async () => {
      const doc = await insertTestSubmission(api.connection, {
        orgId: storeA,
        tenantId: tenantA,
        moduleKey: TEST_TRANSFER,
        values: {
          payable: 8000,
          store: String(storeA),
          shipper: String(storeB),
          docNo: "T-0009",
        },
      });
      const now = new Date();
      const point = new Types.ObjectId();
      const printerId = new Types.ObjectId();
      await api.connection.collection("lottery_cash_points").insertOne({
        _id: point,
        orgId: storeA,
        tenantId: tenantA,
        positionKey: "counter-a",
        name: "店內櫃台抽屜",
        order: 1,
        enabled: true,
        printerId,
        note: null,
        moduleKey: "master-data.cash-points",
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
      await api.connection.collection(LOTTERY_SHIFTS_COLLECTION).insertOne({
        orgId: storeA,
        tenantId: tenantA,
        cashPointId: point,
        openedBy: new Types.ObjectId(),
        openedAt: now,
        openingFloat: 5000,
        openingFloatSource: "vault",
        previousShiftId: null,
        openingMovementId: null,
        scheduleEntryId: null,
        scheduleTaskSnapshot: null,
        positionMismatch: null,
        closedAt: null,
        checkoutId: null,
        drawerVersion: 0,
        moduleKey: "store",
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
      await ok(api, hq, RECORD_SETTLEMENT, {
        input: {
          moduleKey: TEST_TRANSFER,
          refId: String(doc),
          side: "receiver",
          button: "out",
          method: "cash",
          cashSource: "drawer",
          cashPointId: String(point),
          handler: "王小明(送貨人)",
          amount: 1000,
        },
      });
      const data = await ok<{
        lotterySettlement: {
          item: {
            records: {
              cashPlace: string | null;
              cashPointName: string | null;
              cashPointPrinterId: string | null;
            }[];
          };
        };
      }>(api, hq, CASH_POINT_RECORDS, {
        moduleKey: TEST_TRANSFER,
        refId: String(doc),
      });
      expect(data.lotterySettlement.item.records).toEqual([
        {
          cashPlace: "drawer",
          cashPointName: "店內櫃台抽屜",
          cashPointPrinterId: String(printerId),
        },
      ]);
    });

    it("調貨型:收貨店付現(小金庫)→「N 待出貨店入帳」→ 出貨店收款後結清", async () => {
      const account = await create({
        accountNo: "0005-00003",
        shareOrgs: [{ orgId: String(tenantA), includeDescendants: true }],
      });
      const doc = await insertTestSubmission(api.connection, {
        orgId: storeA,
        tenantId: tenantA,
        moduleKey: TEST_TRANSFER,
        values: {
          payable: 8000,
          store: String(storeA),
          shipper: String(storeB),
          docNo: "T-0008",
        },
      });
      // 現金要經手人;抽屜沒有開著的班
      expect(
        await errorOf(api, hq, RECORD_SETTLEMENT, {
          input: {
            moduleKey: TEST_TRANSFER,
            refId: String(doc),
            side: "receiver",
            button: "out",
            method: "cash",
            cashSource: "vault",
            amount: 10_000,
          },
        }),
      ).toMatchObject({ fields: ["handler"] });
      expect(
        await errorOf(api, hq, RECORD_SETTLEMENT, {
          input: {
            moduleKey: TEST_TRANSFER,
            refId: String(doc),
            side: "receiver",
            button: "out",
            method: "cash",
            cashSource: "drawer",
            cashPointId: String(new Types.ObjectId()),
            handler: "送貨人",
            amount: 10_000,
          },
        }),
      ).toMatchObject({ reason: "NO_OPEN_SHIFT" });
      // 別家店(出貨店)收銀點開著的班:不是這一邊(收貨店)的抽屜 → 擋下
      const otherPoint = new Types.ObjectId();
      const now = new Date();
      await api.connection.collection(LOTTERY_SHIFTS_COLLECTION).insertOne({
        orgId: storeB,
        tenantId: tenantA,
        cashPointId: otherPoint,
        openedBy: new Types.ObjectId(),
        openedAt: now,
        openingFloat: 5000,
        openingFloatSource: "vault",
        previousShiftId: null,
        openingMovementId: null,
        scheduleEntryId: null,
        scheduleTaskSnapshot: null,
        positionMismatch: null,
        closedAt: null,
        checkoutId: null,
        drawerVersion: 0,
        moduleKey: "store",
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });
      expect(
        await errorOf(api, hq, RECORD_SETTLEMENT, {
          input: {
            moduleKey: TEST_TRANSFER,
            refId: String(doc),
            side: "receiver",
            button: "out",
            method: "cash",
            cashSource: "drawer",
            cashPointId: String(otherPoint),
            handler: "送貨人",
            amount: 1000,
          },
        }),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["cashSource"],
        reason: "CASH_POINT_NOT_AT_BRANCH",
      });
      // 從小金庫付現不能超過小金庫應有(與出庫同一個判斷):超過擋下、一筆都不寫;剛好等於可以
      await fillVault(storeA, 10_000);
      expect(
        await errorOf(api, hq, RECORD_SETTLEMENT, {
          input: {
            moduleKey: TEST_TRANSFER,
            refId: String(doc),
            side: "receiver",
            button: "out",
            method: "cash",
            cashSource: "vault",
            handler: "送貨人",
            amount: 10_001,
          },
        }),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["amount"],
        reason: "AMOUNT_EXCEEDS_VAULT",
      });
      expect(
        await api.connection
          .collection("lottery_cash_movements")
          .countDocuments({ refId: doc }),
      ).toBe(0);
      await ok(api, hq, RECORD_SETTLEMENT, {
        input: {
          moduleKey: TEST_TRANSFER,
          refId: String(doc),
          side: "receiver",
          button: "out",
          method: "cash",
          cashSource: "vault",
          handler: "送貨人",
          amount: 10_000,
        },
      });
      const paid = await settlement(TEST_TRANSFER, doc);
      expect(paid.pendingPayee).toBe(10_000);
      expect(
        paid.sides.map((side) => [side.side, side.net, side.buttons]),
      ).toEqual([
        [
          "receiver",
          10_000,
          [
            { button: "out", defaultAmount: 0, canUse: false },
            { button: "in", defaultAmount: 2000, canUse: true },
          ],
        ],
        [
          "shipper",
          0,
          [
            { button: "out", defaultAmount: 0, canUse: false },
            { button: "in", defaultAmount: 10_000, canUse: true },
          ],
        ],
      ]);
      expect(paid.records[0]).toMatchObject({
        method: "cash",
        side: "receiver",
        direction: "out",
        handler: "送貨人",
      });
      // 現金流水寫在收貨店的小金庫
      const vault = await ok<{
        lotteryCashLedger: { items: { type: string; from: string }[] };
      }>(api, hq, CASH_LEDGER, {
        input: { orgId: String(storeA), type: "transfer_out" },
      });
      expect(vault.lotteryCashLedger.items[0]).toMatchObject({
        type: "transfer_out",
        from: "vault",
      });
      // 出貨店收 10,000 → 退 2,000;收貨店收到退款 2,000 → 三個數字相等、結清
      const step = (side: string, button: string, amount: number) =>
        ok(api, hq, RECORD_SETTLEMENT, {
          input: {
            moduleKey: TEST_TRANSFER,
            refId: String(doc),
            side,
            button,
            method: "bank",
            accountId: account.id,
            amount,
          },
        });
      await step("shipper", "in", 10_000);
      await step("shipper", "out", 2000);
      await step("receiver", "in", 2000);
      const done = await settlement(TEST_TRANSFER, doc);
      expect(done.sides.map((side) => side.net)).toEqual([8000, 8000]);
      expect(
        done.sides.flatMap((side) =>
          side.buttons.filter((button) => button.canUse),
        ),
      ).toEqual([]);
    });

    it("現金收付與稽核同一個交易:稽核寫入失敗 → 流水一起回復", async () => {
      const doc = await insertTestSubmission(api.connection, {
        orgId: storeA,
        tenantId: tenantA,
        moduleKey: TEST_TRANSFER,
        values: {
          payable: 500,
          store: String(storeA),
          shipper: String(storeB),
          docNo: "T-0009",
        },
      });
      // 小金庫夠付(否則在檢查應有那一步就被擋下,測不到稽核失敗)
      await fillVault(storeA, 500);
      const audit = api.app.get(AuditService);
      const spy = jest
        .spyOn(audit, "record")
        .mockRejectedValueOnce(new Error("audit down"));
      try {
        const result = await api.graphql(
          RECORD_SETTLEMENT,
          {
            input: {
              moduleKey: TEST_TRANSFER,
              refId: String(doc),
              side: "receiver",
              button: "out",
              method: "cash",
              cashSource: "vault",
              handler: "送貨人",
              amount: 500,
            },
          },
          { accessToken: hq },
        );
        expect(result.errors).toBeDefined();
      } finally {
        spy.mockRestore();
      }
      expect(
        await api.connection
          .collection("lottery_cash_movements")
          .countDocuments({ refId: doc }),
      ).toBe(0);
    });

    it("從小金庫付現:審核中日結要存入的錢先扣;同一家店同時兩筆只過一筆", async () => {
      const doc = await insertTestSubmission(api.connection, {
        orgId: storeA,
        tenantId: tenantA,
        moduleKey: TEST_TRANSFER,
        values: {
          payable: 8000,
          store: String(storeA),
          shipper: String(storeB),
          docNo: "T-0010",
        },
      });
      const payCash = (amount: number) =>
        api.graphql(
          RECORD_SETTLEMENT,
          {
            input: {
              moduleKey: TEST_TRANSFER,
              refId: String(doc),
              side: "receiver",
              button: "out",
              method: "cash",
              cashSource: "vault",
              handler: "送貨人",
              amount,
            },
          },
          { accessToken: hq },
        );
      // 小金庫 5,000,其中 2,000 是審核中的日結要存入銀行的 → 能付 3,000
      await fillVault(storeA, 5000);
      const now = new Date();
      const checkout = await api.connection
        .collection("lottery_checkouts")
        .insertOne({
          orgId: storeA,
          tenantId: tenantA,
          type: "daily",
          status: "pending",
          bankDepositAmount: 2000,
          moduleKey: "store",
          createdAt: now,
          updatedAt: now,
          createdBy: null,
          updatedBy: null,
          deletedAt: null,
        });
      try {
        const over = await payCash(3001);
        expect(over.errors?.[0]?.extensions).toMatchObject({
          code: "VALIDATION_FAILED",
          fields: ["amount"],
          reason: "AMOUNT_EXCEEDS_VAULT",
        });
        // 同時兩筆 2,000(合計超過 3,000):在同一個守門文件上序列化,只有一筆成功
        const results = await Promise.all([payCash(2000), payCash(2000)]);
        expect(
          results.filter((result) => result.errors === undefined),
        ).toHaveLength(1);
        expect(
          results.find((result) => result.errors !== undefined)?.errors?.[0]
            ?.extensions,
        ).toMatchObject({ reason: "AMOUNT_EXCEEDS_VAULT" });
        expect(
          await api.connection
            .collection("lottery_cash_movements")
            .countDocuments({ refId: doc }),
        ).toBe(1);
      } finally {
        await api.connection
          .collection("lottery_checkouts")
          .deleteOne({ _id: checkout.insertedId });
      }
    });

    it("沖正一筆錢進小金庫的收付 = 從小金庫拿錢:超過小金庫應有擋下,剛好等於可以", async () => {
      const account = await create({
        accountNo: "0005-00007",
        shareOrgs: [{ orgId: String(tenantA), includeDescendants: true }],
      });
      const doc = await insertTestSubmission(api.connection, {
        orgId: storeA,
        tenantId: tenantA,
        moduleKey: TEST_TRANSFER,
        values: {
          payable: 1000,
          store: String(storeA),
          shipper: String(storeB),
          docNo: "T-0011",
        },
      });
      const record = (input: Record<string, unknown>) =>
        ok(api, hq, RECORD_SETTLEMENT, {
          input: {
            moduleKey: TEST_TRANSFER,
            refId: String(doc),
            side: "receiver",
            ...input,
          },
        });
      // 收貨店多付 2,000(銀行)→ [收到退款] 2,000 收現金進小金庫
      await record({
        button: "out",
        method: "bank",
        accountId: account.id,
        amount: 3000,
      });
      await record({
        button: "in",
        method: "cash",
        cashSource: "vault",
        handler: "送貨人",
        amount: 2000,
      });
      const recorded = await settlement(TEST_TRANSFER, doc);
      const refund = recorded.records.find((row) => row.method === "cash");
      if (refund === undefined) throw new Error("缺收到退款的現金那一筆");
      const reverse = () =>
        api.graphql(
          REVERSE_SETTLEMENT,
          { input: { method: "cash", id: refund.id, reason: "記錯" } },
          { accessToken: hq },
        );
      // 錢已經被拿走一部分:小金庫只剩 1,999 → 沖正 2,000 擋下,一筆都不寫
      await fillVault(storeA, 1999);
      const blocked = await reverse();
      expect(blocked.errors?.[0]?.extensions).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "AMOUNT_EXCEEDS_VAULT",
      });
      expect(
        await api.connection
          .collection("lottery_cash_movements")
          .countDocuments({ refId: doc }),
      ).toBe(1);
      // 剛好 2,000 → 可以沖正,小金庫歸 0
      await fillVault(storeA, 2000);
      const reversed = await reverse();
      expect(reversed.errors).toBeUndefined();
      const operator = await operatorOf(api, tenantA);
      const vault = await api.app
        .get(CashLedgerService)
        .vaultExpected(operator, tenantA, storeA);
      expect(vault.amount).toBe(0);
    });

    it("收付沖正不能跨店:記帳分店不在可見範圍 → NOT_FOUND;同一筆同時沖正只有一個成功", async () => {
      const account = await create({
        accountNo: "0005-00004",
        shareOrgs: [{ orgId: String(tenantA), includeDescendants: true }],
      });
      const doc = await insertTestSubmission(api.connection, {
        orgId: storeA,
        tenantId: tenantA,
        moduleKey: TEST_TRANSFER,
        values: {
          payable: 1000,
          store: String(storeA),
          shipper: String(storeB),
          docNo: "T-0010",
        },
      });
      const pay = (side: string, button: string, amount: number) =>
        ok<{ recordLotterySettlement: { recordId: string } }>(
          api,
          hq,
          RECORD_SETTLEMENT,
          {
            input: {
              moduleKey: TEST_TRANSFER,
              refId: String(doc),
              side,
              button,
              method: "bank",
              accountId: account.id,
              amount,
            },
          },
        );
      await pay("receiver", "out", 1000);
      await pay("shipper", "in", 1000);
      const paid = await settlement(TEST_TRANSFER, doc);
      const shipperRecord = paid.records.find(
        (record) => record.side === "shipper",
      );
      // 中山店的人看得到單據、有收付權限,但出貨店(新竹店)記的帳不能沖
      expect(
        await errorOf(api, managerA, REVERSE_SETTLEMENT, {
          input: { method: "bank", id: shipperRecord?.id, reason: "跨店" },
        }),
      ).toMatchObject({ code: "NOT_FOUND" });
      // 同時沖正同一筆:只有一個成功,另一個 ALREADY_REVERSED
      const reverse = () =>
        api.graphql(
          REVERSE_SETTLEMENT,
          { input: { method: "bank", id: shipperRecord?.id, reason: "同時" } },
          { accessToken: hq },
        );
      const results = await Promise.all([reverse(), reverse()]);
      expect(results.filter((result) => !result.errors)).toHaveLength(1);
      expect(
        results.find((result) => result.errors)?.errors?.[0]?.extensions,
      ).toMatchObject({ reason: "ALREADY_REVERSED" });
      expect(
        await api.connection
          .collection("lottery_bank_transactions")
          .countDocuments({
            reversalOf: new Types.ObjectId(shipperRecord?.id),
          }),
      ).toBe(1);
    });

    it("付款視窗的帳戶選項要那一邊的收付權限;兌獎入帳掛在單據上但不算進淨額", async () => {
      const account = await create({
        accountNo: "0005-00005",
        shareOrgs: [{ orgId: String(tenantA), includeDescendants: true }],
      });
      const doc = await insertTestSubmission(api.connection, {
        orgId: storeA,
        tenantId: tenantA,
        moduleKey: TEST_PURCHASE,
        values: { payable: 3000, store: String(storeA), docNo: "P-0040" },
      });
      expect(
        await errorOf(api, nobody, SETTLEMENT_ACCOUNTS, {
          moduleKey: TEST_PURCHASE,
          refId: String(doc),
          side: "hq",
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
      const prize = await record({
        accountId: account.id,
        type: "redemption_income",
        amount: 40_000,
        refType: TEST_PURCHASE,
        refId: String(doc),
      });
      expect(prize).toMatchObject({ settlementSide: null });
      const after = await settlement(TEST_PURCHASE, doc);
      expect(after.sides[0]).toMatchObject({ net: 0, totalIn: 0 });
      expect(after.records).toEqual([]);
      expect(after.sides[0]?.buttons[0]).toMatchObject({
        button: "out",
        defaultAmount: 3000,
      });
    });

    it("交易內的自動記帳:不看按鈕權限;金額 0 不記;不在交易內拋錯", async () => {
      const account = await create({
        accountNo: "0005-00006",
        shareOrgs: [{ orgId: String(tenantA), includeDescendants: true }],
      });
      const doc = await insertTestSubmission(api.connection, {
        orgId: storeA,
        tenantId: tenantA,
        moduleKey: TEST_PURCHASE,
        values: { payable: 17_000, store: String(storeA), docNo: "P-0041" },
      });
      const submission = await api.connection
        .collection("form_submissions")
        .findOne({ _id: doc });
      const service = api.app.get(SettlementService);
      const operator = await operatorOf(api, tenantA);
      const input = {
        operator,
        moduleKey: TEST_PURCHASE,
        submission: submission as unknown as SettlementSubmission,
        side: "hq",
        button: "out" as const,
        accountId: new Types.ObjectId(account.id),
      };
      await expect(
        service.recordAutomatic(undefined, { ...input, amount: 17_000 }),
      ).rejects.toBeInstanceOf(CashLedgerOutsideTransactionError);
      const transactions = api.app.get(TransactionService);
      // 負數不記;0 元照記(應付 0 也留一筆,淨額不變)
      expect(
        await transactions.withTransaction((session) =>
          service.recordAutomatic(session, { ...input, amount: -1 }),
        ),
      ).toBeNull();
      expect(
        await transactions.withTransaction((session) =>
          service.recordAutomatic(session, { ...input, amount: 0 }),
        ),
      ).not.toBeNull();
      const zero = await settlement(TEST_PURCHASE, doc);
      expect(zero.sides[0]).toMatchObject({ net: 0 });
      expect(zero.records).toEqual([
        expect.objectContaining({ direction: "out", amount: 0 }),
      ]);
      await transactions.withTransaction((session) =>
        service.recordAutomatic(session, { ...input, amount: 17_000 }),
      );
      const after = await settlement(TEST_PURCHASE, doc);
      expect(after.sides[0]).toMatchObject({ net: 17_000 });
      expect(after.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            side: "hq",
            direction: "out",
            amount: 17_000,
          }),
        ]),
      );
    });
  });
});

/** 某個租戶的系統身分(直接呼叫服務用;可見範圍 = 那個租戶),帶一個登記人。 */
async function operatorOf(
  api: AuthTestApp,
  tenantId: Types.ObjectId,
): Promise<OperatorContext> {
  const reader = await tenantBoundaryContext(
    api.app.get(OrgsRepository),
    null,
    tenantId,
  );
  return { ...reader, actorId: new Types.ObjectId() };
}

/** 守門的呼叫上下文(只用到 operator、submission、get)。 */
function guardContext(
  api: AuthTestApp,
  operator: OperatorContext,
  tenantId: Types.ObjectId,
  submissionId: Types.ObjectId,
): FormGuardContext {
  return {
    guard: "beforeVoid",
    operator,
    submission: {
      _id: submissionId,
      tenantId,
      orgId: tenantId,
      moduleKey: TEST_PURCHASE,
      formKey: "test_doc",
      status: "reviewing",
      revision: 1,
      values: {},
    },
    values: {},
    stepKey: null,
    session: null as never,
    get: (token) => api.app.get(token),
  };
}
