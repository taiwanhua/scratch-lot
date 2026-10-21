/* eslint-disable unicorn/filename-case -- 定義快照的檔名固定為 <key>.<revision>.seed.ts,表單 / 流程 key 是底線格式;到期條件:匯出檔名規則或 key 格式改變時移除 */
import type { SeedSet } from "@repo/domain/seed";

// 匯出的種子快照:不要手改內容或重新排版。
// prettier-ignore
export const seed = {
  kind: "form-definition",
  key: "stocktake_confirm",
  revision: "r1",
  name: "盤點確認申請",
  changelog: "初版:分店、盤點範圍、彙總、說明;盤點內容由盤點頁帶入(唯讀時不顯示)",
  desiredStatus: "published",
  moduleKey: "store",
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  serial: {
    prefix: "S",
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
        key: "scope_label",
        label: "盤點範圍",
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
        help: "全店或收銀點名稱,由盤點頁帶入",
      },
      {
        key: "totals",
        label: "彙總",
        type: "multiline",
        widget: {
          kind: "textArea",
        },
        valueSource: {
          kind: "input",
        },
        rules: {
          maxLength: 500,
        },
        help: "補登售出、新增待查、標記異常、確認遺失,由盤點頁帶入",
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
        label: "盤點內容(系統)",
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
        help: "盤點頁帶入的盤點內容,不要手動修改",
      },
    ],
    layout: {
      sections: [
        {
          key: "basic",
          title: "盤點確認申請",
          rows: [
            {
              cols: [
                {
                  fieldKey: "branch",
                  span: 6,
                },
                {
                  fieldKey: "scope_label",
                  span: 6,
                },
              ],
            },
            {
              cols: [
                {
                  fieldKey: "totals",
                  span: 12,
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
      title: "scope_label",
      date: null,
    },
    prefills: [],
  },
} satisfies SeedSet;
