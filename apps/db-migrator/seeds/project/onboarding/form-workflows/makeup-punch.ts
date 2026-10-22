import { MAKEUP_PUNCH_FORM_KEY } from "@repo/domain/project/schedule-settings";

import { requireRoleId } from "../context";
import {
  type FormWorkflowSpec,
  applicantReviews,
  audienceSource,
  reviewStep,
} from "./types";

/**
 * 補打卡申請(規格 2.1、14.8):一關,店長限定「分店」= 人員條件「角色 店長 且 所屬組織屬於表單欄位『分店』(本身)」。
 * 核准後寫入打卡(source = 補打卡)。申請人也是審核者時 = **照常審核**:店長自己的補打卡派給他自己審。
 */
export const makeupPunchWorkflow: FormWorkflowSpec = {
  formKey: MAKEUP_PUNCH_FORM_KEY,
  formName: "補打卡申請",
  workflowName: "補打卡申請審核",
  steps: ({ state }) => [
    applicantReviews(
      reviewStep(
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
    ),
  ],
};
