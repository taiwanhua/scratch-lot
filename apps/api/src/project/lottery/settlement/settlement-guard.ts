import type { FormGuard } from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { ACCOUNTS_REASONS } from "../accounts/accounts-error";
import { SettlementLedger } from "./settlement-ledger";

/**
 * 作廢 / 駁回前的收付檢查(規格 9「已有結算紀錄的單據作廢 / 駁回前淨額必須 = 0」)。
 *
 * 登記了收付的單據(P18 進貨單、P19 調貨單)在自己的 `registerFormLifecycle` 掛上:
 *
 * ```ts
 * registerFormLifecycle({
 *   moduleKey: "purchasing.purchase",
 *   inject: [SettlementLedger],
 *   guards: { beforeVoid: settlementClearedGuard, beforeReject: settlementClearedGuard },
 * })
 * ```
 *
 * 每一邊的淨額都是 0(沒有任何收付,或都已沖正 / 退回)才放行;否則擋下(`FORBIDDEN` + `reason =
 * SETTLEMENT_NOT_CLEARED`),整個動作沒有任何寫入。
 */
export const settlementClearedGuard: FormGuard = async ({
  operator,
  submission,
  get,
}) => {
  const cleared = await get(SettlementLedger).isCleared(operator, {
    _id: submission._id,
    orgId: submission.orgId,
    tenantId: submission.tenantId,
    moduleKey: submission.moduleKey,
    status: submission.status,
    revision: submission.revision,
    values: submission.values,
    submittedAt: null,
  });
  return cleared
    ? null
    : {
        code: ACCOUNTS_REASONS.settlementNotCleared,
        message: `settlement net amount is not zero: ${String(submission._id)}`,
      };
};
