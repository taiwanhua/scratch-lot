import { temporalIsoOf } from "@repo/domain/form";
import { DateTimePicker } from "@repo/ui/date-time-picker";

import { scalarText } from "@/lib/base/form-engine/value-text";

import { ReadOnlyField } from "./ReadOnlyField";
import type { WidgetProps } from "./widget-types";

/** `rules.min` / `max` 收任何時區的 ISO 8601;給選擇器前先收成 UTC,不合法就不限。 */
const limitOf = (raw: unknown): string | undefined =>
  temporalIsoOf(raw) ?? undefined;

/**
 * 日期時間欄(`datetime` → `dateTimePicker`):值是時點(收發 ISO 8601,api 存 Mongo `Date`),
 * 以**讀者現在的租戶時區**輸入與顯示(`context.timezone` = `me.currentOrg.timezone`;唯讀檢視也是)。
 * 唯讀檢視印 `YYYY-MM-DD HH:mm`(`useTemporalText`)。
 */
export const DateTimeWidget = ({
  field,
  value,
  onChange,
  isDisabled,
  isReadOnly = false,
  hiddenLabel = false,
  helperText,
  hasError,
  context,
}: WidgetProps) => {
  if (isReadOnly) {
    return (
      <ReadOnlyField
        field={field}
        value={value}
        context={context}
        helperText={helperText}
        hiddenLabel={hiddenLabel}
      />
    );
  }
  const text = temporalIsoOf(value) ?? scalarText(value);
  const min = limitOf(field.rules?.min);
  const max = limitOf(field.rules?.max);

  return (
    <DateTimePicker
      label={field.label}
      hiddenLabel={hiddenLabel}
      value={text === "" ? null : text}
      onChange={(next) => {
        onChange(next);
      }}
      {...(context.timezone !== undefined && { timezone: context.timezone })}
      {...(min !== undefined && { minDateTime: min })}
      {...(max !== undefined && { maxDateTime: max })}
      disabled={isDisabled}
      required={field.rules?.required === true}
      error={hasError}
      helperText={helperText}
      fullWidth
      size="small"
    />
  );
};
