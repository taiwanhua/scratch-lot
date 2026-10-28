import type {
  FormEffect,
  FormGuard,
} from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { ACCOUNTS_REASONS } from "../accounts/accounts-error";
import { SettlementLedger } from "./settlement-ledger";
import { SettlementMarks } from "./settlement-marks";

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

/**
 * 結清標記的兩個掛接點(待結清只掃還沒結清的;正本 `docs/modules/project/accounts.md`「待結清款項與側欄數字」)。
 * 登記了收付的單據在自己的 `registerFormLifecycle` 一定要兩個都掛(`inject` 要有 `SettlementMarks`;
 * `settlement-marks-wiring.test.ts` 鎖定):
 *
 * - `settlementMarkCompleted`(事後動作 `completed`):單據完成 → 建一筆待確認的標記
 * - `settlementMarkReopenGuard`(守門 `beforeEditCompleted`,不擋):不走流程的已完成單據被修改,應付可能跟著變
 *   → 標記改回待確認。守門在修改的交易內、寫入之前跑,修改失敗一起回復
 */
export const settlementMarkCompleted: FormEffect = async (context) => {
  await context.get(SettlementMarks).completed(context.session, {
    _id: context.submissionId,
    orgId: context.orgId,
    tenantId: context.tenantId,
    moduleKey: context.moduleKey,
  });
};

export const settlementMarkReopenGuard: FormGuard = async ({
  submission,
  session,
  get,
}) => {
  await get(SettlementMarks).touch(
    submission.tenantId,
    submission._id,
    session,
  );
  return null;
};
