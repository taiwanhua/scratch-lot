import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { TimePicker } from "@repo/ui/time-picker";

import type { EntryFieldErrors } from "./entry-dialog-state";

export interface EntryTimeFieldsProps {
  startTime: string;
  endTime: string;
  breakText: string;
  disabled: boolean;
  /** 欄位 → 寫在欄位正下方的原因(REACT-18) */
  fieldErrors: EntryFieldErrors;
  onTimes: (startTime: string, endTime: string) => void;
  onBreak: (text: string) => void;
}

/**
 * 排班對話框的上班 / 下班 / 休息(上下班用 `@repo/ui/time-picker`,值 `HH:mm`;送出時和日期合成時點,
 * 結束不晚於開始 = 隔天):平板以上三欄一列;手機寬上班 / 下班一列、休息自己一列,
 * 欄位下的原因(重疊、店休、畫休……)才有地方換行,不把欄位擠扁(REACT-18)。
 */
export const EntryTimeFields = ({
  startTime,
  endTime,
  breakText,
  disabled,
  fieldErrors,
  onTimes,
  onBreak,
}: EntryTimeFieldsProps) => {
  const t = useTranslations("admin.schedule.roster.entryDialog");
  return (
    <Stack
      direction="row"
      spacing={1.5}
      useFlexGap
      sx={{
        flexWrap: { xs: "wrap", sm: "nowrap" },
        alignItems: "flex-start",
      }}
    >
      <TimePicker
        label={t("startTime")}
        sx={{ flex: "1 1 0", minWidth: 0 }}
        value={startTime === "" ? null : startTime}
        required
        fullWidth
        disabled={disabled}
        error={fieldErrors.startTime !== undefined}
        helperText={fieldErrors.startTime}
        onChange={(next) => {
          onTimes(next ?? "", endTime);
        }}
      />
      <TimePicker
        label={t("endTime")}
        sx={{ flex: "1 1 0", minWidth: 0 }}
        value={endTime === "" ? null : endTime}
        required
        fullWidth
        disabled={disabled}
        error={fieldErrors.endTime !== undefined}
        helperText={fieldErrors.endTime}
        onChange={(next) => {
          onTimes(startTime, next ?? "");
        }}
      />
      <TextField
        label={t("breakMinutes")}
        type="number"
        value={breakText}
        fullWidth
        sx={{ flexBasis: { xs: "100%", sm: 0 }, flexGrow: 1 }}
        disabled={disabled}
        error={fieldErrors.breakMinutes !== undefined}
        helperText={fieldErrors.breakMinutes}
        slotProps={{ htmlInput: { min: 0, step: 5 } }}
        onChange={(event) => {
          onBreak(event.target.value);
        }}
      />
    </Stack>
  );
};
