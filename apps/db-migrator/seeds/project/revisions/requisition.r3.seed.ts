import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "form-definition",
  key: "requisition",
  revision: "r3",
  name: "叫貨單",
  changelog: "作廢原因類別改用刮刮樂與排班共用的「作廢原因」(void-reason)",
  desiredStatus: "published",
  moduleKey: "purchasing.requisition",
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: true,
  serial: {
    prefix: "R",
    period: "none",
    digits: 4,
  },
  voidReasonCategoryKey: "void-reason",
  definition: {
    fields: [
      {
        key: "branch",
        label: "叫貨分店",
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
        key: "expected_date",
        label: "期望到貨日",
        type: "date",
        widget: {
          kind: "datePicker",
        },
        valueSource: {
          kind: "input",
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
            rules: {
              required: true,
            },
            width: 220,
          },
          {
            key: "books",
            label: "本數",
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
              maxLength: 100,
            },
            width: 200,
          },
        ],
        rules: {
          required: true,
          maxRows: 200,
        },
      },
      {
        key: "total_books",
        label: "本數",
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
              "books",
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
          title: "叫貨單",
          rows: [
            {
              cols: [
                {
                  fieldKey: "branch",
                  span: 6,
                },
                {
                  fieldKey: "expected_date",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "lines",
                  span: 12,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "total_books",
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
      date: "expected_date",
    },
    prefills: [],
  },
} satisfies SeedSet;
