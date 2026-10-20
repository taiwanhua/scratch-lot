/**
 * 銀行帳戶與交易的規則(專案規格 10.1;正本 `docs/modules/project/accounts.md`「資料」)。
 */

/** 帳戶狀態:使用中 / 停用。 */
export const BANK_ACCOUNT_STATUS = {
  active: "active",
  inactive: "inactive",
} as const;

export type BankAccountStatus =
  (typeof BANK_ACCOUNT_STATUS)[keyof typeof BANK_ACCOUNT_STATUS];

export const BANK_ACCOUNT_STATUSES: readonly BankAccountStatus[] =
  Object.values(BANK_ACCOUNT_STATUS);

/** 交易方向:收(入帳)/ 支(出帳)。 */
export const DIRECTION = { in: "in", out: "out" } as const;

export type Direction = (typeof DIRECTION)[keyof typeof DIRECTION];

export const DIRECTIONS: readonly Direction[] = Object.values(DIRECTION);

export function oppositeDirection(direction: Direction): Direction {
  return direction === DIRECTION.in ? DIRECTION.out : DIRECTION.in;
}

/**
 * 銀行交易類型(規格 10.1 表)。沒有「佣金入帳」(佣金靠賣刮刮樂收回);其他收入用「其他」選收。
 * 沖正不是類型:沖正的交易沿用原交易的類型、方向相反,以 `reversalOf` 指向原交易。
 */
export const BANK_TRANSACTION_TYPE = {
  /** 存入(收):含日結存銀行 */
  deposit: "deposit",
  /** 兌獎入帳(收):不算進任何單據的已付 / 已收淨額 */
  redemptionIncome: "redemption_income",
  /** 批貨收入(收):進貨單收到退款 */
  purchaseIncome: "purchase_income",
  /** 調貨收入(收) */
  transferIncome: "transfer_income",
  /** 提領(支) */
  withdrawal: "withdrawal",
  /** 牌租(支) */
  licenseRent: "license_rent",
  /** 批貨支出(支):進貨單付款 */
  purchaseExpense: "purchase_expense",
  /** 調貨支出(支) */
  transferExpense: "transfer_expense",
  /** 調整(使用者選方向,說明必填) */
  adjustment: "adjustment",
  /** 其他(使用者選方向,說明必填) */
  other: "other",
} as const;

export type BankTransactionType =
  (typeof BANK_TRANSACTION_TYPE)[keyof typeof BANK_TRANSACTION_TYPE];

export const BANK_TRANSACTION_TYPES: readonly BankTransactionType[] =
  Object.values(BANK_TRANSACTION_TYPE);

/** 方向固定的類型;不在表內的(調整、其他)由使用者選。 */
const FIXED_DIRECTIONS: Partial<Record<BankTransactionType, Direction>> = {
  deposit: "in",
  redemption_income: "in",
  purchase_income: "in",
  transfer_income: "in",
  withdrawal: "out",
  license_rent: "out",
  purchase_expense: "out",
  transfer_expense: "out",
};

/** 這個類型的固定方向;null = 使用者選(調整、其他)。 */
export function fixedDirectionOf(type: BankTransactionType): Direction | null {
  return FIXED_DIRECTIONS[type] ?? null;
}

/** 調整、其他:說明必填。 */
export function requiresSummary(type: BankTransactionType): boolean {
  return fixedDirectionOf(type) === null;
}

/** 批貨與調貨:歸屬分店必填(規格 10.1)。 */
const BRANCH_REQUIRED: ReadonlySet<BankTransactionType> = new Set([
  "purchase_income",
  "purchase_expense",
  "transfer_income",
  "transfer_expense",
]);

export function requiresBranch(type: BankTransactionType): boolean {
  return BRANCH_REQUIRED.has(type);
}

/**
 * 在銀行 [登記交易] 選了要指定單據的類型(規格 9):批貨收入 / 調貨收入 → 單據必填,
 * 只列有待退或待收的單據;兌獎入帳 → 單據選填(不算進單據淨額)。
 */
export function documentRequirementOf(
  type: BankTransactionType,
): "required" | "optional" | "none" {
  if (type === "purchase_income" || type === "transfer_income") {
    return "required";
  }
  return type === "redemption_income" ? "optional" : "none";
}

/** 帳號顯示用的末 5 碼(lookup、列表「末 34521」)。 */
export function accountNoTail(accountNo: string): string {
  const digits = accountNo.replaceAll(/\D/g, "");
  return (digits === "" ? accountNo : digits).slice(-5);
}

/** 帳戶在選單裡的名稱:戶名 + 帳號末 5 碼(規格 10.1 lookup)。 */
export function bankAccountLabel(account: {
  accountName: string;
  accountNo: string;
}): string {
  return `${account.accountName} 末 ${accountNoTail(account.accountNo)}`;
}

/** 帶正負號的金額:收 = +、支 = −(餘額依時間累加用)。 */
export function signedAmount(direction: Direction, amount: number): number {
  return direction === DIRECTION.in ? amount : -amount;
}

/** 銀行代碼 3 碼數字。 */
export const BANK_CODE_PATTERN = /^\d{3}$/;

/** 欄位長度上限。 */
export const BANK_ACCOUNT_LIMITS = {
  branchName: 30,
  accountNo: 30,
  accountName: 50,
  note: 1000,
  summary: 200,
} as const;
