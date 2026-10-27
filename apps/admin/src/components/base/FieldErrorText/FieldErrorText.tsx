import { Typography } from "@repo/ui/typography";

export interface FieldErrorTextProps {
  /** 欄位下的原因(REACT-18);undefined = 這一欄沒錯,什麼都不畫 */
  text: string | undefined;
  /** 文字的 id;所屬的群組以 `aria-describedby` 指到它(`useFieldErrorText` 給) */
  id?: string;
}

/**
 * 沒有 `helperText` 可放的欄位(勾選群組、單選群組、色票、清單)把錯誤原因寫在欄位正下方(REACT-18),
 * 字級與顏色同 `TextField` 的 helperText。群組要以 `aria-describedby` 連到這段文字,報讀軟體才讀得到:
 * 用 `useFieldErrorText`,不要直接畫這個元件。
 */
export const FieldErrorText = ({ text, id }: FieldErrorTextProps) =>
  text === undefined ? null : (
    <Typography id={id} variant="caption" color="error">
      {text}
    </Typography>
  );
