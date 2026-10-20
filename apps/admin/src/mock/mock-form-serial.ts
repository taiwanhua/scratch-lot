import { type ModuleListColumn, ModuleListColumnKind } from "@repo/graphql";

import { DEMO_FORM_KEY } from "@/test/msw/form-fixtures";

/** 購物單的單號格式(每月重新起算):表單設定的「單號」區塊看得到格式與預覽。 */
export const MOCK_SHOPPING_SERIAL = {
  prefix: "PU",
  period: "month",
  digits: 4,
  separator: "-",
} as const;

/** 示範表單(頂層)的列表欄:標題、單號、日期(單號欄見 `docs/modules/forms.md`「單號」)。 */
export const MOCK_DEMO_FORM_LIST_COLUMNS: Record<string, ModuleListColumn[]> = {
  [DEMO_FORM_KEY]: [
    ["title", 220],
    ["serialNo", 160],
    ["date", 140],
  ].map(([key, width], order) => ({
    kind: ModuleListColumnKind.Slot,
    key: String(key),
    formKey: null,
    width: Number(width),
    order,
  })),
};
