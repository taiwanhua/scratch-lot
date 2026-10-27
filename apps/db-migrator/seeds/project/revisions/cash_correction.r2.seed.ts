/* eslint-disable unicorn/filename-case -- 定義快照的檔名固定為 <key>.<revision>.seed.ts,表單 / 流程 key 是底線格式;到期條件:匯出檔名規則或 key 格式改變時移除 */
import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "form-definition",
  key: "cash_correction",
  revision: "r2",
  name: "現金更正單",
  changelog: "依欄位共用:分店指到的分店也看得到這張單(唯讀)",
  desiredStatus: "published",
  moduleKey: "store",
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  serial: {
    prefix: "X",
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
        key: "direction",
        label: "方向",
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
              value: "increase",
              label: "現金增加",
              order: 1,
              enabled: true,
            },
            {
              value: "decrease",
              label: "現金減少",
              order: 2,
              enabled: true,
            },
          ],
        },
        default: {
          kind: "constant",
          value: "increase",
        },
        rules: {
          required: true,
        },
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
          min: 1,
        },
      },
      {
        key: "place",
        label: "位置",
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
              value: "drawer",
              label: "某一班的抽屜",
              order: 1,
              enabled: true,
            },
            {
              value: "vault",
              label: "小金庫",
              order: 2,
              enabled: true,
            },
          ],
        },
        default: {
          kind: "constant",
          value: "drawer",
        },
        rules: {
          required: true,
        },
        help: "關店後發現的錢一律選小金庫",
      },
      {
        key: "shift",
        label: "班次",
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
              var: "place",
            },
            "drawer",
          ],
        },
        rules: {
          required: true,
        },
        help: "錢在哪一班的抽屜;只能選本店的班",
      },
      {
        key: "attributed_shift",
        label: "歸屬班次(選填)",
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
        help: "表示是誰的責任,可以選已結帳的班(只做歸屬)",
      },
      {
        key: "reason",
        label: "原因類別",
        type: "select",
        widget: {
          kind: "dropdown",
        },
        valueSource: {
          kind: "input",
        },
        options: {
          kind: "fieldCategory",
          key: "lottery-cash-correction-reason",
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
          required: true,
          maxLength: 200,
        },
      },
    ],
    layout: {
      sections: [
        {
          key: "basic",
          title: "現金更正單",
          rows: [
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
                  fieldKey: "direction",
                  span: 6,
                },
                {
                  fieldKey: "amount",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "place",
                  span: 6,
                },
                {
                  fieldKey: "shift",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "attributed_shift",
                  span: 6,
                },
                {
                  fieldKey: "reason",
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
      amount: "amount",
    },
    prefills: [],
  },
} satisfies SeedSet;
