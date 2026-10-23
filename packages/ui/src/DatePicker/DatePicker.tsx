"use client";

import type { SxProps, Theme } from "@mui/material/styles";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker as MuiDatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import dayjs, { type Dayjs } from "dayjs";
import type { ReactNode } from "react";

import "dayjs/locale/zh-tw";

import {
  type PickerChangeDetails,
  isCompleteDate,
  usePickerDraft,
} from "./usePickerDraft";

export type { PickerChangeDetails } from "./usePickerDraft";

/**
 * 對外的值格式:ISO 日期字串。
 * 資料範圍規則把日期條件當字串存進 `data_scope_rules`(ADR-0008),
 * 設計稿的值欄也直接顯示 `2026-01-01`(Figma 資料範圍 167:1819),所以顯示格式預設同一個。
 */
const VALUE_FORMAT = "YYYY-MM-DD";

/** 日曆的語系資料(不是 UI 文案 — ui 套件不做 i18n,文字一律由 props 傳入,I18N-01)。 */
export type DatePickerLocale = "zh-tw" | "en";

export interface DatePickerProps {
  /** 浮動標籤(如「值」「起日」);ui 不內建文案 */
  label?: ReactNode;
  /**
   * 不畫浮動標籤(外框因此不留 legend 缺口),`label` 改當無障礙名稱(`aria-label`,須是字串)。
   * 給表頭已寫了標題的表格格子用(表單引擎的明細列)。
   */
  hiddenLabel?: boolean;
  /** 受控值,`YYYY-MM-DD`;清空為 `null` */
  value?: string | null;
  /** 非受控的初始值,`YYYY-MM-DD` */
  defaultValue?: string | null;
  /**
   * 選到日期時回傳 `YYYY-MM-DD`;清空、輸入未完成(年份沒打滿 4 位)或不合法時回傳 `null`。
   * 第二個參數分辨「清空」與「打到一半」(`details.isIncomplete`)。
   */
  onChange?: (value: string | null, details: PickerChangeDetails) => void;
  /** 可選範圍(含),`YYYY-MM-DD` */
  minDate?: string;
  maxDate?: string;
  /* 以下沿用 MUI 的名字而不自創(STYLE-05 / FIGMA-01:包裝層能透傳就透傳) */
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: ReactNode;
  fullWidth?: boolean;
  name?: string;
  /**
   * 輸入格高度,與 `TextField` / `Select` 同一組名字。
   * 預設 `medium`(MUI 的原預設);和 `size="small"` 的下拉同列時要一起給 `small`,
   * 否則日期欄比隔壁高一截(資料範圍規則編輯器的條件列)。
   */
  size?: "small" | "medium";
  /** 顯示格式;預設與值格式相同 */
  format?: string;
  locale?: DatePickerLocale;
  sx?: SxProps<Theme>;
}

/** 對外的字串 ↔ 內部的 Dayjs:`undefined` 要原樣傳下去,受控 / 非受控才不會被誤判。 */
const toDate = (value: string | null | undefined): Dayjs | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? null : dayjs(value);
};

/** 未完成(年份沒打滿 4 位)或不合法回 `null`,不往外送錯值。 */
const toValue = (date: Dayjs | null): string | null =>
  isCompleteDate(date) ? date.format(VALUE_FORMAT) : null;

/**
 * 日期選擇(MUI X Date Pickers 社群版 / MIT,dayjs adapter)。
 * 對外只收發 `YYYY-MM-DD` 字串,呼叫端不必碰 dayjs,也不必自己掛 `LocalizationProvider`。
 * 外觀就是一個 outlined `TextField` 加日曆按鈕,幾何與圓角由 theme 的 `MuiOutlinedInput` 供給(STYLE-07)。
 * 受控時內部保留 MUI 的草稿值(`usePickerDraft`),鍵盤逐位輸入不會被外部值往返打斷。
 */
export const DatePicker = ({
  label,
  hiddenLabel = false,
  value,
  defaultValue,
  onChange,
  minDate,
  maxDate,
  disabled,
  readOnly,
  required,
  error,
  helperText,
  fullWidth,
  name,
  size,
  format = VALUE_FORMAT,
  locale = "zh-tw",
  sx,
}: DatePickerProps) => {
  const draft = usePickerDraft({
    value,
    toDate: (date) => dayjs(date),
    toValue,
    onChange,
  });

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={locale}>
      <MuiDatePicker
        label={hiddenLabel ? undefined : label}
        value={draft.date}
        defaultValue={toDate(defaultValue)}
        onChange={draft.handleChange}
        minDate={toDate(minDate) ?? undefined}
        maxDate={toDate(maxDate) ?? undefined}
        disabled={disabled}
        readOnly={readOnly}
        format={format}
        sx={sx}
        slotProps={{
          textField: {
            required,
            error,
            helperText,
            fullWidth,
            name,
            size,
            // 不畫標籤時名稱改掛在欄位的 group 上(沒有標籤元素可指,`aria-labelledby` 一併拿掉)
            ...(hiddenLabel &&
              typeof label === "string" && {
                slotProps: {
                  input: { "aria-label": label, "aria-labelledby": undefined },
                },
              }),
          },
        }}
      />
    </LocalizationProvider>
  );
};
