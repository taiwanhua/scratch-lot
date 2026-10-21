import {
  type LocalDate,
  localDateOf,
  startOfLocalDay,
} from "../../form/temporal";
import {
  CHECKOUT_TYPE,
  type CheckoutDenomination,
  type CheckoutStocktakeChoice,
  type ExpectedCashItemKind,
  parseDenominations,
  parseStocktakeChoice,
  stocktakeChoiceJsonOf,
} from "./checkout";

/**
 * 日結與存銀行(專案規格 6.10、6.11、8.7、3.4 日結逾期;正本 `docs/modules/project/store.md`「日結與存銀行」)。
 * api 的送出檢查 / 寫入與 admin 的日結精靈、存銀行視窗共用這裡的規則,不另寫字面值。
 *
 * - **日結精靈一次做完**(規格 6.0):步驟間的資料只在畫面上(`DailyCloseDraft`),[送出] 時一次寫入結帳單(類型 = 日結)、
 *   全店盤點單與結帳確認申請
 * - **涵蓋計算期間** = 上一次日結送出 至 這次日結送出;不能補日結;每一班只會被一張日結涵蓋計算
 * - **小金庫**:完成時從清點金額重新起算(起算時間 = 這張日結送出的時間)
 */

/** 日結精靈的五步(規格 6.10:① 各班結帳 → ② 全店盤點 → ③ 小金庫 → ④ 存入銀行 → ⑤ 確認)。 */
export const DAILY_CLOSE_STEPS = [
  "shifts",
  "stocktake",
  "vault",
  "bank",
  "confirm",
] as const;
export type DailyCloseStep = (typeof DAILY_CLOSE_STEPS)[number];

/** 小金庫應有的各項(規格 6.10 第 ③ 步的順序;金額以流入小金庫 +、流出 −)。 */
export const VAULT_CASH_ITEM_KINDS = [
  "opening",
  "deposits",
  "withdrawals",
  "transfers",
  "corrections",
  "bank_deposits",
] as const satisfies readonly ExpectedCashItemKind[];

/** 日結與存銀行擋下的原因(api 的 `extensions.reason`)。 */
export const DAILY_CLOSE_REASONS = {
  /** 這家店還有收銀點的班沒送出交班結帳 */
  shiftsOpen: "DAILY_CLOSE_SHIFTS_OPEN",
  /** 涵蓋計算的交班結帳還有沒核准的 */
  unapproved: "DAILY_CLOSE_UNAPPROVED",
  /** 這家店已有審核中 / 已退回待更正的日結 */
  pendingExists: "DAILY_CLOSE_PENDING_EXISTS",
  /** 存入銀行的金額不合(不是非負整數、超過小金庫實點) */
  depositInvalid: "DAILY_CLOSE_DEPOSIT_INVALID",
  /** 存入銀行 > 0 沒選帳戶、或帳戶不能用(停用、使用組織不含這家店) */
  accountNotUsable: "DAILY_CLOSE_ACCOUNT_NOT_USABLE",
  /** 存銀行:這家店沒有可用的銀行帳戶(Figma ST-26b) */
  noBankAccount: "BANK_DEPOSIT_NO_ACCOUNT",
} as const;

/** 日結精靈的結帳內容(結帳確認申請的 `draft` 欄位,類型 = 日結)。 */
export interface DailyCloseDraft {
  version: 1;
  type: "daily";
  orgId: string;
  /** 全店盤點(現在盤點的範圍是全店:`scopeCashPointId = null`) */
  stocktake: CheckoutStocktakeChoice;
  /** 小金庫實點(依面額清點) */
  denominations: CheckoutDenomination[];
  /** 小金庫差額原因(欄位管理「結帳差額原因」);差額為 0 時 null */
  diffReasonKey: string | null;
  diffReasonNote: string | null;
  /** 存入銀行:金額(0 = 不存)、帳戶(`lottery_bank_account` 的 id;金額 0 時 null) */
  bankDeposit: { amount: number; accountId: string | null };
}

export type ParsedDailyCloseDraft =
  { ok: true; draft: DailyCloseDraft } | { ok: false; problem: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const optionalText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

function jsonOf(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** 結帳內容(表單的 `draft` 欄位)是交班還是日結;讀不懂 = null。 */
export function checkoutDraftTypeOf(raw: unknown): "shift" | "daily" | null {
  const value = jsonOf(raw);
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.type === CHECKOUT_TYPE.shift ||
    value.type === CHECKOUT_TYPE.daily
  ) {
    return value.type;
  }
  return null;
}

/** 讀日結的結帳內容(JSON 文字或物件);形狀不對 → `{ ok: false }`。 */
export function parseDailyCloseDraft(raw: unknown): ParsedDailyCloseDraft {
  const value = jsonOf(raw);
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.type !== CHECKOUT_TYPE.daily ||
    !isText(value.orgId)
  ) {
    return { ok: false, problem: "header" };
  }
  const stocktake = parseStocktakeChoice(value.stocktake);
  if (stocktake === null) {
    return { ok: false, problem: "stocktake" };
  }
  const denominations = parseDenominations(value.denominations);
  if (denominations === null) {
    return { ok: false, problem: "denominations" };
  }
  const deposit = value.bankDeposit;
  if (
    !isRecord(deposit) ||
    typeof deposit.amount !== "number" ||
    !(deposit.accountId === null || isText(deposit.accountId))
  ) {
    return { ok: false, problem: "bankDeposit" };
  }
  return {
    ok: true,
    draft: {
      version: 1,
      type: "daily",
      orgId: value.orgId,
      stocktake,
      denominations,
      diffReasonKey: optionalText(value.diffReasonKey),
      diffReasonNote: optionalText(value.diffReasonNote),
      bankDeposit: { amount: deposit.amount, accountId: deposit.accountId },
    },
  };
}

/** 日結的結帳內容 → 表單欄位的 JSON 文字。 */
export function serializeDailyCloseDraft(draft: DailyCloseDraft): string {
  return JSON.stringify({
    ...draft,
    stocktake: stocktakeChoiceJsonOf(draft.stocktake),
  });
}

export type BankDepositProblem =
  "invalid_amount" | "account_required" | "exceeds_available";

/**
 * 存入銀行的檢查(日結第 ④ 步、[存銀行]):金額是非負整數(日結可以是 0 = 不存;[存銀行] 呼叫端另要求 > 0)、
 * 不超過可存的錢(日結 = 小金庫實點;[存銀行] = 小金庫應有)、> 0 時要選帳戶。合格 = null。
 */
export function bankDepositProblemOf(input: {
  amount: number;
  accountId: string | null;
  /** 可存的上限 */
  available: number;
}): BankDepositProblem | null {
  if (!Number.isInteger(input.amount) || input.amount < 0) {
    return "invalid_amount";
  }
  if (input.amount > input.available) {
    return "exceeds_available";
  }
  if (input.amount > 0 && input.accountId === null) {
    return "account_required";
  }
  return null;
}

// ---- 日期(租戶時區的當地日期;呼叫端先用 `localDateOf` 換好) ----

const dayNumberOf = (date: LocalDate): number =>
  Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);

const dateOfDayNumber = (day: number): LocalDate => {
  const shifted = new Date(day * 86_400_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

/** 當地日期 + N 天。 */
export function addLocalDays(date: LocalDate, days: number): LocalDate {
  return dateOfDayNumber(dayNumberOf(date) + days);
}

/** `to − from` 的日曆日數(頂部「上次日結:10/13(已 3 天)」)。 */
export function localDaysBetween(from: LocalDate, to: LocalDate): number {
  return dayNumberOf(to) - dayNumberOf(from);
}

/**
 * 涵蓋計算期間裡「沒有日結」的日子(畫面「涵蓋計算期間 10/14 09:02 至 現在(10/14、10/15 沒有日結)」):
 * 上一次日結那天起、到今天的前一天(今天還沒過完不算);上一次日結就是今天 → 沒有。沒有上一次日結 → 沒有。
 */
export function dailyCloseGapDates(
  lastClose: LocalDate | null,
  today: LocalDate,
): LocalDate[] {
  if (lastClose === null) {
    return [];
  }
  const from = dayNumberOf(lastClose);
  const to = dayNumberOf(today);
  return Array.from({ length: Math.max(to - from, 0) }, (_, index) =>
    dateOfDayNumber(from + index),
  );
}

/**
 * 日結逾期的時點(規格 3.4、6.10):這家店最早一張還沒被日結涵蓋計算的交班結帳,送出日的**隔天** `time`(`HH:mm`,
 * 租戶時區;通知設定頁可調,預設 09:00)。過了這個時點還沒日結 → 負責人提醒(之後每天一次)、側欄計數。
 */
export function dailyCloseOverdueAt(
  earliestSubmittedAt: Date,
  timezone: string,
  time: string,
): Date {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const nextDay = addLocalDays(
    localDateOf(earliestSubmittedAt.getTime(), timezone),
    1,
  );
  return new Date(
    startOfLocalDay(nextDay, timezone) + (hour * 60 + minute) * 60_000,
  );
}
