"use client";

import MuiAutocomplete from "@mui/material/Autocomplete";
import type { SxProps, Theme } from "@mui/material/styles";
import { styled } from "@mui/material/styles";
import type { AutocompleteValue as MuiAutocompleteValue } from "@mui/material/useAutocomplete";
import type { ReactNode } from "react";

import { Stack } from "../Stack/Stack";
import { TextField } from "../TextField/TextField";
import { Typography } from "../Typography/Typography";
import { CloseIcon } from "../icons/CloseIcon";

/**
 * 受控值的形狀。刻意直接借 MUI 的條件型別(而不是自己寫一份
 * `Multiple extends true ? … : …`):自己寫一份 TypeScript 無法證明兩者相等,
 * 泛型還沒解析時就得在包裝層裡 `as` 硬轉。借同一個型別則完全不必轉。
 *
 * `Multiple` 為 `true` → `Option[]`;其餘(`false` / 沒給)→ `Option | null`。
 */
export type AutocompleteValue<
  Option,
  Multiple extends boolean | undefined,
> = MuiAutocompleteValue<Option, Multiple, false, false>;

export interface AutocompleteProps<
  Option,
  Multiple extends boolean | undefined = undefined,
> {
  options: readonly Option[];
  /** 受控值;`multiple` 時是陣列,否則是單一選項或 `null` */
  value: AutocompleteValue<Option, Multiple>;
  onChange: (value: AutocompleteValue<Option, Multiple>) => void;
  /** 多選:選中的項目變成可移除的 chip(Figma 253:3 的 chip) */
  multiple?: Multiple;
  /** 每個選項的主文字,同時是**內建搜尋**比對的對象 */
  getOptionLabel: (option: Option) => string;
  /**
   * 選項的穩定識別。不給時用 `getOptionLabel` —— 同名選項(每個租戶都有「租戶管理員」)
   * 一定要給,否則兩列會被當成同一個。
   */
  getOptionKey?: (option: Option) => string;
  /** 選項的次文字(Figma 253:24:主文字下方的小字,如擁有組織) */
  getOptionSecondaryText?: (option: Option) => ReactNode;
  /** 這個選項能不能選;灰掉的列用 `getOptionDisabledReason` 就地說明原因 */
  getOptionDisabled?: (option: Option) => boolean;
  /**
   * 不能選的原因(Figma 253:38「美味餐飲 — 使用者不在此角色的擁有組織之下」)。
   *
   * **就地寫在次文字那一行,不是 Tooltip**:MUI 對 `aria-disabled` 的選項下
   * `pointer-events: none`(`Autocomplete.js`),hover 根本不會觸發;把它改回 `auto`
   * 又會讓停用的選項點得下去(`useAutocomplete` 的 `handleOptionClick` 不重驗
   * `getOptionDisabled`)。設計稿畫的也是就地說明。
   */
  getOptionDisabledReason?: (option: Option) => ReactNode;
  /** 分組:回同一個字串的選項歸一組,組標題就是這個字串(Figma 253:21 group-header) */
  groupBy?: (option: Option) => string;
  /** 浮動標籤;ui 不內建文案(I18N-01) */
  label?: ReactNode;
  /**
   * 不畫浮動標籤(外框因此不留 legend 缺口),`label` 改當輸入框的 `aria-label`(須是字串)。
   * 給表頭已寫了標題的表格格子用(表單引擎的明細列)。
   */
  hiddenLabel?: boolean;
  placeholder?: string;
  /**
   * 輸入框的字變了。**給了它就等於接手過濾**(用在 keyword 丟回 api 查的情境),
   * 內建的前端過濾會關掉,`options` 原樣顯示。
   */
  onInputChange?: (keyword: string) => void;
  /** 選項還在路上:列出一列 `loadingText` 而不是「沒有符合的項目」 */
  loading?: boolean;
  loadingText?: ReactNode;
  noOptionsText?: ReactNode;
  /**
   * 多選 chip 的刪除鈕:`cancel`(預設,MUI 的實心圓 ×)或 `close`(小 ×,同 `@repo/ui/tag` 的 `onDelete`)。
   * 同一列旁邊並排的是可關閉的 Tag 時用 `close`,兩種標籤的 × 才一致(人員條件的條件列)。
   */
  chipDeleteIcon?: "cancel" | "close";
  /* 以下沿用 MUI / `TextField` 的名字而不自創(STYLE-05 / FIGMA-01) */
  /**
   * 輸入格高度;預設 `medium`,與 `TextField` / `SelectField` / `DatePicker` 的預設相同,
   * 同一張表單不論混用哪幾種欄位,高度都一致。精簡表單(工具列、篩選列)一律明寫 `small`。
   */
  size?: "small" | "medium";
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: ReactNode;
  fullWidth?: boolean;
  name?: string;
  sx?: SxProps<Theme>;
}

/**
 * Figma `Draft/Autocomplete` 253:39 的 listbox:組標題 11px SemiBold 次要色、
 * 選項兩行(主文字 14px / 次文字 11px)。幾何寫在 `styled()`,呼叫端的 `sx` 疊加不覆蓋(STYLE-07)。
 */
const StyledAutocomplete = styled(MuiAutocomplete)(({ theme }) => ({
  "& .MuiAutocomplete-groupLabel": {
    // Figma 指定 11px;theme.typography 最小級是 caption 12px,故此處直寫(STYLE-06)
    fontSize: "0.6875rem",
    fontWeight: 600,
    color: theme.palette.text.secondary,
    lineHeight: 1.6,
    paddingBlock: theme.spacing(0.75, 0.25),
  },
  "& .MuiAutocomplete-option": {
    paddingBlock: theme.spacing(0.75),
  },
  /**
   * 多選時選中的項目(Figma 253:4 的 chip:`primary.lighter` 底、`primary.darker` 字、膠囊)。
   * 不借 `@repo/ui/tag` —— 那是狀態標籤,而 MUI 的 chip 槽只收 `slotProps`、不收元件替換,
   * 所以這裡就是這個元件自己的幾何(STYLE-07)。
   */
  "& .MuiAutocomplete-tag": {
    height: "auto",
    // 膠囊(Figma 的 12 / 全圓角):與品牌無關的形狀值,不走 shape.borderRadius
    borderRadius: "999px",
    paddingBlock: "2px",
    backgroundColor: theme.palette.primary.lighter,
    color: theme.palette.primary.darker,
    fontSize: "0.75rem",
    "& .MuiChip-deleteIcon": { color: "inherit", opacity: 0.6 },
    "& .MuiChip-deleteIcon:hover": { color: "inherit", opacity: 1 },
  },
})) as typeof MuiAutocomplete;

/**
 * 輸入即搜尋的選擇器。取代「MUI Select + 選單外一個搜尋框」的組合 ——
 * Select 會把選單裡的子元素一律 clone 成 `role="option"`,搜尋框塞不進選單裡。
 *
 * 三件事是這個元件存在的理由(根組織視角下角色清單跨很多租戶):
 * **輸入即過濾**、**依租戶頂層分組**、**每列主文字 + 次文字**分辨同名選項。
 * 不合格的選項**列出來但灰掉**並就地寫原因,不是直接不列。
 */
export const Autocomplete = <
  Option,
  Multiple extends boolean | undefined = undefined,
>({
  options,
  value,
  onChange,
  multiple,
  getOptionLabel,
  getOptionKey,
  getOptionSecondaryText,
  getOptionDisabled,
  getOptionDisabledReason,
  groupBy,
  label,
  hiddenLabel = false,
  placeholder,
  onInputChange,
  loading,
  loadingText,
  noOptionsText,
  chipDeleteIcon = "cancel",
  size = "medium",
  disabled,
  required,
  error,
  helperText,
  fullWidth,
  name,
  sx,
}: AutocompleteProps<Option, Multiple>) => {
  const keyOf = (option: Option) =>
    getOptionKey === undefined ? getOptionLabel(option) : getOptionKey(option);

  return (
    <StyledAutocomplete<Option, Multiple>
      options={options}
      value={value}
      multiple={multiple}
      groupBy={groupBy}
      disabled={disabled}
      loading={loading}
      loadingText={loadingText}
      noOptionsText={noOptionsText}
      size={size}
      fullWidth={fullWidth}
      sx={sx}
      getOptionLabel={getOptionLabel}
      getOptionKey={keyOf}
      getOptionDisabled={getOptionDisabled}
      {...(chipDeleteIcon === "close" && {
        slotProps: {
          chip: {
            deleteIcon: <CloseIcon />,
            // 尺寸同 Tag 的關閉圖示(12px)
            sx: { "& .MuiChip-deleteIcon": { fontSize: "0.75rem" } },
          },
        },
      })}
      isOptionEqualToValue={(option, other) => keyOf(option) === keyOf(other)}
      // 呼叫端自己拿 keyword 去查(`onInputChange`)時,前端不要再過濾一次
      filterOptions={
        onInputChange === undefined ? undefined : (all) => [...all]
      }
      onChange={(_event, next) => {
        onChange(next);
      }}
      onInputChange={(_event, keyword) => {
        onInputChange?.(keyword);
      }}
      renderOption={(optionProps, option) => {
        const { key, ...rest } = optionProps;
        const secondary = getOptionSecondaryText?.(option);
        const reason =
          getOptionDisabled?.(option) === true
            ? getOptionDisabledReason?.(option)
            : undefined;
        return (
          <li key={key} {...rest}>
            <Stack spacing={0} sx={{ minWidth: 0 }}>
              <Typography variant="body2">{getOptionLabel(option)}</Typography>
              {secondary !== undefined && secondary !== null && (
                <Typography variant="caption" color="textSecondary">
                  {secondary}
                </Typography>
              )}
              {reason !== undefined && reason !== null && (
                <Typography variant="caption" color="textSecondary">
                  {reason}
                </Typography>
              )}
            </Stack>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={hiddenLabel ? undefined : label}
          {...(hiddenLabel &&
            typeof label === "string" && {
              slotProps: {
                ...params.slotProps,
                htmlInput: {
                  ...params.slotProps.htmlInput,
                  "aria-label": label,
                },
              },
            })}
          placeholder={placeholder}
          required={required}
          error={error}
          helperText={helperText}
          name={name}
        />
      )}
    />
  );
};
