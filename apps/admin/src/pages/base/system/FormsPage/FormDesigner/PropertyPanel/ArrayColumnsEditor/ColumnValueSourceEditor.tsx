import { useTranslations } from "use-intl";

import {
  type ArrayColumnDef,
  FIELD_EXPRESSION_TYPES,
  type FieldDef,
  ROW_VAR_PREFIX,
  arrayColumnsOf,
} from "@repo/domain/form";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import { ExpressionPicker } from "@/components/base/form-engine/ExpressionPicker/ExpressionPicker";
import { initialExpressionOf } from "@/lib/base/form-engine/expression-options";

export interface ColumnValueSourceEditorProps {
  arrayField: FieldDef;
  column: ArrayColumnDef;
  fields: readonly FieldDef[];
  formKey: string;
  exprIssues: readonly string[];
  onChange: (valueSource: ArrayColumnDef["valueSource"]) => void;
}

type SourceKind = ArrayColumnDef["valueSource"]["kind"];

const SOURCE_KINDS: readonly SourceKind[] = ["input", "computed"];

/**
 * 子欄的值來源:使用者填 / 列內公式(沒有固定值)。列內公式的選擇器可選:同一列的其他子欄(`row.<子欄 key>`,
 * 畫面上標「本列・」)、表單層欄位、系統值與彙總(明細欄 key 從下拉挑);根要回子欄的型別。
 */
export const ColumnValueSourceEditor = ({
  arrayField,
  column,
  fields,
  formKey,
  exprIssues,
  onChange,
}: ColumnValueSourceEditorProps) => {
  const t = useTranslations("admin.forms.columns");
  const tProperty = useTranslations("admin.forms.property");
  const resultType = FIELD_EXPRESSION_TYPES[column.type];
  const source = column.valueSource;
  // 同一列的其他子欄當成 `row.<key>` 欄位給選擇器(引用自己 = 循環,不列)
  const rowFields: FieldDef[] = arrayColumnsOf(arrayField)
    .filter((candidate) => candidate.key !== column.key)
    .map((candidate) => ({
      ...candidate,
      key: `${ROW_VAR_PREFIX}${candidate.key}`,
      label: t("rowField", { label: candidate.label }),
    }));

  return (
    <Stack spacing={1.5}>
      <SelectField<SourceKind>
        label={tProperty("valueSource")}
        value={source.kind}
        options={SOURCE_KINDS.map((kind) => ({
          value: kind,
          label: t(`sources.${kind}`),
        }))}
        onChange={(kind) => {
          onChange(
            kind === "computed"
              ? {
                  kind,
                  expr: initialExpressionOf(
                    resultType === null ? null : [resultType],
                  ),
                }
              : { kind: "input" },
          );
        }}
        size="small"
      />
      {source.kind === "computed" && (
        <ExpressionPicker
          label={t("formula")}
          value={source.expr}
          fields={[...rowFields, ...fields]}
          usage="formula"
          resultType={resultType}
          resultField={column}
          formKey={formKey}
          issues={exprIssues}
          onChange={(expr) => {
            onChange({ kind: "computed", expr: expr ?? null });
          }}
        />
      )}
    </Stack>
  );
};
