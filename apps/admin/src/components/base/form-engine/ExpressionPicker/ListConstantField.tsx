import { useState } from "react";

import type { Expression, FieldDef } from "@repo/domain/form";
import { TextField } from "@repo/ui/text-field";

import {
  constantText,
  listConstantOf,
} from "@/lib/base/form-engine/expression-tree";

import { TypedValueInput } from "../TypedValueInput/TypedValueInput";

export interface ListConstantFieldProps {
  value: Expression;
  onChange: (value: Expression) => void;
  label: string;
  /** 目標選項欄(`in` 的清單、多選公式):有給就從它的選項多選,不打逗號字串 */
  optionTarget?: FieldDef | null;
  /** 類別 / lookup 選項查詢用的表單 key */
  formKey?: string;
}

/**
 * 清單常數:目標是選項欄時從該欄位的選項多選(存 value 陣列);其餘是逗號分隔的輸入框
 * (自己記住打到一半的字「甲,」,每次改都回報解析後的清單)。
 */
export const ListConstantField = ({
  value,
  onChange,
  label,
  optionTarget = null,
  formKey = "",
}: ListConstantFieldProps) => {
  const [text, setText] = useState(() => constantText(value));
  if (optionTarget !== null) {
    return (
      <TypedValueInput
        field={optionTarget}
        value={value}
        label={label}
        shape="expression"
        isMultiple
        formKey={formKey}
        onChange={(next) => {
          onChange(Array.isArray(next) ? (next as Expression[]) : []);
        }}
      />
    );
  }
  return (
    <TextField
      label={label}
      size="small"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(listConstantOf(event.target.value));
      }}
    />
  );
};
