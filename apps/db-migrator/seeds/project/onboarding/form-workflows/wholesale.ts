import { WHOLESALE_FORM_KEY } from "@repo/domain/project/lottery";

import { requireRoleId } from "../context";
import {
  type FormWorkflowSpec,
  applicantReviews,
  audienceSource,
  reviewStep,
} from "./types";

/**
 * 批售單(規格 21.4):一關「出貨確認」,人員條件「角色 店長 且 所屬組織屬於表單欄位『出貨分店』(本身)」。
 * **不跳過**:「收到錢再核准」靠這一關等錢。申請人也是審核者時 = **照常審核**(店長自己開的單,收到錢後自己按核准)。
 * 核准 = 出貨 = 單據完成;掛接點的核准前檢查只認流程的最後一關,租戶改流程時出貨確認要留在最後一關。
 */
export const wholesaleWorkflow: FormWorkflowSpec = {
  formKey: WHOLESALE_FORM_KEY,
  formName: "批售單",
  workflowName: "批售單出貨確認",
  steps: ({ state }) => [
    applicantReviews(
      reviewStep(
        "ship",
        "出貨確認",
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
            value: { kind: "dynamic", ref: "form-field:from_branch" },
            range: "self",
          },
        ),
      ),
    ),
  ],
};
