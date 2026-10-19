import { useTranslations } from "use-intl";

import {
  DEFAULT_TENANT_TIMEZONE,
  FORM_UPLOAD_MAX_SIZE_MB,
  type FieldDef,
  type FieldRules,
  TEXT_FORMATS,
  type TextFormat,
} from "@repo/domain/form";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { TextField } from "@repo/ui/text-field";

import { ExpressionPicker } from "@/components/base/form-engine/ExpressionPicker/ExpressionPicker";
import { TypedValueInput } from "@/components/base/form-engine/TypedValueInput/TypedValueInput";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import type { PropertySections } from "@/lib/base/form-engine/property-sections";
import {
  UPLOAD_TYPE_GROUPS,
  type UploadTypeGroupKey,
  acceptOfGroups,
  acceptedGroupsOf,
} from "@/lib/base/form-engine/upload-types";
import { scalarText } from "@/lib/base/form-engine/value-text";

export interface RulesEditorProps {
  field: FieldDef;
  /** 自訂驗證可引用的欄位(不含受保護欄位;可含自己) */
  fields: readonly FieldDef[];
  sections: PropertySections;
  /** 自訂驗證裡的選項常數查詢用的表單 key(草稿) */
  formKey: string;
  onChange: (rules: FieldRules) => void;
  customIssues: readonly string[];
}

const NO_FORMAT = "";

/** 空字串 = 移除這條規則(不存 `""` 進定義)。 */
const withRule = <Key extends keyof FieldRules>(
  rules: FieldRules,
  key: Key,
  value: FieldRules[Key] | "",
): FieldRules => {
  const next: FieldRules = { ...rules };
  if (value === "" || value === undefined) {
    Reflect.deleteProperty(next, key);
  } else {
    next[key] = value;
  }
  return next;
};

const numberOrEmpty = (text: string): number | "" =>
  text.trim() === "" ? "" : Number(text);

/**
 * 驗證規則(`rules`,哪些出現照 `property-sections.ts` 的 `sections`):必填(是 / 否欄位 = 必須勾選)、範圍(數字打字;
 * 日期 / 日期時間用與固定值同一組輸入元件 `TypedValueInput`,以租戶時區輸入、存時點 ISO,日期時間兩格直排)、上傳的檔型 / 大小上限(`rules.accept` / `rules.maxSizeMb`)、長度(單行 / 多行文字)、
 * 內建格式或正則 + 訊息(只有單行文字)、`allowCustom`(只有可搜尋類 widget、值來源 = 使用者填)、
 * 自訂驗證(條件成立才通過,不成立顯示 `customMessage`)。
 * 正則要搭錯誤訊息、與內建格式二擇一、不安全的正則由檢查器指出(`PATTERN_*`)。
 */
export const RulesEditor = ({
  field,
  fields,
  sections,
  formKey,
  onChange,
  customIssues,
}: RulesEditorProps) => {
  const t = useTranslations("admin.forms.rules");
  const rules = field.rules ?? {};
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const isDateTime = field.type === "datetime";

  return (
    <Stack spacing={1.5}>
      <FormControlLabel
        label={t("required")}
        control={
          <Switch
            checked={rules.required === true}
            onChange={(_event, checked) => {
              onChange({ ...rules, required: checked });
            }}
          />
        }
      />
      {sections.numberRange && (
        <Stack direction="row" spacing={1}>
          <TextField
            label={t("min")}
            size="small"
            value={scalarText(rules.min)}
            onChange={(event) => {
              onChange(withRule(rules, "min", event.target.value.trim()));
            }}
          />
          <TextField
            label={t("max")}
            size="small"
            value={scalarText(rules.max)}
            onChange={(event) => {
              onChange(withRule(rules, "max", event.target.value.trim()));
            }}
          />
        </Stack>
      )}
      {sections.dateRange && (
        <Stack direction={isDateTime ? "column" : "row"} spacing={1}>
          {(["min", "max"] as const).map((key) => (
            <TypedValueInput
              key={key}
              field={field}
              label={t(key)}
              value={rules[key] ?? null}
              timezone={timezone}
              {...(isDateTime && {
                helperText: t("dateTimeRangeZone", { timezone }),
              })}
              onChange={(next) => {
                onChange(
                  withRule(rules, key, typeof next === "string" ? next : ""),
                );
              }}
            />
          ))}
        </Stack>
      )}
      {sections.uploadLimits && (
        <>
          <SelectField<UploadTypeGroupKey>
            label={t("uploadAccept")}
            multiple
            value={acceptedGroupsOf(field)}
            options={UPLOAD_TYPE_GROUPS.map((group) => ({
              value: group.key,
              label: t(`uploadTypes.${group.key}`),
            }))}
            onChange={(keys) => {
              onChange(withRule(rules, "accept", acceptOfGroups(keys) ?? ""));
            }}
            size="small"
          />
          <TextField
            label={t("uploadMaxSize")}
            size="small"
            type="number"
            helperText={t("uploadMaxSizeHint", {
              max: FORM_UPLOAD_MAX_SIZE_MB,
            })}
            value={scalarText(rules.maxSizeMb)}
            onChange={(event) => {
              onChange(
                withRule(rules, "maxSizeMb", numberOrEmpty(event.target.value)),
              );
            }}
          />
        </>
      )}
      {sections.lengthRange && (
        <Stack direction="row" spacing={1}>
          <TextField
            label={t("minLength")}
            size="small"
            type="number"
            value={scalarText(rules.minLength)}
            onChange={(event) => {
              onChange(
                withRule(rules, "minLength", numberOrEmpty(event.target.value)),
              );
            }}
          />
          <TextField
            label={t("maxLength")}
            size="small"
            type="number"
            value={scalarText(rules.maxLength)}
            onChange={(event) => {
              onChange(
                withRule(rules, "maxLength", numberOrEmpty(event.target.value)),
              );
            }}
          />
        </Stack>
      )}
      {sections.textFormat && (
        <>
          <SelectField<TextFormat | typeof NO_FORMAT>
            label={t("format")}
            value={rules.format ?? NO_FORMAT}
            displayEmpty
            options={[
              { value: NO_FORMAT, label: t("formatNone") },
              ...TEXT_FORMATS.map((format) => ({
                value: format,
                label: t(`formats.${format}`),
              })),
            ]}
            onChange={(format) => {
              onChange(withRule(rules, "format", format));
            }}
            size="small"
          />
          <TextField
            label={t("pattern")}
            size="small"
            value={rules.pattern ?? ""}
            helperText={t("patternHint")}
            onChange={(event) => {
              onChange(withRule(rules, "pattern", event.target.value));
            }}
          />
          <TextField
            label={t("patternMessage")}
            size="small"
            value={rules.patternMessage ?? ""}
            onChange={(event) => {
              onChange(withRule(rules, "patternMessage", event.target.value));
            }}
          />
        </>
      )}
      {sections.allowCustom && (
        <FormControlLabel
          label={t("allowCustom")}
          control={
            <Switch
              checked={rules.allowCustom === true}
              onChange={(_event, checked) => {
                onChange({ ...rules, allowCustom: checked });
              }}
            />
          }
        />
      )}
      {sections.custom && (
        <>
          <ExpressionPicker
            label={t("custom")}
            value={rules.custom}
            fields={fields}
            usage="condition"
            formKey={formKey}
            issues={customIssues}
            onChange={(custom) => {
              onChange(
                custom === null
                  ? withRule(withRule(rules, "custom", ""), "customMessage", "")
                  : { ...rules, custom },
              );
            }}
          />
          {rules.custom !== undefined && rules.custom !== null && (
            <TextField
              label={t("customMessage")}
              size="small"
              value={rules.customMessage ?? ""}
              helperText={t("customMessageHint")}
              onChange={(event) => {
                onChange(withRule(rules, "customMessage", event.target.value));
              }}
            />
          )}
        </>
      )}
    </Stack>
  );
};
