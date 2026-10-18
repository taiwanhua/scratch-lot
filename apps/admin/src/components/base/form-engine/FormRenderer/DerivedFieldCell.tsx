import type { FieldDef } from "@repo/domain/form";
import { TextField } from "@repo/ui/text-field";

import { useTemporalText } from "@/hooks/base/useTemporalText";
import {
  type FormDisplayItemLike,
  type FormValueRenderContext,
  displayTextOf,
  isEmptyDisplay,
} from "@/lib/base/form-engine/value-text";

export interface DerivedFieldCellProps {
  field: FieldDef;
  value: unknown;
  display?: readonly FormDisplayItemLike[];
  text: FormValueRenderContext["text"];
  /** api 回的值錯誤(計算結果不合規則,例:必填的總額算不出來) */
  errorMessage?: string | null;
  /** 日期 / 日期時間欄的顯示時區(不給 = 讀者的租戶時區) */
  timezone?: string;
}

/**
 * 計算 / 固定值欄位在設計畫布、填寫、預覽的樣子:**有框的唯讀輸入框**,
 * 外觀與其他停用的欄位一致;內容是顯示值(數字帶單位、選項顯示名;計算欄位缺依賴時是「—」)。
 */
export const DerivedFieldCell = ({
  field,
  value,
  display,
  text,
  errorMessage,
  timezone,
}: DerivedFieldCellProps) => {
  const temporalText = useTemporalText(timezone);
  const hasError = errorMessage !== undefined && errorMessage !== null;
  const help = field.help ?? "";
  const helperText = hasError ? errorMessage : help;

  return (
    <TextField
      label={field.label}
      value={
        (field.type === "date" || field.type === "datetime") &&
        !isEmptyDisplay(value)
          ? temporalText(value, field.type)
          : displayTextOf({
              field,
              value,
              text,
              ...(display !== undefined && { display }),
            })
      }
      disabled
      fullWidth
      size="small"
      error={hasError}
      {...(helperText !== "" && { helperText })}
      slotProps={{ htmlInput: { readOnly: true } }}
    />
  );
};
