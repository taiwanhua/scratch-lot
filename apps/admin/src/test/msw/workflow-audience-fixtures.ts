import type { AssigneeSource } from "@repo/domain/workflow";

/**
 * 流程設計器目錄裡的角色 id(人員條件的格式只收 ObjectId 字串,設計器的即時檢查也照這個驗,
 * 所以假資料要長得像真的 id)。
 */
export const HR_ROLE_ID = "65f0000000000000000000a1";
export const FINANCE_ROLE_ID = "65f0000000000000000000a2";

/** 人員條件「角色屬於某角色,且所屬組織 = 單據所屬組織(本身)」。 */
export const roleInSubmissionOrg = (roleId: string): AssigneeSource => ({
  kind: "audience",
  audience: {
    mode: "match",
    filter: {
      op: "AND",
      children: [
        {
          field: "role",
          cond: "in",
          value: { kind: "static", values: [roleId] },
        },
        {
          field: "org",
          cond: "in",
          value: { kind: "dynamic", ref: "submission-org" },
          range: "self",
        },
      ],
    },
  },
});
