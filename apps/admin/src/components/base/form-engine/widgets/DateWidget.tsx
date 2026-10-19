import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { DatePicker } from "@repo/ui/date-picker";

import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";

import { ReadOnlyField } from "./ReadOnlyField";
import type { WidgetProps } from "./widget-types";

/**
 * 日期欄(`date` → `datePicker`):存的是**時點** —— 選的那一天在租戶時區 00:00。
 * 選日 → `startOfLocalDay`(租戶時區)→ ISO 送出;顯示 → 時點換成租戶時區的 `YYYY-MM-DD` 給選擇器。
 * 時區 = `context.timezone`(讀者現在的租戶時區 `me.currentOrg.timezone`),沒給用預設時區。
 * 唯讀檢視印 `YYYY-MM-DD`(`useTemporalText`,同一個時區)。
 */
export const DateWidget = ({
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
  const timezone = context.timezone ?? DEFAULT_TENANT_TIMEZONE;

  return (
    <DatePicker
      label={field.label}
      hiddenLabel={hiddenLabel}
      value={localDayTextOf(value, timezone)}
      onChange={(next) => {
        onChange(localDayInstantOf(next, timezone));
      }}
      disabled={isDisabled}
      required={field.rules?.required === true}
      error={hasError}
      helperText={helperText}
      fullWidth
      size="small"
    />
  );
};
