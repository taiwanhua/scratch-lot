import {
  type SettlementSideTotals,
  receivedNetOf,
} from "../lottery-accounts/settlement";
import { purchaseAmountOf } from "./purchase";

/**
 * 批售單(專案規格 21.3、21.4;正本 `docs/modules/project/purchasing.md`「批售單」):api 的掛接點 / 收付登記與
 * admin 的新增頁、檢視頁共用的常數與純函式 —— 表單代號 / 欄位 key、權限、收款方式、明細存值 → 明細列、
 * 批售金額、核准前「已收 = 批售金額」的檢查。
 */

/** 批售單綁定的模組與表單代號(規格 21.3)。 */
export const WHOLESALE_MODULE_KEY = "purchasing.wholesale";
export const WHOLESALE_FORM_KEY = "wholesale";

/** 明細最多幾列(規格 21.3)。 */
export const WHOLESALE_MAX_LINES = 200;

/** 受管表單 `wholesale` 的欄位 key(`seeds/project/revisions/wholesale.r1.seed.ts`)。 */
export const WHOLESALE_FIELD_KEYS = {
  /** 出貨分店(組織引用) */
  fromBranch: "from_branch",
  /** 批售客戶(引用 `lottery_wholesale_customer`,往來中) */
  customer: "customer",
  /** 收款方式(從帳戶入帳 / 收到錢再核准) */
  paymentMode: "payment_mode",
  /** 入帳帳戶(引用 `lottery_bank_account`,使用中;只在「從帳戶入帳」時顯示且必填) */
  account: "account",
  /** 備註 */
  note: "note",
  /** 明細(一列 = 一整本) */
  lines: "lines",
  /** 明細子欄:遊戲(引用 `lottery_game`,不限販售中) */
  game: "game",
  /** 明細子欄:本(引用 `lottery_book`,正常) */
  book: "book",
  /** 明細子欄:張數(遊戲的標準張數) */
  tickets: "tickets",
  /** 明細子欄:整本金額 */
  bookPrice: "book_price",
  /** 明細子欄:批購金額率(整數 %;預設遊戲的預設批購金額率) */
  rate: "rate",
  /** 明細子欄:批售金額(列內公式 = 整本金額 × 批購金額率) */
  amount: "amount",
  /** 批售金額(計算欄 = 明細批售金額合計;這張單的應收) */
  wholesaleTotal: "wholesale_total",
} as const;

/** 收款方式:從帳戶入帳 / 收到錢再核准(預設)。 */
export const WHOLESALE_PAYMENT_MODE = {
  autoBank: "auto_bank",
  collectFirst: "collect_first",
} as const;
export type WholesalePaymentMode =
  (typeof WHOLESALE_PAYMENT_MODE)[keyof typeof WHOLESALE_PAYMENT_MODE];

/** 批售單的權限(表單四條 + 出貨店收款;規格 21.8)。 */
export const WHOLESALE_PERMISSIONS = {
  view: `${WHOLESALE_MODULE_KEY}.view`,
  create: `${WHOLESALE_MODULE_KEY}.create`,
  edit: `${WHOLESALE_MODULE_KEY}.edit`,
  delete: `${WHOLESALE_MODULE_KEY}.delete`,
  /** 結算區 [收款] [退款] [沖正] */
  receive: `${WHOLESALE_MODULE_KEY}.receive`,
} as const;

/** 收付機制登記的那一邊:出貨店(收款方;規格 21.6)。 */
export const WHOLESALE_SETTLEMENT_SIDE = "shipper";

/** 明細的一列(存值正規化後)。 */
export interface WholesaleLineValue {
  rowId: string;
  gameId: string | null;
  bookId: string;
  tickets: number;
  bookPrice: number;
  rate: number;
  amount: number;
}

/** 單頭(引用欄取 id)。 */
export interface WholesaleHeader {
  fromBranchId: string | null;
  customerId: string | null;
  /** 沒填或看不懂 = null。 */
  paymentMode: WholesalePaymentMode | null;
  accountId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 引用 / 下拉欄的存值(`{ id, label }`、`{ value }` 或字串)→ 值。 */
function idOf(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (isRecord(value)) {
    for (const key of ["id", "value"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate !== "") {
        return candidate;
      }
    }
  }
  return null;
}

function numberOf(value: unknown): number {
  const number =
    typeof value === "number" ? value : Number(value ?? Number.NaN);
  return Number.isFinite(number) ? number : 0;
}

/** 一列的批售金額 = 整本金額 × 批購金額率(整數 %),取整數元(同進貨單)。 */
export function wholesaleAmountOf(bookPrice: number, rate: number): number {
  return purchaseAmountOf(bookPrice, rate);
}

/** 明細存值 → 明細列:沒有 rowId 或沒有本的列略過。 */
export function wholesaleLinesOf(
  values: Record<string, unknown>,
): WholesaleLineValue[] {
  const rows = values[WHOLESALE_FIELD_KEYS.lines];
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row): WholesaleLineValue[] => {
    if (!isRecord(row) || typeof row.rowId !== "string") {
      return [];
    }
    const bookId = idOf(row[WHOLESALE_FIELD_KEYS.book]);
    return bookId === null
      ? []
      : [
          {
            rowId: row.rowId,
            gameId: idOf(row[WHOLESALE_FIELD_KEYS.game]),
            bookId,
            tickets: numberOf(row[WHOLESALE_FIELD_KEYS.tickets]),
            bookPrice: numberOf(row[WHOLESALE_FIELD_KEYS.bookPrice]),
            rate: numberOf(row[WHOLESALE_FIELD_KEYS.rate]),
            amount: numberOf(row[WHOLESALE_FIELD_KEYS.amount]),
          },
        ];
  });
}

/** 單頭的值。 */
export function wholesaleHeaderOf(
  values: Record<string, unknown>,
): WholesaleHeader {
  const mode = idOf(values[WHOLESALE_FIELD_KEYS.paymentMode]);
  return {
    fromBranchId: idOf(values[WHOLESALE_FIELD_KEYS.fromBranch]),
    customerId: idOf(values[WHOLESALE_FIELD_KEYS.customer]),
    paymentMode:
      Object.values(WHOLESALE_PAYMENT_MODE).find((value) => value === mode) ??
      null,
    accountId: idOf(values[WHOLESALE_FIELD_KEYS.account]),
  };
}

/** 批售金額(這張單的應收)= 明細批售金額合計。 */
export function wholesaleTotalOf(lines: readonly WholesaleLineValue[]): number {
  return lines.reduce((sum, line) => sum + line.amount, 0);
}

/**
 * 「收到錢再核准」核准前:已收淨額要等於批售金額(規格 21.4)。還差 N 元沒收 / 多收 N 元;相等 → null。
 */
export function wholesaleReceivedProblemOf(
  total: number,
  totals: SettlementSideTotals,
): { kind: "unreceived" | "overreceived"; amount: number } | null {
  const received = receivedNetOf(totals);
  if (received === total) {
    return null;
  }
  return received < total
    ? { kind: "unreceived", amount: total - received }
    : { kind: "overreceived", amount: received - total };
}
