import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "form-definition",
  key: "purchase",
  revision: "r4",
  name: "進貨單",
  changelog: "批購受託人:本人批購 = 否時必填(本人批購 = 是時隱藏、不檢查)",
  desiredStatus: "published",
  moduleKey: "purchasing.purchase",
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: true,
  voidReasonCategoryKey: "void-reason",
  serial: {
    prefix: "P",
    period: "none",
    digits: 4,
  },
  definition: {
    fields: [
      {
        key: "branch",
        label: "進貨分店",
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
        key: "dealer",
        label: "批購甲類",
        type: "reference",
        widget: {
          kind: "referencePicker",
        },
        valueSource: {
          kind: "input",
        },
        source: {
          provider: "lottery_dealer",
          labelField: "name",
          filter: {
            type: "a",
            status: "active",
          },
        },
        rules: {
          required: true,
        },
      },
      {
        key: "self_purchase",
        label: "本人批購",
        type: "boolean",
        widget: {
          kind: "switch",
        },
        valueSource: {
          kind: "input",
        },
        default: {
          kind: "constant",
          value: true,
        },
      },
      {
        key: "trustee",
        label: "批購受託人",
        type: "reference",
        widget: {
          kind: "referencePicker",
        },
        valueSource: {
          kind: "input",
        },
        source: {
          provider: "lottery_dealer_contact",
          labelField: "name",
          filter: {
            status: "active",
            roles: "trustee",
          },
        },
        visibleWhen: {
          "!": [
            {
              var: "self_purchase",
            },
          ],
        },
        rules: {
          required: true,
        },
      },
      {
        key: "purchase_date",
        label: "批購日期",
        type: "date",
        widget: {
          kind: "datePicker",
        },
        valueSource: {
          kind: "input",
        },
        default: {
          kind: "expression",
          expr: {
            var: "ctx.now",
          },
        },
        rules: {
          required: true,
        },
      },
      {
        key: "account",
        label: "扣款帳戶",
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
              filter: {
                status: "on_sale",
              },
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
            key: "book_no",
            label: "本號",
            type: "text",
            widget: {
              kind: "textField",
            },
            valueSource: {
              kind: "input",
            },
            rules: {
              required: true,
              pattern: "^[0-9]{6,7}$",
              patternMessage: "本號要 6 或 7 位數字",
            },
            width: 110,
          },
          {
            key: "last_ticket_no",
            label: "最後張號",
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
            width: 100,
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
        key: "purchase_total",
        label: "批購合計",
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
        key: "redemptions",
        label: "兌獎",
        type: "array",
        widget: {
          kind: "table",
        },
        valueSource: {
          kind: "input",
        },
        columns: [
          {
            key: "redemption",
            label: "兌獎紀錄",
            type: "reference",
            widget: {
              kind: "referencePicker",
            },
            valueSource: {
              kind: "input",
            },
            source: {
              provider: "lottery_redemption",
              labelField: "ticketLabel",
              filter: {
                status: "in_store",
              },
            },
            prefill: {
              mapping: [
                {
                  sourceField: "prizeAmount",
                  fieldKey: "prize_amount",
                },
              ],
            },
            rules: {
              required: true,
            },
            width: 200,
          },
          {
            key: "prize_amount",
            label: "中獎金額",
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
            width: 110,
          },
        ],
        rules: {
          maxRows: 200,
        },
      },
      {
        key: "redemption_total",
        label: "兌獎金額",
        type: "number",
        precision: 0,
        widget: {
          kind: "number",
        },
        valueSource: {
          kind: "computed",
          expr: {
            sumOf: [
              "redemptions",
              "prize_amount",
            ],
          },
        },
      },
      {
        key: "redemption_offset",
        label: "兌獎折抵",
        type: "number",
        precision: 0,
        widget: {
          kind: "number",
        },
        valueSource: {
          kind: "computed",
          expr: {
            min: [
              {
                var: "redemption_total",
              },
              {
                var: "purchase_total",
              },
            ],
          },
        },
      },
      {
        key: "deducted_amount",
        label: "扣款金額",
        type: "number",
        precision: 0,
        widget: {
          kind: "number",
        },
        valueSource: {
          kind: "computed",
          expr: {
            "-": [
              {
                var: "purchase_total",
              },
              {
                var: "redemption_offset",
              },
            ],
          },
        },
      },
      {
        key: "redemption_remainder",
        label: "兌獎剩餘",
        type: "number",
        precision: 0,
        widget: {
          kind: "number",
        },
        valueSource: {
          kind: "computed",
          expr: {
            "-": [
              {
                var: "redemption_total",
              },
              {
                var: "redemption_offset",
              },
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
          title: "進貨單",
          rows: [
            {
              cols: [
                {
                  fieldKey: "branch",
                  span: 3,
                },
                {
                  fieldKey: "requisition",
                  span: 3,
                },
                {
                  fieldKey: "dealer",
                  span: 3,
                },
                {
                  fieldKey: "self_purchase",
                  span: 3,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "trustee",
                  span: 3,
                },
                {
                  fieldKey: "purchase_date",
                  span: 3,
                },
                {
                  fieldKey: "account",
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
          key: "redemptions",
          title: "兌獎",
          rows: [
            {
              cols: [
                {
                  fieldKey: "redemptions",
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
                  fieldKey: "purchase_total",
                  span: 4,
                },
                {
                  fieldKey: "redemption_total",
                  span: 4,
                },
                {
                  fieldKey: "redemption_offset",
                  span: 4,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "deducted_amount",
                  span: 4,
                },
                {
                  fieldKey: "redemption_remainder",
                  span: 4,
                },
              ],
            },
          ],
        },
      ],
    },
    summaryMap: {
      title: "note",
      date: "purchase_date",
      amount: "deducted_amount",
    },
    prefills: [],
  },
} satisfies SeedSet;
