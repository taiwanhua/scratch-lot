import {
  CASH_CORRECTION_FORM_KEY,
  SALE_REVERSAL_FORM_KEY,
} from "@repo/domain/project/lottery";

import type { OnboardingContext } from "../context";
import { requireRoleId } from "../context";
import {
  type FormWorkflowSpec,
  type WorkflowStepJson,
  audienceSource,
  reviewStep,
} from "./types";

/**
 * 一關「店長限定分店」+ B5「申請人是審核者時自動通過」(規格 2.1):人員條件「角色 店長 且 所屬組織屬於表單欄位
 * 『分店』(本身)」;店長自己送的單直接通過。
 */
function storeManagerStep({ state }: OnboardingContext): WorkflowStepJson[] {
  return [
    {
      ...reviewStep(
        "store_manager",
        "店長審核",
        audienceSource(
          {
            field: "role",
            cond: "in",
            value: {
              kind: "static",
              values: [requireRoleId(state, "store-manager")],
            },
          },
          {
            field: "org",
            cond: "in",
            value: { kind: "dynamic", ref: "form-field:branch" },
            range: "self",
          },
        ),
      ),
      autoApprove: { applicant: true },
    },
  ];
}

/** 撤銷售出申請(規格 2.1、8.5):完成時張改回未售、退貨退款記在退款班次。 */
export const saleReversalWorkflow: FormWorkflowSpec = {
  formKey: SALE_REVERSAL_FORM_KEY,
  formName: "撤銷售出申請",
  workflowName: "撤銷售出申請審核",
  steps: storeManagerStep,
};

/** 現金更正單(規格 2.1、8.8):完成時寫現金流水「現金更正」。 */
export const cashCorrectionWorkflow: FormWorkflowSpec = {
  formKey: CASH_CORRECTION_FORM_KEY,
  formName: "現金更正單",
  workflowName: "現金更正單審核",
  steps: storeManagerStep,
};
