import type { Direction } from "./bank";

/**
 * 收付機制的計算(專案規格第 9 章;正本 `docs/modules/project/accounts.md`「收付機制」)。
 * api 算預設值與待結清、admin 的 `SettlementPanel` 顯示,都用這裡同一份。
 *
 * - 一張單據有一或多「邊」(進貨單:總部;調貨單:收貨店、出貨店)。每一邊的按鈕只有兩顆方向:
 *   `out`(支出:付款 / 退款)與 `in`(收入:收到退款 / 收款)
 * - 已付淨額 = 支出 − 收入;已收淨額 = 收入 − 支出
 * - 先填的數字 = 這一邊按下去剛好結清的金額;≤ 0 時那顆按鈕停用
 */

/** 收付的方向按鈕:`out` = 這一邊付出去、`in` = 這一邊收進來。 */
export type SettlementButton = Direction;

/** 付款方式:銀行 / 現金。 */
export const SETTLEMENT_METHOD = { bank: "bank", cash: "cash" } as const;

export type SettlementMethod =
  (typeof SETTLEMENT_METHOD)[keyof typeof SETTLEMENT_METHOD];

export const SETTLEMENT_METHODS: readonly SettlementMethod[] =
  Object.values(SETTLEMENT_METHOD);

/** 一邊的收付合計(沖正的那一筆以反方向計入,不另外排除)。 */
export interface SettlementSideTotals {
  /** 支出合計 */
  out: number;
  /** 收入合計 */
  in: number;
}

export const EMPTY_TOTALS: SettlementSideTotals = { out: 0, in: 0 };

/** 已付淨額 = 支出 − 收入。 */
export function paidNetOf(totals: SettlementSideTotals): number {
  return totals.out - totals.in;
}

/** 已收淨額 = 收入 − 支出。 */
export function receivedNetOf(totals: SettlementSideTotals): number {
  return totals.in - totals.out;
}

/** 單據目前的收付狀態:應付(或調貨金額)與各邊的合計。 */
export interface SettlementState {
  payable: number;
  /**
   * 付款方先填值的基準,和應付不同時才給(調貨單:已點收的批購金額;調貨金額照點收的本計算,規格 9)。
   */
  received?: number;
  sides: Readonly<Record<string, SettlementSideTotals>>;
}

export function totalsOf(
  state: SettlementState,
  side: string,
): SettlementSideTotals {
  return state.sides[side] ?? EMPTY_TOTALS;
}

/** 金額不小於 0。 */
function atLeastZero(value: number): number {
  return Math.max(0, value);
}

/**
 * 「付款方」那一邊(進貨單總部、調貨單收貨店)的預設值:
 * [付款](`out`)= 應付 − 已付淨額;[收到退款](`in`)= 已付淨額 − 應付;最少 0。
 */
export function payerDefaultAmount(
  button: SettlementButton,
  payable: number,
  totals: SettlementSideTotals,
): number {
  const paid = paidNetOf(totals);
  return button === "out"
    ? atLeastZero(payable - paid)
    : atLeastZero(paid - payable);
}

/**
 * 調貨單出貨店(收款方)的預設值(規格 9 表):
 * [收款](`in`)= 收貨店已付淨額 − 出貨店已收淨額,**只有**「出貨店已收 < 調貨金額」且差額 > 0 才能按;
 * [退款](`out`)= 出貨店已收淨額 − 調貨金額。
 */
export function payeeDefaultAmount(
  button: SettlementButton,
  amount: number,
  payerTotals: SettlementSideTotals,
  payeeTotals: SettlementSideTotals,
): number {
  const received = receivedNetOf(payeeTotals);
  if (button === "out") {
    return atLeastZero(received - amount);
  }
  if (received >= amount) {
    return 0;
  }
  return atLeastZero(paidNetOf(payerTotals) - received);
}

/** 待結清的種類:待付 / 待退 / 待收。 */
export type OutstandingKind = "to_pay" | "to_refund" | "to_receive";

/**
 * 一邊的待結清:付款方 `out` > 0 = 待付、`in` > 0 = 待退;收款方 `in` > 0 = 待收、`out` > 0 = 待退。
 * 兩顆都 0 = 這一邊已結清(null)。
 */
export function outstandingKindOf(
  role: "payer" | "payee",
  defaults: Readonly<Record<SettlementButton, number>>,
): { kind: OutstandingKind; button: SettlementButton; amount: number } | null {
  if (role === "payer") {
    if (defaults.out > 0) {
      return { kind: "to_pay", button: "out", amount: defaults.out };
    }
    return defaults.in > 0
      ? { kind: "to_refund", button: "in", amount: defaults.in }
      : null;
  }
  if (defaults.in > 0) {
    return { kind: "to_receive", button: "in", amount: defaults.in };
  }
  return defaults.out > 0
    ? { kind: "to_refund", button: "out", amount: defaults.out }
    : null;
}

/** 「N 待出貨店入帳」的 N:收貨店已付 − 出貨店已收,> 0 才顯示。 */
export function pendingPayeeAmount(
  payerTotals: SettlementSideTotals,
  payeeTotals: SettlementSideTotals,
): number {
  return atLeastZero(paidNetOf(payerTotals) - receivedNetOf(payeeTotals));
}

/** 作廢 / 駁回前:每一邊的淨額都要是 0(規格 9「已有結算紀錄的單據作廢 / 駁回前淨額必須 = 0」)。 */
export function isSettlementCleared(state: SettlementState): boolean {
  return Object.values(state.sides).every((totals) => paidNetOf(totals) === 0);
}
