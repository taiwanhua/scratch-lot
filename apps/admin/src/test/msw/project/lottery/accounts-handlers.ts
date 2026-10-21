import { HttpResponse } from "msw";

import {
  ACCOUNTS_PERMISSIONS as PERMISSIONS,
  bankAccountLabel,
  fixedDirectionOf,
} from "@repo/domain/project/lottery-accounts";
import type { BankTransactionType } from "@repo/domain/project/lottery-accounts";
import {
  type CreateLotteryBankAccountMutationVariables,
  type LotteryBankAccountFieldsFragment,
  type LotteryBankAccountQueryVariables,
  type LotteryBankTransactionFieldsFragment,
  type LotteryBankTransactionsQueryVariables,
  type LotteryCashLedgerQueryVariables,
  type LotteryCashMovementFieldsFragment,
  type LotteryCashMovementQueryVariables,
  type LotteryOutstandingSettlementFieldsFragment,
  type LotterySettlementQueryVariables,
  type RecordLotteryBankTransactionMutationVariables,
  type RecordLotterySettlementMutationVariables,
  type ReverseLotteryBankTransactionMutationVariables,
  type UpdateLotteryBankAccountMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api, type server } from "../../server";
import {
  ALL_ACCOUNTS_PERMISSIONS,
  bankAccount,
  bankTransaction,
  sampleBankAccounts,
  sampleMovements,
  sampleOutstanding,
  sampleTransactions,
  settlementOf,
} from "./accounts-fixtures";
import { masterDataOrgs } from "./master-data-fixtures";

/**
 * 帳戶管理的假 api(夾具在 `accounts-fixtures.ts`;規則照 `docs/modules/project/accounts.md`):
 * 有狀態 —— 新增帳戶 / 登記交易 / 沖正後重查看得到;有交易的帳戶改期初或刪除 → `BANK_ACCOUNT_HAS_TRANSACTIONS`;
 * 同一筆沖兩次 → `ALREADY_REVERSED`。`abilities` 由這裡依「給的權限」算好(api 的職責),元件只讀。
 * 元件測試與 mock 模式共用(`mock/project/mock-world.ts`)。
 */

export interface AccountsWorldOptions {
  accounts?: LotteryBankAccountFieldsFragment[];
  transactions?: LotteryBankTransactionFieldsFragment[];
  movements?: LotteryCashMovementFieldsFragment[];
  outstanding?: LotteryOutstandingSettlementFieldsFragment[];
  permissions?: readonly string[];
}

export interface AccountsWorld {
  handlers: Parameters<typeof server.use>;
  inputs: {
    createAccount: CreateLotteryBankAccountMutationVariables["input"][];
    updateAccount: UpdateLotteryBankAccountMutationVariables["input"][];
    record: RecordLotteryBankTransactionMutationVariables["input"][];
    reverse: ReverseLotteryBankTransactionMutationVariables["input"][];
    settle: RecordLotterySettlementMutationVariables["input"][];
  };
}

const validation = (reason: string, fields: string[]) =>
  graphqlError("VALIDATION_FAILED", reason, { reason, fields });

const notFound = () =>
  graphqlError("VALIDATION_FAILED", "NOT_FOUND", { code: "NOT_FOUND" });

export const accountsWorld = ({
  accounts = sampleBankAccounts(),
  transactions = sampleTransactions(),
  movements = sampleMovements(),
  outstanding = sampleOutstanding(),
  permissions = ALL_ACCOUNTS_PERMISSIONS,
}: AccountsWorldOptions = {}): AccountsWorld => {
  const has = (key: string) => permissions.includes(key);
  const withAbilities = (
    row: LotteryBankAccountFieldsFragment,
  ): LotteryBankAccountFieldsFragment => ({
    ...row,
    abilities: {
      __typename: "LotteryBankAccountAbilities",
      canEdit: has(PERMISSIONS.editBankAccount),
      canDelete: has(PERMISSIONS.editBankAccount) && !row.hasTransactions,
      canRecordTransaction:
        has(PERMISSIONS.recordBankTransaction) && row.status === "active",
      canReverse: has(PERMISSIONS.reverseBankTransaction),
    },
  });
  const withTxAbilities = (
    row: LotteryBankTransactionFieldsFragment,
  ): LotteryBankTransactionFieldsFragment => ({
    ...row,
    abilities: {
      __typename: "LotteryBankTransactionAbilities",
      canReverse:
        has(PERMISSIONS.reverseBankTransaction) &&
        !row.reversedById &&
        !row.reversalOf,
    },
  });
  let accountState = accounts.map((row) => withAbilities(row));
  let txState = transactions;
  const inputs: AccountsWorld["inputs"] = {
    createAccount: [],
    updateAccount: [],
    record: [],
    reverse: [],
    settle: [],
  };
  const forbidden = (permission: string) =>
    has(permission)
      ? null
      : graphqlError("FORBIDDEN", "FORBIDDEN", { code: "FORBIDDEN" });

  const handlers: AccountsWorld["handlers"] = [
    api.query("LotteryBankAccounts", () => {
      const denied = forbidden(PERMISSIONS.viewBankAccounts);
      if (denied) return denied;
      return HttpResponse.json({
        data: {
          lotteryBankAccounts: {
            items: accountState,
            totalCount: accountState.length,
            page: 1,
            pageSize: 50,
          },
        },
      });
    }),
    api.query("LotteryBankAccount", ({ variables }) => {
      const { id } = variables as LotteryBankAccountQueryVariables;
      const item = accountState.find((row) => row.id === id);
      return item === undefined
        ? notFound()
        : HttpResponse.json({ data: { lotteryBankAccount: { item } } });
    }),
    api.query("LotteryBankTransactions", ({ variables }) => {
      const { input } = variables as LotteryBankTransactionsQueryVariables;
      const items = txState
        .filter(
          (row) =>
            row.accountId === input.accountId &&
            (!input.type || row.type === input.type),
        )
        .map((row) => withTxAbilities(row));
      const sum = (direction: string) =>
        items
          .filter((row) => row.direction === direction)
          .reduce((total, row) => total + row.amount, 0);
      return HttpResponse.json({
        data: {
          lotteryBankTransactions: {
            items,
            totalCount: items.length,
            totalIn: sum("in"),
            totalOut: sum("out"),
          },
        },
      });
    }),
    api.mutation("CreateLotteryBankAccount", ({ variables }) => {
      const { input } = variables as CreateLotteryBankAccountMutationVariables;
      inputs.createAccount.push(input);
      if (
        accountState.some(
          (row) =>
            row.bankCode === input.bankCode &&
            row.accountNo === input.accountNo,
        )
      ) {
        return validation("BANK_ACCOUNT_DUPLICATE", ["accountNo"]);
      }
      const item = withAbilities(
        bankAccount({
          id: `ba-new-${String(accountState.length)}`,
          accountName: input.accountName,
          accountNo: input.accountNo,
          bankCode: input.bankCode,
          branchName: input.branchName ?? null,
          openingBalance: input.openingBalance,
          openingDate: input.openingDate,
          balance: input.openingBalance,
          label: bankAccountLabel(input),
        }),
      );
      accountState = [...accountState, item];
      return HttpResponse.json({
        data: { createLotteryBankAccount: { item } },
      });
    }),
    api.mutation("UpdateLotteryBankAccount", ({ variables }) => {
      const { input } = variables as UpdateLotteryBankAccountMutationVariables;
      inputs.updateAccount.push(input);
      const current = accountState.find((row) => row.id === input.id);
      if (current === undefined) return notFound();
      if (
        current.hasTransactions &&
        (input.openingBalance != null || input.openingDate != null)
      ) {
        return validation("BANK_ACCOUNT_HAS_TRANSACTIONS", ["openingBalance"]);
      }
      const item = withAbilities({
        ...current,
        ...(input.accountName ? { accountName: input.accountName } : {}),
        ...(input.status ? { status: input.status } : {}),
      });
      accountState = accountState.map((row) =>
        row.id === item.id ? item : row,
      );
      return HttpResponse.json({
        data: { updateLotteryBankAccount: { item } },
      });
    }),
    api.mutation("DeleteLotteryBankAccount", ({ variables }) => {
      const { id } = variables as { id: string };
      const current = accountState.find((row) => row.id === id);
      if (current === undefined) return notFound();
      if (current.hasTransactions) {
        return validation("BANK_ACCOUNT_HAS_TRANSACTIONS", ["id"]);
      }
      accountState = accountState.filter((row) => row.id !== id);
      return HttpResponse.json({ data: { deleteLotteryBankAccount: { id } } });
    }),
    api.mutation("RecordLotteryBankTransaction", ({ variables }) => {
      const { input } =
        variables as RecordLotteryBankTransactionMutationVariables;
      inputs.record.push(input);
      const direction =
        fixedDirectionOf(input.type as BankTransactionType) ??
        input.direction ??
        "in";
      const item = withTxAbilities(
        bankTransaction({
          id: `bt-new-${String(txState.length)}`,
          accountId: input.accountId,
          type: input.type,
          direction,
          amount: input.amount,
          balanceAfter: 0,
          occurredAt: input.occurredAt,
          summary: input.summary ?? null,
        }),
      );
      txState = [item, ...txState];
      return HttpResponse.json({
        data: { recordLotteryBankTransaction: { item } },
      });
    }),
    api.mutation("ReverseLotteryBankTransaction", ({ variables }) => {
      const { input } =
        variables as ReverseLotteryBankTransactionMutationVariables;
      inputs.reverse.push(input);
      const original = txState.find((row) => row.id === input.id);
      if (original === undefined) return notFound();
      if (original.reversedById || original.reversalOf) {
        return validation("ALREADY_REVERSED", ["id"]);
      }
      const item = bankTransaction({
        id: `${original.id}r`,
        accountId: original.accountId,
        type: original.type,
        direction: original.direction === "in" ? "out" : "in",
        amount: original.amount,
        balanceAfter: 0,
        reversalOf: original.id,
        note: input.reason,
      });
      txState = [
        item,
        ...txState.map((row) =>
          row.id === original.id ? { ...row, reversedById: item.id } : row,
        ),
      ];
      return HttpResponse.json({
        data: { reverseLotteryBankTransaction: { item } },
      });
    }),
    api.query("LotteryCashLedger", ({ variables }) => {
      const denied = forbidden(PERMISSIONS.viewCash);
      if (denied) return denied;
      const { input } = variables as LotteryCashLedgerQueryVariables;
      const items = movements.filter(
        (row) =>
          row.org.id === input.orgId &&
          (!input.type || row.type === input.type) &&
          (!input.cashPointId || row.cashPoint?.id === input.cashPointId),
      );
      return HttpResponse.json({
        data: {
          lotteryCashLedger: {
            vault: {
              amount: input.orgId === masterDataOrgs.storeA.id ? 48_200 : 0,
              baselineAmount: 0,
              baselineAt: null,
            },
            items,
            totalCount: items.length,
          },
        },
      });
    }),
    api.query("LotteryCashMovement", ({ variables }) => {
      const { id } = variables as LotteryCashMovementQueryVariables;
      const item = movements.find((row) => row.id === id);
      return item === undefined
        ? notFound()
        : HttpResponse.json({ data: { lotteryCashMovement: { item } } });
    }),
    api.query("LotteryOutstandingSettlements", () => {
      const denied = forbidden(PERMISSIONS.viewOutstanding);
      if (denied) return denied;
      return HttpResponse.json({
        data: {
          lotteryOutstandingSettlements: {
            items: outstanding,
            totalCount: outstanding.length,
          },
        },
      });
    }),
    api.query("LotterySettlementCandidates", () => {
      const items = outstanding.filter((row) => row.button === "in");
      return HttpResponse.json({
        data: {
          lotterySettlementCandidates: { items, totalCount: items.length },
        },
      });
    }),
    api.query("LotterySettlement", ({ variables }) => {
      const { refId } = variables as LotterySettlementQueryVariables;
      const row = outstanding.find((item) => item.refId === refId);
      return row === undefined
        ? notFound()
        : HttpResponse.json({
            data: { lotterySettlement: { item: settlementOf(row) } },
          });
    }),
    api.query("LotterySettlementAccounts", () => {
      const items = accountState
        .filter((row) => row.status === "active")
        .map((row) => ({
          __typename: "LotteryAccountsRef" as const,
          id: row.id,
          name: row.label,
        }));
      return HttpResponse.json({
        data: {
          lotterySettlementAccounts: { items, totalCount: items.length },
        },
      });
    }),
    api.mutation("RecordLotterySettlement", ({ variables }) => {
      const { input } = variables as RecordLotterySettlementMutationVariables;
      inputs.settle.push(input);
      const row = outstanding.find((item) => item.refId === input.refId);
      if (row === undefined) return notFound();
      return HttpResponse.json({
        data: {
          recordLotterySettlement: {
            recordId: `rec-${String(inputs.settle.length)}`,
            item: settlementOf(row),
          },
        },
      });
    }),
  ];

  return { handlers, inputs };
};
