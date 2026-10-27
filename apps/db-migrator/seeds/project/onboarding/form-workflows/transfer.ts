import { TRANSFER_FORM_KEY } from "@repo/domain/project/lottery";

import { requireRoleId } from "../context";
import {
  type FormWorkflowSpec,
  applicantReviews,
  audienceSource,
  reviewStep,
} from "./types";

/** 「角色 店長 且 所屬組織屬於表單欄位 X(本身)」。 */
function storeManagerOf(roleId: string, fieldKey: string) {
  return audienceSource(
    { field: "role", cond: "in", value: { kind: "static", values: [roleId] } },
    {
      field: "org",
      cond: "in",
      value: { kind: "dynamic", ref: `form-field:${fieldKey}` },
      range: "self",
    },
  );
}

/**
 * 調貨單(規格 2.1、8.4):兩關。第 1 關「出貨確認」店長限定「出貨分店」,跳過條件
 * `ctx.user.orgId == 出貨分店`(出貨店自己送出時不必再確認一次);第 2 關「點收」店長限定「收貨分店」。
 * 掛接點以流程實例的**最後一關**當點收關卡(點收、核准前的檢查、側欄計數只認它)。
 * 兩關的「申請人也是審核者時」都是**照常審核**:出貨店店長不是站在出貨店送出(跳過條件不成立)、
 * 或申請人也是收貨店店長時,任務派給他自己(出貨確認 / 點收照樣要做),不因剔除而找不到人。
 */
export const transferWorkflow: FormWorkflowSpec = {
  formKey: TRANSFER_FORM_KEY,
  formName: "調貨單",
  workflowName: "調貨單出貨與點收",
  steps: ({ state }) => {
    const manager = requireRoleId(state, "store-manager");
    return [
      {
        ...applicantReviews(
          reviewStep(
            "ship",
            "出貨確認",
            storeManagerOf(manager, "from_branch"),
          ),
        ),
        skipWhen: { "==": [{ var: "ctx.user.orgId" }, { var: "from_branch" }] },
      },
      applicantReviews(
        reviewStep("receive", "點收", storeManagerOf(manager, "to_branch")),
      ),
    ];
  },
};
