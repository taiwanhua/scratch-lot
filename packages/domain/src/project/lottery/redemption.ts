/**
 * 兌獎(專案規格 6.5、6.12、8.2「兌獎」;正本 `docs/modules/project/store.md`「兌獎」):api 的登記 / 撤銷 /
 * 抽屜應有與 admin 的兌獎視窗、撤銷按鈕、進貨單的兌獎區共用的常數與純函式。
 */

/** 兌獎紀錄的狀態:店內持有 / 已送兌(勾進進貨單)/ 已撤銷。 */
export const REDEMPTION_STATUSES = ["in_store", "sent", "revoked"] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

export const REDEMPTION_STATUS = {
  inStore: "in_store",
  sent: "sent",
  revoked: "revoked",
} as const satisfies Record<string, RedemptionStatus>;

export function isRedemptionStatus(value: unknown): value is RedemptionStatus {
  return (REDEMPTION_STATUSES as readonly unknown[]).includes(value);
}

/** 單張中獎金額上限:超過擋下(提示客人到銀行兌獎;規格 6.5)。 */
export const REDEMPTION_MAX_PRIZE = 5000;

/**
 * 兌獎紀錄的單號(規格 6.5;底座單號機制 ADR-0015):`RD-0001` —— 前綴 RD、4 位數、不分期(`none`),
 * 各租戶各自連號;新增兌獎時在同一個交易內取號,撤銷不收回,[撤銷並重新登記] 的新紀錄取新號。
 * `REDEMPTION_SERIAL_KEY` 是計數器的 key(同一個租戶內唯一;表單的是 `form:<formKey>`)。
 */
export const REDEMPTION_SERIAL_KEY = "lottery_redemption";
export const REDEMPTION_SERIAL_FORMAT = {
  prefix: "RD",
  period: "none",
  digits: 4,
} as const;

/** 兌獎視窗的常見金額選項(Figma ST-11a;另可自由輸入)。 */
export const REDEMPTION_PRIZE_PRESETS: readonly number[] = [
  200, 500, 1000, 2000,
];

/**
 * 自己登記、班還開著時撤銷的原因代碼(規格 6.5「當下撤銷的原因固定『當下撤銷』」);
 * 其他撤銷的原因是欄位管理「撤銷兌獎原因」的選項值。
 */
export const REDEMPTION_IMMEDIATE_REVOKE_REASON = "immediate";

/**
 * 撤銷兌獎的方式(規格 6.5 兩層,都不用審核):
 * - `self`:自己登記、那一班還開著、有 `store.redeem` → 確認視窗(不用原因,不限時間)
 * - `manager`:那一班已結帳、或不是自己登記的,有 `store.undo-redeem` → 原因必填 + 說明,另有 [撤銷並重新登記]
 * - `null`:沒有權限 → 看不到撤銷按鈕
 */
export type RedemptionRevokeMode = "self" | "manager";

export interface RedemptionRevokeFacts {
  status: RedemptionStatus;
  /** 登記人是操作者本人 */
  isMine: boolean;
  /** 那一班還開著(還沒送出交班結帳) */
  shiftOpen: boolean;
  canRedeem: boolean;
  canUndoRedeem: boolean;
}

export interface RedemptionRevokeState {
  /** 用哪一層撤銷;沒有權限 = null(按鈕不顯示)。已撤銷的也是 null。 */
  mode: RedemptionRevokeMode | null;
  /** 已送兌:按鈕停用、提示先撤回或退回進貨單(規格 6.5、第 17 章第 7 題)。 */
  blockedBySent: boolean;
}

/**
 * 撤銷按鈕怎麼顯示(api 也用同一支判斷;已送兌時 api 拒絕)。
 * 例:自己登記、班開著、有 `store.redeem` → `{ mode: "self", blockedBySent: false }`。
 */
export function redemptionRevokeStateOf(
  facts: RedemptionRevokeFacts,
): RedemptionRevokeState {
  if (facts.status === REDEMPTION_STATUS.revoked) {
    return { mode: null, blockedBySent: false };
  }
  let mode: RedemptionRevokeMode | null = null;
  if (facts.isMine && facts.shiftOpen && facts.canRedeem) {
    mode = "self";
  } else if (facts.canUndoRedeem) {
    mode = "manager";
  }
  return {
    mode,
    blockedBySent: mode !== null && facts.status === REDEMPTION_STATUS.sent,
  };
}

/** 兌獎紀錄對那一班的現金影響要用到的欄位(規格 6.12「事後更正」)。 */
export interface RedemptionCashRow {
  shiftId: string;
  prizeAmount: number;
  /** 已撤銷 */
  revoked: boolean;
  /** 登記時那一班已結帳(撤銷並重新登記的新紀錄)→ 那一班的 id;否則 null */
  postCloseOf: string | null;
  /** 撤銷時那一班已結帳 → 那一班的 id;否則 null */
  revokePostCloseOf: string | null;
}

/**
 * 結帳當時(班開著時)兌獎對抽屜應有的淨額:那一班開著時登記、且沒有在班開著時撤銷的,一筆 −金額。
 * 例:登記 500 → −500;班開著時撤銷 → 0;交班後才撤銷 → 仍是 −500(差額由事後更正解釋)。
 */
export function redemptionDrawerNetOf(
  rows: readonly RedemptionCashRow[],
  shiftId: string,
): number {
  return rows.reduce(
    (sum, row) =>
      row.shiftId === shiftId &&
      row.postCloseOf === null &&
      (!row.revoked || row.revokePostCloseOf !== null)
        ? sum - row.prizeAmount
        : sum,
    0,
  );
}

/**
 * 那一班兌獎的**事後更正淨額**(規格 6.12):交班後撤銷的 +金額、交班後登記(撤銷並重新登記)的 −金額。
 * 例(第 17 章第 5 題):撤銷 2,000、重新登記 200 → +1,800。
 */
export function redemptionPostCloseNetOf(
  rows: readonly RedemptionCashRow[],
  shiftId: string,
): number {
  return rows.reduce((sum, row) => {
    let next = sum;
    if (row.revoked && row.revokePostCloseOf === shiftId) {
      next += row.prizeAmount;
    }
    if (row.postCloseOf === shiftId) {
      next -= row.prizeAmount;
    }
    return next;
  }, 0);
}

/** 進貨單的兌獎合計(規格 8.2「合計」)。 */
export interface PurchaseRedemptionTotals {
  /** 兌獎金額:勾選的兌獎紀錄合計 */
  redemptionTotal: number;
  /** 兌獎折抵:兌獎金額與批購合計取較小者 */
  offset: number;
  /** 扣款金額:批購合計 − 兌獎折抵(最少 0) */
  deducted: number;
  /** 兌獎剩餘:兌獎金額 − 兌獎折抵 */
  remainder: number;
}

/**
 * 例(規格 8.2):批購 60,000、兌獎 100,000 → 折抵 60,000、扣款 0、兌獎剩餘 40,000。
 */
export function purchaseRedemptionTotalsOf(
  purchaseTotal: number,
  redemptionTotal: number,
): PurchaseRedemptionTotals {
  const offset = Math.max(0, Math.min(redemptionTotal, purchaseTotal));
  return {
    redemptionTotal,
    offset,
    deducted: Math.max(0, purchaseTotal - offset),
    remainder: Math.max(0, redemptionTotal - offset),
  };
}
