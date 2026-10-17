import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  ALLOW_CUSTOM_WIDGETS,
  type ExpressionSlot,
  type FieldDef,
  arrayColumnsOf,
} from "@repo/domain/form";
import { Button } from "@repo/ui/button";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { Typography } from "@repo/ui/typography";

import { ExpressionPicker } from "@/components/base/form-engine/ExpressionPicker/ExpressionPicker";
import { widgetKindsFor } from "@/components/base/form-engine/widgets/widget-registry";
import type { DesignerIssue } from "@/lib/base/form-engine/designer-issues";
import type { FieldKeyProblem } from "@/lib/base/form-engine/designer-ops";
import { conditionFieldsOf } from "@/lib/base/form-engine/expression-options";
import { propertySectionsOf } from "@/lib/base/form-engine/property-sections";

import { ArrayColumnPanel } from "./ArrayColumnsEditor/ArrayColumnPanel";
import { ArrayColumnsEditor } from "./ArrayColumnsEditor/ArrayColumnsEditor";
import { ArrayRowRangeEditor } from "./ArrayRowRangeEditor";
import { DefaultValueEditor } from "./DefaultValueEditor";
import { FieldBasicsEditor } from "./FieldBasicsEditor";
import { LookupSourceEditor } from "./LookupSourceEditor";
import { OptionsEditor } from "./OptionsEditor";
import { RulesEditor } from "./RulesEditor";
import { ValueSourceEditor } from "./ValueSourceEditor";

export interface FieldPropertyPanelProps {
  field: FieldDef;
  fields: readonly FieldDef[];
  /** 表單 key(類別 / 資料來源選項欄的預設值用填寫時的選擇器挑,要查這張表單的草稿) */
  formKey: string;
  span: number | null;
  /** 檢查器指到這個欄位的錯誤與警告(點檢查結果定位到這裡) */
  issues: readonly DesignerIssue[];
  /** 改 key 當場擋:null = 可以寫入;否則是原因(格式 / 保留字 / 重複) */
  keyProblemOf: (key: string) => FieldKeyProblem | null;
  onChange: (field: FieldDef) => void;
  onSpanChange: (span: number) => void;
  onDelete: () => void;
  /** 回到表單層設定(摘要槽、帶入規則) */
  onBack: () => void;
}

/**
 * 屬性面板(Spec 6a §8 畫面 2):選中欄位的定義,**每種型別只出現該有的設定**(§5 表 A,
 * `lib/base/form-engine/property-sections.ts`)。表達式一律用型別導向的結構化選擇器(表 B);條件類不列受保護欄位。
 * 每一塊的檢查器錯誤就地顯示(表達式槽依 `location.exprSlot` 分派),其餘列在最上方。
 */
export const FieldPropertyPanel = ({
  field,
  fields,
  formKey,
  span,
  issues,
  keyProblemOf,
  onChange,
  onSpanChange,
  onDelete,
  onBack,
}: FieldPropertyPanelProps) => {
  const t = useTranslations("admin.forms.property");
  const sections = propertySectionsOf(
    field,
    widgetKindsFor(field.type),
    ALLOW_CUSTOM_WIDGETS,
  );
  const slotIssues = (slot: ExpressionSlot) =>
    issues
      .filter((issue) => issue.location.exprSlot === slot)
      .map((issue) => issue.message);
  // 明細子欄的錯誤在「子欄位」區塊裡顯示(清單標紅、點進子欄看)
  const general = issues.filter(
    (issue) =>
      issue.location.exprSlot === undefined &&
      issue.location.columnKey === undefined,
  );
  const permission = field.permission ?? { show: false, edit: false };
  // 明細列:點一個子欄 → 整個面板換成子欄的縮小版(面板以欄位的內部 id 為 key,換欄位時歸零)
  const [columnIndex, setColumnIndex] = useState<number | null>(null);
  const columns = arrayColumnsOf(field);
  const column = columnIndex === null ? undefined : columns.at(columnIndex);
  const columnIssues = issues.filter(
    (issue) => issue.location.columnKey !== undefined,
  );

  if (columnIndex !== null && column !== undefined) {
    return (
      <ArrayColumnPanel
        arrayField={field}
        column={column}
        fields={fields}
        formKey={formKey}
        issues={columnIssues.filter(
          (issue) => issue.location.columnKey === column.key,
        )}
        onChange={(next) => {
          onChange({
            ...field,
            columns: columns.map((item, index) =>
              index === columnIndex ? next : item,
            ),
          });
        }}
        onBack={() => {
          setColumnIndex(null);
        }}
      />
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {t("title", { label: field.label })}
        </Typography>
        <Button variant="text" size="small" onClick={onBack}>
          {t("backToSettings")}
        </Button>
      </Stack>
      {general.length > 0 && (
        <Stack spacing={0.5} role="list" aria-label={t("issues")}>
          {general.map((issue, index) => (
            <Typography
              key={`${issue.code}-${String(index)}`}
              role="listitem"
              variant="caption"
              color="error"
            >
              {issue.message}
            </Typography>
          ))}
        </Stack>
      )}
      <FieldBasicsEditor
        field={field}
        span={span}
        sections={sections}
        keyProblemOf={keyProblemOf}
        onChange={onChange}
        onSpanChange={onSpanChange}
      />
      {sections.valueSource && (
        <ValueSourceEditor
          field={field}
          fields={fields}
          formKey={formKey}
          exprIssues={slotIssues("valueSource.expr")}
          onChange={(valueSource) => {
            // 預設值只屬於「使用者填」:改成公式 / 固定值時一併拿掉(否則檢查器報 DEFAULT_NOT_ALLOWED)
            onChange({
              ...field,
              valueSource,
              ...(valueSource.kind !== "input" && { default: null }),
            });
          }}
        />
      )}
      {sections.defaultValue && (
        <DefaultValueEditor
          field={field}
          fields={fields}
          formKey={formKey}
          exprIssues={slotIssues("default.expr")}
          onChange={(fallback) => {
            onChange({ ...field, default: fallback });
          }}
        />
      )}
      {sections.arrayColumns && (
        <ArrayColumnsEditor
          field={field}
          issues={columnIssues}
          onChange={onChange}
          onOpen={setColumnIndex}
        />
      )}
      {sections.options && (
        <OptionsEditor
          value={field.options}
          onChange={(options) => {
            onChange({ ...field, options });
          }}
        />
      )}
      {sections.referenceSource && (
        <LookupSourceEditor
          value={field.source ?? { provider: "user", labelField: "name" }}
          hasValueField={false}
          linkFields={fields.filter(
            (candidate) =>
              candidate.key !== field.key && candidate.type !== "array",
          )}
          onChange={(source) => {
            onChange({ ...field, source });
          }}
        />
      )}
      <RulesEditor
        field={field}
        formKey={formKey}
        fields={conditionFieldsOf(fields, field.key, true)}
        sections={sections}
        customIssues={slotIssues("rules.custom")}
        onChange={(rules) => {
          onChange({ ...field, rules });
        }}
      />
      {sections.rowRange && (
        <ArrayRowRangeEditor
          rules={field.rules ?? {}}
          onChange={(rules) => {
            onChange({ ...field, rules });
          }}
        />
      )}
      <ExpressionPicker
        label={t("visibleWhen")}
        value={field.visibleWhen}
        fields={conditionFieldsOf(fields, field.key, false)}
        usage="condition"
        formKey={formKey}
        issues={slotIssues("visibleWhen")}
        onChange={(visibleWhen) => {
          onChange({ ...field, visibleWhen });
        }}
      />
      {sections.readonlyWhen && (
        <ExpressionPicker
          label={t("readonlyWhen")}
          value={field.readonlyWhen}
          fields={conditionFieldsOf(fields, field.key, true)}
          usage="condition"
          formKey={formKey}
          issues={slotIssues("readonlyWhen")}
          onChange={(readonlyWhen) => {
            onChange({ ...field, readonlyWhen });
          }}
        />
      )}
      <Stack spacing={0.5}>
        <FormControlLabel
          label={t("permissionShow")}
          control={
            <Switch
              checked={permission.show}
              onChange={(_event, checked) => {
                onChange({
                  ...field,
                  permission: { ...permission, show: checked },
                });
              }}
            />
          }
        />
        <FormControlLabel
          label={t("permissionEdit")}
          control={
            <Switch
              checked={permission.edit}
              onChange={(_event, checked) => {
                onChange({
                  ...field,
                  permission: { ...permission, edit: checked },
                });
              }}
            />
          }
        />
        <Typography variant="caption" color="text.secondary">
          {t("permissionHint")}
        </Typography>
      </Stack>
      <Stack direction="row">
        <Button variant="text" color="error" onClick={onDelete}>
          {t("delete")}
        </Button>
      </Stack>
    </Stack>
  );
};
