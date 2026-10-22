import { type OnboardingStep, requireBranchId } from "../onboarding/context";
import { tenantDayInstants } from "../onboarding/tenant-dates";

/** 一個示範銀行帳戶(帳戶管理,規格 10.1;`createLotteryBankAccount` 的 input)。 */
export interface DemoBankAccount {
  bankCode: string;
  branchName: string;
  /** 重跑時以「銀行代碼 + 帳號」找回(已存在就不動) */
  accountNo: string;
  accountName: string;
  openingBalance: number;
  /** 期初日期(`YYYY-MM-DD`) */
  openingOn: string;
  /** 使用組織:分店名稱(不含下層) */
  usedBy: readonly string[];
}

/**
 * 示範帳戶(帳號是虛構的示範值):A 兩家店共用、B 只給信義店(驗收「帳戶選單依使用組織篩選」)。
 */
export const DEMO_BANK_ACCOUNTS: readonly DemoBankAccount[] = [
  {
    bankCode: "812",
    branchName: "台北分行",
    accountNo: "000123456789",
    accountName: "示範彩券行",
    openingBalance: 500_000,
    openingOn: "2026-10-01",
    usedBy: ["中山店", "信義店"],
  },
  {
    bankCode: "700",
    branchName: "信義郵局",
    accountNo: "00011112222333",
    accountName: "信義店零用",
    openingBalance: 120_000,
    openingOn: "2026-10-01",
    usedBy: ["信義店"],
  },
];

const BANK_ACCOUNTS = /* GraphQL */ `
  query DemoBankAccounts($input: LotteryBankAccountsInput!) {
    lotteryBankAccounts(input: $input) {
      items {
        id
        bankCode
        accountNo
      }
    }
  }
`;

const CREATE_BANK_ACCOUNT = /* GraphQL */ `
  mutation DemoCreateBankAccount($input: CreateLotteryBankAccountInput!) {
    createLotteryBankAccount(input: $input) {
      item {
        id
        label
      }
    }
  }
`;

/**
 * **示範資料專用**的一步:銀行帳戶與使用組織。開通清單第 6 點的後半(銀行帳戶)是人工步驟(開通腳本不建),
 * 所以不放進 `onboarding/steps.ts`,只由示範指令接在開通步驟後面跑。以「銀行代碼 + 帳號」找回,
 * 已存在就不改(期初餘額、使用組織都不動);只用帳戶管理既有的 GraphQL。
 */
export const demoBankAccountsStep: OnboardingStep = {
  key: "demo-bank-accounts",
  title: "示範銀行帳戶",
  run: async ({ client, state }) => {
    const { lotteryBankAccounts } = await client.request<{
      lotteryBankAccounts: {
        items: { id: string; bankCode: string; accountNo: string }[];
      };
    }>(BANK_ACCOUNTS, { input: { pageSize: 100 } });
    const instantOf = await tenantDayInstants(client);
    const lines: string[] = [];
    for (const account of DEMO_BANK_ACCOUNTS) {
      const name = `${account.accountName}(${account.bankCode} ${account.accountNo})`;
      if (
        lotteryBankAccounts.items.some(
          (item) =>
            item.bankCode === account.bankCode &&
            item.accountNo === account.accountNo,
        )
      ) {
        lines.push(`帳戶「${name}」已存在`);
        continue;
      }
      await client.request(CREATE_BANK_ACCOUNT, {
        input: {
          bankCode: account.bankCode,
          branchName: account.branchName,
          accountNo: account.accountNo,
          accountName: account.accountName,
          openingBalance: account.openingBalance,
          openingDate: instantOf(account.openingOn),
          shareOrgs: account.usedBy.map((branch) => ({
            orgId: requireBranchId(state, branch),
            includeDescendants: false,
          })),
        },
      });
      lines.push(
        `建立帳戶「${name}」:期初 ${account.openingBalance.toLocaleString("en-US")}、使用組織 ${account.usedBy.join("、")}`,
      );
    }
    return lines;
  },
};
