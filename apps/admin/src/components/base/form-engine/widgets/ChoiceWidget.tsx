import { useState } from "react";
import { useTranslations } from "use-intl";

import { Autocomplete } from "@repo/ui/autocomplete";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { identityOf } from "@/lib/base/form-engine/value-text";

import { ReadOnlyField } from "./ReadOnlyField";
import {
  customOptionOf,
  optionOfStored,
  storedOfValue,
  withCurrent,
} from "./choice-options";
import { useFieldOptions } from "./useFieldOptions";
import type { ChoiceOption, WidgetProps } from "./widget-types";

/**
 * 單選欄(`select` → `dropdown` / `radio` / `autocomplete`)。
 * 三種來源的選項由 `useFieldOptions` 統一;`rules.allowCustom` 只有 `autocomplete` 能開(= freeSolo):
 * 輸入的字不在清單內時多一個「使用「…」」選項,存 `{ value, label, custom: true }`。
 */
export const ChoiceWidget = (props: WidgetProps) => {
  const { field, value, onChange, isDisabled, isDesign, helperText, hasError } =
    props;
  const isReadOnly = props.isReadOnly ?? false;
  const hiddenLabel = props.hiddenLabel ?? false;
  const t = useTranslations("admin.formEngine.widgets");
  const [keyword, setKeyword] = useState("");
  // 唯讀檢視不查選項:顯示名來自 `displayValues`(現名 / 快照)與定義裡的靜態 label
  const source = useFieldOptions({
    field,
    context: props.context,
    keyword,
    isDesign: isDesign || isReadOnly,
  });
  if (isReadOnly) {
    return (
      <ReadOnlyField
        field={field}
        value={value}
        context={props.context}
        helperText={helperText}
        hiddenLabel={hiddenLabel}
        {...(props.display !== undefined && { display: props.display })}
      />
    );
  }
  const options = withCurrent(source.options, value === null ? [] : [value]);
  const current = identityOf(value);
  const kind = field.widget.kind;
  const note = source.isUnavailable ? t("optionsUnavailable") : helperText;
  const isLocked = isDisabled || source.isUnavailable;

  if (kind === "radio") {
    return (
      <Stack spacing={0.5}>
        <Typography variant="body2" color="textSecondary">
          {field.label}
        </Typography>
        <RadioGroup
          row
          aria-label={field.label}
          value={current}
          onChange={(_event, next) => {
            onChange(storedOfValue(options, next));
          }}
        >
          {options.map((option) => (
            <FormControlLabel
              key={option.value}
              value={option.value}
              control={<Radio disabled={isLocked} />}
              label={option.label}
            />
          ))}
        </RadioGroup>
        {note !== undefined && (
          <Typography
            variant="caption"
            color={hasError ? "error" : "textSecondary"}
          >
            {note}
          </Typography>
        )}
      </Stack>
    );
  }

  if (kind === "autocomplete") {
    const custom =
      field.rules?.allowCustom === true
        ? customOptionOf(keyword, options)
        : null;
    const listed: ChoiceOption[] =
      custom === null
        ? options
        : [
            ...options,
            { ...custom, label: t("customOption", { value: custom.label }) },
          ];
    return (
      <Autocomplete<ChoiceOption>
        label={field.label}
        hiddenLabel={hiddenLabel}
        options={listed}
        value={
          optionOfStored(value) === null
            ? null
            : (options.find((option) => option.value === current) ?? null)
        }
        getOptionLabel={(option) => option.label}
        getOptionKey={(option) => option.value}
        onChange={(option) => {
          onChange(option === null ? null : option.stored);
        }}
        onInputChange={setKeyword}
        loading={source.isLoading}
        loadingText={t("loading")}
        noOptionsText={t("noOptions")}
        disabled={isLocked}
        required={field.rules?.required === true}
        error={hasError}
        helperText={note}
        size="small"
        fullWidth
      />
    );
  }

  return (
    <SelectField
      label={field.label}
      hiddenLabel={hiddenLabel}
      value={current}
      displayEmpty
      options={[
        { value: "", label: t("unselected") },
        ...options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
      ]}
      onChange={(next) => {
        onChange(next === "" ? null : storedOfValue(options, next));
      }}
      disabled={isLocked}
      required={field.rules?.required === true}
      error={hasError}
      helperText={note}
      size="small"
      fullWidth
    />
  );
};
