/* eslint-disable unicorn/filename-case -- 定義快照的檔名固定為 <key>.<revision>.seed.ts,表單 / 流程 key 是底線格式;到期條件:匯出檔名規則或 key 格式改變時移除 */
import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "form-definition",
  key: "support_request",
  revision: "r4",
  name: "支援需求單",
  changelog: "「日期」與「開始 / 結束」(文字 HH:mm)改成「開始」「結束」兩個日期時間欄:存的是時點,結束要晚於開始而且在同一天",
  desiredStatus: "published",
  moduleKey: "schedule.manage",
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  serial: {
    prefix: "SP",
    period: "none",
    digits: 4,
  },
  sharedByFieldKeys: [
    "branch",
  ],
  definition: {
    fields: [
      {
        key: "start_at",
        label: "開始",
        type: "datetime",
        widget: {
          kind: "dateTimePicker",
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          required: true,
        },
      },
      {
        key: "end_at",
        label: "結束",
        type: "datetime",
        widget: {
          kind: "dateTimePicker",
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          required: true,
          custom: {
            and: [
              {
                ">": [
                  {
                    var: "end_at",
                  },
                  {
                    var: "start_at",
                  },
                ],
              },
              {
                "==": [
                  {
                    dateDiff: [
                      {
                        var: "start_at",
                      },
                      {
                        var: "end_at",
                      },
                    ],
                  },
                  0,
                ],
              },
            ],
          },
          customMessage: "結束要晚於開始,而且在同一天(不能跨午夜,跨過午夜請拆成兩張)",
        },
      },
      {
        key: "position",
        label: "崗位",
        type: "select",
        widget: {
          kind: "dropdown",
        },
        valueSource: {
          kind: "input",
        },
        options: {
          kind: "fieldCategory",
          key: "schedule-position",
        },
        rules: {
          required: true,
        },
      },
      {
        key: "headcount",
        label: "需要人數",
        type: "number",
        precision: 0,
        widget: {
          kind: "number",
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          required: true,
          min: 1,
          max: 99,
        },
      },
      {
        key: "branch",
        label: "分店",
        type: "reference",
        widget: {
          kind: "referencePicker",
        },
        valueSource: {
          kind: "input",
        },
        source: {
          provider: "org",
          labelField: "name",
        },
        default: {
          kind: "expression",
          expr: {
            var: "ctx.user.orgId",
          },
        },
        rules: {
          required: true,
        },
      },
      {
        key: "note",
        label: "說明",
        type: "text",
        widget: {
          kind: "textField",
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          maxLength: 200,
        },
      },
    ],
    layout: {
      sections: [
        {
          key: "basic",
          title: "支援需求",
          rows: [
            {
              cols: [
                {
                  fieldKey: "start_at",
                  span: 6,
                },
                {
                  fieldKey: "end_at",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "position",
                  span: 6,
                },
                {
                  fieldKey: "headcount",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "branch",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "note",
                  span: 12,
                },
              ],
            },
          ],
        },
      ],
    },
    summaryMap: {
      title: "note",
      date: "start_at",
    },
    prefills: [],
  },
} satisfies SeedSet;
