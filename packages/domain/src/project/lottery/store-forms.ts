import { STORE_KEY } from "./store";
import { parseTicketNos } from "./transfer";

/**
 * 店面管理的兩張表單:撤銷售出申請、現金更正單(專案規格 8.5、8.8、2.1;正本
 * `docs/modules/project/store.md`「撤銷售出申請與現金更正單」)。表單代號、欄位 key、存值解析與規則;
 * seed、api 掛接點與 admin 新增頁都引用這裡,不另寫字面值。
 */

/** 撤銷售出申請(底座表單 key 不收 `-`,規格的 `sale-reversal` 寫成底線)。 */
export const SALE_REVERSAL_FORM_KEY = "sale_reversal";

/** 現金更正單(規格的 `cash-correction` 寫成底線)。 */
export const CASH_CORRECTION_FORM_KEY = "cash_correction";

/** 兩張表單開啟 B9b 後的新增權限(表單發布時自動建立)。 */
export const STORE_FORM_PERMISSIONS = {
  createSaleReversal: `${STORE_KEY}.create-${SALE_REVERSAL_FORM_KEY}`,
  createCashCorrection: `${STORE_KEY}.create-${CASH_CORRECTION_FORM_KEY}`,
} as const;

/** 張被撤銷售出申請鎖定時的鎖來源(`TICKET_LOCK_REF_TYPES`)。 */
export const SALE_REVERSAL_LOCK_REF_TYPE = "sale_reversal";

/** 撤銷售出申請的欄位 key(受管表單 `sale_reversal.r4.seed.ts`)。 */
export const SALE_REVERSAL_FIELD_KEYS = {
  branch: "branch",
  lines: "lines",
  /** 明細列的種類(`SALE_REVERSAL_LINE_KIND`;沒有值 = 依張號,r3 以前的單) */
  lineKind: "line_kind",
  book: "book",
  ticketNos: "ticket_nos",
  tickets: "tickets",
  /** 依遊戲 + 張數:遊戲 */
  game: "game",
  /** 收銀點:依遊戲 + 張數 = 挑哪一台的已售·未對號;依張號 = 刷退票的那一台(對號找這台最近一筆依張數售出;張數店規格 7.3) */
  cashPoint: "cash_point",
  /** 依遊戲 + 張數:張數 */
  count: "count",
  amount: "amount",
  reason: "reason",
  refund: "refund",
  refundShift: "refund_shift",
  note: "note",
  refundAmount: "refund_amount",
} as const;

/** 現金更正單的欄位 key(受管表單 `cash_correction.r1.seed.ts`)。 */
export const CASH_CORRECTION_FIELD_KEYS = {
  branch: "branch",
  direction: "direction",
  amount: "amount",
  place: "place",
  shift: "shift",
  attributedShift: "attributed_shift",
  reason: "reason",
  note: "note",
} as const;

/**
 * 撤銷售出申請明細列的種類(張數店規格 5.7、7.3 第 3 點):依張號(刷條碼、手輸或點格子;預設)/
 * 依遊戲 + 張數(沒有票可刷時,系統挑這台最近的已售·未對號)。
 */
export const SALE_REVERSAL_LINE_KIND = {
  byTicket: "by_ticket",
  byCount: "by_count",
} as const;
export type SaleReversalLineKind =
  (typeof SALE_REVERSAL_LINE_KIND)[keyof typeof SALE_REVERSAL_LINE_KIND];

/** 退款給客人:是 / 否。 */
export const SALE_REVERSAL_REFUND = { yes: "yes", no: "no" } as const;

/** 現金更正的方向。 */
export const CASH_CORRECTION_DIRECTION = {
  increase: "increase",
  decrease: "decrease",
} as const;
export type CashCorrectionDirection =
  (typeof CASH_CORRECTION_DIRECTION)[keyof typeof CASH_CORRECTION_DIRECTION];

/** 現金更正的位置:某一班的抽屜 / 小金庫。 */
export const CASH_CORRECTION_PLACE = {
  drawer: "drawer",
  vault: "vault",
} as const;
export type CashCorrectionPlace =
  (typeof CASH_CORRECTION_PLACE)[keyof typeof CASH_CORRECTION_PLACE];

/**
 * 「退款給客人」依原因的預設選項代碼自動帶入(規格 8.5):客人退貨 = 是;其他(含租戶新增的原因)= 否。
 * 欄位管理「撤銷售出原因」的種子代碼見 `seeds/project/field-categories.ts`。
 */
export const REFUND_DEFAULT_REASON_KEYS: readonly string[] = [
  "customer-return",
];

export function refundDefaultOf(reasonKey: string | null): boolean {
  return reasonKey !== null && REFUND_DEFAULT_REASON_KEYS.includes(reasonKey);
}

/** 撤銷售出申請的一列(依張號):一本的幾張(張數跨多本時依本分組)。 */
export interface SaleReversalLine {
  rowId: string;
  bookId: string;
  /** 3 位張號,排序去重。 */
  ticketNos: string[];
  tickets: number;
  amount: number;
  /** 刷退票的那一台(沒有 = null;重刷進來的 = 重刷刷到的位置,庫存也是 null) */
  cashPointId: string | null;
}

/** 撤銷售出申請的一列(依遊戲 + 張數;張數店規格 5.7、7.3 第 3 點):送出時系統挑這台最近的已售·未對號。 */
export interface SaleReversalCountLine {
  rowId: string;
  gameId: string | null;
  cashPointId: string | null;
  count: number;
  amount: number;
}

export interface SaleReversalValues {
  branchId: string | null;
  lines: SaleReversalLine[];
  countLines: SaleReversalCountLine[];
  reasonKey: string | null;
  refund: boolean;
  refundShiftId: string | null;
  refundAmount: number;
  note: string | null;
}

export interface CashCorrectionValues {
  branchId: string | null;
  direction: CashCorrectionDirection | null;
  amount: number;
  place: CashCorrectionPlace | null;
  shiftId: string | null;
  attributedShiftId: string | null;
  reasonKey: string | null;
  note: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 引用 / 選項的存值(`"id"`、`{ id, label }`、`{ value, label }`)→ id 或代碼。 */
export function storedIdOf(value: unknown): string | null {
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

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function numberOf(value: unknown): number {
  const number =
    typeof value === "number" ? value : Number(value ?? Number.NaN);
  return Number.isFinite(number) ? number : 0;
}

function oneOf<T extends string>(
  values: Readonly<Record<string, T>>,
  value: string | null,
): T | null {
  return (Object.values(values) as string[]).includes(value ?? "")
    ? (value as T)
    : null;
}

/**
 * 撤銷售出申請的存值 → 規則用的值:依張號的列(沒有 rowId 或沒有本的略過;張號看不懂的列張號為空)與
 * 依遊戲 + 張數的列(`line_kind = by_count`)分開。
 */
export function saleReversalValuesOf(
  values: Record<string, unknown>,
): SaleReversalValues {
  const keys = SALE_REVERSAL_FIELD_KEYS;
  const rows = values[keys.lines];
  const records = Array.isArray(rows)
    ? rows.filter(
        (row): row is Record<string, unknown> & { rowId: string } =>
          isRecord(row) && typeof row.rowId === "string",
      )
    : [];
  const isCountRow = (row: Record<string, unknown>) =>
    storedIdOf(row[keys.lineKind]) === SALE_REVERSAL_LINE_KIND.byCount;
  const countLines = records
    .filter((row) => isCountRow(row))
    .map((row): SaleReversalCountLine => ({
      rowId: row.rowId,
      gameId: storedIdOf(row[keys.game]),
      cashPointId: storedIdOf(row[keys.cashPoint]),
      count: numberOf(row[keys.count]),
      amount: numberOf(row[keys.amount]),
    }));
  const lines = records
    .filter((row) => !isCountRow(row))
    .flatMap((row): SaleReversalLine[] => {
      const bookId = storedIdOf(row[keys.book]);
      if (bookId === null) {
        return [];
      }
      const rawNos = row[keys.ticketNos];
      return [
        {
          rowId: row.rowId,
          bookId,
          ticketNos:
            typeof rawNos === "string" ? (parseTicketNos(rawNos) ?? []) : [],
          tickets: numberOf(row[keys.tickets]),
          amount: numberOf(row[keys.amount]),
          cashPointId: storedIdOf(row[keys.cashPoint]),
        },
      ];
    });
  return {
    branchId: storedIdOf(values[keys.branch]),
    lines,
    countLines,
    reasonKey: storedIdOf(values[keys.reason]),
    refund: storedIdOf(values[keys.refund]) === SALE_REVERSAL_REFUND.yes,
    refundShiftId: storedIdOf(values[keys.refundShift]),
    refundAmount: numberOf(values[keys.refundAmount]),
    note: textOf(values[keys.note]),
  };
}

/** 現金更正單的存值 → 規則用的值。 */
export function cashCorrectionValuesOf(
  values: Record<string, unknown>,
): CashCorrectionValues {
  const keys = CASH_CORRECTION_FIELD_KEYS;
  return {
    branchId: storedIdOf(values[keys.branch]),
    direction: oneOf(
      CASH_CORRECTION_DIRECTION,
      storedIdOf(values[keys.direction]),
    ),
    amount: numberOf(values[keys.amount]),
    place: oneOf(CASH_CORRECTION_PLACE, storedIdOf(values[keys.place])),
    shiftId: storedIdOf(values[keys.shift]),
    attributedShiftId: storedIdOf(values[keys.attributedShift]),
    reasonKey: storedIdOf(values[keys.reason]),
    note: textOf(values[keys.note]),
  };
}

/** 現金更正對位置的影響:增加 +、減少 −。 */
export function signedCorrectionAmount(
  direction: CashCorrectionDirection,
  amount: number,
): number {
  return direction === CASH_CORRECTION_DIRECTION.increase ? amount : -amount;
}

/** 退款金額 = 這些張數的面額合計(規格 8.5)。 */
export function saleReversalRefundAmountOf(
  lines: readonly { unitPrice: number; tickets: number }[],
): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.tickets, 0);
}

/** 撤銷售出申請送出前的值檢查(張數、原因、退款班次);回第一個不合的欄位 key,合格 = null。 */
export function saleReversalProblemOf(values: SaleReversalValues): {
  field: string;
} | null {
  const keys = SALE_REVERSAL_FIELD_KEYS;
  if (values.branchId === null) {
    return { field: keys.branch };
  }
  if (
    values.lines.length + values.countLines.length === 0 ||
    values.lines.some(
      (line) =>
        line.ticketNos.length === 0 || line.tickets !== line.ticketNos.length,
    ) ||
    values.countLines.some(
      (line) =>
        line.gameId === null ||
        line.cashPointId === null ||
        !Number.isInteger(line.count) ||
        line.count < 1,
    )
  ) {
    return { field: keys.lines };
  }
  if (values.reasonKey === null) {
    return { field: keys.reason };
  }
  if (values.refund && values.refundShiftId === null) {
    return { field: keys.refundShift };
  }
  return null;
}

/** 現金更正單送出前的值檢查;回第一個不合的欄位 key,合格 = null。 */
export function cashCorrectionProblemOf(values: CashCorrectionValues): {
  field: string;
} | null {
  const keys = CASH_CORRECTION_FIELD_KEYS;
  if (values.branchId === null) {
    return { field: keys.branch };
  }
  if (values.direction === null) {
    return { field: keys.direction };
  }
  if (!Number.isInteger(values.amount) || values.amount <= 0) {
    return { field: keys.amount };
  }
  if (values.place === null) {
    return { field: keys.place };
  }
  if (
    values.place === CASH_CORRECTION_PLACE.drawer &&
    values.shiftId === null
  ) {
    return { field: keys.shift };
  }
  if (values.reasonKey === null) {
    return { field: keys.reason };
  }
  if (values.note === null) {
    return { field: keys.note };
  }
  return null;
}

/** 時刻 → 租戶時區的 `MM/DD HH:mm`。 */
function monthDayTimeOf(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((one) => one.type === type)?.value ?? "";
  return `${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}

/**
 * 收銀班次的顯示名稱(開班時存進 `lottery_shifts.label`,lookup 來源 `lottery_shift` 的顯示欄;
 * 撤銷售出申請的退款班次、現金更正單的位置 / 歸屬班次用):`店內櫃台 · 李小華 10/21 13:00`。
 */
export function shiftLabelOf(shift: {
  cashPointName: string;
  ownerName: string;
  openedAt: Date;
  timezone: string;
}): string {
  return `${shift.cashPointName} · ${shift.ownerName} ${monthDayTimeOf(shift.openedAt, shift.timezone)}`;
}
