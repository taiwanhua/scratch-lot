import type { MouseEvent } from "react";
import { useTranslations } from "use-intl";

import type { TagPaletteKey } from "@repo/domain/tag-palette";
import { Tag } from "@repo/ui/tag";

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
 * 一個色票代號的標籤(Figma BS-13 289:87534 的顏色欄與色票面板):`@repo/ui/tag` 的 `palette`
 * 畫顏色(深色模式由 ui 換),這裡只補多語的色票名稱。分類標籤要顯示顏色一律經它(或 `TagPaletteSelect`),
 * 不在別處寫色碼(STYLE-01)。
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
  return (
    <Tag
      palette={paletteKey}
      label={label ?? t(paletteKey)}
      {...(onClick === undefined ? {} : { onClick })}
      {...(disabled === undefined ? {} : { disabled })}
      {...aria}
    />
  );
};
