import type { MyScheduleQuery } from "@repo/graphql";

import { tagPaletteBackground } from "@/components/project/TagPaletteChip/tag-palette-background";
import {
  type TagPaletteKey,
  isTagPaletteKey,
} from "@/lib/project/tag-palettes";

type CalendarDay = MyScheduleQuery["mySchedule"]["calendarDays"][number];

/** 那天在我的班表(月曆、條列)的行事曆標示(規格 14.6)。 */
export type MyCalendarMark =
  | { kind: "closed" }
  /** 特殊日:`paletteKey` 是行事曆選的顏色,沒選顏色時是 null(退回中性的特殊日底色) */
  | { kind: "special"; paletteKey: TagPaletteKey | null; name: string | null }
  | { kind: "none" };

/**
 * 行事曆那天 → 標示:店休;特殊日(有沒有選顏色都標,並帶名稱);其他沒有標示。
 * 我的班表的月曆與條列都用這裡判斷,不各寫一套。
 */
export const myCalendarMarkOf = (
  day: CalendarDay | undefined,
): MyCalendarMark => {
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

/**
 * 條列那一行的底色:特殊日用它的顏色(標籤色票底色;祖先要有 `tagPaletteBackgroundVarsSx`),
 * 沒選顏色用底座 `MonthCalendar` 特殊日(`tone: special`)的底色;其他不給。
 */
export const myListBackgroundOf = (
  mark: MyCalendarMark,
): string | undefined => {
  if (mark.kind !== "special") {
    return undefined;
  }
  return mark.paletteKey === null
    ? "info.lighter"
    : tagPaletteBackground(mark.paletteKey);
};
