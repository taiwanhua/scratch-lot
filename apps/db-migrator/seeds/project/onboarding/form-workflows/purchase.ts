import { PURCHASE_FORM_KEY } from "@repo/domain/project/lottery";

import { requireRoleId } from "../context";
import {
  type FormWorkflowSpec,
  applicantReviews,
  audienceSource,
  reviewStep,
} from "./types";

/**
 * 進貨單(規格 2.1、8.2):一關「點收」,人員條件「角色 店長 且 所屬組織屬於表單欄位『進貨分店』(本身)」。
 * 店長從申請中心進入,在審核頁逐本刷條碼點收,全部點收後核准。申請人也是審核者時 = **照常審核**
 * (同時是總部管理與進貨分店店長的人自己建單,點收照樣由他刷條碼完成)。
 */
export const purchaseWorkflow: FormWorkflowSpec = {
  formKey: PURCHASE_FORM_KEY,
  formName: "進貨單",
  workflowName: "進貨單點收",
  steps: ({ state }) => [
    applicantReviews(
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
    ),
  ],
};
