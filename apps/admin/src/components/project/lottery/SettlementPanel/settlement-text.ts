import { accountsErrorOf } from "@/lib/project/lottery/accounts-error";

/** 金額顯示(千分位)。 */
export const moneyText = (value: number): string =>
  value.toLocaleString("en-US");

/**
 * 按鈕的字(`admin.lotteryAccounts.settlement.buttons.*`):付款方 out = 付款、in = 收到退款;
 * 收款方 in = 收款、out = 退款。
 */
export const buttonLabelKey = (
  role: "payer" | "payee",
  button: "out" | "in",
): string => `settlement.buttons.${role}.${button}`;

/** 收付寫入失敗的文案 key(`admin.lotteryAccounts.errors.<code>`)。 */
export const settlementErrorKey = (error: unknown): string =>
  `errors.${accountsErrorOf(error).code}`;
