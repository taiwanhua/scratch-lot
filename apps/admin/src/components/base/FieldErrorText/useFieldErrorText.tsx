import { type ReactNode, useId } from "react";

import { FieldErrorText } from "./FieldErrorText";

/**
 * 群組欄位(勾選 / 單選群組、色票、清單)的錯誤原因與 aria 連結(REACT-18):
 * `describedBy` 放在群組那一層(`role="group"` / `radiogroup`)的 `aria-describedby`(沒錯時 undefined),
 * `errorText` 畫在群組正下方。
 */
export const useFieldErrorText = (
  text: string | undefined,
): { describedBy: string | undefined; errorText: ReactNode } => {
  const id = useId();
  return {
    describedBy: text === undefined ? undefined : id,
    errorText: <FieldErrorText text={text} id={id} />,
  };
};
