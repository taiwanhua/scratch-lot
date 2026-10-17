import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { DataScopeFieldType } from "@repo/graphql";
import { DatePicker } from "@repo/ui/date-picker";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  type ConditionDraft,
  DYNAMIC_REFS_BY_TYPE,
  type DataScopeDynamicRef,
  type DataScopeFieldLike,
  type DataScopeValueDraft,
} from "@/lib/base/data-scope-rule";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";

import type { DataScopeEditorEnv } from "../data-scope-types";

/** 動態值在同一個下拉裡混著靜態選項出現(Figma 167:1761 的「值」欄),用前綴區分。 */
const DYNAMIC_PREFIX = "dynamic:";

export interface ValueEditorProps {
  field: DataScopeFieldLike;
  condition: ConditionDraft;
  env: DataScopeEditorEnv;
  hasError: boolean;
  onChange: (value: DataScopeValueDraft) => void;
}

interface ValueOption {
  value: string;
  label: string;
}

/** 靜態值的選項來源由**型別**決定(ADR-0008:翻譯器不認識個別欄位)。 */
const staticOptionsOf = (
  field: DataScopeFieldLike,
  env: DataScopeEditorEnv,
): ValueOption[] => {
  if (field.type === DataScopeFieldType.Org) {
    return env.orgOptions.map((org) => ({ value: org.id, label: org.path }));
  }
  if (field.type === DataScopeFieldType.User) {
    return env.userOptions.map((user) => ({
      value: user.id,
      label: user.label,
    }));
  }
  return field.options.map((option) => ({
    value: option.value,
    label: option.label,
  }));
};

/**
 * 條件列的「值」欄:依欄位型別出不同控制項(ADR-0008 的值來源欄)。
 * 日期用 `DatePicker`(`between` 兩個),與表單引擎的日期欄同一種做法(`DateWidget`):
 * 存的是**時點** —— 選的那一天在規則所屬組織(根組織)的租戶時區 00:00 的 ISO;本頁只有站在根組織才進得來,
 * 所以就是 `me.currentOrg.timezone`。顯示時換回該時區的 `YYYY-MM-DD` 給選擇器。
 * org / user / enum 是多選下拉,
 * org 與 user 的下拉第一段是**動態值**(【操作者本人】【操作者的所屬組織】)—
 * 選了動態值就取代整份靜態值,反之亦然(同一條件不會又是「本人」又是「某幾個人」)。
 */
export const ValueEditor = ({
  field,
  condition,
  env,
  hasError,
  onChange,
}: ValueEditorProps) => {
  const t = useTranslations("admin.dataScope.condition");
  const tDynamic = useTranslations("admin.dataScope.dynamic");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;

  if (field.type === DataScopeFieldType.Date) {
    const values =
      condition.value.kind === "static" ? condition.value.values : [];
    const isRange = condition.cond === "between";
    const setDate = (index: number, next: string | null) => {
      const size = isRange ? 2 : 1;
      const instant = localDayInstantOf(next, timezone) ?? "";
      onChange({
        kind: "static",
        values: Array.from({ length: size }, (_, position) =>
          position === index ? instant : (values[position] ?? ""),
        ),
      });
    };
    return (
      <Stack direction="row" spacing={1}>
        <DatePicker
          label={isRange ? t("valueFrom") : t("value")}
          value={localDayTextOf(values[0], timezone)}
          error={hasError}
          disabled={env.isReadOnly}
          size="small"
          sx={{ width: 170 }}
          onChange={(next) => {
            setDate(0, next);
          }}
        />
        {isRange && (
          <DatePicker
            label={t("valueTo")}
            value={localDayTextOf(values[1], timezone)}
            error={hasError}
            disabled={env.isReadOnly}
            size="small"
            sx={{ width: 170 }}
            onChange={(next) => {
              setDate(1, next);
            }}
          />
        )}
      </Stack>
    );
  }

  const options: ValueOption[] = [
    ...DYNAMIC_REFS_BY_TYPE[field.type].map((ref) => ({
      value: `${DYNAMIC_PREFIX}${ref}`,
      label: tDynamic(ref),
    })),
    ...staticOptionsOf(field, env),
  ];
  const selected =
    condition.value.kind === "dynamic"
      ? [`${DYNAMIC_PREFIX}${condition.value.ref}`]
      : condition.value.values;

  const handleChange = (next: readonly string[]) => {
    const picked = next.findLast((item) => item.startsWith(DYNAMIC_PREFIX));
    if (picked !== undefined && condition.value.kind !== "dynamic") {
      onChange({
        kind: "dynamic",
        ref: picked.slice(DYNAMIC_PREFIX.length) as DataScopeDynamicRef,
      });
      return;
    }
    onChange({
      kind: "static",
      values: next.filter((item) => !item.startsWith(DYNAMIC_PREFIX)),
    });
  };

  const renderValue = (value: readonly string[]): ReactNode =>
    value
      .map(
        (item) =>
          options.find((option) => option.value === item)?.label ?? item,
      )
      .join("、");

  return (
    <SelectField<string>
      multiple
      size="small"
      label={t("value")}
      value={selected}
      error={hasError}
      disabled={env.isReadOnly}
      sx={{ width: 230 }}
      options={options}
      renderValue={renderValue}
      onChange={handleChange}
    />
  );
};
