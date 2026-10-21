import type { FormLifecycleRegistration } from "../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { purchaseLifecycle } from "./lottery/purchase/purchase-lifecycle";
import { requisitionLifecycle } from "./lottery/requisition/requisition-lifecycle";
import { transferLifecycle } from "./lottery/transfer/transfer-lifecycle";
import { makeupPunchLifecycle } from "./schedule/attendance/makeup-punch-lifecycle";

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
export const PROJECT_FORM_LIFECYCLES: readonly FormLifecycleRegistration[] = [
  // 叫貨單:送出前檢查停售、完成時寫副本、作廢補 voidedAt(專案規格 8.1)
  requisitionLifecycle,
  // 進貨單:送出前檢查、送出後記批貨支出與批購日、點收守門、作廢撤銷本(專案規格 8.2)
  purchaseLifecycle,
  // 調貨單:送出鎖定、第一關通過出貨在途、點收與收付守門、駁回 / 作廢回到出貨店(專案規格 8.4)
  transferLifecycle,
  // 補打卡申請:送出檢查對應排班、核准前排班被刪除就擋、完成時寫補打卡(專案規格 14.8)
  makeupPunchLifecycle,
];
