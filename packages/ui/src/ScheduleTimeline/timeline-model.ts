import {
  type TimelineLayoutGroup,
  compareTimelineGroups,
} from "./layout-timeline";
import type {
  ScheduleTimelineBar,
  ScheduleTimelineDisabledRange,
  ScheduleTimelineGroup,
  ScheduleTimelineSlot,
} from "./schedule-timeline-types";
import { type DaySpan, clipToDay } from "./timeline-time";

/**
 * 把模組給的群組 / 長條換成「某一天要畫什麼」(純函式,元件與測試共用):
 * 跨午夜的裁成兩天各一段、長條超出所屬容器的時間拆成前段 / 後段延伸、日模式往下排的列。
 */

/** 分鐘範圍(0–1440)。 */
export interface MinuteRange {
  start: number;
  end: number;
}

/** 長條落在當天的部分:實線段(容器時段內)與前 / 後段延伸(超出容器的時間)。 */
export interface BarDayParts {
  span: DaySpan;
  solid: MinuteRange | null;
  before: MinuteRange | null;
  after: MinuteRange | null;
}

export interface SlotDayModel {
  slot: ScheduleTimelineSlot;
  /** 在容器裡是第幾條(0 起) */
  index: number;
  /** 長條才有;缺額空位的時段就是容器的時段 */
  bar: BarDayParts | null;
}

export interface GroupDayModel extends TimelineLayoutGroup {
  group: ScheduleTimelineGroup;
  span: DaySpan;
  slotModels: SlotDayModel[];
  /** 容器加上延伸段佔的時間(日模式排列時不讓延伸段蓋到別的容器) */
  occupied: MinuteRange;
}

const rangeOrNull = (start: number, end: number): MinuteRange | null =>
  end > start ? { start, end } : null;

const barParts = (
  bar: ScheduleTimelineBar,
  groupSpan: DaySpan,
  date: string,
  timezone: string | undefined,
): BarDayParts | null => {
  const span = clipToDay(bar.start, bar.end, date, timezone);
  if (span === null) {
    return null;
  }
  const { startMinute: s, endMinute: e } = span;
  const { startMinute: gs, endMinute: ge } = groupSpan;
  return {
    span,
    solid: rangeOrNull(Math.max(s, gs), Math.min(e, ge)),
    before: rangeOrNull(s, Math.min(e, gs)),
    after: rangeOrNull(Math.max(s, ge), e),
  };
};

/** 某一天的容器(依完整排序;時段沒落在當天的不列)。`timezone` 沒給 = 瀏覽器時區。 */
export const groupsOfDay = (
  groups: readonly ScheduleTimelineGroup[],
  date: string,
  timezone?: string,
): GroupDayModel[] =>
  groups
    .flatMap((group): GroupDayModel[] => {
      const span = clipToDay(group.start, group.end, date, timezone);
      if (span === null) {
        return [];
      }
      const slotModels = group.slots.flatMap((slot, index): SlotDayModel[] => {
        if (slot.kind === "vacancy") {
          return [{ slot, index, bar: null }];
        }
        const bar = barParts(slot, span, date, timezone);
        return bar === null ? [] : [{ slot, index, bar }];
      });
      const barSpans = slotModels.flatMap((m) => (m.bar ? [m.bar.span] : []));
      return [
        {
          id: group.id,
          start: span.startMinute,
          end: span.endMinute,
          slots: group.slots.length,
          sortKeys: group.sortKeys,
          createdAt: group.createdAt,
          group,
          span,
          slotModels,
          occupied: {
            start: Math.min(
              span.startMinute,
              ...barSpans.map((b) => b.startMinute),
            ),
            end: Math.max(span.endMinute, ...barSpans.map((b) => b.endMinute)),
          },
        },
      ];
    })
    .toSorted(compareTimelineGroups);

/**
 * 日模式的列:依完整排序逐一放進第一個「容器加延伸段的時間都不重疊」的列,放不下就開新列
 * (往下排、往下長,不收起任何東西)。
 */
export const dayLanes = (
  models: readonly GroupDayModel[],
): GroupDayModel[][] => {
  const lanes: GroupDayModel[][] = [];
  for (const model of models.toSorted(compareTimelineGroups)) {
    const lane = lanes.find((placed) =>
      placed.every(
        (other) =>
          model.occupied.end <= other.occupied.start ||
          model.occupied.start >= other.occupied.end,
      ),
    );
    if (lane === undefined) {
      lanes.push([model]);
    } else {
      lane.push(model);
    }
  }
  return lanes;
};

/** 某一天的不能操作範圍。 */
export interface DisabledDayRange extends MinuteRange {
  label: ScheduleTimelineDisabledRange["label"];
}

export const disabledRangesOfDay = (
  ranges: readonly ScheduleTimelineDisabledRange[],
  date: string,
  timezone?: string,
): DisabledDayRange[] =>
  ranges.flatMap((range) => {
    const span = clipToDay(range.start, range.end, date, timezone);
    return span === null
      ? []
      : [{ start: span.startMinute, end: span.endMinute, label: range.label }];
  });

/** 一小時格(第 `hour` 格)是否碰到不能操作的範圍(碰到就不能點)。 */
export const isHourDisabled = (
  hour: number,
  ranges: readonly MinuteRange[],
): boolean =>
  ranges.some(
    (range) => range.start < (hour + 1) * 60 && range.end > hour * 60,
  );

/** 顯示範圍內各容器 / 長條的開始分鐘(自動捲動用)。 */
export const startMinutesOf = (
  days: readonly (readonly GroupDayModel[])[],
): number[] =>
  days.flatMap((models) =>
    models.flatMap((model) => [
      model.span.startMinute,
      ...model.slotModels.flatMap((m) =>
        m.bar ? [m.bar.span.startMinute] : [],
      ),
    ]),
  );

/**
 * 副標畫在長條裡嗎:只有日模式的正常 / 停用長條畫;週模式(窄長條)與「較短」的長條放不下,
 * 副標改放進滑過提示(Figma Draft/ScheduleTimelineBlock State=Short 的副標要換行,
 * 時間軸的長條高度固定、換不了行)。
 */
export const showsSubtitleInBar = (
  orientation: "day" | "week",
  bar: ScheduleTimelineBar,
): boolean => orientation === "day" && bar.state !== "short";
