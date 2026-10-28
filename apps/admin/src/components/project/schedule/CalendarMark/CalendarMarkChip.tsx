import { MONTH_CALENDAR_TONE_BACKGROUND } from "@repo/ui/month-calendar";
import { Tag } from "@repo/ui/tag";

import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import type { TagPaletteKey } from "@/lib/project/tag-palettes";

export interface CalendarMarkChipProps {
  /** 行事曆選的顏色;null = 沒選顏色 */
  paletteKey: TagPaletteKey | null;
  /** 特殊日名稱 */
  name: string | null;
}

/**
 * 特殊日的名稱標籤:有選顏色用色票標籤,沒選顏色用中性的特殊日底色(同底座月曆 `tone: special`)。
 */
export const CalendarMarkChip = ({
  paletteKey,
  name,
}: CalendarMarkChipProps) =>
  paletteKey === null ? (
    <Tag
      label={name ?? ""}
      data-palette="none"
      sx={{
        bgcolor: MONTH_CALENDAR_TONE_BACKGROUND.special,
        color: "text.primary",
      }}
    />
  ) : (
    <TagPaletteChip paletteKey={paletteKey} label={name ?? ""} />
  );
