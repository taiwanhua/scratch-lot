import type {
  ExpressionContext,
  FieldDef,
  FieldType,
  FormDefinition,
} from "./types";

/** 測試夾具:各型別的預設 widget(與 `DEFAULT_WIDGET_REGISTRY` 的第一個一致)。 */
const DEFAULT_WIDGET: Record<FieldType, string> = {
  text: "textField",
  multiline: "textArea",
  number: "number",
  date: "datePicker",
  datetime: "dateTimePicker",
  select: "dropdown",
  multiSelect: "checkboxGroup",
  boolean: "switch",
  upload: "upload",
  reference: "referencePicker",
  array: "table",
};

/** 一個最小可用的欄位;`overrides` 蓋掉任何屬性。 */
export function field(
  key: string,
  type: FieldType,
  overrides: Partial<FieldDef> = {},
): FieldDef {
  return {
    key,
    label: key,
    type,
    widget: { kind: DEFAULT_WIDGET[type] },
    valueSource: { kind: "input" },
    ...(type === "number" ? { precision: 0 } : {}),
    ...(type === "select" || type === "multiSelect"
      ? {
          options: {
            kind: "static" as const,
            items: [
              { value: "sick", label: "病假", order: 1, enabled: true },
              { value: "annual", label: "特休", order: 2, enabled: true },
            ],
          },
        }
      : {}),
    ...overrides,
  };
}

/** 每個非固定值欄位各佔一列的版面 + 標題槽對第一個文字欄位。 */
export function definitionOf(
  fields: FieldDef[],
  overrides: Partial<FormDefinition> = {},
): FormDefinition {
  const placed = fields.filter(
    (candidate) => candidate.valueSource.kind !== "constant",
  );
  return {
    fields,
    layout: {
      sections: [
        {
          key: "basic",
          title: "基本資料",
          rows: placed.map((candidate) => ({
            cols: [{ fieldKey: candidate.key, span: 12 }],
          })),
        },
      ],
    },
    summaryMap: {
      title: fields.find((candidate) => candidate.type === "text")?.key ?? null,
    },
    prefills: [],
    ...overrides,
  };
}

export const CTX: ExpressionContext = {
  now: "2026-03-01T01:00:00.000Z",
  timezone: "Asia/Taipei",
  user: { id: "user-1", orgId: "org-1", orgIds: ["org-1"] },
  tenant: { id: "tenant-1" },
};
