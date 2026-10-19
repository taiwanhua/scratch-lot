import { useTranslations } from "use-intl";

import { Tag } from "@repo/ui/tag";

import { type TagPaletteKey, tagPalettes } from "@/lib/project/tag-palettes";

export interface TagPaletteChipProps {
  /** 色票代號;`null` = 沒有顏色,不畫任何東西 */
  paletteKey: TagPaletteKey | null;
  /** 標籤上的字;省略 = 色票名稱(藍、青…) */
  label?: string;
}

/**
 * 一個色票代號的標籤(Figma BS-13 289:87534 的顏色欄;形狀沿用 `@repo/ui/tag`)。
 * 顏色取自 `lib/project/tag-palettes.ts`,深色模式以 `theme.applyStyles("dark")` 換成深色那一組
 * —— 和 theme 的 colorSchemes 同一個切換點,元件不自己判斷現在是不是深色(STYLE-04)。
 * 供欄位管理的選項顏色、遊戲顏色、人力需求範本 / 行事曆顏色使用。
 */
export const TagPaletteChip = ({ paletteKey, label }: TagPaletteChipProps) => {
  const t = useTranslations("admin.tagPalettes.names");
  if (paletteKey === null) {
    return null;
  }
  const { light, dark } = tagPalettes[paletteKey];
  return (
    <Tag
      label={label ?? t(paletteKey)}
      data-palette={paletteKey}
      sx={(theme) => ({
        bgcolor: light.bg,
        color: light.text,
        ...theme.applyStyles("dark", { bgcolor: dark.bg, color: dark.text }),
      })}
    />
  );
};
