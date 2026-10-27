import { tagPaletteBackground } from "@/components/project/TagPaletteChip/tag-palette-background";
import {
  type TagPaletteKey,
  isTagPaletteKey,
} from "@/lib/project/tag-palettes";

import type { RosterData } from "../roster-context";

/** 那天在排班表各檢視的行事曆標示(規格 14.5「行事曆標示」)。 */
export type RosterCalendarMark =
  | { kind: "closed" }
  | { kind: "special"; paletteKey: TagPaletteKey; name: string | null }
  | { kind: "none" };

/**
 * 行事曆那天 → 標示:店休;特殊日(有選顏色才畫底色與名稱);其他沒有標示。
 * 月 / 週 / 日 / 班表與手機清單都用這裡判斷,不各寫一套。
 */
export const calendarMarkOf = (
  day: RosterData["calendarDays"][number] | undefined,
): RosterCalendarMark => {
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
 * 手機清單那一天的底色:特殊日用它的顏色、店休停用底色(同 `closedBlockSx`)、其他白底。
 * 祖先要有 `tagPaletteBackgroundVarsSx`。
 */
export const calendarMarkBackground = (mark: RosterCalendarMark): string => {
  if (mark.kind === "special") {
    return tagPaletteBackground(mark.paletteKey);
  }
  return mark.kind === "closed"
    ? "action.disabledBackground"
    : "background.paper";
};
