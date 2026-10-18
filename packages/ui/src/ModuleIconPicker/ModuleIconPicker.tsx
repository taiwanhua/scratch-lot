"use client";

import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

import { ListItemIcon } from "../List/ListItemIcon";
import { MenuItem } from "../Menu/MenuItem";
import { Stack } from "../Stack/Stack";
import { TextField } from "../TextField/TextField";
import {
  MODULE_ICONS,
  MODULE_ICON_KEYS,
  type ModuleIconKey,
  isModuleIconKey,
  moduleIconOf,
} from "../icons/module-icon-registry";

export interface ModuleIconPickerProps {
  /**
   * 受控值 = 白名單的 key。值不在白名單(舊資料、`null`、空字串)時
   * 顯示 `DEFAULT_MODULE_ICON` 與 `emptyLabel`,不會清掉呼叫端的值。
   */
  value: string | null;
  /** 選到圖示時回報;只會收到白名單裡的 key */
  onChange?: (value: ModuleIconKey) => void;
  /** 浮動標籤(如「圖示」);ui 不內建文案(I18N-01) */
  label?: ReactNode;
  /**
   * 無障礙名稱。**放進「左標籤 + 右內容」版型時不給 `label`**,
   * 那時 combobox 沒有任何名稱可言 —— 給這個,或用 `labelId` 指向版型自己那顆標籤。
   */
  "aria-label"?: string;
  /** 已存在的標籤元素 id;與 `aria-label` 二擇一,不要兩個都給 */
  labelId?: string;
  /** 值不在白名單時顯示的文字;預設空字串(只畫預設圖示) */
  emptyLabel?: ReactNode;
  /**
   * 覆寫選項的顯示名稱(i18n 用):不給時用登錄表的繁中短詞。
   * 回 `undefined` 時退回登錄表的值,呼叫端只翻它要翻的那幾個。
   */
  labelOf?: (key: ModuleIconKey) => ReactNode;
  /* 以下沿用 MUI / `TextField` 的名字而不自創(STYLE-05 / FIGMA-01) */
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: ReactNode;
  fullWidth?: boolean;
  name?: string;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
}

/**
 * 模組圖示選擇器:下拉列出 `@repo/ui/icons` 白名單的 30 個 MUI Outlined 圖示,
 * 每列「圖示 + 短詞」,收合後顯示目前選中的那一個。模組與權限頁、角色/選單設定共用。
 *
 * 值域由登錄表決定,元件本身不認得任何圖示 —— 加圖示只改 `module-icon-registry.ts`。
 */
export const ModuleIconPicker = ({
  value,
  onChange,
  label,
  "aria-label": ariaLabel,
  labelId,
  emptyLabel = "",
  labelOf,
  disabled,
  required,
  error,
  helperText,
  fullWidth,
  name,
  size,
  sx,
}: ModuleIconPickerProps) => {
  const displayLabel = (key: ModuleIconKey): ReactNode =>
    labelOf?.(key) ?? MODULE_ICONS[key].label;

  /** 收合後那一列:同樣走 `moduleIconOf`,未知值才會落在預設圖示 + `emptyLabel`。 */
  const renderValue = (selected: unknown): ReactNode => {
    const key = typeof selected === "string" ? selected : null;
    const Icon = moduleIconOf(key);
    return (
      <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
        <Icon fontSize="small" />
        {isModuleIconKey(key) ? displayLabel(key) : emptyLabel}
      </Stack>
    );
  };

  return (
    <TextField
      select
      label={label}
      value={value ?? ""}
      onChange={(event) => {
        if (isModuleIconKey(event.target.value)) {
          onChange?.(event.target.value);
        }
      }}
      disabled={disabled}
      required={required}
      error={error}
      helperText={helperText}
      fullWidth={fullWidth}
      name={name}
      size={size}
      sx={sx}
      slotProps={{
        select: {
          renderValue,
          displayEmpty: true,
          // 名稱直通到 combobox 本體(收合後那顆 `role="combobox"` 的 div)
          "aria-label": ariaLabel,
          labelId,
        },
      }}
    >
      {MODULE_ICON_KEYS.map((key) => {
        const { Icon } = MODULE_ICONS[key];
        return (
          <MenuItem key={key} value={key}>
            <ListItemIcon>
              <Icon fontSize="small" />
            </ListItemIcon>
            {displayLabel(key)}
          </MenuItem>
        );
      })}
    </TextField>
  );
};
