import {
  CASH_CORRECTION_FORM_KEY,
  SALE_REVERSAL_FORM_KEY,
  STORE_KEY,
} from "@repo/domain/project/lottery";

import {
  type FormEffectContext,
  registerFormLifecycle,
} from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import type { StoreFormsRules } from "./store-forms-rules.service";
import { STORE_FORMS_RULES } from "./store-forms-rules.token";

const rulesOf = (context: Pick<FormEffectContext, "get">): StoreFormsRules =>
  context.get<StoreFormsRules>(STORE_FORMS_RULES);

/**
 * 撤銷售出申請的掛接點(專案規格 8.5;規則在 `StoreFormsRules`,正本 `docs/modules/project/store.md`
 * 「撤銷售出申請與現金更正單」):
 *
 * | 時機 | 做什麼 |
 * | --- | --- |
 * | `beforeSubmit` | 本店已售、不在其他未結束的撤銷單上;退款金額 = 面額合計;退款班次是本店的班 |
 * | `submitted` | 張鎖定(撤銷審核中) |
 * | `returned` / `withdrawn` / `rejected` | 解除鎖定;駁回什麼都不記 |
 * | `completed` | 張改回未售、回原收銀點(「撤銷」事件);退貨退款記在退款班次(已結帳 → 事後更正) |
 * | `beforeVoid` | 一律擋下 |
 */
export const saleReversalLifecycle = registerFormLifecycle({
  moduleKey: STORE_KEY,
  formKey: SALE_REVERSAL_FORM_KEY,
  inject: [STORE_FORMS_RULES],
  guards: {
    beforeSubmit: ({ operator, submission, values, get }) =>
      rulesOf({ get }).beforeSubmitSaleReversal(operator, submission, values),
    beforeVoid: ({ get }) => rulesOf({ get }).beforeVoid(),
  },
  effects: {
    submitted: (context) => rulesOf(context).onSaleReversalSubmitted(context),
    returned: (context) => rulesOf(context).onSaleReversalReleased(context),
    withdrawn: (context) => rulesOf(context).onSaleReversalReleased(context),
    rejected: (context) => rulesOf(context).onSaleReversalReleased(context),
    completed: (context) => rulesOf(context).onSaleReversalCompleted(context),
  },
});

/**
 * 現金更正單的掛接點(專案規格 8.8):送出前檢查位置 / 歸屬班次是本店的班;完成時寫現金流水「現金更正」
 * (班開著 → 計入應有;已結帳 → 事後更正);駁回不記;作廢一律擋下。
 */
export const cashCorrectionLifecycle = registerFormLifecycle({
  moduleKey: STORE_KEY,
  formKey: CASH_CORRECTION_FORM_KEY,
  inject: [STORE_FORMS_RULES],
  guards: {
    beforeSubmit: ({ operator, submission, values, get }) =>
      rulesOf({ get }).beforeSubmitCashCorrection(operator, submission, values),
    beforeVoid: ({ get }) => rulesOf({ get }).beforeVoid(),
  },
  effects: {
    completed: (context) => rulesOf(context).onCashCorrectionCompleted(context),
  },
});
