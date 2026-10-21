import { bookKeyOf, normalizeBookNo, parseTicketInput } from "./ticket-code";

/**
 * 進貨單(專案規格 8.2、8.3;正本 `docs/modules/project/purchasing.md`「進貨單」):api 的掛接點 / 點收 /
 * 收付登記與 admin 的新增頁、檢視頁共用的常數與純函式 —— 表單代號 / 欄位 key、明細存值 → 明細列、
 * 批購金額、應付、依遊戲分組、同單本號重複、點收刷條碼的比對、點收進度與「這一次」。
 */

/** 進貨單綁定的模組與表單代號(規格 2.1)。 */
export const PURCHASE_MODULE_KEY = "purchasing.purchase";
export const PURCHASE_FORM_KEY = "purchase";

/** 受管表單 `purchase` 的欄位 key(`seeds/project/revisions/purchase.r3.seed.ts`)。 */
export const PURCHASE_FIELD_KEYS = {
  /** 進貨分店(組織引用) */
  branch: "branch",
  /** 叫貨單單號(選填;同一家分店、待購買的叫貨單,例 `R-0042`) */
  requisition: "requisition",
  /** 批購甲類(引用 `lottery_dealer`,type = a、營業中) */
  dealer: "dealer",
  /** 本人批購(是 / 否) */
  selfPurchase: "self_purchase",
  /** 批購受託人(本人批購 = 否時必填;引用 `lottery_dealer_contact`) */
  trustee: "trustee",
  /** 批購日期 */
  purchaseDate: "purchase_date",
  /** 扣款帳戶(引用 `lottery_bank_account`,使用中) */
  account: "account",
  /** 備註 */
  note: "note",
  /** 明細 */
  lines: "lines",
  /** 明細子欄:遊戲(引用 `lottery_game`,販售中) */
  game: "game",
  /** 明細子欄:本號(7 位存;輸入 6 位補 0) */
  bookNo: "book_no",
  /** 明細子欄:最後張號 */
  lastTicketNo: "last_ticket_no",
  /** 明細子欄:張數(遊戲的整本張數,帶入) */
  tickets: "tickets",
  /** 明細子欄:整本金額(帶入) */
  bookPrice: "book_price",
  /** 明細子欄:批購金額率(整數 %;預設遊戲的值,可逐本改) */
  rate: "rate",
  /** 明細子欄:批購金額(列內公式 = 整本金額 × 批購金額率) */
  amount: "amount",
  /** 批購合計(計算欄) */
  purchaseTotal: "purchase_total",
  /** 扣款金額(計算欄 = 批購合計 − 兌獎折抵;這張單的應付) */
  deductedAmount: "deducted_amount",
  /** 兌獎(勾選這次拿去兌獎的兌獎紀錄;明細欄,r3 起) */
  redemptions: "redemptions",
  /** 兌獎子欄:兌獎紀錄(引用 `lottery_redemption`,店內持有) */
  redemption: "redemption",
  /** 兌獎子欄:中獎金額(帶入兌獎紀錄的金額) */
  prizeAmount: "prize_amount",
  /** 兌獎金額(計算欄 = 勾選的合計) */
  redemptionTotal: "redemption_total",
  /** 兌獎折抵(計算欄 = 兌獎金額與批購合計取較小者) */
  redemptionOffset: "redemption_offset",
  /** 兌獎剩餘(計算欄 = 兌獎金額 − 兌獎折抵) */
  redemptionRemainder: "redemption_remainder",
} as const;

/** 進貨單勾選的一筆兌獎紀錄(存值正規化後)。 */
export interface PurchaseRedemptionValue {
  rowId: string | null;
  redemptionId: string;
  prizeAmount: number;
}

/** 進貨單的權限(表單四條 + 頁內 `settle`;規格 3.2)。 */
export const PURCHASE_PERMISSIONS = {
  view: `${PURCHASE_MODULE_KEY}.view`,
  create: `${PURCHASE_MODULE_KEY}.create`,
  edit: `${PURCHASE_MODULE_KEY}.edit`,
  delete: `${PURCHASE_MODULE_KEY}.delete`,
  settle: `${PURCHASE_MODULE_KEY}.settle`,
} as const;

/** 收付機制登記的那一邊:總部(規格 9 表)。 */
export const PURCHASE_SETTLEMENT_SIDE = "hq";

/** 明細的一列(存值正規化後)。 */
export interface PurchaseLineValue {
  rowId: string;
  gameId: string;
  /** 7 位本號;格式不對 → null(送出時擋)。 */
  bookNo: string | null;
  lastTicketNo: number;
  tickets: number;
  bookPrice: number;
  rate: number;
  amount: number;
}

/** 單頭(引用欄取 id)。 */
export interface PurchaseHeader {
  branchId: string | null;
  /** 叫貨單單號(去空白);沒填 = null。 */
  requisitionNo: string | null;
  dealerId: string | null;
  selfPurchase: boolean;
  trusteeId: string | null;
  purchaseDate: Date | null;
  accountId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 引用欄的存值(`{ id, label }` 或 id 字串)→ id。 */
function idOf(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (isRecord(value) && typeof value.id === "string" && value.id !== "") {
    return value.id;
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

function dateOf(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value !== "string" || value === "") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 批購金額 = 整本金額 × 批購金額率(整數 %),四捨五入到元。 */
export function purchaseAmountOf(bookPrice: number, rate: number): number {
  return Math.round((bookPrice * rate) / 100);
}

/** 明細存值 → 明細列:沒有 rowId 或沒有遊戲的列略過;本號 6 位補 0、格式不對 → null。 */
export function purchaseLinesOf(
  values: Record<string, unknown>,
): PurchaseLineValue[] {
  const rows = values[PURCHASE_FIELD_KEYS.lines];
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row): PurchaseLineValue[] => {
    if (!isRecord(row) || typeof row.rowId !== "string") {
      return [];
    }
    const gameId = idOf(row[PURCHASE_FIELD_KEYS.game]);
    if (gameId === null) {
      return [];
    }
    const rawBookNo = row[PURCHASE_FIELD_KEYS.bookNo];
    return [
      {
        rowId: row.rowId,
        gameId,
        bookNo:
          typeof rawBookNo === "string" ? normalizeBookNo(rawBookNo) : null,
        lastTicketNo: numberOf(row[PURCHASE_FIELD_KEYS.lastTicketNo]),
        tickets: numberOf(row[PURCHASE_FIELD_KEYS.tickets]),
        bookPrice: numberOf(row[PURCHASE_FIELD_KEYS.bookPrice]),
        rate: numberOf(row[PURCHASE_FIELD_KEYS.rate]),
        amount: numberOf(row[PURCHASE_FIELD_KEYS.amount]),
      },
    ];
  });
}

/** 單頭的值。 */
export function purchaseHeaderOf(
  values: Record<string, unknown>,
): PurchaseHeader {
  return {
    branchId: idOf(values[PURCHASE_FIELD_KEYS.branch]),
    requisitionNo: textOf(values[PURCHASE_FIELD_KEYS.requisition]),
    dealerId: idOf(values[PURCHASE_FIELD_KEYS.dealer]),
    selfPurchase: values[PURCHASE_FIELD_KEYS.selfPurchase] === true,
    trusteeId: idOf(values[PURCHASE_FIELD_KEYS.trustee]),
    purchaseDate: dateOf(values[PURCHASE_FIELD_KEYS.purchaseDate]),
    accountId: idOf(values[PURCHASE_FIELD_KEYS.account]),
  };
}

/**
 * 這張單的應付(扣款金額,規格 8.2「合計」):讀計算欄 `deducted_amount`(批購合計 − 兌獎折抵);
 * 沒有時用批購合計(明細批購金額加總)。最少 0。
 */
export function purchasePayableOf(values: Record<string, unknown>): number {
  const amount =
    storedNumberOf(values[PURCHASE_FIELD_KEYS.deductedAmount]) ??
    purchaseLinesOf(values).reduce((sum, line) => sum + line.amount, 0);
  return Math.max(0, Math.round(amount));
}

/** 計算欄的存值:數字,或表單引擎存的十進位字串(`"60000"`);空 / 看不懂 → null。 */
function storedNumberOf(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 同一個遊戲一組(組標題列顯示小計;順序照第一次出現)。 */
export interface PurchaseLineGroup<T extends PurchaseLineValue> {
  gameId: string;
  rows: T[];
  subtotal: number;
}

export function groupPurchaseLines<T extends PurchaseLineValue>(
  lines: readonly T[],
): PurchaseLineGroup<T>[] {
  const groups = new Map<string, PurchaseLineGroup<T>>();
  for (const line of lines) {
    const group = groups.get(line.gameId) ?? {
      gameId: line.gameId,
      rows: [],
      subtotal: 0,
    };
    group.rows.push(line);
    group.subtotal += line.amount;
    groups.set(line.gameId, group);
  }
  return [...groups.values()];
}

/** 同一張單裡重複的本編號(遊戲代號 + 本號);`gameCodeOf` 找不到代號的列不比。 */
export function duplicateBookKeysOf(
  lines: readonly PurchaseLineValue[],
  gameCodeOf: (gameId: string) => string | undefined,
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const line of lines) {
    const gameCode = gameCodeOf(line.gameId);
    if (gameCode === undefined || line.bookNo === null) {
      continue;
    }
    const key = bookKeyOf(gameCode, line.bookNo);
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }
  return [...duplicates];
}

/** 點收刷條碼的比對結果(規格 8.2「點收一本」)。 */
export type ReceiveScanResult =
  | { kind: "invalid" }
  | { kind: "match"; row: PurchaseLineValue }
  | { kind: "already_received"; row: PurchaseLineValue }
  /** 刷到的最後張號和單上不同 → 擋下「請退回更正」 */
  | { kind: "last_ticket_mismatch"; row: PurchaseLineValue }
  /** 單上沒有這本(再查是不是別家店的進貨單:送錯分店) */
  | { kind: "not_on_purchase"; bookNo: string; gameCode: string | null };

/**
 * 刷到的碼(背面編號 / 正面編號 / 正面條碼)對這張單的明細:背面編號有遊戲代號,遊戲 + 本號都要對;
 * 正面的碼沒有遊戲代號,只用本號對。刷的是這本的**最後一張**:張號要等於單上的最後張號。
 */
export function matchReceiveScan(
  lines: readonly PurchaseLineValue[],
  receivedRowIds: ReadonlySet<string>,
  raw: string,
  gameCodeOf: (gameId: string) => string | undefined,
): ReceiveScanResult {
  const parsed = parseTicketInput(raw);
  if (parsed === null) {
    return { kind: "invalid" };
  }
  const gameCode = parsed.gameCode ?? null;
  const row = lines.find(
    (line) =>
      line.bookNo === parsed.bookNo &&
      (gameCode === null || gameCodeOf(line.gameId) === gameCode),
  );
  if (row === undefined) {
    return { kind: "not_on_purchase", bookNo: parsed.bookNo, gameCode };
  }
  if (receivedRowIds.has(row.rowId)) {
    return { kind: "already_received", row };
  }
  return Number(parsed.ticketNo) === row.lastTicketNo
    ? { kind: "match", row }
    : { kind: "last_ticket_mismatch", row };
}

/** 點收進度與「這一次」:這一次 = 上次按 [完成這次點收](或開始點收)之後點收的本。 */
export interface ReceivingSummary<T extends PurchaseLineValue> {
  thisTime: T[];
  notArrived: T[];
  receivedCount: number;
  totalCount: number;
}

export function receivingSummaryOf<T extends PurchaseLineValue>(
  lines: readonly T[],
  receivedRowIds: ReadonlySet<string>,
  thisTimeRowIds: ReadonlySet<string>,
): ReceivingSummary<T> {
  return {
    thisTime: lines.filter(
      (line) =>
        thisTimeRowIds.has(line.rowId) && receivedRowIds.has(line.rowId),
    ),
    notArrived: lines.filter((line) => !receivedRowIds.has(line.rowId)),
    receivedCount: lines.filter((line) => receivedRowIds.has(line.rowId))
      .length,
    totalCount: lines.length,
  };
}

/** 勾選的兌獎紀錄(`redemptions` 存值 → 列;沒有兌獎紀錄 id 的列略過、同一筆只算一次)。 */
export function purchaseRedemptionsOf(
  values: Record<string, unknown>,
): PurchaseRedemptionValue[] {
  const rows = values[PURCHASE_FIELD_KEYS.redemptions];
  if (!Array.isArray(rows)) {
    return [];
  }
  const seen = new Set<string>();
  return rows.flatMap((row): PurchaseRedemptionValue[] => {
    if (!isRecord(row)) {
      return [];
    }
    const redemptionId = idOf(row[PURCHASE_FIELD_KEYS.redemption]);
    if (redemptionId === null || seen.has(redemptionId)) {
      return [];
    }
    seen.add(redemptionId);
    return [
      {
        rowId: typeof row.rowId === "string" ? row.rowId : null,
        redemptionId,
        prizeAmount: numberOf(row[PURCHASE_FIELD_KEYS.prizeAmount]),
      },
    ];
  });
}

/** 兌獎剩餘(計算欄 `redemption_remainder`;沒有時 0)。送出後 > 0 → 記銀行「兌獎入帳」。 */
export function purchaseRedemptionRemainderOf(
  values: Record<string, unknown>,
): number {
  const stored = storedNumberOf(
    values[PURCHASE_FIELD_KEYS.redemptionRemainder],
  );
  return stored === null ? 0 : Math.max(0, Math.round(stored));
}
