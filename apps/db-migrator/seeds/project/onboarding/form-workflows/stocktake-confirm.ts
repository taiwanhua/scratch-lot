import { STOCKTAKE_CONFIRM_FORM_KEY } from "@repo/domain/project/lottery";

import { requireRoleId } from "../context";
import { type FormWorkflowSpec, audienceSource, reviewStep } from "./types";

/**
 * 盤點確認申請(規格 2.1、8.6):一關,店長限定「分店」= 人員條件「角色 店長 且 所屬組織屬於表單欄位『分店』(本身)」;
 * B5 申請人是審核者時自動通過(店長自己盤點送出即完成)。核准完成時套用庫存變動。
 */
export const stocktakeConfirmWorkflow: FormWorkflowSpec = {
  formKey: STOCKTAKE_CONFIRM_FORM_KEY,
  formName: "盤點確認申請",
  workflowName: "盤點確認申請審核",
  steps: ({ state }) => [
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
  ],
};
