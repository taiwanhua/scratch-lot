"use client";

import type { SxProps, Theme } from "@mui/material/styles";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { TimePicker as MuiTimePicker } from "@mui/x-date-pickers/TimePicker";
import dayjs, { type Dayjs } from "dayjs";
import type { ReactNode } from "react";

import "dayjs/locale/zh-tw";

import {
  type PickerChangeDetails,
  usePickerDraft,
} from "../DatePicker/usePickerDraft";

export type { PickerChangeDetails } from "../DatePicker/usePickerDraft";

/** 對外的值格式:24 小時制、補零的 `HH:mm`(字串比較就是先後順序)。 */
const VALUE_FORMAT = "HH:mm";

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 把 `HH:mm` 放到固定的一天上交給 MUI。值只有時刻、不綁日期,所以哪一天都可以;
 * 固定一天才不會因為「今天」不同而建出不同的物件。`minTime` / `maxTime` 只比時刻(MUI 預設忽略日期部分)。
 */
const REFERENCE_DAY = "2000-01-01";

/** 日曆的語系資料(不是 UI 文案 — ui 套件不做 i18n,文字一律由 props 傳入,I18N-01)。 */
export type TimePickerLocale = "zh-tw" | "en";

export interface TimePickerProps {
  /** 浮動標籤(如「開始」「寄送時間」);ui 不內建文案 */
  label?: ReactNode;
  /**
   * 不畫浮動標籤(外框因此不留 legend 缺口),`label` 改當無障礙名稱(`aria-label`,須是字串)。
   * 給表頭已寫了標題的表格格子用。
   */
  hiddenLabel?: boolean;
  /** 受控值,`HH:mm`(24 小時制);清空為 `null` */
  value?: string | null;
  /** 非受控的初始值,`HH:mm` */
  defaultValue?: string | null;
  /**
   * 選到時間時回傳 `HH:mm`;清空、輸入未完成或不合法時回傳 `null`。
   * 第二個參數分辨「清空」與「打到一半」(`details.isIncomplete`)。
   * 不在 `minutesStep` 格子上、或超出 `minTime` / `maxTime` 的時間仍照打的值回傳(欄位標紅),由使用處驗證後擋下。
   */
  onChange?: (value: string | null, details: PickerChangeDetails) => void;
  /**
   * 分鐘的間隔(例 15 = 00、15、30、45):選單只列這些分鐘,不在格子上的時間標紅。
   * 預設 1(選單每 5 分鐘一格,MUI 的預設)。
   */
  minutesStep?: number;
  /** 可選範圍(含),`HH:mm` */
  minTime?: string;
  maxTime?: string;
  /* 以下沿用 MUI 的名字而不自創(STYLE-05 / FIGMA-01:包裝層能透傳就透傳) */
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: ReactNode;
  fullWidth?: boolean;
  name?: string;
  /** 輸入格高度,與 `TextField` / `DatePicker` 同一組名字;預設 `medium` */
  size?: "small" | "medium";
  /** 顯示格式;預設與值格式相同(`HH:mm`) */
  format?: string;
  locale?: TimePickerLocale;
  sx?: SxProps<Theme>;
}

/** `HH:mm` → 固定那一天的 Dayjs;不是 `HH:mm` 的字串給不合法的物件(欄位顯示為不合法,不猜)。 */
const dayjsOf = (time: string): Dayjs =>
  HH_MM.test(time) ? dayjs(`${REFERENCE_DAY}T${time}`) : dayjs(Number.NaN);

/** 對外的字串 ↔ 內部的 Dayjs:`undefined` 要原樣傳下去,受控 / 非受控才不會被誤判。 */
const toDate = (value: string | null | undefined): Dayjs | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? null : dayjsOf(value);
};

/** 未完成或不合法回 `null`,不往外送錯值。 */
const toValue = (date: Dayjs | null): string | null =>
  date?.isValid() === true ? date.format(VALUE_FORMAT) : null;

/**
 * 時刻選擇(MUI X Date Pickers 社群版 / MIT,dayjs adapter),24 小時制。
 * 對外只收發 `HH:mm` 字串:時刻不綁日期、不是時點,要綁某一天時由使用處和日期一起換成時點。
 * 外觀同 `DatePicker`:outlined `TextField` 加時鐘按鈕,幾何由 theme 的 `MuiOutlinedInput` 供給(STYLE-07)。
 * 受控時內部保留 MUI 的草稿值(`usePickerDraft`),鍵盤逐位輸入不會被外部值往返打斷。
 */
export const TimePicker = ({
  label,
  hiddenLabel = false,
  value,
  defaultValue,
  onChange,
  minutesStep,
  minTime,
  maxTime,
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
}: TimePickerProps) => {
  const draft = usePickerDraft({
    value,
    toDate: dayjsOf,
    toValue,
    onChange,
  });

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={locale}>
      <MuiTimePicker
        label={hiddenLabel ? undefined : label}
        value={draft.date}
        defaultValue={toDate(defaultValue)}
        onChange={draft.handleChange}
        ampm={false}
        minutesStep={minutesStep}
        // 選單的分鐘欄只列格子上的分鐘(沒給時用 MUI 的預設 5 分鐘一格)
        timeSteps={
          minutesStep === undefined ? undefined : { minutes: minutesStep }
        }
        minTime={toDate(minTime) ?? undefined}
        maxTime={toDate(maxTime) ?? undefined}
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
