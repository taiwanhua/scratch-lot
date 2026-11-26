import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "form-definition",
  key: "wholesale",
  revision: "r1",
  name: "批售單",
  changelog: "初版:分店把未拆的整本批售給批售客戶",
  desiredStatus: "published",
  moduleKey: "purchasing.wholesale",
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: true,
  voidReasonCategoryKey: "void-reason",
  serial: {
    prefix: "W",
    period: "none",
    digits: 4,
  },
  sharedByFieldKeys: [
    "from_branch",
  ],
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
        key: "customer",
        label: "批售客戶",
        type: "reference",
        widget: {
          kind: "referencePicker",
        },
        valueSource: {
          kind: "input",
        },
        source: {
          provider: "lottery_wholesale_customer",
          labelField: "label",
          filter: {
            status: "active",
          },
        },
        rules: {
          required: true,
        },
      },
      {
        key: "payment_mode",
        label: "收款方式",
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
              value: "auto_bank",
              label: "從帳戶入帳",
              order: 1,
              enabled: true,
            },
            {
              value: "collect_first",
              label: "收到錢再核准",
              order: 2,
              enabled: true,
            },
          ],
        },
        default: {
          kind: "constant",
          value: "collect_first",
        },
        rules: {
          required: true,
        },
      },
      {
        key: "account",
        label: "入帳帳戶",
        type: "reference",
        widget: {
          kind: "referencePicker",
        },
        valueSource: {
          kind: "input",
        },
        source: {
          provider: "lottery_bank_account",
          labelField: "label",
          filter: {
            status: "active",
          },
        },
        visibleWhen: {
          "==": [
            {
              var: "payment_mode",
            },
            "auto_bank",
          ],
        },
        rules: {
          required: true,
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
            prefill: {
              mapping: [
                {
                  sourceField: "ticketsPerBook",
                  fieldKey: "tickets",
                },
                {
                  sourceField: "bookPrice",
                  fieldKey: "book_price",
                },
                {
                  sourceField: "defaultRate",
                  fieldKey: "rate",
                },
              ],
            },
            rules: {
              required: true,
            },
            width: 200,
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
            },
            width: 90,
          },
          {
            key: "book_price",
            label: "整本金額",
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
            width: 110,
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
            key: "amount",
            label: "批售金額",
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
                        var: "row.book_price",
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
        key: "wholesale_total",
        label: "批售金額",
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
          title: "批售單",
          rows: [
            {
              cols: [
                {
                  fieldKey: "from_branch",
                  span: 3,
                },
                {
                  fieldKey: "customer",
                  span: 3,
                },
                {
                  fieldKey: "payment_mode",
                  span: 3,
                },
                {
                  fieldKey: "account",
                  span: 3,
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
                  fieldKey: "wholesale_total",
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
      amount: "wholesale_total",
    },
    prefills: [],
  },
} satisfies SeedSet;
