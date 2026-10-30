import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

/** 「插入欄位」下拉的一項:顯示名 + 插進模板的寫法(例 `{{value.start_at}}`)。 */
export interface TemplatePlaceholderOption {
  label: string;
  placeholder: string;
}

export interface TemplatePlaceholderInputProps {
  value: string;
  /** 可插入的佔位符;null = 還挑不了(來源還沒選、目錄載入中),下拉停用 */
  options: readonly TemplatePlaceholderOption[] | null;
  onChange: (value: string) => void;
  /** 文案由呼叫端取好(各自的字典區塊) */
  text: {
    label: string;
    hint: string;
    insert: string;
    insertHint: string;
  };
  /** 錯誤原因(REACT-18:寫在模板欄正下方,換掉 `hint`);undefined = 沒錯 */
  errorText?: string;
}

const UNSET = "";

/**
 * 顯示模板的輸入(`{{名稱}}` 佔位符):文字框 + 「插入欄位」下拉,挑一項就把它的寫法接在模板最後。
 * lookup 來源的 `labelTemplate`(表單管理的屬性面板)與列表欄位配置的組合欄共用;
 * 可挑哪些佔位符、寫法長怎樣由呼叫端決定(兩處的佔位符規則不同)。
 */
export const TemplatePlaceholderInput = ({
  value,
  options,
  onChange,
  text,
  errorText,
}: TemplatePlaceholderInputProps) => (
  <Stack spacing={1}>
    <TextField
      label={text.label}
      value={value}
      error={errorText !== undefined}
      helperText={errorText ?? text.hint}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      size="small"
    />
    <SelectField<string>
      label={text.insert}
      value={UNSET}
      displayEmpty
      disabled={options === null || options.length === 0}
      helperText={text.insertHint}
      options={[
        { value: UNSET, label: "—" },
        ...(options ?? []).map((option) => ({
          value: option.placeholder,
          label: option.label,
        })),
      ]}
      onChange={(placeholder) => {
        if (placeholder !== UNSET) {
          onChange(`${value}${placeholder}`);
        }
      }}
      size="small"
    />
  </Stack>
);
