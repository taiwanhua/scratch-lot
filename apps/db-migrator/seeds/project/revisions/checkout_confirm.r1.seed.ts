/* eslint-disable unicorn/filename-case -- 定義快照的檔名固定為 <key>.<revision>.seed.ts,表單 / 流程 key 是底線格式;到期條件:匯出檔名規則或 key 格式改變時移除 */
import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "form-definition",
  key: "checkout_confirm",
  revision: "r1",
  name: "結帳確認申請",
  changelog: "初版:分店、類型、收銀點、接班人、應有 / 實點 / 差額 / 留給下一班、說明;結帳內容由精靈帶入(唯讀時不顯示)",
  desiredStatus: "published",
  moduleKey: "store",
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  serial: {
    prefix: "C",
    period: "none",
    digits: 4,
  },
  voidReasonCategoryKey: "void-reason",
  definition: {
    fields: [
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
        key: "type",
        label: "類型",
        type: "select",
        widget: {
          kind: "dropdown",
        },
        valueSource: {
          kind: "input",
        },
        options: {
          kind: "static",
          items: [
            {
              value: "shift",
              label: "交班",
              order: 1,
              enabled: true,
            },
            {
              value: "daily",
              label: "日結",
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
        key: "cash_point",
        label: "收銀點",
        type: "text",
        widget: {
          kind: "textField",
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          maxLength: 60,
        },
        help: "交班的收銀點名稱,由精靈帶入;日結為空",
      },
      {
        key: "successor",
        label: "接班人",
        type: "reference",
        widget: {
          kind: "referencePicker",
        },
        valueSource: {
          kind: "input",
        },
        source: {
          provider: "user",
          labelField: "name",
        },
        help: "交班時選填;「留給下一班」大於 0 時必填。有接班人由接班人審核,沒有改由店長審核",
      },
      {
        key: "expected",
        label: "應有",
        type: "number",
        widget: {
          kind: "number",
        },
        valueSource: {
          kind: "input",
        },
      },
      {
        key: "counted",
        label: "實點",
        type: "number",
        widget: {
          kind: "number",
        },
        valueSource: {
          kind: "input",
        },
      },
      {
        key: "difference",
        label: "差額",
        type: "number",
        widget: {
          kind: "number",
        },
        valueSource: {
          kind: "input",
        },
      },
      {
        key: "left_for_next",
        label: "留給下一班",
        type: "number",
        widget: {
          kind: "number",
        },
        valueSource: {
          kind: "input",
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
      {
        key: "draft",
        label: "結帳內容(系統)",
        type: "multiline",
        widget: {
          kind: "textArea",
          hideWhenReadonly: true,
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          required: true,
        },
        help: "精靈帶入的結帳內容,不要手動修改",
      },
    ],
    layout: {
      sections: [
        {
          key: "basic",
          title: "結帳確認申請",
          rows: [
            {
              cols: [
                {
                  fieldKey: "branch",
                  span: 4,
                },
                {
                  fieldKey: "type",
                  span: 4,
                },
                {
                  fieldKey: "cash_point",
                  span: 4,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "expected",
                  span: 3,
                },
                {
                  fieldKey: "counted",
                  span: 3,
                },
                {
                  fieldKey: "difference",
                  span: 3,
                },
                {
                  fieldKey: "left_for_next",
                  span: 3,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "successor",
                  span: 6,
                },
                {
                  fieldKey: "note",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "draft",
                  span: 12,
                },
              ],
            },
          ],
        },
      ],
    },
    summaryMap: {
      title: "cash_point",
      date: null,
    },
    prefills: [],
  },
} satisfies SeedSet;
