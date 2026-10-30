import { type KeyboardEvent, type ReactNode, useState } from "react";

import { Alert } from "@repo/ui/alert";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { useScanner } from "@/hooks/base/useScanner/useScanner";

/** 「正面條碼的遊戲」選單的一個選項。 */
export interface ScanGameOption {
  value: string;
  label: string;
}

/** 「正面條碼的遊戲」選單(要顯示時才給)。 */
export interface ScanGamePicker {
  label: string;
  /** 「不選」那一項的文字(例「刷背面編號」);不給 = 沒有不選的選項 */
  noneLabel?: string;
  options: readonly ScanGameOption[];
  /** 選的遊戲;null = 沒選 */
  value: string | null;
  onChange: (gameId: string | null) => void;
}

export interface BookScanBarProps {
  /** 掃描用途(B10 全域掃描監聽;條碼槍讀到的碼交給這一列) */
  purpose: string;
  /** 輸入欄的標籤(例「刷條碼加入」「刷條碼點收」) */
  label: string;
  /** 刷到一個碼(條碼槍或手動輸入後按 Enter);回傳 `false` = 失敗,輸入欄保留原碼 */
  onScan: (code: string) => boolean | Promise<boolean>;
  /** 還不能刷(例 還沒選分店)或正在送出 */
  disabled?: boolean;
  /** 「正面條碼的遊戲」選單;不給 = 不顯示 */
  gamePicker?: ScanGamePicker | null;
  /** 刷條碼的提示 / 錯誤(固定顯示在這一列正下方) */
  message?: { severity: "warning" | "error"; text: string } | null;
  /** 列尾的按鈕(例 [完成這次點收]) */
  action?: ReactNode;
}

const NONE = "__none__";

/**
 * 刷條碼列(專案規格 8.2、8.4;進貨單 / 調貨單的新增、編輯、點收共用):「正面條碼的遊戲」選單(需要時才給)+
 * 輸入欄(條碼槍 `useScanner` 或手動輸入後按 Enter)+ 列尾按鈕,提示 / 錯誤固定在這一列正下方。
 * 電腦 / 平板一列排開,手機直排、輸入欄滿版。刷成功後清空輸入欄。
 */
export const BookScanBar = ({
  purpose,
  label,
  onScan,
  disabled = false,
  gamePicker = null,
  message = null,
  action,
}: BookScanBarProps) => {
  const [code, setCode] = useState("");

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (disabled || trimmed === "") {
      return;
    }
    void Promise.resolve(onScan(trimmed)).then((ok) => {
      if (ok) {
        setCode("");
      }
    });
  };
  useScanner(purpose, ({ code: scanned }) => {
    submit(scanned);
  });
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit(code);
    }
  };

  return (
    <Stack spacing={1}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" }, justifyContent: "flex-end" }}
      >
        {gamePicker !== null && (
          <SelectField<string>
            label={gamePicker.label}
            size="small"
            value={gamePicker.value ?? NONE}
            disabled={disabled}
            options={[
              ...(gamePicker.noneLabel === undefined
                ? []
                : [{ value: NONE, label: gamePicker.noneLabel }]),
              ...gamePicker.options,
            ]}
            onChange={(next) => {
              gamePicker.onChange(next === NONE ? null : next);
            }}
            sx={{ minWidth: { sm: 200 } }}
          />
        )}
        <TextField
          label={label}
          size="small"
          value={code}
          disabled={disabled}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          onKeyDown={handleKey}
          sx={{ width: { xs: "100%", sm: 280 } }}
          slotProps={{ htmlInput: { "data-scanner-field": purpose } }}
        />
        {action}
      </Stack>
      {message !== null && (
        <Alert severity={message.severity}>{message.text}</Alert>
      )}
    </Stack>
  );
};
