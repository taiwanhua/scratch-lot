import {
  ACCOUNTS_MODULE_KEYS as KEYS,
  ACCOUNTS_PERMISSIONS as PERMISSIONS,
} from "@repo/domain/project/lottery-accounts";
import {
  type LotteryBankAccountFieldsFragment,
  type LotteryBankTransactionFieldsFragment,
  type LotteryCashMovementFieldsFragment,
  type LotteryOutstandingSettlementFieldsFragment,
  type LotterySettlementFieldsFragment,
  ModuleEngine,
  ModuleSidebarType,
} from "@repo/graphql";

import type { TestModule } from "../../auth-handlers";
import { masterDataOrgs } from "./master-data-fixtures";

/** 帳戶管理的夾具(元件測試、假 api 與 mock 模式共用;資料照 Figma AC-01 / 02 / 04 / 05)。 */

export const ALL_ACCOUNTS_PERMISSIONS = Object.values(PERMISSIONS);

const orgs = masterDataOrgs;
const ref = (org: { id: string; name: string }) => ({
  __typename: "LotteryAccountsRef" as const,
  ...org,
});

export const bankAccount = (
  overrides: Partial<LotteryBankAccountFieldsFragment> &
    Pick<LotteryBankAccountFieldsFragment, "id" | "accountName" | "accountNo">,
): LotteryBankAccountFieldsFragment => ({
  __typename: "LotteryBankAccount",
  bankCode: "004",
  branchName: null,
  label: `${overrides.accountName} 末 ${overrides.accountNo.replaceAll(/\D/g, "").slice(-5)}`,
  openingBalance: 0,
  openingDate: "2026-09-30T16:00:00.000Z",
  status: "active",
  note: null,
  balance: 0,
  hasTransactions: false,
  shareOrgs: [],
  usageOrgs: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  abilities: {
    __typename: "LotteryBankAccountAbilities",
    canEdit: true,
    canDelete: true,
    canRecordTransaction: true,
    canReverse: true,
  },
  ...overrides,
});

const share = (orgId: string, includeDescendants = false) => ({
  __typename: "ShareOrg" as const,
  orgId,
  includeDescendants,
});

/** Figma AC-01 的三筆:中山分行(最上層組織、中山店)、新竹(餘額負數)、舊帳戶(停用)。 */
export const sampleBankAccounts = (): LotteryBankAccountFieldsFragment[] => [
  bankAccount({
    id: "ba-1",
    accountName: "好運彩券行",
    accountNo: "0123-456-34521",
    branchName: "中山分行",
    openingBalance: 500_000,
    balance: 1_284_300,
    hasTransactions: true,
    shareOrgs: [share(orgs.tenant.id), share(orgs.storeA.id)],
    usageOrgs: [ref(orgs.tenant), ref(orgs.storeA)],
  }),
  bankAccount({
    id: "ba-2",
    accountName: "好運彩券行新竹",
    accountNo: "0456-789-88012",
    bankCode: "005",
    branchName: "新竹分行",
    balance: -2000,
    hasTransactions: true,
    shareOrgs: [share(orgs.storeB.id)],
    usageOrgs: [ref(orgs.storeB)],
  }),
  bankAccount({
    id: "ba-3",
    accountName: "舊帳戶",
    accountNo: "0700-000-00921",
    bankCode: "700",
    status: "inactive",
  }),
];

export const bankTransaction = (
  overrides: Partial<LotteryBankTransactionFieldsFragment> &
    Pick<
      LotteryBankTransactionFieldsFragment,
      "id" | "type" | "direction" | "amount" | "balanceAfter"
    >,
): LotteryBankTransactionFieldsFragment => ({
  __typename: "LotteryBankTransaction",
  accountId: "ba-1",
  occurredAt: "2026-10-16T14:30:00.000Z",
  branch: ref(orgs.storeA),
  refType: null,
  refId: null,
  settlementSide: null,
  summary: null,
  handler: null,
  note: null,
  reversalOf: null,
  reversedById: null,
  createdBy: ref({ id: "u-1", name: "何家華" }),
  createdAt: "2026-10-16T14:30:00.000Z",
  abilities: {
    __typename: "LotteryBankTransactionAbilities",
    canReverse: true,
  },
  ...overrides,
});

/** Figma AC-02 的四筆(新的在前)。 */
export const sampleTransactions =
  (): LotteryBankTransactionFieldsFragment[] => [
    bankTransaction({
      id: "bt-4",
      type: "deposit",
      direction: "in",
      amount: 48_200,
      balanceAfter: 1_284_300,
      summary: "日結存入 · C-0040",
    }),
    bankTransaction({
      id: "bt-3",
      type: "redemption_income",
      direction: "in",
      amount: 40_000,
      balanceAfter: 1_236_100,
      occurredAt: "2026-10-12T06:00:00.000Z",
      summary: "進貨單 P-0031 兌獎剩餘",
    }),
    bankTransaction({
      id: "bt-2",
      type: "purchase_expense",
      direction: "out",
      amount: 18_400,
      balanceAfter: 1_196_100,
      occurredAt: "2026-10-12T06:00:00.000Z",
      summary: "進貨單 P-0031 · 批購 10/12",
    }),
    bankTransaction({
      id: "bt-1",
      type: "license_rent",
      direction: "out",
      amount: 3000,
      balanceAfter: 1_214_500,
      occurredAt: "2026-10-05T02:00:00.000Z",
      branch: null,
      summary: "乙類 好運 2 號店 10 月牌租",
      reversedById: "bt-1r",
      abilities: {
        __typename: "LotteryBankTransactionAbilities",
        canReverse: false,
      },
    }),
  ];

const movement = (
  overrides: Partial<LotteryCashMovementFieldsFragment> &
    Pick<
      LotteryCashMovementFieldsFragment,
      "id" | "type" | "from" | "to" | "amount" | "occurredAt"
    >,
): LotteryCashMovementFieldsFragment => ({
  __typename: "LotteryCashMovement",
  org: ref(orgs.storeA),
  reason: null,
  cashPoint: null,
  payee: null,
  note: null,
  refType: null,
  refId: null,
  reversalOf: null,
  reversedById: null,
  createdBy: ref({ id: "u-2", name: "李小華" }),
  ...overrides,
});

/** Figma AC-04 的四筆(中山店 10/16)。 */
export const sampleMovements = (): LotteryCashMovementFieldsFragment[] => [
  movement({
    id: "cm-4",
    type: "deposit",
    from: "drawer",
    to: "vault",
    amount: 3000,
    occurredAt: "2026-10-16T13:30:00.000Z",
    cashPoint: ref({ id: "cp-1", name: "店內櫃台" }),
    note: "D-0018",
  }),
  movement({
    id: "cm-3",
    type: "transfer_out",
    from: "drawer",
    to: "external",
    amount: 1840,
    occurredAt: "2026-10-16T11:05:00.000Z",
    cashPoint: ref({ id: "cp-1", name: "店內櫃台" }),
    payee: "王小明",
    note: "T-0008",
  }),
  movement({
    id: "cm-2",
    type: "withdraw",
    from: "vault",
    to: "drawer",
    amount: 2000,
    reason: "opening_float",
    occurredAt: "2026-10-16T05:00:00.000Z",
    cashPoint: ref({ id: "cp-2", name: "店外攤位" }),
    note: "W-0013",
  }),
  movement({
    id: "cm-1",
    type: "bank_deposit",
    from: "vault",
    to: "bank",
    amount: 20_000,
    occurredAt: "2026-10-16T02:20:00.000Z",
    note: "存款 K-0004",
  }),
];

const outstandingRow = (
  overrides: Partial<LotteryOutstandingSettlementFieldsFragment> &
    Pick<
      LotteryOutstandingSettlementFieldsFragment,
      "refId" | "docNo" | "kind" | "amount" | "button"
    >,
): LotteryOutstandingSettlementFieldsFragment => ({
  __typename: "LotteryOutstandingSettlement",
  moduleKey: "purchasing.purchase",
  label: "進貨",
  side: "hq",
  sideLabel: "總部",
  branch: ref(orgs.storeA),
  counterparty: "",
  payable: 0,
  net: 0,
  daysOutstanding: 0,
  canSettle: true,
  ...overrides,
});

/** Figma AC-05 的三列。 */
export const sampleOutstanding =
  (): LotteryOutstandingSettlementFieldsFragment[] => [
    outstandingRow({
      refId: "doc-p31",
      docNo: "P-0031",
      counterparty: "陳志明 #12345678",
      payable: 16_400,
      net: 18_400,
      kind: "to_refund",
      amount: 2000,
      button: "in",
      daysOutstanding: 4,
    }),
    outstandingRow({
      refId: "doc-t8",
      docNo: "T-0008",
      moduleKey: "purchasing.transfer",
      label: "調貨",
      side: "shipper",
      sideLabel: "出貨店",
      branch: ref(orgs.storeB),
      counterparty: "中山店(出貨店)",
      payable: 1840,
      net: 1840,
      kind: "to_receive",
      amount: 1840,
      button: "in",
    }),
    outstandingRow({
      refId: "doc-p33",
      docNo: "P-0033",
      branch: ref(orgs.storeB),
      counterparty: "林大同 #87654321",
      payable: 36_800,
      net: 0,
      kind: "to_pay",
      amount: 36_800,
      button: "out",
      daysOutstanding: 1,
    }),
  ];

/** 一列待結清對應的收付現況(付款視窗要的形狀)。 */
export const settlementOf = (
  row: LotteryOutstandingSettlementFieldsFragment,
): LotterySettlementFieldsFragment => ({
  __typename: "LotterySettlement",
  moduleKey: row.moduleKey,
  label: row.label,
  kind: row.moduleKey === "purchasing.transfer" ? "transfer" : "purchase",
  refId: row.refId,
  docNo: row.docNo,
  counterparty: row.counterparty,
  payable: row.payable,
  pendingPayee: 0,
  sides: [
    {
      __typename: "LotterySettlementSide",
      side: row.side,
      label: row.sideLabel,
      role: row.kind === "to_receive" ? "payee" : "payer",
      methods: ["bank"],
      branch: row.branch,
      totalOut: row.net,
      totalIn: 0,
      net: row.net,
      canSettle: row.canSettle,
      buttons: (["out", "in"] as const).map((button) => ({
        __typename: "LotterySettlementButton" as const,
        button,
        defaultAmount: button === row.button ? row.amount : 0,
        canUse: row.canSettle && button === row.button,
      })),
    },
  ],
  records: [],
});

const module = (
  key: string,
  name: string,
  parentId: string | null,
  route: string,
  permissions: readonly string[],
  sidebarType = ModuleSidebarType.Hidden,
): TestModule => ({
  __typename: "MeModule",
  id: `m-${key}`,
  key,
  name,
  parentId,
  sidebarType,
  engine: ModuleEngine.Fixed,
  order: 40,
  route,
  icon: "business",
  permissions: [...permissions],
});

/** 帳戶管理的模組(與 seed 宣告一致):列表 + 銀行帳戶詳情;`viewPage` 決定綁不綁詳情頁。 */
export const accountsModules = ({
  permissions = ALL_ACCOUNTS_PERMISSIONS,
  viewPage = true,
}: {
  permissions?: readonly string[];
  viewPage?: boolean;
} = {}): TestModule[] => {
  const root = module(
    KEYS.list,
    "帳戶管理",
    null,
    "/accounts",
    permissions,
    ModuleSidebarType.Link,
  );
  return [
    root,
    ...(viewPage
      ? [
          module(
            KEYS.bankAccountViewPage,
            "銀行帳戶詳情",
            root.id,
            "/accounts/view-page",
            [],
          ),
        ]
      : []),
  ];
};
