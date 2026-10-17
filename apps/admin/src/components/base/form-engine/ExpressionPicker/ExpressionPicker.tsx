import { useMemo } from "react";
import { useTranslations } from "use-intl";

import {
  type ExpectedTypes,
  type Expression,
  type ExpressionValueType,
  type FieldDef,
  fieldTypeLookupOf,
  isOptionExpected,
} from "@repo/domain/form";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  type PickerUsage,
  initialExpressionOf,
} from "@/lib/base/form-engine/expression-options";

import { JsonPreview } from "../../JsonPreview";
import { ExpressionNodeEditor } from "./ExpressionNodeEditor";

export interface ExpressionPickerProps {
  label: string;
  /** undefined / null = 沒有設定 */
  value: Expression | undefined;
  onChange: (value: Expression | null) => void;
  /** 可引用的欄位(呼叫端依用途過濾:條件不含受保護欄位;顯示條件不含自己) */
  fields: readonly FieldDef[];
  /**
   * 用途(Spec 6a §5 表 B):`condition`(顯示 / 鎖定條件、自訂驗證、流程跳過條件)根要回是 / 否,
   * 常數與系統值不能單獨當根;`formula`(計算欄位、預設值)根要回 `resultType`。
   */
  usage?: PickerUsage;
  /** 公式的根要回的型別(= 欄位的表達式型別) */
  resultType?: ExpressionValueType | null;
  /**
   * 公式所屬的欄位:選項欄(根型別是「選項」)的根與 `if` 的然後 / 否則只列同選項來源的欄位,
   * 常數從它的選項挑
   */
  resultField?: FieldDef | null;
  /** 類別 / lookup 選項常數查詢用的表單 key(設計器 = 草稿);不給 = 空字串(查不到選項) */
  formKey?: string;
  /** 檢查器指到這個表達式的錯誤(就地顯示) */
  issues?: readonly string[];
  /** 沒有任何欄位可選時,欄位下拉顯示的提示(例:流程跳過條件「請先選檢查用表單」);不給 = 空清單 */
  emptyFieldsLabel?: string;
}

const BOOLEAN_ROOT: ExpectedTypes = ["boolean"];

/** 根要回的型別:條件 = 是 / 否;公式 = 欄位型別(不知道就不限)。 */
const rootTypesOf = (
  usage: PickerUsage,
  resultType: ExpressionValueType | null,
): ExpectedTypes => {
  if (usage === "condition") {
    return BOOLEAN_ROOT;
  }
  return resultType === null ? null : [resultType];
};

/**
 * 表達式欄位(公式、顯示條件、鎖定條件、自訂驗證、流程跳過條件):沒設定時一顆「設定」;設定後是
 * **型別導向**的結構化選擇器(每個位置只列型別對得上的欄位 / 系統值 / 常數 / 運算),下方附唯讀的
 * JSON 預覽(可複製,Spec 6a §5「右側 JSON 預覽唯讀可複製」)。
 */
export const ExpressionPicker = ({
  label,
  value,
  onChange,
  fields,
  usage = "condition",
  resultType = null,
  resultField = null,
  formKey = "",
  issues = [],
  emptyFieldsLabel,
}: ExpressionPickerProps) => {
  const t = useTranslations("admin.forms.expression");
  const isSet = value !== undefined && value !== null;
  const expected = rootTypesOf(usage, resultType);
  const fieldTypeOf = useMemo(() => fieldTypeLookupOf(fields), [fields]);

  return (
    <Stack spacing={1} role="group" aria-label={label}>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <Typography variant="body2" sx={{ flex: 1 }}>
          {label}
        </Typography>
        {isSet ? (
          <Button
            variant="text"
            size="small"
            onClick={() => {
              onChange(null);
            }}
          >
            {t("clear")}
          </Button>
        ) : (
          <Button
            variant="text"
            size="small"
            onClick={() => {
              onChange(initialExpressionOf(expected));
            }}
          >
            {t("set")}
          </Button>
        )}
      </Stack>
      {isSet && (
        <>
          <ExpressionNodeEditor
            value={value}
            onChange={onChange}
            fields={fields}
            position={{
              expected,
              usage,
              isRoot: true,
              allowNull: false,
              optionTarget: isOptionExpected(expected) ? resultField : null,
            }}
            formKey={formKey}
            fieldTypeOf={fieldTypeOf}
            path=""
            depth={0}
            {...(emptyFieldsLabel !== undefined && { emptyFieldsLabel })}
          />
          <JsonPreview value={value} label={t("json", { label })} />
        </>
      )}
      {issues.map((message) => (
        <Typography key={message} variant="caption" color="error">
          {message}
        </Typography>
      ))}
    </Stack>
  );
};
