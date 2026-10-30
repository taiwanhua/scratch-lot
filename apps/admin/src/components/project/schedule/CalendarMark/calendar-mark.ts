import { type TagPaletteKey, isTagPaletteKey } from "@repo/domain/tag-palette";
import { tagPaletteBackground, tagPaletteColorOf } from "@repo/ui/theme";

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

export interface CalendarMarkBackgroundOptions {
  /**
   * 店休由底座元件自己的停用畫(班表 `RosterDate.disabled`、時間軸 `disabledRanges`、月檢視 `MonthCalendar` 的
   * `disabled`;都是 `action.disabledBackground`):這裡店休回空,不重複疊一層
   */
  closedByComponent?: boolean;
}

/**
 * 行事曆標示 → 那天的底色(規格 14.5「行事曆標示」、14.6;各檢視只做轉接,不各自判斷顏色):
 * - 店休:店休灰 `action.disabledBackground`(同 `closedBlockSx`、班表停用欄、時間軸停用區;半透明,疊在紙色上)
 * - 特殊日:行事曆選的色票淡化底色(`tagPaletteBackground`;祖先要有 `tagPaletteBackgroundVarsSx`)
 * - 其他:空(用原本的底色)
 *
 * 只收「自己淡化的來源色」的底座 `MonthCalendar` 用 `calendarMarkMonthBackground`。
 */
export const calendarMarkBackground = (
  mark: CalendarMark,
  { closedByComponent = false }: CalendarMarkBackgroundOptions = {},
): string | undefined => {
  if (mark.kind === "special") {
    return tagPaletteBackground(mark.paletteKey);
  }
  return mark.kind === "closed" && !closedByComponent
    ? "action.disabledBackground"
    : undefined;
};

/**
 * 底座 `MonthCalendar` 每日資訊的 `background`:它只收**來源色**、自己以主題 alpha 淡化,收不下色票底色變數,
 * 所以特殊日給色票代表色(`tagPaletteColorOf`);店休不從這裡給(排班表月檢視用 `disabled`;
 * 我的班表月曆要可點,用 `calendarMarkBackground` 鋪在 `content` 底層)。
 */
export const calendarMarkMonthBackground = (
  mark: CalendarMark,
): string | undefined =>
  mark.kind === "special" ? tagPaletteColorOf(mark.paletteKey) : undefined;
