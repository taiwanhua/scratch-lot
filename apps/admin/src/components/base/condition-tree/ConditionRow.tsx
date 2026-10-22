import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface ConditionRowProps<F extends string> {
  /** 這棵樹可選的欄位(資料範圍 = 資料目標的欄位目錄;人員條件 = 使用者 / 角色 / 所屬組織 / 權限) */
  fieldOptions: readonly { value: F; label: string }[];
  /** 目前的欄位;不在清單裡(資料壞掉或欄位已下架)時傳 `""`,下拉顯示空白 */
  field: F | "";
  isFieldError?: boolean;
  isReadOnly: boolean;
  /** 換欄位:使用處決定怎麼重建這一列(運算子與值一起重設) */
  onFieldChange: (field: F) => void;
  onRemove: () => void;
  /** 這一列的錯誤文字 */
  error?: string;
  /** 欄位之後的控制項(條件、值、範圍…),依使用處而定 */
  children?: ReactNode;
}

/**
 * 條件樹的一條條件列(資料範圍的條件組合與 AudiencePicker 共用):欄位 → 使用處的控制項 → 刪除,
 * 錯誤文字在列下方。兩棵樹只差欄位清單與欄位之後長什麼樣。寬度不夠時控制項換行(手機)。
 */
export const ConditionRow = <F extends string>({
  fieldOptions,
  field,
  isFieldError = false,
  isReadOnly,
  onFieldChange,
  onRemove,
  error,
  children,
}: ConditionRowProps<F>) => {
  const t = useTranslations("admin.conditionTree");

  return (
    <Stack spacing={0.5}>
      {/* 窄螢幕(手機全螢幕彈窗)放不下一整列時換行,不讓控制項互相擠壓重疊 */}
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: "flex-start", flexWrap: "wrap" }}
      >
        <SelectField<F>
          size="small"
          label={t("field")}
          value={field}
          error={isFieldError}
          disabled={isReadOnly}
          sx={{ width: 190 }}
          options={fieldOptions}
          onChange={onFieldChange}
        />
        {children}
        <Box sx={{ flex: 1 }} />
        {!isReadOnly && (
          <Button variant="text" size="small" onClick={onRemove}>
            {t("remove")}
          </Button>
        )}
      </Stack>
      {error !== undefined && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
    </Stack>
  );
};
