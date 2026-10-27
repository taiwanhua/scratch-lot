/**
 * 即時現金帳與現金流水的規則(專案規格 10.2;正本 `docs/modules/project/accounts.md`「資料」)。
 * 應有現金只由流水加總,不另存可被改寫的數字(第 17 章共通原則)。
 */

/** 錢在哪裡:收銀點抽屜 / 小金庫 / 銀行 / 外部。 */
export const CASH_PLACE = {
  drawer: "drawer",
  vault: "vault",
  bank: "bank",
  external: "external",
} as const;

export type CashPlace = (typeof CASH_PLACE)[keyof typeof CASH_PLACE];

export const CASH_PLACES: readonly CashPlace[] = Object.values(CASH_PLACE);

/** 現金流水類型(規格 10.2 表;已刪除的類型:交接、調整、開班領零用金、單據付現)。 */
export const CASH_MOVEMENT_TYPE = {
  /** 出庫:小金庫 → 抽屜(原因:開班零用金 / 補零錢 / 其他) */
  withdraw: "withdraw",
  /** 投庫:抽屜 → 小金庫 */
  deposit: "deposit",
  /** 存銀行:小金庫 → 銀行(連到銀行「存入」) */
  bankDeposit: "bank_deposit",
  /** 調貨支出:抽屜或小金庫 → 外部 */
  transferOut: "transfer_out",
  /** 調貨收入:外部 → 抽屜或小金庫 */
  transferIn: "transfer_in",
  /** 退貨退款:抽屜 → 外部 */
  refund: "refund",
  /** 現金更正(增加):外部 → 抽屜或小金庫 */
  correctionIncrease: "correction_increase",
  /** 現金更正(減少):抽屜或小金庫 → 外部 */
  correctionDecrease: "correction_decrease",
} as const;

export type CashMovementType =
  (typeof CASH_MOVEMENT_TYPE)[keyof typeof CASH_MOVEMENT_TYPE];

export const CASH_MOVEMENT_TYPES: readonly CashMovementType[] =
  Object.values(CASH_MOVEMENT_TYPE);

/** 每種類型允許的「從 → 到」(沖正的那一筆兩端對調,不在此檢查)。 */
const ROUTES: Record<
  CashMovementType,
  { from: readonly CashPlace[]; to: readonly CashPlace[] }
> = {
  withdraw: { from: ["vault"], to: ["drawer"] },
  deposit: { from: ["drawer"], to: ["vault"] },
  bank_deposit: { from: ["vault"], to: ["bank"] },
  transfer_out: { from: ["drawer", "vault"], to: ["external"] },
  transfer_in: { from: ["external"], to: ["drawer", "vault"] },
  refund: { from: ["drawer"], to: ["external"] },
  correction_increase: { from: ["external"], to: ["drawer", "vault"] },
  correction_decrease: { from: ["drawer", "vault"], to: ["external"] },
};

export function isCashRouteAllowed(
  type: CashMovementType,
  from: CashPlace,
  to: CashPlace,
): boolean {
  const route = ROUTES[type];
  return route.from.includes(from) && route.to.includes(to);
}

/** 一筆流水對某個地方的影響:流入 +、流出 −、無關 0。 */
export function cashEffectOn(
  place: CashPlace,
  movement: { from: CashPlace; to: CashPlace; amount: number },
): number {
  let effect = 0;
  if (movement.to === place) {
    effect += movement.amount;
  }
  if (movement.from === place) {
    effect -= movement.amount;
  }
  return effect;
}

/** 出庫的原因(規格 10.2)。 */
export const WITHDRAW_REASONS = ["opening_float", "change", "other"] as const;

export type WithdrawReason = (typeof WITHDRAW_REASONS)[number];
