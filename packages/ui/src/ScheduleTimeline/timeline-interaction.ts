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
  /** 已選取的東西;`undefined` = 使用處不追蹤選取(按鈕不標 `aria-pressed`) */
  selection: ScheduleTimelineSelection | null | undefined;
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
  /** 空白格的 roving tabindex(整個時間軸只有一格在 tab 順序裡,方向鍵移動) */
  emptyCursor: EmptyCellCursor;
  /** 時間軸的時區(IANA);`undefined` = 瀏覽器時區 */
  timezone: string | undefined;
}

/** 空白格的鍵盤游標:`key` 是 `emptyCellKey(date, hour)`。 */
export interface EmptyCellCursor {
  /** 目前在 tab 順序裡的那一格;沒有可點的空白格時 `null` */
  activeKey: string | null;
  /** 格子拿到焦點(點擊或方向鍵)時記下來 */
  onFocus: (key: string) => void;
  /** 方向鍵:回傳要移過去的那一格(沒有就 `null`,原地不動) */
  move: (date: string, hour: number, key: string) => string | null;
}

export const emptyCellKey = (date: string, hour: number): string =>
  [date, String(hour)].join("@");

export const isSelected = (
  selection: ScheduleTimelineSelection | null | undefined,
  kind: "group" | "bar" | "vacancy",
  id: string,
): boolean =>
  selection?.kind === kind && "id" in selection && selection.id === id;

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

/** Enter / 空白鍵觸發(按鈕的鍵盤行為);其他鍵不處理。 */
export const handleActivationKey = (
  event: KeyboardEvent<HTMLElement>,
  activate: () => void,
) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
};

/** 使用處沒追蹤選取時不標 `aria-pressed`(不是開關按鈕)。 */
export const pressedOf = (
  actions: Pick<TimelineActions, "selection">,
  selected: boolean,
): boolean | undefined =>
  actions.selection === undefined ? undefined : selected;

export interface ActivationOptions {
  label: string;
  /** `undefined` = 不標 `aria-pressed` */
  selected: boolean | undefined;
  date: string;
  /** 這一段在當天的時間;點到的時間不會超出它,鍵盤操作時取它的開始 */
  range: MinuteRange;
  /** 回呼帶出的時點用的時區;`undefined` = 瀏覽器時區 */
  timezone: string | undefined;
  onActivate: (point: ScheduleTimelinePoint) => void;
}

/** 可點的時間軸元素(容器 / 長條 / 缺額 / 空白格)共用的按鈕屬性:點擊與 Enter / 空白鍵。 */
export const activationProps = ({
  label,
  selected,
  date,
  range,
  timezone,
  onActivate,
}: ActivationOptions) => ({
  role: "button",
  tabIndex: 0,
  "aria-label": label,
  "aria-pressed": selected,
  onClick: (event: MouseEvent<HTMLElement>) => {
    onActivate(
      pointAt(
        date,
        clamp(minuteFromPointer(event) ?? range.start, range),
        timezone,
      ),
    );
  },
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
    handleActivationKey(event, () => {
      onActivate(pointAt(date, range.start, timezone));
    });
  },
});

/** 只給滑鼠的點擊(延伸段:和實線段同一條長條,不另外佔一個 tab 停留點)。 */
export const pointerOnlyProps = ({
  date,
  range,
  timezone,
  onActivate,
}: Pick<ActivationOptions, "date" | "range" | "timezone" | "onActivate">) => ({
  onClick: (event: MouseEvent<HTMLElement>) => {
    onActivate(
      pointAt(
        date,
        clamp(minuteFromPointer(event) ?? range.start, range),
        timezone,
      ),
    );
  },
});
