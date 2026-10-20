/* eslint-disable unicorn/filename-case -- 定義快照的檔名固定為 <key>.<revision>.seed.ts,表單 / 流程 key 是底線格式;到期條件:匯出檔名規則或 key 格式改變時移除 */
import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "form-definition",
  key: "support_request",
  revision: "r1",
  name: "支援需求單",
  changelog: "初版:分店人力不足時請總部協助(專案規格 14.10);時段 = 開始–結束(不跨午夜)",
  desiredStatus: "published",
  moduleKey: "schedule.manage",
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  definition: {
    fields: [
      {
        key: "date",
        label: "日期",
        type: "date",
        widget: {
          kind: "datePicker",
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          required: true,
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
        key: "start_time",
        label: "開始",
        type: "text",
        widget: {
          kind: "textField",
          placeholder: "HH:mm",
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          required: true,
          pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$",
          patternMessage: "請輸入 24 小時制的時間,例 17:00",
        },
      },
      {
        key: "end_time",
        label: "結束",
        type: "text",
        widget: {
          kind: "textField",
          placeholder: "HH:mm",
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          required: true,
          pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$",
          patternMessage: "請輸入 24 小時制的時間,例 21:00",
          custom: {
            ">": [
              {
                var: "end_time",
              },
              {
                var: "start_time",
              },
            ],
          },
          customMessage: "結束時間要晚於開始時間",
        },
      },
      {
        key: "time_slot",
        label: "時段",
        type: "text",
        widget: {
          kind: "textField",
        },
        valueSource: {
          kind: "computed",
          expr: {
            concat: [
              {
                var: "start_time",
              },
              "–",
              {
                var: "end_time",
              },
            ],
          },
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
                  fieldKey: "date",
                  span: 6,
                },
                {
                  fieldKey: "position",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "start_time",
                  span: 4,
                },
                {
                  fieldKey: "end_time",
                  span: 4,
                },
                {
                  fieldKey: "time_slot",
                  span: 4,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "headcount",
                  span: 6,
                },
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
      date: "date",
    },
    prefills: [],
  },
} satisfies SeedSet;
