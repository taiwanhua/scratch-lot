import type { FormLifecycleRegistration } from "../workflows/workflow-engine/lifecycle/form-lifecycle-registration";

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
export const PROJECT_FORM_LIFECYCLES: readonly FormLifecycleRegistration[] = [];
