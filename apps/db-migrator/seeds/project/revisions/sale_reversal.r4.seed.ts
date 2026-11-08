/* eslint-disable unicorn/filename-case -- 定義快照的檔名固定為 <key>.<revision>.seed.ts,表單 / 流程 key 是底線格式;到期條件:匯出檔名規則或 key 格式改變時移除 */
import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "form-definition",
  key: "sale_reversal",
  revision: "r4",
  name: "撤銷售出申請",
  changelog: "張數店:明細列加種類(依張號 / 依遊戲 + 張數)、遊戲、收銀點、張數;依遊戲 + 張數的列沒有本與張號,本、張號、張數改成不必填(依種類由送出前檢查)",
  desiredStatus: "published",
  moduleKey: "store",
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  serial: {
    prefix: "SR",
    period: "none",
    digits: 4,
  },
  voidReasonCategoryKey: "void-reason",
  sharedByFieldKeys: [
    "branch",
  ],
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
        key: "lines",
        label: "張數",
        type: "array",
        widget: {
          kind: "table",
        },
        valueSource: {
          kind: "input",
        },
        columns: [
          {
            key: "line_kind",
            label: "種類",
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
                  value: "by_ticket",
                  label: "依張號",
                  order: 1,
                  enabled: true,
                },
                {
                  value: "by_count",
                  label: "依遊戲 + 張數",
                  order: 2,
                  enabled: true,
                },
              ],
            },
            width: 120,
          },
          {
            key: "book",
            label: "本",
            type: "reference",
            widget: {
              kind: "referencePicker",
            },
            valueSource: {
              kind: "input",
            },
            source: {
              provider: "lottery_book",
              labelField: "bookKey",
            },
            width: 160,
          },
          {
            key: "ticket_nos",
            label: "張號",
            type: "text",
            widget: {
              kind: "textField",
            },
            valueSource: {
              kind: "input",
            },
            rules: {
              maxLength: 400,
            },
            width: 200,
          },
          {
            key: "tickets",
            label: "張數",
            type: "number",
            precision: 0,
            widget: {
              kind: "number",
            },
            valueSource: {
              kind: "input",
            },
            rules: {
              min: 1,
              max: 999,
            },
            width: 80,
          },
          {
            key: "game",
            label: "遊戲",
            type: "reference",
            widget: {
              kind: "referencePicker",
            },
            valueSource: {
              kind: "input",
            },
            source: {
              provider: "lottery_game",
              labelField: "name",
            },
            width: 160,
          },
          {
            key: "cash_point",
            label: "收銀點",
            type: "reference",
            widget: {
              kind: "referencePicker",
            },
            valueSource: {
              kind: "input",
            },
            source: {
              provider: "lottery_cash_point",
              labelField: "name",
            },
            width: 140,
          },
          {
            key: "count",
            label: "張數(依遊戲)",
            type: "number",
            precision: 0,
            widget: {
              kind: "number",
            },
            valueSource: {
              kind: "input",
            },
            rules: {
              min: 1,
              max: 999,
            },
            width: 80,
          },
          {
            key: "amount",
            label: "金額",
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
              min: 0,
            },
            width: 100,
          },
        ],
        rules: {
          required: true,
          maxRows: 200,
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
          key: "lottery-sale-reversal-reason",
        },
        rules: {
          required: true,
        },
      },
      {
        key: "refund",
        label: "退款給客人",
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
              value: "yes",
              label: "是",
              order: 1,
              enabled: true,
            },
            {
              value: "no",
              label: "否",
              order: 2,
              enabled: true,
            },
          ],
        },
        default: {
          kind: "constant",
          value: "no",
        },
        rules: {
          required: true,
        },
      },
      {
        key: "refund_shift",
        label: "退款班次",
        type: "reference",
        widget: {
          kind: "referencePicker",
        },
        valueSource: {
          kind: "input",
        },
        source: {
          provider: "lottery_shift",
          labelField: "label",
        },
        visibleWhen: {
          "==": [
            {
              var: "refund",
            },
            "yes",
          ],
        },
        rules: {
          required: true,
        },
        help: "只能選本店的班;預設送出人目前的班",
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
        key: "refund_amount",
        label: "退款金額",
        type: "number",
        precision: 0,
        widget: {
          kind: "number",
        },
        valueSource: {
          kind: "computed",
          expr: {
            sumOf: [
              "lines",
              "amount",
            ],
          },
        },
      },
    ],
    layout: {
      sections: [
        {
          key: "basic",
          title: "撤銷售出申請",
          rows: [
            {
              cols: [
                {
                  fieldKey: "branch",
                  span: 6,
                },
                {
                  fieldKey: "reason",
                  span: 6,
                },
              ],
            },
          ],
        },
        {
          key: "lines",
          title: "張數",
          rows: [
            {
              cols: [
                {
                  fieldKey: "lines",
                  span: 12,
                },
              ],
            },
          ],
        },
        {
          key: "refund",
          title: "退款",
          rows: [
            {
              cols: [
                {
                  fieldKey: "refund",
                  span: 6,
                },
                {
                  fieldKey: "refund_shift",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "note",
                  span: 6,
                },
                {
                  fieldKey: "refund_amount",
                  span: 6,
                },
              ],
            },
          ],
        },
      ],
    },
    summaryMap: {
      title: "note",
      amount: "refund_amount",
    },
    prefills: [],
  },
} satisfies SeedSet;
