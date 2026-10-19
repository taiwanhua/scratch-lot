import type { MouseEvent } from "react";
import { useTranslations } from "use-intl";

import { Tag } from "@repo/ui/tag";

import { type TagPaletteKey, tagPalettes } from "@/lib/project/tag-palettes";

export interface TagPaletteChipProps {
  /** 色票代號;`null` = 沒有顏色,不畫任何東西 */
  paletteKey: TagPaletteKey | null;
  /** 標籤上的字;省略 = 色票名稱(藍、青…) */
  label?: string;
  /** 給了就變成可點的標籤(MUI Chip 的 button 語意:可聚焦、Enter / 空白鍵觸發) */
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  disabled?: boolean;
  /** 可點時的無障礙名稱(例「「炸物」的顏色」);省略 = 標籤上的字 */
  "aria-label"?: string;
  "aria-haspopup"?: "dialog";
  "aria-expanded"?: boolean;
  /** 色票面板裡標出目前選中的那一個 */
  "aria-pressed"?: boolean;
}

/**
 * 一個色票代號的標籤(Figma BS-13 289:87534 的顏色欄與色票面板;形狀沿用 `@repo/ui/tag`)。
 * 顏色取自 `lib/project/tag-palettes.ts`,深色模式以 `theme.applyStyles("dark")` 換成深色那一組
 * —— 和 theme 的 colorSchemes 同一個切換點,元件不自己判斷現在是不是深色(STYLE-04)。
 * 供欄位管理的選項顏色、遊戲顏色、人力需求範本 / 行事曆顏色使用。
 */
export const TagPaletteChip = ({
  paletteKey,
  label,
  onClick,
  disabled,
  ...aria
}: TagPaletteChipProps) => {
  const t = useTranslations("admin.tagPalettes.names");
  if (paletteKey === null) {
    return null;
  }
  const { light, dark } = tagPalettes[paletteKey];
  return (
    <Tag
      label={label ?? t(paletteKey)}
      data-palette={paletteKey}
      {...(onClick === undefined ? {} : { onClick })}
      {...(disabled === undefined ? {} : { disabled })}
      {...aria}
      sx={(theme) => ({
        bgcolor: light.bg,
        color: light.text,
        // 可點的標籤:hover / focus 維持同一組顏色,只加一圈文字色外框(不換成別的顏色)
        "&.MuiChip-clickable:hover, &.MuiChip-clickable.Mui-focusVisible": {
          bgcolor: light.bg,
          boxShadow: `0 0 0 2px ${light.text}`,
        },
        ...theme.applyStyles("dark", {
          bgcolor: dark.bg,
          color: dark.text,
          "&.MuiChip-clickable:hover, &.MuiChip-clickable.Mui-focusVisible": {
            bgcolor: dark.bg,
            boxShadow: `0 0 0 2px ${dark.text}`,
          },
        }),
      })}
    />
  );
};
