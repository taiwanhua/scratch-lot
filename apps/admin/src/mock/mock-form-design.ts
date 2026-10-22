import type { FormDefinition } from "@repo/domain/form";
import { FormVersionStatus } from "@repo/graphql";

import type { FormDesignWorldOptions } from "@/test/msw/form-design-handlers";
import {
  SHOPPING_FORM_KEY,
  field,
  formFragment,
  shoppingDefinition,
  versionFragment,
} from "@/test/msw/form-fixtures";

import { MOCK_SHOPPING_SERIAL } from "./mock-form-serial";

/** 購物單發布版多一個組織欄「收貨組織」:表單設定的「依欄位共用」看得到可勾的組織欄(已勾)。 */
const SHARED_BY_FIELD_KEYS = ["receiver_org"];

const publishedDefinition = (): FormDefinition => {
  const base = shoppingDefinition();
  return {
    ...base,
    fields: [
      ...base.fields,
      field("receiver_org", "收貨組織", "reference", {
        widget: { kind: "referencePicker" },
        source: { provider: "org", labelField: "name" },
      }),
    ],
    layout: {
      sections: base.layout.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              rows: [
                ...section.rows,
                { cols: [{ fieldKey: "receiver_org", span: 6 }] },
              ],
            }
          : section,
      ),
    },
  };
};

/**
 * 表單管理的假資料:一張共用表單(購物單),已發布 v1 + 一份草稿;設了單號格式(`mock-form-serial.ts`)
 * 與依欄位共用(發布版的「收貨組織」)。
 */
export const mockFormDesign = (): FormDesignWorldOptions => ({
  forms: [
    formFragment({
      serial: MOCK_SHOPPING_SERIAL,
      sharedByFieldKeys: SHARED_BY_FIELD_KEYS,
    }),
  ],
  versions: {
    [SHOPPING_FORM_KEY]: [
      versionFragment(shoppingDefinition(), { baseVersion: 1 }),
      versionFragment(publishedDefinition(), {
        id: `ver-${SHOPPING_FORM_KEY}-1`,
        version: 1,
        status: FormVersionStatus.Published,
        changelog: "第一版",
      }),
    ],
  },
});
