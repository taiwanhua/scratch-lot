import { useTranslations } from "use-intl";

import {
  type FieldDef,
  type LayoutSection,
  sectionCollapseOf,
} from "@repo/domain/form";

import type { ResolvedFormState } from "@/lib/base/form-engine/field-states";
import {
  type FormDisplayItemLike,
  displayTextOf,
  isEmptyDisplay,
} from "@/lib/base/form-engine/value-text";

export interface SectionSummaryInput {
  byKey: ReadonlyMap<string, FieldDef>;
  resolved: ResolvedFormState;
  displayValues: readonly {
    fieldKey: string;
    items: readonly FormDisplayItemLike[];
  }[];
  /** 日期 / 日期時間的顯示時區(同格子用的那個) */
  timezone?: string;
}

/**
 * 收合分區標題列的摘要(底座 10.3「收合時標題列顯示的欄位」):設定的欄位裡**看得到、有值的**,
 * 每個印成「標題:值」再以分隔號串起來;值的文字與唯讀檢視同一套(`displayTextOf`)。
 * 讀者沒有 show、`visibleWhen` 算出 false 的欄位不進摘要(收合也不能洩漏看不到的值)。
 */
export const useSectionSummary = ({
  byKey,
  resolved,
  displayValues,
  timezone,
}: SectionSummaryInput): ((section: LayoutSection) => string) => {
  const t = useTranslations("admin.formEngine.renderer");
  const text = {
    empty: t("empty"),
    yes: t("yes"),
    no: t("no"),
    unavailable: t("sourceUnavailable"),
  };
  return (section) =>
    sectionCollapseOf(section)
      .summaryFieldKeys.flatMap((fieldKey) => {
        const field = byKey.get(fieldKey);
        const value = resolved.values[fieldKey];
        if (
          field === undefined ||
          resolved.states.get(fieldKey)?.visible !== true ||
          isEmptyDisplay(value)
        ) {
          return [];
        }
        const display = displayValues.find(
          (entry) => entry.fieldKey === fieldKey,
        )?.items;
        return [
          t("summaryItem", {
            label: field.label,
            value: displayTextOf({
              field,
              value,
              text,
              ...(display !== undefined && { display }),
              ...(timezone !== undefined && { timezone }),
            }),
          }),
        ];
      })
      .join(t("summarySeparator"));
};
