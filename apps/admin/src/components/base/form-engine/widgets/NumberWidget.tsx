import { TextField } from "@repo/ui/text-field";

import { scalarText } from "@/lib/base/form-engine/value-text";

import { ReadOnlyField } from "./ReadOnlyField";
import type { WidgetProps } from "./widget-types";

/**
 * 數字欄(`number` → `number`)。存值是十進位字串(Spec §5「值的存法」),所以輸入框收原字、
 * 不在前端轉成 JS number(會失去精度);取到 `precision` 位由 api 在存檔時做。
 * `widget.unit`(「元」)只是長相,顯示在欄位尾端。
 */
export const NumberWidget = ({
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
    // 唯讀:顯示值帶單位(「30 元」)
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
  const unit = scalarText(field.widget.unit);

  return (
    <TextField
      label={hiddenLabel ? undefined : field.label}
      value={scalarText(value)}
      onChange={(event) => {
        onChange(event.target.value.trim());
      }}
      disabled={isDisabled}
      required={field.rules?.required === true}
      error={hasError}
      helperText={helperText}
      fullWidth
      size="small"
      slotProps={{
        htmlInput: {
          inputMode: "decimal",
          ...(hiddenLabel && { "aria-label": field.label }),
        },
        ...(unit !== "" && { input: { endAdornment: unit } }),
      }}
    />
  );
};
