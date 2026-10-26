import { useState } from "react";

import { TextField } from "@repo/ui/text-field";

import { parseRate } from "./parse-rate";

/**
 * 批購金額率的輸入框:改過(和預設不同)標色。輸入中的文字自己記(清空、打到一半不會被 `value` 蓋回去);
 * 是 0–100 的整數才回報,離開時還原成目前的值;`value` 從外面改(例:改整組)時跟著換。
 */
export const RateInput = ({
  label,
  value,
  isEdited,
  onChange,
}: {
  label: string;
  value: number;
  isEdited: boolean;
  onChange: (rate: number) => void;
}) => {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  return (
    <TextField
      size="small"
      type="number"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const rate = parseRate(event.target.value);
        if (rate !== null) {
          onChange(rate);
        }
      }}
      onBlur={() => {
        setText(String(value));
      }}
      sx={{
        width: 88,
        "& input": { textAlign: "right" },
        ...(isEdited && {
          "& .MuiInputBase-root": { bgcolor: "warning.light" },
        }),
      }}
      slotProps={{ htmlInput: { "aria-label": label, min: 0, max: 100 } }}
    />
  );
};
