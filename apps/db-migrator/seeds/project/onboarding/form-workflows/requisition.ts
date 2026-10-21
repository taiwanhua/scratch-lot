import { REQUISITION_FORM_KEY } from "@repo/domain/project/lottery";
import { SKIP_ORG_TENANT } from "@repo/domain/workflow";

import { requireBranchId, requireRoleId } from "../context";
import { type FormWorkflowSpec, audienceSource, reviewStep } from "./types";

/**
 * 叫貨單(規格 2.1、8.1):一關,角色「總部管理」;**B4 跳過組織 = 租戶**(總部是某家分店時改選那家店)。
 * B4 比對的是申請人的所屬組織:總部人員(一律屬於租戶)送出的叫貨單、替分店送的也一樣,直接跳過審核完成。
 */
export const requisitionWorkflow: FormWorkflowSpec = {
  formKey: REQUISITION_FORM_KEY,
  formName: "叫貨單",
  workflowName: "叫貨單審核",
  steps: ({ plan, state }) => [
    {
      ...reviewStep(
        "hq",
        "總部審核",
        audienceSource({
          field: "role",
          cond: "in",
          value: { kind: "static", values: [requireRoleId(state, "hq")] },
        }),
      ),
      skipOrgs: {
        orgIds: [
          plan.headquartersBranch === null
            ? SKIP_ORG_TENANT
            : requireBranchId(state, plan.headquartersBranch),
        ],
        includeDescendants: false,
      },
    },
  ],
};
