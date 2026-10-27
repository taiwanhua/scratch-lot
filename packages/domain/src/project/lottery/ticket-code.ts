/**
 * 刮刮樂編號(專案規格 6.3「輸入方式」、7.1 本號 / 本編號):前後端共用的解析與格式。
 *
 * - 背面編號 `5164-1-056527-099-0-6`:遊戲代號 4 位、印刷版別 1 位、本號 6 位、張號 3 位、
 *   工廠控管碼、終端校驗碼(第 5、6 段**不驗證**,演算法未知)
 * - 正面編號 `056527-099` / `056527099`:本號 6 位 + 張號 3 位
 * - 正面條碼 `0056527099`:本號 7 位 + 張號 3 位
 *
 * 本號一律存 7 位(`^\d{7}$`,6 位自動補 0);開頭是 0 時顯示 6 位。
 */

/** 本號(存的格式):7 位數字。 */
export const BOOK_NO_PATTERN = /^\d{7}$/;

/** 張號:3 位數字字串(起號 "001")。 */
export const TICKET_NO_PATTERN = /^\d{3}$/;

/** 迄號上限(本的迄號 ≥ 標準張數且 ≤ 999)。 */
export const LAST_TICKET_NO_MAX = 999;

/** 起號(一律 001)。 */
export const FIRST_TICKET_NO = "001";

/** 輸入格式:背面編號 / 正面編號 / 正面條碼。 */
export type TicketInputFormat = "back" | "front" | "barcode";

/** 解析結果;沒有遊戲代號時由呼叫端依本店對到的遊戲決定(規格 6.3)。 */
export interface ParsedTicketInput {
  format: TicketInputFormat;
  /** 遊戲代號(只有背面編號有)。 */
  gameCode?: string;
  /** 印刷版別(只有背面編號有)。 */
  printVersion?: string;
  /** 本號 7 位。 */
  bookNo: string;
  /** 張號 3 位。 */
  ticketNo: string;
}

const BACK_PATTERN =
  /^(\d{4})-(\d)-(\d{6})-(\d{3})-([0-9A-Za-z]+)-([0-9A-Za-z]+)$/;
const FRONT_DASH_PATTERN = /^(\d{6})-(\d{3})$/;
const FRONT_PATTERN = /^(\d{6})(\d{3})$/;
const BARCODE_PATTERN = /^(\d{7})(\d{3})$/;

/** 6 位或 7 位本號 → 7 位(6 位補 0);其他 → null。 */
export function normalizeBookNo(raw: string): string | null {
  const value = raw.trim();
  if (/^\d{6}$/.test(value)) {
    return `0${value}`;
  }
  return BOOK_NO_PATTERN.test(value) ? value : null;
}

/** 顯示用本號:開頭是 0 時顯示 6 位(`0056527` → `056527`)。 */
export function displayBookNo(bookNo: string): string {
  return bookNo.startsWith("0") ? bookNo.slice(1) : bookNo;
}

/** 張號數字 → 3 位字串(12 → "012")。 */
export function formatTicketNo(ticketNo: number): string {
  return String(ticketNo).padStart(3, "0");
}

/** 本編號(租戶內唯一):`5164-0056527`。 */
export function bookKeyOf(gameCode: string, bookNo: string): string {
  return `${gameCode}-${bookNo}`;
}

/** 顯示用本編號:`5164-056527`。 */
export function displayBookKey(gameCode: string, bookNo: string): string {
  return `${gameCode}-${displayBookNo(bookNo)}`;
}

/** 張編號(租戶內唯一):`5164-0056527-001`。 */
export function ticketKeyOf(
  gameCode: string,
  bookNo: string,
  ticketNo: string,
): string {
  return `${bookKeyOf(gameCode, bookNo)}-${ticketNo}`;
}

/** 顯示用張編號:`5164-056527-012`。 */
export function displayTicketKey(
  gameCode: string,
  bookNo: string,
  ticketNo: string,
): string {
  return `${displayBookKey(gameCode, bookNo)}-${ticketNo}`;
}

/**
 * 解析使用者輸入或條碼槍 / 相機讀到的碼;前後空白忽略。不是四種格式之一 → null。
 * 張號 000 不存在(起號 001)→ null。
 */
export function parseTicketInput(raw: string): ParsedTicketInput | null {
  const value = raw.trim();
  const result = parseValue(value);
  return result !== null && result.ticketNo !== "000" ? result : null;
}

function parseValue(value: string): ParsedTicketInput | null {
  const back = BACK_PATTERN.exec(value);
  if (back) {
    const [, gameCode, printVersion, bookNo, ticketNo] = back;
    return {
      format: "back",
      gameCode,
      printVersion,
      bookNo: `0${bookNo ?? ""}`,
      ticketNo: ticketNo ?? "",
    };
  }
  const front = FRONT_DASH_PATTERN.exec(value) ?? FRONT_PATTERN.exec(value);
  if (front) {
    const [, bookNo, ticketNo] = front;
    return {
      format: "front",
      bookNo: `0${bookNo ?? ""}`,
      ticketNo: ticketNo ?? "",
    };
  }
  const barcode = BARCODE_PATTERN.exec(value);
  if (barcode) {
    const [, bookNo, ticketNo] = barcode;
    return {
      format: "barcode",
      bookNo: bookNo ?? "",
      ticketNo: ticketNo ?? "",
    };
  }
  return null;
}

/**
 * 不連號的張號以區段顯示(規格 7.5):`["012","013","014","015","016","020"]` → `#012–016、#020`。
 * 先排序去重;空陣列 → 空字串。
 */
export function formatTicketRanges(ticketNos: readonly string[]): string {
  const numbers = [...new Set(ticketNos.map(Number))]
    .filter((value) => Number.isInteger(value))
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
        ? `#${formatTicketNo(start)}`
        : `#${formatTicketNo(start)}–${formatTicketNo(previous)}`,
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
  return ranges.join("、");
}
