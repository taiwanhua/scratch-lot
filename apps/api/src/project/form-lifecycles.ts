import {
  FORM_GUARD_NAMES,
  type FormGuard,
  type FormGuardName,
  type FormLifecycleRegistration,
} from "../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { checkoutConfirmLifecycle } from "./lottery/checkout/checkout-lifecycle";
import { purchaseLifecycle } from "./lottery/purchase/purchase-lifecycle";
import { requisitionLifecycle } from "./lottery/requisition/requisition-lifecycle";
import { stocktakeConfirmLifecycle } from "./lottery/stocktake/stocktake-lifecycle";
import {
  cashCorrectionLifecycle,
  saleReversalLifecycle,
} from "./lottery/store/store-forms-lifecycle";
import { transferLifecycle } from "./lottery/transfer/transfer-lifecycle";
import { makeupPunchLifecycle } from "./schedule/attendance/makeup-punch-lifecycle";
import { TENANT_ONLY_REASON, isAtRootOrg } from "./tenant-scope/root-org";

/**
 * 根組織的防線(Spec #143 定案 8、ADR-0014):專案表單在根組織送出 / 審核 / 作廢……一律擋下,
 * 回 `FORBIDDEN` + reason `TENANT_ONLY`(與 resolver 的 `@RequireTenant()` 同一個回應)。
 * 每一筆登記的 8 個守門都先過這一關,沒登記的守門也補上。
 */
const withRootOrgGuard = (
  registration: FormLifecycleRegistration,
): FormLifecycleRegistration => {
  const guards: Partial<Record<FormGuardName, FormGuard>> = {};
  for (const name of FORM_GUARD_NAMES) {
    const own = registration.guards?.[name];
    guards[name] = (context) =>
      isAtRootOrg(context.operator)
        ? {
            code: TENANT_ONLY_REASON,
            message:
              "The root org belongs to no tenant; switch into a tenant first",
          }
        : (own?.(context) ?? null);
  }
  return { ...registration, guards };
};

/**
 * 專案的表單 / 流程掛接點(`docs/concepts/workflow-engine.md`「掛接點」;STRUCT-12 api 的
 * 固定入口之一,只由 `database/database.module.ts` 組裝)。同一個 (moduleKey, formKey) 只能一筆,重複 → app 起不來。
 *
 * ```ts
 * registerFormLifecycle({
 *   moduleKey: "purchasing.purchase",
 *   formKey: "purchase", // 省略 = 這個模組的所有表單
 *   // handler 的 get 只拿得到這裡列的 provider;啟動時找不到 → app 起不來
 *   inject: [PurchaseRowsRepository, StockRepository],
 *   guards: {
 *     // 只能讀;回 null = 通過,回 { code, message } = 擋下(FORBIDDEN + reason = code)
 *     beforeApprove: async ({ submission, get }) =>
 *       (await get(PurchaseRowsRepository).hasUnreceived(submission._id))
 *         ? { code: "PURCHASE_UNRECEIVED_ROWS", message: "Rows not received" }
 *         : null,
 *   },
 *   effects: {
 *     // 同一個交易內、系統身分;拋錯 = 整個動作回復
 *     completed: async ({ operator, submissionId, get }) => {
 *       await get(StockRepository).receive(operator, submissionId);
 *     },
 *   },
 * })
 * ```
 */
const REGISTRATIONS: readonly FormLifecycleRegistration[] = [
  // 叫貨單:送出前檢查停售、完成時寫副本、作廢補 voidedAt(專案規格 8.1)
  requisitionLifecycle,
  // 進貨單:送出前檢查、送出後記批貨支出與批購日、點收守門、作廢撤銷本(專案規格 8.2)
  purchaseLifecycle,
  // 調貨單:送出鎖定、第一關通過出貨在途、點收與收付守門、駁回 / 作廢回到出貨店(專案規格 8.4)
  transferLifecycle,
  // 補打卡申請:送出檢查對應排班、核准前排班被刪除就擋、完成時寫補打卡(專案規格 14.8)
  makeupPunchLifecycle,
  // 撤銷售出申請:送出鎖定、完成時撤銷售出並記退貨退款、作廢一律擋下(專案規格 8.5)
  saleReversalLifecycle,
  // 現金更正單:完成時寫現金更正流水、作廢一律擋下(專案規格 8.8)
  cashCorrectionLifecycle,
  // 盤點確認申請:送出前再檢查差異、送出建立盤點單、完成時套用庫存變動、作廢一律擋下(專案規格 6.8、8.6)
  stocktakeConfirmLifecycle,
  // 結帳確認申請(交班):送出前檢查負責人 / 店長、盤點方式與交接,送出建立結帳單與盤點單、這一班結束;
  // 完成時套用盤點;駁回、作廢一律擋下(專案規格 6.9、8.7)
  checkoutConfirmLifecycle,
  // 支援需求單:沒有自己的掛接點,只套根組織的防線
  { moduleKey: "schedule.manage", formKey: "support_request" },
];

export const PROJECT_FORM_LIFECYCLES: readonly FormLifecycleRegistration[] =
  REGISTRATIONS.map((registration) => withRootOrgGuard(registration));
