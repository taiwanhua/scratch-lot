import { TextField } from "@repo/ui/text-field";

import { scalarText } from "@/lib/base/form-engine/value-text";

import { ReadOnlyField } from "./ReadOnlyField";
import type { WidgetProps } from "./widget-types";

const DEFAULT_ROWS = 3;

/**
 * 文字欄(`text` → `textField`、`multiline` → `textArea`)。
 * widget 只管長相(`placeholder`、`rows`),長度 / 正則 / 格式驗證在 api(與 `@repo/domain/form` 的 `values.ts`)。
 */
export const TextWidget = ({
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
  const isMultiline = field.type === "multiline";
  const rows =
    typeof field.widget.rows === "number" ? field.widget.rows : DEFAULT_ROWS;
  const placeholder = scalarText(field.widget.placeholder);

  return (
    <TextField
      label={hiddenLabel ? undefined : field.label}
      value={scalarText(value)}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      disabled={isDisabled}
      required={field.rules?.required === true}
      error={hasError}
      helperText={helperText}
      fullWidth
      size="small"
      {...(placeholder !== "" && { placeholder })}
      {...(isMultiline && { multiline: true, minRows: rows })}
      {...(hiddenLabel && {
        slotProps: { htmlInput: { "aria-label": field.label } },
      })}
    />
  );
};
