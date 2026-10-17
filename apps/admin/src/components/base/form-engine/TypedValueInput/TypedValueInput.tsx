import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { DatePicker } from "@repo/ui/date-picker";
import { DateTimePicker } from "@repo/ui/date-time-picker";
import { SelectField } from "@repo/ui/select-field";
import { TextField } from "@repo/ui/text-field";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";
import { scalarText } from "@/lib/base/form-engine/value-text";

import { ChoiceValueInput } from "./ChoiceValueInput";
import type { TypedValueField, TypedValueShape } from "./typed-value";

export interface TypedValueInputProps {
  field: TypedValueField;
  value: unknown;
  /** 清空(沒選、刪光)回 null */
  onChange: (value: unknown) => void;
  label: string;
  /** 存值(預設)或表達式常數的形狀(`typed-value.ts`) */
  shape?: TypedValueShape;
  /** 單選欄當成多選挑(`in` 的清單、選項清單常數)給 true;多選欄當單選挑給 false;預設照欄位型別 */
  isMultiple?: boolean;
  /** 類別 / lookup 選項用填寫時的選擇器查,要知道查哪張表單(設計器 = 草稿) */
  formKey?: string;
  /** 查哪一版的選項定義;不給(null)= 草稿(設計器)。舊版資料升級的補值 = 目標版 */
  version?: number | null;
  /** 給了就多一個「不設」選項(是 / 否、靜態單選),選它回 null */
  emptyLabel?: string;
  helperText?: string;
  /** 日期 / 日期時間的時區;不給 = 租戶時區(還沒載到 = `Asia/Taipei`) */
  timezone?: string;
}

const NONE = "";

/** 數字:存值是十進位字串(照打的字),表達式常數是 number;清空回 null。 */
const numberOf = (text: string, shape: TypedValueShape): unknown => {
  if (text.trim() === "") {
    return null;
  }
  return shape === "stored" ? text : Number(text);
};

/** 文字:清空回 null。 */
const textOf = (text: string): string | null => (text === "" ? null : text);

/**
 * 依欄位型別給的**值輸入元件**(Spec 6a §5 表 B 末段:值來源「固定值」、日期上下限、表達式常數、
 * 預設值共用):文字 / 數字打字、是 / 否下拉、日期 → DatePicker(送當地 00:00 的 ISO)、日期時間 →
 * DateTimePicker(ISO)、單選 / 多選 → 從該欄位的選項挑(`ChoiceValueInput`)。回傳**正確型別**:
 * 是 / 否是布林、多選是陣列、日期是 ISO。只收欄位屬性與 `onChange`,不綁設計器 store。
 */
export const TypedValueInput = ({
  field,
  value,
  onChange,
  label,
  shape = "stored",
  isMultiple = field.type === "multiSelect",
  formKey = "",
  version = null,
  emptyLabel,
  helperText,
  timezone,
}: TypedValueInputProps) => {
  const t = useTranslations("admin.forms.property");
  const tenantTimezone = useTenantTimezone();
  const zone = timezone ?? tenantTimezone ?? DEFAULT_TENANT_TIMEZONE;
  const common = {
    label,
    size: "small" as const,
    ...(helperText !== undefined && { helperText }),
  };

  switch (field.type) {
    case "boolean": {
      return (
        <SelectField<string>
          {...common}
          value={typeof value === "boolean" ? String(value) : NONE}
          displayEmpty={emptyLabel !== undefined}
          options={[
            ...(emptyLabel === undefined
              ? []
              : [{ value: NONE, label: emptyLabel }]),
            { value: "true", label: t("defaultBoolean.true") },
            { value: "false", label: t("defaultBoolean.false") },
          ]}
          onChange={(next) => {
            onChange(next === NONE ? null : next === "true");
          }}
        />
      );
    }
    case "date": {
      return (
        <DatePicker
          {...common}
          value={localDayTextOf(value, zone)}
          onChange={(next) => {
            onChange(localDayInstantOf(next, zone));
          }}
        />
      );
    }
    case "datetime": {
      return (
        <DateTimePicker
          {...common}
          value={typeof value === "string" ? value : null}
          timezone={zone}
          onChange={onChange}
        />
      );
    }
    case "select":
    case "multiSelect": {
      return (
        <ChoiceValueInput
          field={field}
          value={value}
          onChange={onChange}
          label={label}
          shape={shape}
          isMultiple={isMultiple}
          formKey={formKey}
          version={version}
          timezone={zone}
          {...(emptyLabel !== undefined && { emptyLabel })}
          {...(helperText !== undefined && { helperText })}
        />
      );
    }
    default: {
      const isNumber = field.type === "number";
      return (
        <TextField
          {...common}
          type={isNumber ? "number" : "text"}
          value={scalarText(value)}
          onChange={(event) => {
            const text = event.target.value;
            onChange(isNumber ? numberOf(text, shape) : textOf(text));
          }}
        />
      );
    }
  }
};
