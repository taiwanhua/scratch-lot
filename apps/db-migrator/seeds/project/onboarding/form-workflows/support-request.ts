import { requireRoleId } from "../context";
import {
  type FormWorkflowSpec,
  applicantReviews,
  audienceSource,
  reviewStep,
} from "./types";

/** 支援需求單的表單代號(受管表單 `seeds/project/revisions/support_request.*.seed.ts`)。 */
export const SUPPORT_REQUEST_FORM_KEY = "support_request";

/**
 * 支援需求單(規格 2.1、14.10):一關,人員條件「角色 總部管理 且 所屬組織屬於租戶(最上層組織本身)」。
 * 總部在排班作業排好人後核准。申請人也是審核者時 = **照常審核**(總部管理自己送的支援需求單,排好人後自己核准)。
 */
export const supportRequestWorkflow: FormWorkflowSpec = {
  formKey: SUPPORT_REQUEST_FORM_KEY,
  formName: "支援需求單",
  workflowName: "支援需求單審核",
  steps: ({ state }) => [
    applicantReviews(
      reviewStep(
        "hq",
        "總部審核",
        audienceSource(
          {
            field: "role",
            cond: "in",
            value: { kind: "static", values: [requireRoleId(state, "hq")] },
          },
          {
            field: "org",
            cond: "in",
            value: { kind: "dynamic", ref: "tenant" },
            range: "self",
          },
        ),
      ),
    ),
  ],
};
