import { useTranslations } from "use-intl";

import {
  FIELD_EXPRESSION_TYPES,
  type FieldDef,
  type FieldDefault,
  REFERENCE_DEFAULT_PATHS,
  defaultKindsOf,
} from "@repo/domain/form";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { ExpressionPicker } from "@/components/base/form-engine/ExpressionPicker/ExpressionPicker";
import { TypedValueInput } from "@/components/base/form-engine/TypedValueInput/TypedValueInput";
import { initialExpressionOf } from "@/lib/base/form-engine/expression-options";

export interface DefaultValueEditorProps {
  field: FieldDef;
  fields: readonly FieldDef[];
  /** 類別 / lookup 選項欄用填寫時的選擇器挑,要知道查哪張表單(草稿) */
  formKey: string;
  /** 預設值公式(`default.expr`)的檢查結果 */
  exprIssues: readonly string[];
  onChange: (value: FieldDefault | null) => void;
}

type PartProps = DefaultValueEditorProps & { constant: unknown };

const NONE = "";

/** 引用欄預設值目前選的系統值路徑(`{ var: "ctx.user.id" }` → `ctx.user.id`);沒設為空字串。 */
const referencePathOf = (value: FieldDefault | null | undefined): string => {
  if (value?.kind !== "expression") {
    return NONE;
  }
  const expr = value.expr as { var?: unknown } | null;
  const raw: unknown = expr?.var;
  const path: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  return typeof path === "string" ? path : NONE;
};

/** 空值(沒選、清空)= 拿掉預設值,不存 `{ kind: "constant", value: null }`。 */
const constantOf = (value: unknown): FieldDefault | null =>
  value === null || value === "" || (Array.isArray(value) && value.length === 0)
    ? null
    : { kind: "constant", value };

/** 引用:只能系統值「填寫者 / 填寫者的組織」。 */
const ReferenceDefault = ({ field, onChange }: PartProps) => {
  const t = useTranslations("admin.forms.property");
  return (
    <SelectField<string>
      label={t("defaultValue")}
      value={referencePathOf(field.default)}
      displayEmpty
      options={[
        { value: NONE, label: t("defaultKinds.none") },
        ...REFERENCE_DEFAULT_PATHS.map((path) => ({
          value: path,
          label: t(`defaultSystem.${path === "ctx.user.id" ? "user" : "org"}`),
        })),
      ]}
      onChange={(path) => {
        onChange(
          path === NONE ? null : { kind: "expression", expr: { var: path } },
        );
      }}
      size="small"
    />
  );
};

/** 是否:固定值(是 / 否)。 */
const BooleanDefault = ({ field, constant, onChange }: PartProps) => {
  const t = useTranslations("admin.forms.property");
  return (
    <TypedValueInput
      field={field}
      label={t("defaultValue")}
      value={constant}
      emptyLabel={t("defaultKinds.none")}
      onChange={(next) => {
        onChange(constantOf(next));
      }}
    />
  );
};

/** 單選 / 多選:從選項挑 —— 靜態清單直接挑;類別 / 資料來源用填寫時的同一個選擇器挑(選項以已存的草稿查詢)。 */
const ChoiceDefault = ({ field, formKey, constant, onChange }: PartProps) => {
  const t = useTranslations("admin.forms.property");
  const isStatic = field.options?.kind === "static";
  return (
    <Stack spacing={0.5}>
      <TypedValueInput
        field={field}
        label={t("defaultValue")}
        value={constant}
        formKey={formKey}
        {...(isStatic
          ? { emptyLabel: t("defaultKinds.none") }
          : { helperText: t("defaultPickerHint") })}
        onChange={(next) => {
          onChange(constantOf(next));
        }}
      />
      {!isStatic && constant !== null && (
        <Stack direction="row">
          <Button
            variant="text"
            size="small"
            onClick={() => {
              onChange(null);
            }}
          >
            {t("defaultClear")}
          </Button>
        </Stack>
      )}
    </Stack>
  );
};

/** 固定值的輸入元件:依型別(`TypedValueInput`;日期存選的那天在租戶時區 00:00 的 ISO)。 */
const ConstantInput = ({ field, constant, onChange }: PartProps) => {
  const t = useTranslations("admin.forms.property");
  return (
    <TypedValueInput
      field={field}
      label={t("defaultConstant")}
      value={constant}
      onChange={(value) => {
        onChange({ kind: "constant", value });
      }}
    />
  );
};

/** 文字 / 多行 / 數字 / 日期 / 日期時間:不設 / 固定值 / 公式(根型別 = 欄位型別,不可引用自己)。 */
const ScalarDefault = (props: PartProps) => {
  const { field, fields, exprIssues, onChange } = props;
  const t = useTranslations("admin.forms.property");
  const current = field.default ?? null;
  const resultType = FIELD_EXPRESSION_TYPES[field.type];
  return (
    <Stack spacing={1}>
      <SelectField<string>
        label={t("defaultValue")}
        value={current?.kind ?? NONE}
        displayEmpty
        options={[
          { value: NONE, label: t("defaultKinds.none") },
          ...defaultKindsOf(field.type).map((item) => ({
            value: item,
            label: t(`defaultKinds.${item}`),
          })),
        ]}
        onChange={(next) => {
          if (next === "expression") {
            onChange({
              kind: "expression",
              expr: initialExpressionOf(
                resultType === null ? null : [resultType],
              ),
            });
          } else {
            onChange(
              next === "constant" ? { kind: "constant", value: null } : null,
            );
          }
        }}
        size="small"
      />
      {current?.kind === "expression" && (
        <ExpressionPicker
          label={t("defaultFormula")}
          value={current.expr}
          fields={fields.filter((candidate) => candidate.key !== field.key)}
          usage="formula"
          resultType={resultType}
          resultField={field}
          formKey={props.formKey}
          issues={exprIssues}
          onChange={(expr) => {
            onChange({ kind: "expression", expr: expr ?? null });
          }}
        />
      )}
      {current?.kind === "constant" && <ConstantInput {...props} />}
      <Typography variant="caption" color="text.secondary">
        {t("defaultHint")}
      </Typography>
    </Stack>
  );
};

/**
 * 預設值(值來源 = 使用者填才出現,上傳沒有):
 * - 文字 / 多行 / 數字 / 日期 / 日期時間:固定值或公式(公式根型別 = 欄位型別,不可引用自己)
 * - 單選 / 多選:從選項挑 —— 靜態清單直接挑;類別 / 資料來源用填寫時的同一個選擇器挑
 * - 是否:固定值(是 / 否);引用:只能系統值「填寫者 / 填寫者的組織」
 *
 * 使用者沒改過這個欄位前,它依賴的欄位變了會跟著重算;改過就停。
 */
export const DefaultValueEditor = (props: DefaultValueEditorProps) => {
  const current = props.field.default ?? null;
  const parts: PartProps = {
    ...props,
    constant: current?.kind === "constant" ? current.value : null,
  };
  switch (props.field.type) {
    case "reference": {
      return <ReferenceDefault {...parts} />;
    }
    case "boolean": {
      return <BooleanDefault {...parts} />;
    }
    case "select":
    case "multiSelect": {
      return <ChoiceDefault {...parts} />;
    }
    default: {
      return <ScalarDefault {...parts} />;
    }
  }
};
