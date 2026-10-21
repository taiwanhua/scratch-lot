import {
  type SettlementButton,
  type SettlementSideTotals,
  paidNetOf,
  payeeDefaultAmount,
  payerDefaultAmount,
  receivedNetOf,
} from "../lottery-accounts/settlement";
import { purchaseAmountOf } from "./purchase";
import { formatTicketNo, parseTicketInput } from "./ticket-code";

/**
 * 調貨單(專案規格 8.4、第 9 章;正本 `docs/modules/project/purchasing.md`「調貨單」):api 的掛接點 / 點收 /
 * 收付登記與 admin 的新增頁、檢視頁共用的常數與純函式 —— 表單代號 / 欄位 key、權限、收付的兩邊、
 * 明細存值 → 明細列、金額、張號區段的存值格式、四顆收付按鈕的先填值、核准前「三個數字相等」的檢查。
 */

/** 調貨單綁定的模組與表單代號(規格 2.1)。 */
export const TRANSFER_MODULE_KEY = "purchasing.transfer";
export const TRANSFER_FORM_KEY = "transfer";

/** 受管表單 `transfer` 的欄位 key(`seeds/project/revisions/transfer.r3.seed.ts`)。 */
export const TRANSFER_FIELD_KEYS = {
  /** 出貨分店(組織引用) */
  fromBranch: "from_branch",
  /** 收貨分店(組織引用;不能和出貨分店相同) */
  toBranch: "to_branch",
  /** 叫貨單單號(選填;收貨分店、待購買的叫貨單,例 `R-0042`) */
  requisition: "requisition",
  /** 備註 */
  note: "note",
  /** 明細 */
  lines: "lines",
  /** 明細子欄:遊戲(引用 `lottery_game`) */
  game: "game",
  /** 明細子欄:本(引用 `lottery_book`,在出貨店、未被鎖定) */
  book: "book",
  /** 明細子欄:方式(整本 / 選張) */
  mode: "mode",
  /** 明細子欄:張號(區段文字,例 `012-016,020`;整本 = 這本的起訖) */
  ticketNos: "ticket_nos",
  /** 明細子欄:張數 */
  tickets: "tickets",
  /** 明細子欄:金額(整本 = 整本金額;選張 = 面額 × 張數) */
  amount: "amount",
  /** 明細子欄:批購金額率(整數 %;預設這一本的成本率) */
  rate: "rate",
  /** 明細子欄:批購金額(列內公式 = 金額 × 批購金額率) */
  purchaseAmount: "purchase_amount",
  /** 調貨金額(計算欄 = 批購金額合計) */
  transferTotal: "transfer_total",
} as const;

/** 明細的方式:整本 / 選張(只有拆過的本能選張,要 `partial-tickets`)。 */
export const TRANSFER_MODE = { whole: "whole", partial: "partial" } as const;
export type TransferMode = (typeof TRANSFER_MODE)[keyof typeof TRANSFER_MODE];

/** 調貨單的權限(表單四條 + 頁內三條;規格 3.2)。 */
export const TRANSFER_PERMISSIONS = {
  view: `${TRANSFER_MODULE_KEY}.view`,
  create: `${TRANSFER_MODULE_KEY}.create`,
  edit: `${TRANSFER_MODULE_KEY}.edit`,
  delete: `${TRANSFER_MODULE_KEY}.delete`,
  /** 零碎張數(選張) */
  partialTickets: `${TRANSFER_MODULE_KEY}.partial-tickets`,
  /** 收貨店 [付款] [收到退款] [沖正] */
  pay: `${TRANSFER_MODULE_KEY}.pay`,
  /** 出貨店 [收款] [退款] [沖正] */
  receive: `${TRANSFER_MODULE_KEY}.receive`,
} as const;

/** 收付機制的兩邊(規格 9 表):收貨店(付款方)、出貨店(收款方)。 */
export const TRANSFER_SETTLEMENT_SIDE = {
  receiver: "receiver",
  shipper: "shipper",
} as const;

/** 明細的一列(存值正規化後)。 */
export interface TransferLineValue {
  rowId: string;
  gameId: string | null;
  bookId: string;
  mode: TransferMode;
  /** 選張的張號(3 位、排序去重);整本 = 空陣列(以這本在出貨店的張為準)。 */
  ticketNos: string[];
  tickets: number;
  amount: number;
  rate: number;
  /** 批購金額 = 金額 × 批購金額率,四捨五入到元(不讀存值的計算欄)。 */
  purchaseAmount: number;
}

/** 單頭(引用欄取 id)。 */
export interface TransferHeader {
  fromBranchId: string | null;
  toBranchId: string | null;
  /** 叫貨單單號(去空白);沒填 = null。 */
  requisitionNo: string | null;
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

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function numberOf(value: unknown): number {
  const number =
    typeof value === "number" ? value : Number(value ?? Number.NaN);
  return Number.isFinite(number) ? number : 0;
}

const RANGE_PATTERN = /^#?(\d{1,3})(?:\s*[-–~]\s*#?(\d{1,3}))?$/;

/**
 * 張號區段文字 → 張號(3 位、排序去重):`012-016,020`、`#012–016、#020`、`12~16 20` 都可以。
 * 看不懂的片段或 0 號 → null(整串不收)。
 */
export function parseTicketNos(text: string): string[] | null {
  const parts = text
    .split(/[,、，\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const numbers = new Set<number>();
  for (const part of parts) {
    const match = RANGE_PATTERN.exec(part);
    if (!match) {
      return null;
    }
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < from) {
      return null;
    }
    for (let value = from; value <= to; value += 1) {
      numbers.add(value);
    }
  }
  return [...numbers]
    .toSorted((left, right) => left - right)
    .map((value) => formatTicketNo(value));
}

/** 張號 → 存值的區段文字(`["012","013","014","020"]` → `012-014,020`)。 */
export function ticketNosText(ticketNos: readonly string[]): string {
  const numbers = [...new Set(ticketNos.map(Number))]
    .filter((value) => Number.isInteger(value) && value > 0)
    .toSorted((left, right) => left - right);
  const ranges: string[] = [];
  let start: number | undefined;
  let previous: number | undefined;
  const flush = (): void => {
    if (start === undefined || previous === undefined) {
      return;
    }
    ranges.push(
      start === previous
        ? formatTicketNo(start)
        : `${formatTicketNo(start)}-${formatTicketNo(previous)}`,
    );
  };
  for (const value of numbers) {
    if (previous !== undefined && value === previous + 1) {
      previous = value;
      continue;
    }
    flush();
    start = value;
    previous = value;
  }
  flush();
  return ranges.join(",");
}

/** 一列的金額:整本 = 整本金額;選張 = 面額 × 張數(規格 8.4 明細)。 */
export function transferLineAmountOf(
  mode: TransferMode,
  game: { bookPrice: number; unitPrice: number },
  tickets: number,
): number {
  return mode === TRANSFER_MODE.whole
    ? game.bookPrice
    : game.unitPrice * tickets;
}

/** 明細存值 → 明細列:沒有 rowId 或沒有本的列略過;批購金額一律重算。 */
export function transferLinesOf(
  values: Record<string, unknown>,
): TransferLineValue[] {
  const rows = values[TRANSFER_FIELD_KEYS.lines];
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row): TransferLineValue[] => {
    if (!isRecord(row) || typeof row.rowId !== "string") {
      return [];
    }
    const bookId = idOf(row[TRANSFER_FIELD_KEYS.book]);
    if (bookId === null) {
      return [];
    }
    const mode =
      idOf(row[TRANSFER_FIELD_KEYS.mode]) === TRANSFER_MODE.partial
        ? TRANSFER_MODE.partial
        : TRANSFER_MODE.whole;
    const rawNos = row[TRANSFER_FIELD_KEYS.ticketNos];
    const ticketNos =
      mode === TRANSFER_MODE.partial && typeof rawNos === "string"
        ? (parseTicketNos(rawNos) ?? [])
        : [];
    const amount = numberOf(row[TRANSFER_FIELD_KEYS.amount]);
    const rate = numberOf(row[TRANSFER_FIELD_KEYS.rate]);
    return [
      {
        rowId: row.rowId,
        gameId: idOf(row[TRANSFER_FIELD_KEYS.game]),
        bookId,
        mode,
        ticketNos,
        tickets: numberOf(row[TRANSFER_FIELD_KEYS.tickets]),
        amount,
        rate,
        purchaseAmount: purchaseAmountOf(amount, rate),
      },
    ];
  });
}

/** 單頭的值。 */
export function transferHeaderOf(
  values: Record<string, unknown>,
): TransferHeader {
  return {
    fromBranchId: idOf(values[TRANSFER_FIELD_KEYS.fromBranch]),
    toBranchId: idOf(values[TRANSFER_FIELD_KEYS.toBranch]),
    requisitionNo: textOf(values[TRANSFER_FIELD_KEYS.requisition]),
  };
}

/** 調貨金額 = 批購金額合計(規格 8.4「合計」)。 */
export function transferTotalOf(lines: readonly TransferLineValue[]): number {
  return lines.reduce((sum, line) => sum + line.purchaseAmount, 0);
}

/** 已點收的批購金額(收貨店 [付款] / [收到退款] 的基準;規格 9 表)。 */
export function receivedTransferAmountOf(
  lines: readonly TransferLineValue[],
  receivedRowIds: ReadonlySet<string>,
): number {
  return transferTotalOf(
    lines.filter((line) => receivedRowIds.has(line.rowId)),
  );
}

/** 單張成本(調入時)= 該列批購金額 ÷ 張數(不四捨五入,一列加總 = 這列的批購金額)。 */
export function transferUnitCostOf(line: TransferLineValue): number {
  return line.tickets > 0 ? line.purchaseAmount / line.tickets : 0;
}

/**
 * 收貨店(付款方)的先填值:[付款](`out`)= 已點收的批購金額 − 已付淨額;
 * [收到退款](`in`)= 已付淨額 − 已點收的批購金額;最少 0(≤ 0 停用)。
 */
export function transferReceiverDefault(
  button: SettlementButton,
  receivedAmount: number,
  receiver: SettlementSideTotals,
): number {
  return payerDefaultAmount(button, receivedAmount, receiver);
}

/**
 * 出貨店(收款方)的先填值:[收款](`in`)= 收貨店已付 − 出貨店已收,**只有**出貨店已收 < 調貨金額
 * 而且差額 > 0 才能按;[退款](`out`)= 出貨店已收 − 調貨金額。
 */
export function transferShipperDefault(
  button: SettlementButton,
  transferAmount: number,
  receiver: SettlementSideTotals,
  shipper: SettlementSideTotals,
): number {
  return payeeDefaultAmount(button, transferAmount, receiver, shipper);
}

/** 核准前三個數字不相等時,哪一邊還沒記 / 記多了。 */
export type TransferSettlementProblem =
  | { kind: "receiver_underpaid"; amount: number }
  | { kind: "shipper_unreceived"; amount: number }
  | { kind: "shipper_overreceived"; amount: number }
  | { kind: "receiver_overpaid"; amount: number };

/**
 * 核准前:收貨店已付淨額 = 出貨店已收淨額 = 調貨金額(規格 8.4「核准前」)。不相等時回下一步該誰記什麼,
 * 順序照收付的先後:收貨店還沒付夠 → 出貨店還沒記收款 → 出貨店多收(先記退款)→ 收貨店多付(記收到退款)。
 */
export function transferSettlementProblemOf(
  transferAmount: number,
  receiver: SettlementSideTotals,
  shipper: SettlementSideTotals,
): TransferSettlementProblem | null {
  const paid = paidNetOf(receiver);
  const received = receivedNetOf(shipper);
  if (paid < transferAmount) {
    return { kind: "receiver_underpaid", amount: transferAmount - paid };
  }
  if (received < transferAmount) {
    return { kind: "shipper_unreceived", amount: transferAmount - received };
  }
  if (received > transferAmount) {
    return { kind: "shipper_overreceived", amount: received - transferAmount };
  }
  if (paid > transferAmount) {
    return { kind: "receiver_overpaid", amount: paid - transferAmount };
  }
  return null;
}

/** 點收刷到的碼:本號 + 張號(背面編號另帶遊戲代號)。看不懂 → null。 */
export interface TransferScan {
  gameCode: string | null;
  bookNo: string;
  ticketNo: string;
}

export function transferScanOf(raw: string): TransferScan | null {
  const parsed = parseTicketInput(raw);
  return parsed === null
    ? null
    : {
        gameCode: parsed.gameCode ?? null,
        bookNo: parsed.bookNo,
        ticketNo: parsed.ticketNo,
      };
}
