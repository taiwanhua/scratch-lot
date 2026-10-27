import type { Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";
import type {
  SettlementButton,
  SettlementMethod,
  SettlementState,
} from "@repo/domain/project/lottery-accounts";

/**
 * 收付機制的單據登記(專案規格第 9 章;正本 `docs/modules/project/accounts.md`「收付機制」)。
 *
 * 進貨單(P18)、調貨單(P19)各登記一筆;本模組不認得任何單據的欄位,應付金額、哪一邊用哪條權限、
 * 可用付款方式、按鈕先填的金額都由登記提供。登記由該單據功能的 Nest provider 在 `onModuleInit` 呼叫
 * (同 `cash-point-deactivation.ts` 的寫法);同一個 `moduleKey` 只能一筆。
 *
 * ```ts
 * registerSettlementDocument({
 *   moduleKey: "purchasing.purchase",
 *   label: "進貨單",
 *   kind: "purchase",
 *   payable: (submission) => ({
 *     amount: deductedOf(submission.values), // 應付(扣款金額)
 *     branchOrgId: storeOf(submission.values),
 *     docNo: numberOf(submission.values),
 *     counterparty: dealerLabelOf(submission.values),
 *   }),
 *   sides: [
 *     {
 *       side: "hq",
 *       label: "總部",
 *       role: "payer",
 *       permission: "purchasing.purchase.settle",
 *       methods: ["bank"],
 *       defaultAmount: (button, state) =>
 *         payerDefaultAmount(button, state.payable, totalsOf(state, "hq")),
 *     },
 *   ],
 * });
 * ```
 */

/** 單據種類:決定寫哪一組交易 / 流水類型(進貨支出 / 收入、調貨支出 / 收入)。 */
export type SettlementKind = "purchase" | "transfer";

/** 登記看得到的提交(`form_submissions` 的那一筆)。 */
export interface SettlementSubmission {
  readonly _id: Types.ObjectId;
  readonly orgId: Types.ObjectId;
  readonly tenantId: Types.ObjectId | null;
  readonly moduleKey: string;
  readonly status: string;
  readonly revision: number;
  readonly values: StoredValues;
  readonly submittedAt: Date | null;
  /** 單號(表單宣告了單號格式才有;`payable` 組 `docNo` 用)。 */
  readonly serialNo?: string | null;
}

/** 單據的收付資訊(由登記從提交算出)。 */
export interface SettlementPayable {
  /** 應付(進貨單)或調貨金額(調貨單);正數或 0。 */
  amount: number;
  /** 單據的分店(待結清款項的「分店」欄、交易的歸屬分店預設值、選帳戶時的使用組織)。 */
  branchOrgId: Types.ObjectId;
  /** 單號(例 `P-0031`)。 */
  docNo: string;
  /** 對象(例 甲類經銷商、出貨店);不用「對方」這種看情境才懂的字。 */
  counterparty: string;
  /** 付款方先填值的基準,和應付不同時才給(調貨單:已點收的批購金額;進 `SettlementState.received`)。 */
  received?: number;
}

export interface SettlementSideRegistration {
  /** 這一邊的代號(單據內唯一;寫進交易 / 流水的 `settlementSide`)。 */
  side: string;
  /** 收付歷程的「哪一店」:例 總部、收貨店、出貨店。 */
  label: string;
  /** 付款方(付款 / 收到退款)或收款方(收款 / 退款)。 */
  role: "payer" | "payee";
  /** 這一邊按鈕(含沖正)要的權限(例 `purchasing.purchase.settle`)。 */
  permission: string;
  /** 可用的付款方式(進貨單只能銀行;調貨單收貨店兩種、出貨店一律銀行)。 */
  methods: readonly SettlementMethod[];
  /** 按鈕先填的金額;≤ 0 時那顆按鈕停用。 */
  defaultAmount: (button: SettlementButton, state: SettlementState) => number;
  /** 這一邊記帳的歸屬分店;不給 = 單據的分店。 */
  branchOf?: (
    submission: SettlementSubmission,
    payable: SettlementPayable,
  ) => Types.ObjectId;
}

export interface SettlementDocumentRegistration {
  /** 單據的模組 key(= 交易 / 流水的 `refType`)。 */
  moduleKey: string;
  /** 類型名稱(例 進貨單)。 */
  label: string;
  kind: SettlementKind;
  /**
   * 這張單據的應付;回 null = 這張不參與收付(例 還沒送出的草稿)。可以是非同步的(調貨單要讀點收紀錄)。
   * 給了 `asOf` = 算那個時點的(例:調貨單的已點收金額只算那個時點以前的點收;輸出報表的期末未結清)。
   */
  payable: (
    submission: SettlementSubmission,
    asOf?: Date,
  ) => SettlementPayable | null | Promise<SettlementPayable | null>;
  /**
   * **兩邊店的單據**:單據存值裡各邊分店的組織欄位路徑(例 `values.to_branch.id`,存組織 id 字串;調貨單的出貨店、
   * 收貨店)。有宣告 = 每一邊只能由「這一邊的分店在可見範圍內」的人操作;沒宣告 = 單據本身要在可見範圍內才能操作。
   * **讀取不靠它**:兩邊店看得到單據是受管表單的「依欄位共用」(`sharedByFieldKeys` → `sharedOrgIds`,ADR-0014),
   * 結算區塊與待結清款項都走一般讀取。
   */
  sideBranchPaths?: readonly string[];
  sides: readonly SettlementSideRegistration[];
}

const registrations = new Map<string, SettlementDocumentRegistration>();

/** 登記一種單據;`moduleKey` 重複或 `side` 重複 → 拋錯。回傳撤銷登記的函式(測試收尾用)。 */
export function registerSettlementDocument(
  registration: SettlementDocumentRegistration,
): () => void {
  if (registrations.has(registration.moduleKey)) {
    throw new Error(`收付機制的單據 ${registration.moduleKey} 已登記過`);
  }
  const sides = registration.sides.map((side) => side.side);
  if (sides.length === 0 || new Set(sides).size !== sides.length) {
    throw new Error(
      `收付機制的單據 ${registration.moduleKey}:sides 不可空白或重複`,
    );
  }
  registrations.set(registration.moduleKey, registration);
  return () => {
    registrations.delete(registration.moduleKey);
  };
}

export function settlementDocumentOf(
  moduleKey: string,
): SettlementDocumentRegistration | undefined {
  return registrations.get(moduleKey);
}

export function settlementDocuments(): readonly SettlementDocumentRegistration[] {
  return [...registrations.values()];
}

export function sideOf(
  registration: SettlementDocumentRegistration,
  side: string,
): SettlementSideRegistration | undefined {
  return registration.sides.find((item) => item.side === side);
}
