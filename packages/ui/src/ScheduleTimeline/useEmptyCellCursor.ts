import { useState } from "react";

import type { ScheduleTimelineMode } from "./schedule-timeline-types";
import { type EmptyCellCursor, emptyCellKey } from "./timeline-interaction";
import { type MinuteRange, isHourDisabled } from "./timeline-model";
import { DEFAULT_SCROLL_MINUTE } from "./timeline-time";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export interface EmptyCellCursorOptions {
  mode: ScheduleTimelineMode;
  /** 顯示的日期(欄的順序) */
  dates: readonly string[];
  /** 與 `dates` 同順序:每天不能操作的範圍(碰到的小時格不能點) */
  disabledRanges: readonly (readonly MinuteRange[])[];
  /** 空白處可點(使用處有給 `onEmptyClick`) */
  enabled: boolean;
}

/**
 * 空白格的 roving tabindex:168 格(週)/ 24 格(日)不全進 tab 順序,只留一格當停留點,
 * 方向鍵在格子間移動(週模式上下 = 前後一小時、左右 = 前後一天;日模式左右 = 前後一小時),
 * 跳過不能操作的格子。停留點預設是第一天 08:00 起第一個可點的格子,之後記住最後拿到焦點的那一格。
 */
export const useEmptyCellCursor = ({
  mode,
  dates,
  disabledRanges,
  enabled,
}: EmptyCellCursorOptions): EmptyCellCursor => {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const isOpen = (dayIndex: number, hour: number) =>
    enabled &&
    dayIndex >= 0 &&
    dayIndex < dates.length &&
    hour >= 0 &&
    hour < 24 &&
    !isHourDisabled(hour, disabledRanges[dayIndex] ?? []);
  const keyAt = (dayIndex: number, hour: number) =>
    emptyCellKey(dates[dayIndex] ?? "", hour);

  const openKeys = dates.flatMap((_, dayIndex) =>
    HOURS.filter((hour) => isOpen(dayIndex, hour)).map((hour) =>
      keyAt(dayIndex, hour),
    ),
  );
  const firstHour = DEFAULT_SCROLL_MINUTE / 60;
  const preferred = HOURS.slice(firstHour).find((hour) => isOpen(0, hour));
  const fallback =
    preferred === undefined ? (openKeys[0] ?? null) : keyAt(0, preferred);
  const activeKey =
    focusedKey !== null && openKeys.includes(focusedKey)
      ? focusedKey
      : fallback;

  /** 從 (日, 時) 往某方向一格一格找第一個可點的格子。 */
  const step = (
    dayIndex: number,
    hour: number,
    dDay: number,
    dHour: number,
  ): string | null => {
    let d = dayIndex + dDay;
    let h = hour + dHour;
    while (d >= 0 && d < dates.length && h >= 0 && h < 24) {
      if (isOpen(d, h)) return keyAt(d, h);
      d += dDay;
      h += dHour;
    }
    return null;
  };

  const DELTAS: Record<string, [number, number] | undefined> =
    mode === "week"
      ? {
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
        }
      : { ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  return {
    activeKey,
    onFocus: setFocusedKey,
    move: (date, hour, key) => {
      const delta = DELTAS[key];
      return delta === undefined
        ? null
        : step(dates.indexOf(date), hour, delta[0], delta[1]);
    },
  };
};
