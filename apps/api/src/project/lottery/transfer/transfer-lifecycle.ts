import {
  TRANSFER_FORM_KEY,
  TRANSFER_MODULE_KEY,
} from "@repo/domain/project/lottery";

import {
  type FormEffectContext,
  type FormGuard,
  registerFormLifecycle,
} from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { settlementClearedGuard } from "../settlement/settlement-guard";
import { SettlementLedger } from "../settlement/settlement-ledger";
import type { TransferRules } from "./transfer-rules.service";
import { TRANSFER_RULES } from "./transfer-rules.token";

/** 兩個守門依序:前一個擋下就不跑後一個。 */
function both(first: FormGuard, second: FormGuard): FormGuard {
  return async (context) => (await first(context)) ?? second(context);
}

const rulesOf = (context: Pick<FormEffectContext, "get">): TransferRules =>
  context.get<TransferRules>(TRANSFER_RULES);

const withoutReceipts: FormGuard = ({ submission, get }) =>
  rulesOf({ get }).withoutReceipts(submission);

/**
 * 調貨單的掛接點(專案規格 8.4 掛接點表;正本 `docs/modules/project/purchasing.md`「調貨單」),
 * 規則在 `TransferRules`:
 *
 * | 時機 | 做什麼 |
 * | --- | --- |
 * | `beforeSubmit` | 本和張都在出貨店、未售、沒被鎖定,且不在其他未結束的調貨單上;已點收的列沒被改或刪;叫貨單有效 |
 * | `submitted` | 鎖定(調貨中);被刪掉的在途列 → 待查、沒出貨的解除;叫貨單 → 已調貨 |
 * | `stepPassed` | 第一關通過(含跳過):在途 + 「調出」事件 + 調貨出貨通知 |
 * | `beforeApprove` | 點收關卡:全部點收,而且收貨店已付 = 出貨店已收 = 調貨金額 |
 * | `returned` / `withdrawn` | 還沒出貨的解除鎖定;已在途的保持在途 |
 * | `beforeReject` / `beforeDelete` | 已有點收 → 擋下;駁回另要求兩邊淨額 = 0 |
 * | `beforeVoid` | 調入後已售、再調出或拆本 → 擋下;兩邊淨額 = 0 |
 * | `rejected` / `voided` | 全部回到出貨店、寫反向事件;叫貨單回到待購買 |
 */
export const transferLifecycle = registerFormLifecycle({
  moduleKey: TRANSFER_MODULE_KEY,
  formKey: TRANSFER_FORM_KEY,
  inject: [TRANSFER_RULES, SettlementLedger],
  guards: {
    beforeSubmit: ({ operator, submission, values, get }) =>
      rulesOf({ get }).beforeSubmit(operator, submission, values),
    beforeApprove: ({ operator, submission, stepKey, get }) =>
      rulesOf({ get }).beforeApprove(submission, operator, stepKey),
    beforeReject: both(withoutReceipts, settlementClearedGuard),
    beforeDelete: withoutReceipts,
    beforeVoid: both(
      ({ submission, get }) => rulesOf({ get }).beforeVoid(submission),
      settlementClearedGuard,
    ),
  },
  effects: {
    submitted: (context) => rulesOf(context).onSubmitted(context),
    stepPassed: (context) => rulesOf(context).onStepPassed(context),
    returned: (context) => rulesOf(context).onReleased(context),
    withdrawn: (context) => rulesOf(context).onReleased(context),
    rejected: (context) => rulesOf(context).onRejected(context),
    voided: (context) => rulesOf(context).onVoided(context),
    completed: (context) => {
      rulesOf(context).onTaskEnded(context);
    },
  },
});
