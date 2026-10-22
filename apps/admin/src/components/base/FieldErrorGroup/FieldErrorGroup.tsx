import { type ReactNode, useId } from "react";

import { Stack } from "@repo/ui/stack";

import { FieldErrorText } from "../FieldErrorText/FieldErrorText";

export interface FieldErrorGroupProps {
  /** 群組的無障礙名稱(例:欄位的標籤) */
  label: string;
  /** 這個群組的錯誤原因(REACT-18);undefined = 沒錯 */
  errorText: string | undefined;
  /** 群組內各項的間距(同外層 `Stack` 的 `spacing`,包起來後排版不變) */
  spacing?: number;
  children: ReactNode;
}

/**
 * 由多個控制項組成的欄位(勾選群組、任務清單、色票、一列條件)的外框(REACT-18):`role="group"`,
 * 錯誤原因畫在群組正下方,並以 `aria-describedby` 連到群組,報讀軟體讀得到。
 */
export const FieldErrorGroup = ({
  label,
  errorText,
  spacing = 0,
  children,
}: FieldErrorGroupProps) => {
  const id = useId();
  return (
    <Stack
      role="group"
      aria-label={label}
      aria-describedby={errorText === undefined ? undefined : id}
      spacing={spacing}
    >
      {children}
      <FieldErrorText text={errorText} id={id} />
    </Stack>
  );
};
