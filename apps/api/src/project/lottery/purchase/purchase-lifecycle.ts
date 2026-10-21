import {
  PURCHASE_FORM_KEY,
  PURCHASE_MODULE_KEY,
} from "@repo/domain/project/lottery";

import {
  type FormEffectContext,
  type FormGuard,
  registerFormLifecycle,
} from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { settlementClearedGuard } from "../settlement/settlement-guard";
import { SettlementLedger } from "../settlement/settlement-ledger";
import type { PurchaseRules } from "./purchase-rules.service";
import { PURCHASE_RULES } from "./purchase-rules.token";

/** 兩個守門依序:前一個擋下就不跑後一個。 */
function both(first: FormGuard, second: FormGuard): FormGuard {
  return async (context) => (await first(context)) ?? second(context);
}

const rulesOf = (context: Pick<FormEffectContext, "get">): PurchaseRules =>
  context.get<PurchaseRules>(PURCHASE_RULES);

const withoutReceipts: FormGuard = ({ submission, get }) =>
  rulesOf({ get }).withoutReceipts(submission);

/**
 * 進貨單的掛接點(專案規格 8.2 掛接點表;正本 `docs/modules/project/purchasing.md`「進貨單」),
 * 規則在 `PurchaseRules`:
 *
 * | 時機 | 做什麼 |
 * | --- | --- |
 * | `beforeSubmit` | 本號不重複(這張單 / 其他有效進貨單 / 既有的本);已點收的列不能被改或刪(rowId);叫貨單有效;停售遊戲;甲類、受託人、扣款帳戶 |
 * | `submitted` | 第一次送出記「批貨支出」(與兌獎剩餘 > 0 的「兌獎入帳」);勾選的兌獎 → 已送兌;甲類批購日重算;叫貨單 → 已進貨;側欄信號 |
 * | `beforeApprove` | 還有沒點收的列 → 擋下 |
 * | `completed` | 不寫帳、不檢查是否結清(只送側欄信號) |
 * | `beforeReject` / `beforeDelete` | 已有點收 → 擋下;駁回另要求淨額 = 0 |
 * | `beforeVoid` | 任何一張已售、已調出、已拆本 → 擋下;淨額 = 0 |
 * | `rejected` / `voided` | 甲類日期重算;作廢另寫「進貨作廢」事件、本 → 已撤銷;叫貨單回到待購買;兌獎 → 店內持有 |
 * | 撤回、退回 | 不擋;兌獎 → 店內持有;側欄信號 |
 */
export const purchaseLifecycle = registerFormLifecycle({
  moduleKey: PURCHASE_MODULE_KEY,
  formKey: PURCHASE_FORM_KEY,
  inject: [PURCHASE_RULES, SettlementLedger],
  guards: {
    beforeSubmit: ({ operator, submission, values, get }) =>
      rulesOf({ get }).beforeSubmit(operator, submission, values),
    beforeApprove: ({ submission, get }) =>
      rulesOf({ get }).beforeApprove(submission),
    beforeReject: both(withoutReceipts, settlementClearedGuard),
    beforeDelete: withoutReceipts,
    beforeVoid: both(
      ({ submission, get }) => rulesOf({ get }).beforeVoid(submission),
      settlementClearedGuard,
    ),
  },
  effects: {
    submitted: (context) => rulesOf(context).onSubmitted(context),
    rejected: (context) => rulesOf(context).onRejected(context),
    voided: (context) => rulesOf(context).onVoided(context),
    completed: (context) => {
      rulesOf(context).onTaskEnded(context);
    },
    returned: (context) => rulesOf(context).onReleased(context),
    withdrawn: (context) => rulesOf(context).onReleased(context),
  },
});
