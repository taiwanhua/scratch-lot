import {
  type StocktakeDraft,
  parseStocktakeDraft,
  serializeStocktakeDraft,
} from "./stocktake";
import { STORE_KEY } from "./store";

/**
 * 交班結帳 `lottery_checkouts` 與結帳確認申請(專案規格 6.9、8.7、6.0;正本 `docs/modules/project/store.md`
 * 「交班結帳」)。api 的送出檢查 / 寫入與 admin 的交班精靈共用這裡的規則,不另寫字面值。
 *
 * - **精靈一次做完**:步驟間的資料只在畫面上(`CheckoutDraft`),[送出] 時一次寫入結帳單、盤點單與結帳確認申請
 * - **應有現金只從紀錄加總**(`expectedCashTotalOf`),每一項帶正負號、可點回單據
 * - **交接**:留給下一班 > 0 時接班人必填;沒有接班人 → 留給下一班必須是 0
 */

/** 結帳確認申請的表單代號(交班與日結同一張表單,`type` 欄位分;B9b 權限 `store.create-checkout_confirm`)。 */
export const CHECKOUT_CONFIRM_FORM_KEY = "checkout_confirm";

/** 結帳確認申請的 B9b 新增權限(表單發布時自動建立)。 */
export const CHECKOUT_CREATE_PERMISSION = `${STORE_KEY}.create-${CHECKOUT_CONFIRM_FORM_KEY}`;

/** 結帳確認申請的欄位 key(受管表單 `seeds/project/revisions/checkout_confirm.r2.seed.ts`)。 */
export const CHECKOUT_FIELD_KEYS = {
  /** 分店(reference org;流程第 2 關「店長限定分店」的對象) */
  branch: "branch",
  /** 類型(select:交班 / 日結;流程兩關的跳過條件看它) */
  type: "type",
  /** 收銀點名稱(文字,顯示用;日結為空) */
  cashPoint: "cash_point",
  /** 接班人(reference user;流程第 1 關的審核者 = 它;沒有接班人 = 空) */
  successor: "successor",
  /** 應有 / 實點 / 差額 / 留給下一班(數字,顯示用;精靈送出時帶入) */
  expected: "expected",
  counted: "counted",
  difference: "difference",
  leftForNext: "left_for_next",
  /** 說明 */
  note: "note",
  /** 結帳內容(系統;`serializeCheckoutDraft` 的 JSON,唯讀時不顯示) */
  draft: "draft",
} as const;

/** 結帳類型:交班 / 日結。 */
export const CHECKOUT_TYPES = ["shift", "daily"] as const;
export type CheckoutType = (typeof CHECKOUT_TYPES)[number];

export const CHECKOUT_TYPE = {
  shift: "shift",
  daily: "daily",
} as const satisfies Record<string, CheckoutType>;

/** 結帳單狀態:待核准 → 已確認;退回 → 已退回(駁回、作廢一律擋下,所以沒有那兩種)。 */
export const CHECKOUT_STATUSES = ["pending", "confirmed", "returned"] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

export const CHECKOUT_STATUS = {
  pending: "pending",
  confirmed: "confirmed",
  returned: "returned",
} as const satisfies Record<string, CheckoutStatus>;

/** 精靈第 ① 步的盤點方式:沿用 30 分鐘內的盤點 / 現在盤點 / 跳過(`store.skip-stocktake`,原因必填)。 */
export const CHECKOUT_STOCKTAKE_MODES = ["reuse", "new", "skip"] as const;
export type CheckoutStocktakeMode = (typeof CHECKOUT_STOCKTAKE_MODES)[number];

/** 「沿用 30 分鐘內的盤點」的門檻(分鐘;規格 6.9)。 */
export const STOCKTAKE_REUSE_MINUTES = 30;

/** 實點依面額清點的面額表(Figma `Draft/DenominationCount` 64:366;由大到小)。 */
export const CHECKOUT_DENOMINATIONS: readonly number[] = [
  1000, 500, 100, 50, 10, 5, 1,
];

/**
 * 應有現金的各項(規格 6.9 公式的順序):期初 + 銷售 − 兌獎 − 投庫 + 出庫 − 調貨支出 + 調貨收入 − 退貨退款 ± 現金更正。
 * 金額一律帶正負號(流入抽屜 +、流出 −),只算已完成的單據;事後更正不算。
 * 日結的小金庫應有(規格 6.10 第 ③ 步)用同一組:期初(上次日結清點)+ 投庫 − 出庫 ± 調貨 ± 現金更正 − 存銀行
 * (金額以流入小金庫 +、流出 −;`daily-close.ts` 的 `VAULT_CASH_ITEM_KINDS`)。
 */
export const EXPECTED_CASH_ITEM_KINDS = [
  "opening",
  "sales",
  "redemptions",
  "deposits",
  "withdrawals",
  "transfer_out",
  "transfer_in",
  "refunds",
  "corrections",
  // 小金庫(日結第 ③ 步):調貨(現金,支出 / 收入合計)、存銀行
  "transfers",
  "bank_deposits",
] as const;
export type ExpectedCashItemKind = (typeof EXPECTED_CASH_ITEM_KINDS)[number];

/** 結帳確認申請擋下的原因(api 的 `extensions.reason`)。 */
export const CHECKOUT_REASONS = {
  /** 結帳內容看不懂 / 與這一班對不上 */
  invalid: "CHECKOUT_DRAFT_INVALID",
  /** 沒有 `store.checkout`、不是負責人也不是店長、跳過盤點沒有 `store.skip-stocktake` */
  forbidden: "CHECKOUT_FORBIDDEN",
  /** 這一班已送出交班結帳 */
  shiftClosed: "CHECKOUT_SHIFT_CLOSED",
  /** 這一班已有審核中的結帳確認申請 */
  pendingExists: "CHECKOUT_PENDING_EXISTS",
  /** 沿用的盤點不存在、不是這個收銀點(或全店)的、或超過 30 分鐘 */
  stocktakeNotReusable: "CHECKOUT_STOCKTAKE_NOT_REUSABLE",
  /** 跳過盤點沒有原因 / 差額不為 0 沒有原因 */
  reasonRequired: "CHECKOUT_REASON_REQUIRED",
  /** 沒有接班人時留給下一班必須是 0(留給下一班 > 0 要有接班人) */
  leftMustBeZero: "CHECKOUT_LEFT_MUST_BE_ZERO",
  /** 留給下一班超過實點(留給下一班的零用金是實點裡的錢) */
  leftExceedsCounted: "CHECKOUT_LEFT_EXCEEDS_COUNTED",
  /** 接班人是申請人或這一班的負責人(接班人 = 下一班的人) */
  successorSelf: "CHECKOUT_SUCCESSOR_SELF",
  /** 接班人不是這家店的人 */
  successorInvalid: "CHECKOUT_SUCCESSOR_INVALID",
  /** 結帳確認申請不能駁回 / 作廢(只能退回) */
  rejectForbidden: "CHECKOUT_REJECT_FORBIDDEN",
  voidForbidden: "CHECKOUT_VOID_FORBIDDEN",
} as const;

// ---- 結帳內容(畫面狀態;送出時才寫) ----

export interface CheckoutDenomination {
  value: number;
  count: number;
}

export type CheckoutStocktakeChoice =
  /** 沿用 30 分鐘內的盤點(那張盤點確認申請 / 結帳確認申請的提交 id) */
  | { mode: "reuse"; submissionId: string }
  /** 現在盤點(只盤這個收銀點) */
  | { mode: "new"; draft: StocktakeDraft }
  /** 跳過(`store.skip-stocktake`,原因必填,報表永久標示「未盤點」) */
  | { mode: "skip"; reasonKey: string; reasonNote: string | null };

/** 交班精靈的結帳內容(結帳確認申請的 `draft` 欄位)。 */
export interface CheckoutDraft {
  version: 1;
  /** 交班(日結的結帳內容是 `DailyCloseDraft`,`daily-close.ts`) */
  type: "shift";
  orgId: string;
  shiftId: string;
  cashPointId: string;
  stocktake: CheckoutStocktakeChoice;
  /** 實點(依面額清點;沒填的面額可以不列) */
  denominations: CheckoutDenomination[];
  /** 差額原因(欄位管理「結帳差額原因」);差額為 0 時 null */
  diffReasonKey: string | null;
  diffReasonNote: string | null;
  leftForNext: number;
  /** 接班人(使用者 id);沒有 = null */
  successorId: string | null;
}

export type ParsedCheckoutDraft =
  { ok: true; draft: CheckoutDraft } | { ok: false; problem: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const optionalText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** 盤點方式(交班 / 日結的結帳內容共用);形狀不對 → null。 */
export function parseStocktakeChoice(
  value: unknown,
): CheckoutStocktakeChoice | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value.mode) {
    case "reuse": {
      return isText(value.submissionId)
        ? { mode: "reuse", submissionId: value.submissionId }
        : null;
    }
    case "new": {
      const parsed = parseStocktakeDraft(value.draft);
      return parsed.ok ? { mode: "new", draft: parsed.draft } : null;
    }
    case "skip": {
      return isText(value.reasonKey)
        ? {
            mode: "skip",
            reasonKey: value.reasonKey,
            reasonNote: optionalText(value.reasonNote),
          }
        : null;
    }
    default: {
      return null;
    }
  }
}

/** 依面額清點(交班 / 日結共用);形狀不對 → null。 */
export function parseDenominations(
  value: unknown,
): CheckoutDenomination[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const rows: CheckoutDenomination[] = [];
  for (const raw of value as unknown[]) {
    if (!isRecord(raw) || !isCount(raw.value) || !isCount(raw.count)) {
      return null;
    }
    rows.push({ value: raw.value, count: raw.count });
  }
  return rows;
}

/** 讀結帳內容(表單欄位的 JSON 文字或物件);形狀不對 → `{ ok: false }`。 */
export function parseCheckoutDraft(raw: unknown): ParsedCheckoutDraft {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, problem: "not_json" };
    }
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.type !== CHECKOUT_TYPE.shift ||
    !isText(value.orgId) ||
    !isText(value.shiftId) ||
    !isText(value.cashPointId) ||
    typeof value.leftForNext !== "number" ||
    !(value.successorId === null || isText(value.successorId))
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
  return {
    ok: true,
    draft: {
      version: 1,
      type: "shift",
      orgId: value.orgId,
      shiftId: value.shiftId,
      cashPointId: value.cashPointId,
      stocktake,
      denominations,
      diffReasonKey: optionalText(value.diffReasonKey),
      diffReasonNote: optionalText(value.diffReasonNote),
      leftForNext: value.leftForNext,
      successorId: value.successorId,
    },
  };
}

/** 結帳內容 → 表單欄位的 JSON 文字(盤點內容也一併序列化成同一份 JSON)。 */
export function serializeCheckoutDraft(draft: CheckoutDraft): string {
  return JSON.stringify({
    ...draft,
    stocktake: stocktakeChoiceJsonOf(draft.stocktake),
  });
}

/** 盤點方式 → 可 JSON 化的物件(現在盤點的盤點內容照盤點的序列化;交班 / 日結共用)。 */
export function stocktakeChoiceJsonOf(
  choice: CheckoutStocktakeChoice,
): unknown {
  return choice.mode === "new"
    ? {
        mode: "new",
        draft: JSON.parse(serializeStocktakeDraft(choice.draft)) as unknown,
      }
    : choice;
}

// ---- 計算 ----

/** 實點 = Σ 面額 × 張數。 */
export function countedTotalOf(
  denominations: readonly CheckoutDenomination[],
): number {
  return denominations.reduce((sum, row) => sum + row.value * row.count, 0);
}

/** 應有現金 = 各項金額加總(每項已帶正負號)。 */
export function expectedCashTotalOf(
  items: readonly { kind: ExpectedCashItemKind; amount: number }[],
): number {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

/** 差額 = 實點 − 應有;不為 0 時原因必填(欄位管理「結帳差額原因」)。 */
export function isDiffReasonRequired(difference: number): boolean {
  return difference !== 0;
}

export type CheckoutHandoverProblem =
  "invalid_amount" | "must_be_zero" | "exceeds_counted";

/**
 * 交接的檢查(規格 6.9):留給下一班是非負整數、不超過實點(留給下一班的零用金是實點裡的錢);> 0 時接班人必填;
 * 沒有接班人時必須是 0(錢先投庫)。合格 = null。
 */
export function checkoutHandoverProblemOf(handover: {
  leftForNext: number;
  successorId: string | null;
  /** 實點(給了才檢查上限) */
  counted?: number;
}): CheckoutHandoverProblem | null {
  if (!Number.isInteger(handover.leftForNext) || handover.leftForNext < 0) {
    return "invalid_amount";
  }
  if (
    handover.counted !== undefined &&
    handover.leftForNext > handover.counted
  ) {
    return "exceeds_counted";
  }
  if (handover.successorId === null && handover.leftForNext > 0) {
    return "must_be_zero";
  }
  return null;
}

/** 這一刻能不能沿用那次盤點:開始盤的時間在 30 分鐘內。 */
export function isStocktakeReusable(startedAt: Date, now: Date): boolean {
  const age = now.getTime() - startedAt.getTime();
  return age >= 0 && age <= STOCKTAKE_REUSE_MINUTES * 60_000;
}
