import { MONTH_CALENDAR_TONE_BACKGROUND } from "@repo/ui/month-calendar";

import { tagPaletteBackground } from "@/components/project/TagPaletteChip/tag-palette-background";
import {
  type TagPaletteKey,
  isTagPaletteKey,
} from "@/lib/project/tag-palettes";

/** 行事曆的一天(排班表、我的班表的查詢都帶這三個欄位)。 */
export interface CalendarMarkDay {
  type: string;
  paletteKey?: string | null;
  name?: string | null;
}

/** 那天在排班表各檢視與我的班表的行事曆標示(規格 14.5「行事曆標示」、14.6)。 */
export type CalendarMark =
  | { kind: "closed" }
  /** 特殊日:`paletteKey` = 行事曆選的顏色;沒選顏色是 null(退回中性的特殊日底色) */
  | { kind: "special"; paletteKey: TagPaletteKey | null; name: string | null }
  | { kind: "none" };

/**
 * 行事曆那天 → 標示:店休;特殊日(有沒有選顏色都標,並帶名稱);其他沒有標示。
 * 排班表月 / 週 / 日 / 班表 / 手機清單 / 選日期,與我的班表月曆 / 條列都用這裡判斷,不各寫一套。
 */
export const calendarMarkOf = (
  day: CalendarMarkDay | undefined,
): CalendarMark => {
  if (day?.type === "closed") {
    return { kind: "closed" };
  }
  if (day?.type === "special") {
    return {
      kind: "special",
      paletteKey: isTagPaletteKey(day.paletteKey) ? day.paletteKey : null,
      name: day.name ?? null,
    };
  }
  return { kind: "none" };
};

/** 特殊日的底色:行事曆選的顏色(標籤色票底色;祖先要有 `tagPaletteBackgroundVarsSx`),沒選顏色用底座月曆的中性特殊日底色。 */
export const specialDayBackground = (
  paletteKey: TagPaletteKey | null,
): string =>
  paletteKey === null
    ? MONTH_CALENDAR_TONE_BACKGROUND.special
    : tagPaletteBackground(paletteKey);

/**
 * 清單那一天的底色:特殊日見 `specialDayBackground`、店休停用底色(同 `closedBlockSx`)、其他白底。
 */
export const calendarMarkBackground = (mark: CalendarMark): string => {
  if (mark.kind === "special") {
    return specialDayBackground(mark.paletteKey);
  }
  return mark.kind === "closed"
    ? "action.disabledBackground"
    : "background.paper";
};
