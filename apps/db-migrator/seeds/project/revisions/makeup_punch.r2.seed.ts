/* eslint-disable unicorn/filename-case -- 定義快照的檔名固定為 <key>.<revision>.seed.ts,表單 / 流程 key 是底線格式;到期條件:匯出檔名規則或 key 格式改變時移除 */
import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "form-definition",
  key: "makeup_punch",
  revision: "r2",
  name: "補打卡申請",
  changelog: "詳情與申請中心不顯示「對應排班」的系統代碼(只顯示對應排班的文字);作廢原因用共用的「作廢原因」類別",
  desiredStatus: "published",
  moduleKey: "schedule.attendance",
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  serial: {
    prefix: "M",
    period: "none",
    digits: 4,
  },
  voidReasonCategoryKey: "void-reason",
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
        key: "entry_label",
        label: "對應排班",
        type: "text",
        widget: {
          kind: "textField",
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          required: true,
          maxLength: 100,
        },
      },
      {
        key: "entry",
        label: "對應排班(系統代碼)",
        type: "text",
        widget: {
          kind: "textField",
          hideWhenReadonly: true,
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          required: true,
          maxLength: 40,
        },
        help: "排班的代碼;沒有排班(臨時代班)= none。由補打卡申請頁帶入,不要手動修改",
      },
      {
        key: "punch_type",
        label: "類型",
        type: "select",
        widget: {
          kind: "radio",
        },
        valueSource: {
          kind: "input",
        },
        options: {
          kind: "static",
          items: [
            {
              value: "in",
              label: "上班",
              order: 1,
              enabled: true,
            },
            {
              value: "out",
              label: "下班",
              order: 2,
              enabled: true,
            },
          ],
        },
        rules: {
          required: true,
        },
      },
      {
        key: "time",
        label: "時間",
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
          patternMessage: "請輸入 24 小時制的時間,例 14:35",
        },
      },
      {
        key: "reason",
        label: "原因",
        type: "select",
        widget: {
          kind: "dropdown",
        },
        valueSource: {
          kind: "input",
        },
        options: {
          kind: "fieldCategory",
          key: "schedule-makeup-punch-reason",
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
          title: "補打卡申請",
          rows: [
            {
              cols: [
                {
                  fieldKey: "date",
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
                  fieldKey: "entry_label",
                  span: 6,
                },
                {
                  fieldKey: "entry",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "punch_type",
                  span: 6,
                },
                {
                  fieldKey: "time",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "reason",
                  span: 6,
                },
                {
                  fieldKey: "note",
                  span: 6,
                },
              ],
            },
          ],
        },
      ],
    },
    summaryMap: {
      title: "entry_label",
      date: "date",
    },
    prefills: [],
  },
} satisfies SeedSet;
