/* eslint-disable unicorn/filename-case -- 定義快照的檔名固定為 <key>.<revision>.seed.ts,表單 / 流程 key 是底線格式;到期條件:匯出檔名規則或 key 格式改變時移除 */
import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "workflow-definition",
  key: "project_review",
  revision: "r1",
  name: "專案審核流程",
  changelog: "初版",
  desiredStatus: "published",
  checkFormKey: "project_request",
  definition: {
    steps: [
      {
        key: "boss",
        name: "直屬主管",
        assignee: {
          kind: "manager",
          level: 1,
        },
        mode: "any",
        skipWhen: {
          "<": [
            {
              var: "amount",
            },
            1000,
          ],
        },
      },
      {
        key: "finance",
        name: "財務",
        assignee: {
          kind: "audience",
          audience: {
            mode: "match",
            filter: {
              op: "AND",
              children: [
                {
                  field: "permission",
                  cond: "in",
                  value: {
                    kind: "static",
                    values: [
                      "finance.approve",
                    ],
                  },
                },
              ],
            },
          },
        },
        mode: "all",
        allowReturn: false,
      },
    ],
  },
} satisfies SeedSet;
