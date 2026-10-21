import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "form-definition",
  key: "transfer",
  revision: "r2",
  name: "調貨單",
  changelog: "作廢原因類別改用刮刮樂與排班共用的「作廢原因」(void-reason)",
  desiredStatus: "published",
  moduleKey: "purchasing.transfer",
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: true,
  voidReasonCategoryKey: "void-reason",
  serial: {
    prefix: "T",
    period: "none",
    digits: 4,
  },
  definition: {
    fields: [
      {
        key: "from_branch",
        label: "出貨分店",
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
        key: "to_branch",
        label: "收貨分店",
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
        rules: {
          required: true,
        },
      },
      {
        key: "requisition",
        label: "叫貨單",
        type: "text",
        widget: {
          kind: "textField",
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          maxLength: 30,
        },
      },
      {
        key: "lines",
        label: "明細",
        type: "array",
        widget: {
          kind: "table",
        },
        valueSource: {
          kind: "input",
        },
        columns: [
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
              filter: {
                status: "normal",
              },
            },
            rules: {
              required: true,
            },
            width: 150,
          },
          {
            key: "mode",
            label: "方式",
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
                  value: "whole",
                  label: "整本",
                  order: 1,
                  enabled: true,
                },
                {
                  value: "partial",
                  label: "選張",
                  order: 2,
                  enabled: true,
                },
              ],
            },
            rules: {
              required: true,
            },
            width: 90,
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
            width: 160,
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
              required: true,
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
          {
            key: "rate",
            label: "批購金額率",
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
              max: 100,
            },
            width: 100,
          },
          {
            key: "purchase_amount",
            label: "批購金額",
            type: "number",
            precision: 0,
            widget: {
              kind: "number",
            },
            valueSource: {
              kind: "computed",
              expr: {
                "/": [
                  {
                    "*": [
                      {
                        var: "row.amount",
                      },
                      {
                        var: "row.rate",
                      },
                    ],
                  },
                  100,
                ],
              },
            },
            width: 110,
          },
        ],
        rules: {
          required: true,
          maxRows: 200,
        },
      },
      {
        key: "transfer_total",
        label: "調貨金額",
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
              "purchase_amount",
            ],
          },
        },
      },
      {
        key: "note",
        label: "備註",
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
          title: "調貨單",
          rows: [
            {
              cols: [
                {
                  fieldKey: "from_branch",
                  span: 3,
                },
                {
                  fieldKey: "to_branch",
                  span: 3,
                },
                {
                  fieldKey: "requisition",
                  span: 3,
                },
                {
                  fieldKey: "note",
                  span: 3,
                },
              ],
            },
          ],
        },
        {
          key: "lines",
          title: "明細",
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
          key: "totals",
          title: "合計",
          rows: [
            {
              cols: [
                {
                  fieldKey: "transfer_total",
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
      amount: "transfer_total",
    },
    prefills: [],
  },
} satisfies SeedSet;
