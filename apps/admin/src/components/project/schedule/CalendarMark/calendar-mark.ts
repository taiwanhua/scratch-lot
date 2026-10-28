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
  /** 特殊日:`paletteKey` = 行事曆選的顏色(必選) */
  | { kind: "special"; paletteKey: TagPaletteKey; name: string | null }
  | { kind: "none" };

/**
 * 行事曆那天 → 標示:店休;特殊日(它的顏色與名稱;顏色必選,不是色票的舊資料不標);其他沒有標示。
 * 排班表月 / 週 / 日 / 班表 / 手機清單 / 選日期,與我的班表月曆 / 條列都用這裡判斷,不各寫一套。
 */
export const calendarMarkOf = (
  day: CalendarMarkDay | undefined,
): CalendarMark => {
  if (day?.type === "closed") {
    return { kind: "closed" };
  }
  if (day?.type === "special" && isTagPaletteKey(day.paletteKey)) {
    return {
      kind: "special",
      paletteKey: day.paletteKey,
      name: day.name ?? null,
    };
  }
  return { kind: "none" };
};

/**
 * 清單那一天的底色:特殊日用它的顏色(標籤色票底色;祖先要有 `tagPaletteBackgroundVarsSx`)、店休停用底色(同 `closedBlockSx`)、其他白底。
 */
export const calendarMarkBackground = (mark: CalendarMark): string => {
  if (mark.kind === "special") {
    return tagPaletteBackground(mark.paletteKey);
  }
  return mark.kind === "closed"
    ? "action.disabledBackground"
    : "background.paper";
};
