import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { FieldReference } from "@/lib/base/form-engine/field-references";

export interface FieldReferenceListProps {
  references: readonly FieldReference[];
}

/**
 * 「還有誰引用這個 / 這些欄位」的清單(刪欄位、刪分區連同欄位共用):
 * 表達式、摘要槽、帶入規則、連動篩選(草稿內)與列表欄位配置(草稿外,只提示)。
 */
export const FieldReferenceList = ({ references }: FieldReferenceListProps) => {
  const t = useTranslations("admin.forms.deleteField");

  const describe = (reference: FieldReference): string => {
    switch (reference.kind) {
      case "expression": {
        return t("refExpression", {
          field: reference.fieldKey,
          slot: t(`slots.${reference.slot}`),
        });
      }
      case "summary": {
        return t("refSummary", { slot: t(`summarySlots.${reference.slot}`) });
      }
      case "prefill": {
        return t("refPrefill", { label: reference.label });
      }
      case "lookupFilter": {
        return reference.columnKey === undefined
          ? t("refLookupFilter", { field: reference.fieldKey })
          : t("refLookupFilterColumn", {
              field: reference.fieldKey,
              column: reference.columnKey,
            });
      }
      case "listColumn": {
        return t("refListColumn");
      }
    }
  };

  if (references.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("noReferences")}
      </Typography>
    );
  }
  return (
    <Stack
      component="ul"
      role="list"
      aria-label={t("references")}
      sx={{ m: 0, pl: 2.5 }}
    >
      {references.map((reference, index) => (
        <Typography
          key={`${reference.kind}-${String(index)}`}
          component="li"
          variant="body2"
        >
          {describe(reference)}
        </Typography>
      ))}
    </Stack>
  );
};
