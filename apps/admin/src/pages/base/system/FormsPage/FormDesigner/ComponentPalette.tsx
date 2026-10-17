import { useTranslations } from "use-intl";

import { FIELD_TYPES, type FieldType } from "@repo/domain/form";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  designerPaletteDirection,
  designerPaletteSx,
} from "../../designer-layout";
import { PaletteItem } from "./PaletteItem";

export interface ComponentPaletteProps {
  onAddField: (type: FieldType) => void;
  onAddSection: () => void;
}

/** 設計器左欄(`xl` 以下為畫布上方一列,`pages/base/system/designer-layout.ts`):欄位型別(拖進畫布或點擊新增)+ 新增分區。 */
export const ComponentPalette = ({
  onAddField,
  onAddSection,
}: ComponentPaletteProps) => {
  const t = useTranslations("admin.forms.designer");

  return (
    <Stack
      component="section"
      aria-label={t("palette")}
      direction={designerPaletteDirection}
      spacing={1}
      sx={designerPaletteSx}
    >
      <Typography variant="subtitle2">{t("palette")}</Typography>
      {FIELD_TYPES.map((type) => (
        <PaletteItem
          key={type}
          type={type}
          label={t(`types.${type}`)}
          addLabel={t("addField", { type: t(`types.${type}`) })}
          onAdd={onAddField}
        />
      ))}
      <Button variant="text" size="small" onClick={onAddSection}>
        {t("addSection")}
      </Button>
    </Stack>
  );
};
