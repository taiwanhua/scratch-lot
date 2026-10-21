/**
 * 店面管理(`store`)的模組 key、權限 key、分頁與規則(專案規格 3.1、3.2、6.1、6.2、6.6;權限表正本
 * `docs/modules/project/store.md`)。seed 宣告、api 守門、admin 判斷都引用這裡,不另寫字面值。
 */
export const STORE_KEY = "store";

/** 模組樹:表單模組主節點 + 表單引擎的三個隱藏頁(`formModuleDeclaration`)。 */
export const STORE_MODULE_KEYS = {
  list: STORE_KEY,
  viewPage: `${STORE_KEY}.view-page`,
  createPage: `${STORE_KEY}.create-page`,
  editPage: `${STORE_KEY}.edit-page`,
} as const;

/**
 * 個別權限(規格 3.2;wildcard 由 seed 自動產生)。表單模組固定四條 + 頁內權限;
 * 開啟 B9b,`create-<formKey>` 由各表單發布時自動建立(不在這裡)。
 */
export const STORE_PERMISSIONS = {
  view: `${STORE_KEY}.view`,
  create: `${STORE_KEY}.create`,
  edit: `${STORE_KEY}.edit`,
  delete: `${STORE_KEY}.delete`,
  sell: `${STORE_KEY}.sell`,
  undoSale: `${STORE_KEY}.undo-sale`,
  split: `${STORE_KEY}.split`,
  move: `${STORE_KEY}.move`,
  redeem: `${STORE_KEY}.redeem`,
  undoRedeem: `${STORE_KEY}.undo-redeem`,
  openShift: `${STORE_KEY}.open-shift`,
  deposit: `${STORE_KEY}.deposit`,
  withdraw: `${STORE_KEY}.withdraw`,
  bankDeposit: `${STORE_KEY}.bank-deposit`,
  stocktake: `${STORE_KEY}.stocktake`,
  checkout: `${STORE_KEY}.checkout`,
  skipStocktake: `${STORE_KEY}.skip-stocktake`,
  confirmLost: `${STORE_KEY}.confirm-lost`,
} as const;

/** 頁內分頁的值(`?tab=`;規格 6.1 的順序)。各功能只追加自己那一個。 */
export const STORE_TABS = {
  board: "board",
  checkouts: "checkouts",
  stocktakes: "stocktakes",
  saleReversals: "sale-reversals",
  cashCorrections: "cash-corrections",
  redemptions: "redemptions",
  otherForms: "other-forms",
} as const;

/** 看板頻道登記的 key(api `project/realtime-boards.ts`、admin `useRealtimeBoard` 共用)。 */
export const STORE_BOARD_KEY = "store-board";

/** 看板頻道的信號類型(`board:<分店>` 頻道上送;每 2 秒合併,RT-05)。 */
export const STORE_BOARD_SIGNAL = "board";

/**
 * 卡片「剩很少」的門檻:剩餘 ≤ 總張數的 10%(規格 6.2 只寫「剩很少的提示」,沒有給數字;
 * Figma ST-01 的例子 6 / 100 有提示、10 / 25 沒有)。總張數 0 不提示。
 */
export const LOW_STOCK_RATIO = 0.1;

export function isLowStock(remaining: number, total: number): boolean {
  return total > 0 && remaining > 0 && remaining <= total * LOW_STOCK_RATIO;
}

/** 這個收銀點的上一班(依開班時間最近的一班;沒有 = 從來沒開過班)。 */
export interface PreviousShiftState {
  /** 上一班已送出交班結帳(班已結束)。 */
  closed: boolean;
  /** 上一班已被送出的日結涵蓋計算。 */
  coveredByDailyClose: boolean;
  /** 上一班「留給下一班」(交班結帳填的;還沒有資料 = 0)。 */
  leftForNext: number;
}

/** 期初零用金怎麼來(規格 6.6)。 */
export type OpeningFloatPlan =
  | {
      /** 第一班:開班時「從小金庫領零用金」(選填,沒領 = 0)。 */
      kind: "first";
    }
  | {
      /** 其他班:上一班「留給下一班」(唯讀)。 */
      kind: "handover";
      amount: number;
    };

/**
 * 第一班 = 沒有上一班,或上一班已被日結涵蓋計算(那張日結已送出);其他 = 上一班留給下一班(規格 6.6)。
 * 例:上一班已交班、留給下一班 2,000、還沒日結 → `{ kind: "handover", amount: 2000 }`。
 */
export function openingFloatPlanOf(
  previous: PreviousShiftState | null,
): OpeningFloatPlan {
  if (previous === null || previous.coveredByDailyClose) {
    return { kind: "first" };
  }
  return { kind: "handover", amount: Math.max(0, previous.leftForNext) };
}
