import {
  CHECKOUT_CONFIRM_FORM_KEY,
  CHECKOUT_FIELD_KEYS,
  CHECKOUT_TYPE,
} from "@repo/domain/project/lottery";

import { requireRoleId } from "../context";
import { type FormWorkflowSpec, audienceSource, reviewStep } from "./types";

/**
 * 結帳確認申請(規格 2.1、8.7):兩關,交班與日結同一張表單(`type` 欄位)。
 *
 * - **第 1 關「接班人確認」**:審核者 = 表單欄位「接班人」(接班人當面點過零用金後核准 = 確認);
 *   跳過條件 = 類型是日結、或接班人為空
 * - **第 2 關「店長審核」**:店長限定「分店」(人員條件「角色 店長 且 所屬組織屬於表單欄位『分店』(本身)」);
 *   跳過條件 = 類型是交班且接班人不為空
 *
 * 結果:交班有接班人 → 接班人審;交班沒有接班人 → 店長審;日結 → 店長審,照常審核(不自動通過)。
 */
export const checkoutConfirmWorkflow: FormWorkflowSpec = {
  formKey: CHECKOUT_CONFIRM_FORM_KEY,
  formName: "結帳確認申請",
  workflowName: "結帳確認申請審核",
  steps: ({ state }) => {
    const isDaily = {
      "==": [{ var: CHECKOUT_FIELD_KEYS.type }, CHECKOUT_TYPE.daily],
    };
    const noSuccessor = { "!": { var: CHECKOUT_FIELD_KEYS.successor } };
    return [
      {
        ...reviewStep("successor", "接班人確認", {
          kind: "field",
          formKey: CHECKOUT_CONFIRM_FORM_KEY,
          fieldKey: CHECKOUT_FIELD_KEYS.successor,
        }),
        skipWhen: { or: [isDaily, noSuccessor] },
      },
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
              value: {
                kind: "dynamic",
                ref: `form-field:${CHECKOUT_FIELD_KEYS.branch}`,
              },
              range: "self",
            },
          ),
        ),
        skipWhen: {
          and: [
            {
              "==": [{ var: CHECKOUT_FIELD_KEYS.type }, CHECKOUT_TYPE.shift],
            },
            { "!!": { var: CHECKOUT_FIELD_KEYS.successor } },
          ],
        },
      },
    ];
  },
};
