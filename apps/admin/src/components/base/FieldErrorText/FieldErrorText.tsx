import { Typography } from "@repo/ui/typography";

export interface FieldErrorTextProps {
  /** 欄位下的原因(REACT-18);undefined = 這一欄沒錯,什麼都不畫 */
  text: string | undefined;
}

/**
 * 沒有 `helperText` 可放的欄位(勾選群組、單選群組、色票)把錯誤原因寫在欄位正下方(REACT-18),
 * 字級與顏色同 `TextField` 的 helperText。
 */
export const FieldErrorText = ({ text }: FieldErrorTextProps) =>
  text === undefined ? null : (
    <Typography variant="caption" color="error">
      {text}
    </Typography>
  );
