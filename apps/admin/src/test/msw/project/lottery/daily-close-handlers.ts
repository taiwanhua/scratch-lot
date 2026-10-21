import { type GraphQLResponseBody, HttpResponse } from "msw";

import type {
  DepositLotteryVaultToBankMutationVariables,
  LotteryBankDepositFormQueryVariables,
  LotteryDailyCloseWizardQueryVariables,
} from "@repo/graphql";

import { api, type server } from "../../server";
import {
  type BankDepositFormFixture,
  type DailyCloseStatusFixture,
  type DailyCloseWizardFixture,
  type DailyCloseWizardOptions,
  sampleBankDepositForm,
  sampleDailyCloseStatus,
  sampleDailyCloseWizard,
} from "./daily-close-fixtures";

export interface DailyCloseWorldOptions extends DailyCloseWizardOptions {
  /** 精靈資料的覆寫(例:還有班沒交班、已有審核中的日結) */
  wizard?: Partial<DailyCloseWizardFixture>;
  /** 看板頂部的覆寫 */
  status?: Partial<DailyCloseStatusFixture>;
  /** 存銀行視窗的覆寫(例:沒有可用帳戶 → ST-26b) */
  bankForm?: Partial<BankDepositFormFixture>;
}

export interface DailyCloseWorld {
  handlers: Parameters<typeof server.use>;
  inputs: {
    deposits: DepositLotteryVaultToBankMutationVariables["input"][];
  };
}

/** 業務錯誤(GQL-04)。 */
const apiError = (code: string, extensions: Record<string, unknown>) =>
  HttpResponse.json<GraphQLResponseBody<Record<string, never>>>({
    data: null,
    errors: [{ message: code, extensions: { ...extensions, code } }],
  });

/**
 * 日結與存銀行的假 api(夾具在 `daily-close-fixtures.ts`;規則照 `docs/modules/project/store.md`「日結與存銀行」):
 * 看板頂部的上次日結、日結精靈資料、存銀行視窗與存入(超過小金庫應有 → `AMOUNT_EXCEEDS_VAULT`;沒有可用帳戶 →
 * `BANK_DEPOSIT_NO_ACCOUNT`)。送出日結走表單執行端的假 api。元件測試與 mock 模式共用。
 */
export const dailyCloseWorld = (
  options: DailyCloseWorldOptions = {},
): DailyCloseWorld => {
  const inputs: DailyCloseWorld["inputs"] = { deposits: [] };
  let vaultExpected =
    options.bankForm?.vaultExpected ?? sampleBankDepositForm("").vaultExpected;
  const handlers = [
    api.query("LotteryDailyCloseStatus", () =>
      HttpResponse.json({
        data: {
          lotteryDailyCloseStatus: {
            ...sampleDailyCloseStatus(),
            ...options.status,
          },
        },
      }),
    ),
    api.query("LotteryDailyCloseWizard", ({ variables }) => {
      const { orgId } = variables as LotteryDailyCloseWizardQueryVariables;
      return HttpResponse.json({
        data: {
          lotteryDailyCloseWizard: {
            ...sampleDailyCloseWizard(orgId, options),
            ...options.wizard,
          },
        },
      });
    }),
    api.query("LotteryBankDepositForm", ({ variables }) => {
      const { orgId } = variables as LotteryBankDepositFormQueryVariables;
      return HttpResponse.json({
        data: {
          lotteryBankDepositForm: {
            ...sampleBankDepositForm(orgId),
            ...options.bankForm,
            vaultExpected,
          },
        },
      });
    }),
    api.mutation("DepositLotteryVaultToBank", ({ variables }) => {
      const { input } = variables as DepositLotteryVaultToBankMutationVariables;
      inputs.deposits.push(input);
      const accounts =
        options.bankForm?.accounts ?? sampleBankDepositForm("").accounts;
      if (accounts.length === 0) {
        return apiError("VALIDATION_FAILED", {
          reason: "BANK_DEPOSIT_NO_ACCOUNT",
          fields: ["accountId"],
        });
      }
      if (input.amount > vaultExpected) {
        return apiError("VALIDATION_FAILED", {
          reason: "AMOUNT_EXCEEDS_VAULT",
          fields: ["amount"],
        });
      }
      vaultExpected -= input.amount;
      return HttpResponse.json({
        data: {
          depositLotteryVaultToBank: {
            __typename: "LotteryBankDepositPayload",
            vaultExpected,
            movementId: "mv-bank-1",
            transactionId: "bt-1",
          },
        },
      });
    }),
  ];
  return { handlers, inputs };
};
