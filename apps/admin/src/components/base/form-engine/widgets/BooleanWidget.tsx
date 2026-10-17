import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { Typography } from "@repo/ui/typography";

import type { WidgetProps } from "./widget-types";

/**
 * 是否欄(`boolean` → `switch` / `checkbox`);標題在開關 / 勾選框前面;必填 = 必須勾選(標題帶必填記號)。
 * 唯讀檢視:同一個開關 / 勾選框帶 `readOnly`(不是停用:照一般顏色顯示開 / 關,點了不會變)。
 */
export const BooleanWidget = ({
  field,
  value,
  onChange,
  isDisabled,
  isReadOnly = false,
  hiddenLabel = false,
  helperText,
  hasError,
}: WidgetProps) => {
  const change = (checked: boolean) => {
    if (!isReadOnly) {
      onChange(checked);
    }
  };
  // 不畫標題時(明細列的表格格子)名稱掛在開關 / 勾選框本身
  const named = hiddenLabel
    ? { slotProps: { input: { "aria-label": field.label } } }
    : {};
  const control =
    field.widget.kind === "checkbox" ? (
      <Checkbox
        {...named}
        checked={value === true}
        disabled={isDisabled}
        readOnly={isReadOnly}
        onChange={(_event, checked) => {
          change(checked);
        }}
      />
    ) : (
      <Switch
        {...named}
        checked={value === true}
        disabled={isDisabled}
        readOnly={isReadOnly}
        onChange={(_event, checked) => {
          change(checked);
        }}
      />
    );

  return (
    <Stack spacing={0.25}>
      {/* 標題在元件前面(Spec 6a §5 表 A 下方:是 / 否欄位的標題顯示在元件前面) */}
      {hiddenLabel ? (
        control
      ) : (
        <FormControlLabel
          control={control}
          label={field.label}
          labelPlacement="start"
          // 必填 = 必須勾選(Spec 6a 表 A;未勾選送出由 api 以 REQUIRED 擋),標題帶必填記號
          required={field.rules?.required === true}
          sx={{ alignSelf: "flex-start" }}
        />
      )}
      {helperText !== undefined && (
        <Typography
          variant="caption"
          color={hasError ? "error" : "text.secondary"}
        >
          {helperText}
        </Typography>
      )}
    </Stack>
  );
};
