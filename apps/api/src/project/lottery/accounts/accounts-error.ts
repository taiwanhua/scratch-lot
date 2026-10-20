import { GraphQLError } from "graphql";

/**
 * 帳戶管理的業務錯誤(GQL-04):只用通用碼 `NOT_FOUND` / `VALIDATION_FAILED` / `FORBIDDEN`,
 * 需要細分原因時放 `extensions.reason`(正本 `docs/modules/project/accounts.md`「錯誤碼」)。
 */
export const ACCOUNTS_REASONS = {
  /** 同一租戶已有相同銀行代碼 + 帳號的帳戶 */
  accountDuplicate: "BANK_ACCOUNT_DUPLICATE",
  /** 帳戶已有交易:期初餘額、期初日期不能改,也不能刪除 */
  accountHasTransactions: "BANK_ACCOUNT_HAS_TRANSACTIONS",
  /** 帳戶已停用:不能登記交易、不能選來付款 */
  accountInactive: "BANK_ACCOUNT_INACTIVE",
  /** 這筆已經被沖正過(或本身就是沖正) */
  alreadyReversed: "ALREADY_REVERSED",
  /** 單據沒有登記收付機制 / 這一邊不存在 */
  settlementUnknown: "SETTLEMENT_UNKNOWN",
  /** 這張單據這個方向目前沒有可結清的金額(按鈕應是停用) */
  settlementNothingDue: "SETTLEMENT_NOTHING_DUE",
  /** 帳戶的使用組織不含這張單據的分店 */
  accountNotUsable: "BANK_ACCOUNT_NOT_USABLE",
  /** 現金來源沒有開著的班(抽屜) */
  noOpenShift: "NO_OPEN_SHIFT",
  /** 作廢 / 駁回前收付淨額必須 = 0(lifecycle 守門的 code) */
  settlementNotCleared: "SETTLEMENT_NOT_CLEARED",
} as const;

export type AccountsReason =
  (typeof ACCOUNTS_REASONS)[keyof typeof ACCOUNTS_REASONS];

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/** 輸入不合法;`fields` 讓前端把錯誤標回表單欄位,`reason` 選填。 */
export function validationError(
  message: string,
  fields: string[],
  reason?: AccountsReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      ...(reason === undefined ? {} : { reason }),
    },
  });
}

/** 收集欄位錯誤(一次回所有欄位)。 */
export class FieldErrors {
  readonly fields: string[] = [];

  add(field: string): null {
    if (!this.fields.includes(field)) {
      this.fields.push(field);
    }
    return null;
  }

  throwIfAny(message: string): void {
    if (this.fields.length > 0) {
      throw validationError(message, this.fields);
    }
  }
}

/** MongoDB 唯一索引衝突。 */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 11_000
  );
}
