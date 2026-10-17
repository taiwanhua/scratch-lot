import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { DesignDefinition } from "@/lib/base/form-engine/design-definition";
import { unplacedFields } from "@/lib/base/form-engine/designer-ops";

export interface UnplacedFieldsProps {
  definition: DesignDefinition;
  /** 選中欄位的內部 id */
  selectedFieldId: string | null;
  onSelectField: (fieldId: string) => void;
  onPlace: (fieldId: string) => void;
}

/**
 * 「未放置」區:在 `fields[]` 裡但沒放進版面的欄位(刪分區選了「欄位移到未放置區」、或剛從面板點進來而
 * 還沒有分區)。檢查器對它們報 `LAYOUT_MISSING_FIELD`;可選取改屬性,或「放回版面」(第一個分區最後)。
 * 固定值欄位可以不放進版面,不列在這裡。
 */
export const UnplacedFields = ({
  definition,
  selectedFieldId,
  onSelectField,
  onPlace,
}: UnplacedFieldsProps) => {
  const t = useTranslations("admin.forms.designer");
  const fields = unplacedFields(definition);
  if (fields.length === 0) {
    return null;
  }
  const canPlace = definition.layout.sections.length > 0;

  return (
    <Stack component="section" aria-label={t("unplaced")} spacing={1}>
      <Typography variant="subtitle2">{t("unplaced")}</Typography>
      {fields.map((field) => (
        <Stack
          key={field._id}
          direction="row"
          spacing={1}
          sx={{ alignItems: "center" }}
        >
          <Button
            variant={selectedFieldId === field._id ? "contained" : "outlined"}
            size="small"
            onClick={() => {
              onSelectField(field._id);
            }}
          >
            {`${field.label}(${field.key})`}
          </Button>
          {canPlace && (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                onPlace(field._id);
              }}
            >
              {t("place")}
            </Button>
          )}
        </Stack>
      ))}
    </Stack>
  );
};
