import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import type {
  ScheduleTimelineBar,
  ScheduleTimelineGroup,
  ScheduleTimelineMoreTone,
  ScheduleTimelinePoint,
  ScheduleTimelineSelection,
  ScheduleTimelineVacancy,
} from "./schedule-timeline-types";
import { DAY_HOUR_WIDTH, WEEK_HOUR_HEIGHT } from "./timeline-geometry";
import type { MinuteRange } from "./timeline-model";
import { pointAt } from "./timeline-time";

/** 元件往下傳給各層的回呼與文案(一包,不逐層拆開傳)。 */
export interface TimelineActions {
  selection: ScheduleTimelineSelection | null;
  onGroupClick?: (
    group: ScheduleTimelineGroup,
    point: ScheduleTimelinePoint,
  ) => void;
  onBarClick?: (
    bar: ScheduleTimelineBar,
    group: ScheduleTimelineGroup,
    point: ScheduleTimelinePoint,
  ) => void;
  onVacancyClick?: (
    vacancy: ScheduleTimelineVacancy,
    group: ScheduleTimelineGroup,
    point: ScheduleTimelinePoint,
  ) => void;
  onEmptyClick?: (point: ScheduleTimelinePoint) => void;
  emptyHint?: string;
  onMoreClick?: (
    date: string,
    collapsed: readonly ScheduleTimelineGroup[],
  ) => void;
  getMoreTone: (
    collapsed: readonly ScheduleTimelineGroup[],
    date: string,
  ) => ScheduleTimelineMoreTone;
  formatMoreLabel: (count: number) => string;
  prevDayLabel: ReactNode;
  nextDayLabel: ReactNode;
}

export const isSelected = (
  selection: ScheduleTimelineSelection | null,
  kind: "group" | "bar" | "vacancy",
  id: string,
): boolean =>
  selection !== null &&
  selection.kind === kind &&
  "id" in selection &&
  selection.id === id;

/**
 * 滑鼠點到的是第幾分鐘:從最近的時間軌道(`data-timeline-axis`,週模式一天欄 / 日模式整列區)
 * 量起;量不到時回 `null`。
 */
const minuteFromPointer = (event: MouseEvent<HTMLElement>): number | null => {
  const track = event.currentTarget.closest<HTMLElement>(
    "[data-timeline-axis]",
  );
  if (track === null) {
    return null;
  }
  const rect = track.getBoundingClientRect();
  return track.dataset.timelineAxis === "x"
    ? ((event.clientX - rect.left) / DAY_HOUR_WIDTH) * 60
    : ((event.clientY - rect.top) / WEEK_HOUR_HEIGHT) * 60;
};

const clamp = (minute: number, range: MinuteRange) =>
  Math.min(Math.max(minute, range.start), Math.max(range.start, range.end - 1));

const isActivationKey = (event: KeyboardEvent) =>
  event.key === "Enter" || event.key === " ";

export interface ActivationOptions {
  label: string;
  selected: boolean;
  date: string;
  /** 這一段在當天的時間;點到的時間不會超出它,鍵盤操作時取它的開始 */
  range: MinuteRange;
  onActivate: (point: ScheduleTimelinePoint) => void;
}

/** 可點的時間軸元素(容器 / 長條 / 缺額 / 空白格)共用的按鈕屬性:點擊與 Enter / 空白鍵。 */
export const activationProps = ({
  label,
  selected,
  date,
  range,
  onActivate,
}: ActivationOptions) => ({
  role: "button",
  tabIndex: 0,
  "aria-label": label,
  "aria-pressed": selected,
  onClick: (event: MouseEvent<HTMLElement>) => {
    onActivate(
      pointAt(date, clamp(minuteFromPointer(event) ?? range.start, range)),
    );
  },
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
    if (!isActivationKey(event)) return;
    event.preventDefault();
    onActivate(pointAt(date, range.start));
  },
});

/** 只給滑鼠的點擊(延伸段:和實線段同一條長條,不另外佔一個 tab 停留點)。 */
export const pointerOnlyProps = ({
  date,
  range,
  onActivate,
}: Pick<ActivationOptions, "date" | "range" | "onActivate">) => ({
  onClick: (event: MouseEvent<HTMLElement>) => {
    onActivate(
      pointAt(date, clamp(minuteFromPointer(event) ?? range.start, range)),
    );
  },
});
