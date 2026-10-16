import { identityOf, scalarText } from "@/lib/base/form-engine/value-text";

import type { ChoiceOption } from "./widget-types";

/**
 * 選項欄共用的換算(單選 / 多選的三種 widget 都用)。
 *
 * 目前的值**不在可選清單內**時(靜態選項被停用、類別選項拿不到、lookup 還沒搜到它、`allowCustom` 自訂值),
 * 仍要顯示得出來:以存值自己帶的 label(沒有就用 value)補一個選項進清單,不讓欄位看起來像空的。
 */
export const optionOfStored = (stored: unknown): ChoiceOption | null => {
  const value = identityOf(stored);
  if (value === "") {
    return null;
  }
  const label =
    typeof stored === "object" && stored !== null && "label" in stored
      ? scalarText(stored.label)
      : "";
  return { value, label: label === "" ? value : label, stored };
};

export const withCurrent = (
  options: readonly ChoiceOption[],
  current: readonly unknown[],
): ChoiceOption[] => {
  const known = new Set(options.map((option) => option.value));
  const extra = current
    .map((stored) => optionOfStored(stored))
    .filter(
      (option): option is ChoiceOption =>
        option !== null && !known.has(option.value),
    );
  return [...options, ...extra];
};

/** `allowCustom`:輸入的字不在清單裡時,多給一個「使用這個值」的選項(存 `custom: true`)。 */
export const customOptionOf = (
  keyword: string,
  options: readonly ChoiceOption[],
): ChoiceOption | null => {
  const text = keyword.trim();
  if (text === "" || options.some((option) => option.label === text)) {
    return null;
  }
  return {
    value: text,
    label: text,
    stored: { value: text, label: text, custom: true },
  };
};

export const storedOfValue = (
  options: readonly ChoiceOption[],
  value: string,
): unknown => options.find((option) => option.value === value)?.stored ?? null;
