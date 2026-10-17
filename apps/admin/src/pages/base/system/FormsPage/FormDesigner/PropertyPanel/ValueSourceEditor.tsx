import { useTranslations } from "use-intl";

import {
  FIELD_EXPRESSION_TYPES,
  type FieldDef,
  type ValueSource,
} from "@repo/domain/form";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import { ExpressionPicker } from "@/components/base/form-engine/ExpressionPicker/ExpressionPicker";
import { TypedValueInput } from "@/components/base/form-engine/TypedValueInput/TypedValueInput";
import { initialExpressionOf } from "@/lib/base/form-engine/expression-options";

export interface ValueSourceEditorProps {
  field: FieldDef;
  fields: readonly FieldDef[];
  /** 類別 / lookup 選項欄的固定值與公式常數用填寫時的選擇器挑,要知道查哪張表單(草稿) */
  formKey: string;
  onChange: (valueSource: ValueSource) => void;
  exprIssues: readonly string[];
}

type SourceKind = ValueSource["kind"];

const SOURCE_KINDS: readonly SourceKind[] = ["input", "computed", "constant"];

/**
 * 值的來源(Spec 6a §5 `valueSource`):使用者填 / 計算(公式,結構化選擇器)/ 固定值(可不放進版面)。
 * 計算與固定值欄位填寫時唯讀,送出時後端重算並以後端為準。公式是**型別導向**的:根要回這個欄位的型別
 * (表 B;選項欄的根是「選項」),可引用除自己以外的欄位(上傳欄不能進表達式,選擇器自己濾掉)。
 * 固定值用依型別的輸入元件(`TypedValueInput`),存正確型別。上傳 / 引用欄位不顯示本區塊(表 A)。
 */
export const ValueSourceEditor = ({
  field,
  fields,
  formKey,
  onChange,
  exprIssues,
}: ValueSourceEditorProps) => {
  const t = useTranslations("admin.forms.property");
  const source = field.valueSource;
  const others = fields.filter((candidate) => candidate.key !== field.key);
  const resultType = FIELD_EXPRESSION_TYPES[field.type];
  // 類別 / 資料來源的選項以已存的草稿查詢:先存草稿才挑得到(同預設值)
  const isPickedFromSaved =
    (field.type === "select" || field.type === "multiSelect") &&
    field.options !== null &&
    field.options !== undefined &&
    field.options.kind !== "static";

  return (
    <Stack spacing={1.5}>
      <SelectField<SourceKind>
        label={t("valueSource")}
        value={source.kind}
        options={SOURCE_KINDS.map((kind) => ({
          value: kind,
          label: t(`sources.${kind}`),
        }))}
        onChange={(kind) => {
          if (kind === "computed") {
            onChange({
              kind,
              expr: initialExpressionOf(
                resultType === null ? null : [resultType],
              ),
            });
          } else if (kind === "constant") {
            onChange({ kind, value: null });
          } else {
            onChange({ kind });
          }
        }}
        size="small"
      />
      {source.kind === "computed" && (
        <ExpressionPicker
          label={t("formula")}
          value={source.expr}
          fields={others}
          usage="formula"
          resultType={resultType}
          resultField={field}
          formKey={formKey}
          issues={exprIssues}
          onChange={(expr) => {
            onChange({ kind: "computed", expr: expr ?? null });
          }}
        />
      )}
      {source.kind === "constant" && (
        <TypedValueInput
          field={field}
          label={t("constantValue")}
          value={source.value}
          formKey={formKey}
          {...(isPickedFromSaved && { helperText: t("defaultPickerHint") })}
          onChange={(value) => {
            onChange({ kind: "constant", value });
          }}
        />
      )}
    </Stack>
  );
};
