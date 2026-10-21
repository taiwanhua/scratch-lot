import { PURCHASE_FORM_KEY } from "@repo/domain/project/lottery";

import { requireRoleId } from "../context";
import { type FormWorkflowSpec, audienceSource, reviewStep } from "./types";

/**
 * 進貨單(規格 2.1、8.2):一關「點收」,人員條件「角色 店長 且 所屬組織屬於表單欄位『進貨分店』(本身)」。
 * 店長從申請中心進入,在審核頁逐本刷條碼點收,全部點收後核准。
 */
export const purchaseWorkflow: FormWorkflowSpec = {
  formKey: PURCHASE_FORM_KEY,
  formName: "進貨單",
  workflowName: "進貨單點收",
  steps: ({ state }) => [
    reviewStep(
      "receive",
      "點收",
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
  ],
};
