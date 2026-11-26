import {
  WHOLESALE_FORM_KEY,
  WHOLESALE_MODULE_KEY,
} from "@repo/domain/project/lottery";

import {
  type FormEffectContext,
  type FormGuard,
  registerFormLifecycle,
} from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import {
  settlementClearedGuard,
  settlementMarkCompleted,
  settlementMarkReopenGuard,
} from "../settlement/settlement-guard";
import { SettlementLedger } from "../settlement/settlement-ledger";
import { SettlementMarks } from "../settlement/settlement-marks";
import { WHOLESALE_REASONS } from "./wholesale-error";
import type { WholesaleRules } from "./wholesale-rules.service";
import { WHOLESALE_RULES } from "./wholesale-rules.token";

/** 兩個守門依序:前一個擋下就不跑後一個。 */
function both(first: FormGuard, second: FormGuard): FormGuard {
  return async (context) => (await first(context)) ?? second(context);
}

const rulesOf = (context: Pick<FormEffectContext, "get">): WholesaleRules =>
  context.get<WholesaleRules>(WHOLESALE_RULES);

/** 刪除只限草稿(同進貨單、調貨單:送出過的單有鎖定 / 收付,刪了不會釋放)。 */
const draftOnly: FormGuard = ({ submission }) =>
  submission.status === "draft"
    ? null
    : {
        code: WHOLESALE_REASONS.notDraft,
        message: "Only drafts can be deleted",
      };

/**
 * 批售單的掛接點(專案規格 21.4 掛接點表;正本 `docs/modules/project/purchasing.md`「批售單」),
 * 規則在 `WholesaleRules`:
 *
 * | 時機 | 做什麼 |
 * | --- | --- |
 * | `beforeSubmit` | 出貨分店、批售客戶、明細每一列、每本未拆且整本在出貨分店庫存、從帳戶入帳的帳戶與已收淨額 0 |
 * | `submitted` | 這張單所有張鎖定(批售中);重新送出時不再單上的解鎖 |
 * | `beforeApprove` | 最後一關:張仍鎖在這張單;從帳戶入帳 = 帳戶可用、收到錢再核准 = 已收 = 批售金額 |
 * | `completed` | 建結清標記、出貨(「批售」事件、已批售、解鎖)、從帳戶入帳自動記「批售收入」 |
 * | `returned` / `withdrawn` / `rejected` | 解除鎖定(結算紀錄保留) |
 * | `beforeReject` | 淨額 ≠ 0 → 擋下 |
 * | `beforeDelete` | 只限草稿 |
 * | `beforeVoid` | 批售出去的張還是已批售、最後一筆事件是這張單的「批售」;淨額 = 0 |
 * | `voided` | 每張寫「取消批售」事件,回到出貨分店庫存的未售 |
 */
export const wholesaleLifecycle = registerFormLifecycle({
  moduleKey: WHOLESALE_MODULE_KEY,
  formKey: WHOLESALE_FORM_KEY,
  inject: [WHOLESALE_RULES, SettlementLedger, SettlementMarks],
  guards: {
    beforeSubmit: ({ operator, submission, values, get }) =>
      rulesOf({ get }).beforeSubmit(operator, submission, values),
    beforeApprove: ({ operator, submission, stepKey, get }) =>
      rulesOf({ get }).beforeApprove(submission, operator, stepKey),
    beforeReject: settlementClearedGuard,
    beforeDelete: draftOnly,
    // 不走流程時可以修改已完成的單據(應收可能變):結清標記改回待確認,不擋
    beforeEditCompleted: settlementMarkReopenGuard,
    beforeVoid: both(
      ({ submission, get }) => rulesOf({ get }).beforeVoid(submission),
      settlementClearedGuard,
    ),
  },
  effects: {
    submitted: (context) => rulesOf(context).onSubmitted(context),
    returned: (context) => rulesOf(context).onReleased(context),
    withdrawn: (context) => rulesOf(context).onReleased(context),
    rejected: (context) => rulesOf(context).onReleased(context),
    voided: (context) => rulesOf(context).onVoided(context),
    completed: async (context) => {
      // 已完成的單據改由結清標記挑出還要算的(待結清只掃還沒結清的)
      await settlementMarkCompleted(context);
      await rulesOf(context).onCompleted(context);
    },
  },
});
