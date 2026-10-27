/** 帳戶管理稽核的 targetType 與動作名(模組文件「稽核」節)。 */
export const ACCOUNTS_AUDIT = {
  accountTarget: "lottery_bank_account",
  transactionTarget: "lottery_bank_transaction",
  movementTarget: "lottery_cash_movement",
  accountCreate: "lottery-bank-account.create",
  accountEdit: "lottery-bank-account.edit",
  accountDelete: "lottery-bank-account.delete",
  transactionCreate: "lottery-bank-transaction.create",
  transactionReverse: "lottery-bank-transaction.reverse",
  movementCreate: "lottery-cash-movement.create",
  movementReverse: "lottery-cash-movement.reverse",
} as const;
