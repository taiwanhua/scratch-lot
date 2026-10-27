import { useTranslations } from "use-intl";

import {
  type FieldDef,
  type FieldType,
  type LookupSourceDescriptor,
  isFilterVarCompatible,
  isLookupFilterVar,
} from "@repo/domain/form";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { LookupProviderOption } from "./useLookupCatalog";

export interface LinkedFilterEditorProps {
  value: LookupSourceDescriptor;
  provider: LookupProviderOption;
  /** 可引用的表單層欄位(呼叫端已排除自己與明細欄) */
  fields: readonly FieldDef[];
  onChange: (value: LookupSourceDescriptor) => void;
}

const UNSET = "";

/** 篩選欄位的型別:`enabled` 是是否;其餘照來源宣告的欄位型別,不在可回欄位內為 null(不擋型別)。 */
const filterTypeOf = (
  provider: LookupProviderOption,
  name: string,
): FieldType | null =>
  (provider.fields.find((field) => field.key === name)?.type as
    FieldType | undefined) ?? (name === "enabled" ? "boolean" : null);

/** 目前連到哪一欄(`{ var: "<key>" }`);沒連動為空字串。 */
const linkedKeyOf = (value: LookupSourceDescriptor, name: string): string => {
  const condition = value.filter?.[name];
  return isLookupFilterVar(condition) && typeof condition.var === "string"
    ? condition.var
    : UNSET;
};

/**
 * 連動篩選的設定:來源每個可當篩選的欄位一個下拉,選「等於表單上的哪一欄」
 * (存 `filter.<欄位> = { var: "<欄位 key>" }`)。只列型別相符的欄位(`isFilterVarCompatible`,與檢查器同一支);
 * 引用不存在 / 型別不符 / 同一列子欄仍由檢查器把關。
 */
export const LinkedFilterEditor = ({
  value,
  provider,
  fields,
  onChange,
}: LinkedFilterEditorProps) => {
  const t = useTranslations("admin.forms.lookupSource");
  if (provider.filterFields.length === 0) {
    return null;
  }
  const labelOf = (name: string): string => {
    if (name === "enabled") {
      return t("filterFields.enabled");
    }
    const declared = provider.fields.find((field) => field.key === name);
    return declared?.label ?? name;
  };
  const setLink = (name: string, fieldKey: string) => {
    const filter: Record<string, unknown> = { ...value.filter };
    if (fieldKey === UNSET) {
      Reflect.deleteProperty(filter, name);
    } else {
      filter[name] = { var: fieldKey };
    }
    const next = { ...value };
    if (Object.keys(filter).length === 0) {
      Reflect.deleteProperty(next, "filter");
    } else {
      next.filter = filter;
    }
    onChange(next);
  };

  return (
    <Stack spacing={1} role="group" aria-label={t("linkedFilter")}>
      <Stack spacing={0.25}>
        <Typography variant="body2">{t("linkedFilter")}</Typography>
        <Typography variant="caption" color="textSecondary">
          {t("linkedFilterHint")}
        </Typography>
      </Stack>
      {provider.filterFields.map((name) => {
        const type = filterTypeOf(provider, name);
        const current = linkedKeyOf(value, name);
        const candidates = fields.filter(
          (field) =>
            isFilterVarCompatible(type, field.type) || field.key === current,
        );
        return (
          <SelectField<string>
            key={name}
            label={t("linkedFilterField", { field: labelOf(name) })}
            value={current}
            displayEmpty
            options={[
              { value: UNSET, label: t("linkedFilterNone") },
              ...candidates.map((field) => ({
                value: field.key,
                label: `${field.label}(${field.key})`,
              })),
              ...(current !== UNSET &&
              !candidates.some((field) => field.key === current)
                ? [{ value: current, label: current }]
                : []),
            ]}
            onChange={(fieldKey) => {
              setLink(name, fieldKey);
            }}
            size="small"
          />
        );
      })}
    </Stack>
  );
};
