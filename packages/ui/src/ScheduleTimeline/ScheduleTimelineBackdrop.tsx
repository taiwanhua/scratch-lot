"use client";

import type { KeyboardEvent } from "react";

import { Box } from "../Box/Box";
import { stateLayerSx } from "../theme/state-layer";
import { dayX, weekY } from "./timeline-geometry";
import {
  type TimelineActions,
  activationProps,
  emptyCellKey,
} from "./timeline-interaction";
import { type DisabledDayRange, isHourDisabled } from "./timeline-model";
import { formatMinute } from "./timeline-time";

export interface ScheduleTimelineBackdropProps {
  orientation: "day" | "week";
  date: string;
  disabledRanges: readonly DisabledDayRange[];
  actions: TimelineActions;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * 時間軌道的底層:每小時一格的空白處(點了回呼模組、滑過顯示淡色「+ 新增」提示)與
 * 不能操作的時間範圍(灰色,不能點、游標維持箭頭)。容器與長條疊在上面。
 */
export const ScheduleTimelineBackdrop = ({
  orientation,
  date,
  disabledRanges,
  actions,
}: ScheduleTimelineBackdropProps) => {
  const isWeek = orientation === "week";
  const { onEmptyClick, emptyHint, emptyCursor } = actions;
  const along = (start: number, end: number) =>
    isWeek
      ? {
          top: weekY(start),
          height: weekY(end) - weekY(start),
          left: 0,
          right: 0,
        }
      : {
          left: dayX(start),
          width: dayX(end) - dayX(start),
          top: 0,
          bottom: 0,
        };

  return (
    <>
      {onEmptyClick === undefined
        ? null
        : HOURS.filter((hour) => !isHourDisabled(hour, disabledRanges)).map(
            (hour) => {
              const key = emptyCellKey(date, hour);
              const button = activationProps({
                label: `${emptyHint ?? "+"} ${date} ${formatMinute(hour * 60)}`,
                selected: undefined,
                date,
                range: { start: hour * 60, end: (hour + 1) * 60 },
                timezone: actions.timezone,
                onActivate: onEmptyClick,
              });
              return (
                <Box
                  key={hour}
                  data-timeline-part="empty"
                  data-empty-cell={key}
                  {...button}
                  // roving tabindex:整個時間軸只有一格空白格在 tab 順序裡,方向鍵在格子間移動
                  tabIndex={emptyCursor.activeKey === key ? 0 : -1}
                  onFocus={() => {
                    emptyCursor.onFocus(key);
                  }}
                  onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
                    if (!event.key.startsWith("Arrow")) {
                      button.onKeyDown(event);
                      return;
                    }
                    event.preventDefault();
                    const next = emptyCursor.move(date, hour, event.key);
                    if (next === null) return;
                    event.currentTarget
                      .closest("[data-timeline-root]")
                      ?.querySelector<HTMLElement>(
                        `[data-empty-cell="${CSS.escape(next)}"]`,
                      )
                      ?.focus();
                  }}
                  sx={(theme) => ({
                    position: "absolute",
                    ...along(hour * 60, (hour + 1) * 60),
                    boxSizing: "border-box",
                    // 提示放在不會被容器蓋住的地方:週模式靠右(避開最右邊 24px 的「+N」長條)、
                    // 日模式在軌道最下方預留的那一列
                    display: "flex",
                    ...(isWeek
                      ? {
                          justifyContent: "flex-end",
                          alignItems: "flex-start",
                          pt: 0.5,
                          pr: 3,
                        }
                      : { alignItems: "flex-end", px: 0.75, pb: 0.5 }),
                    typography: "caption",
                    color: "text.disabled",
                    outline: "none",
                    "& > span": { opacity: 0 },
                    "&:hover > span, &:focus-visible > span": { opacity: 1 },
                    ...stateLayerSx(theme),
                  })}
                >
                  {emptyHint === undefined ? null : <span>{emptyHint}</span>}
                </Box>
              );
            },
          )}
      {disabledRanges.map((range) => (
        <Box
          key={[range.start, range.end].join("-")}
          data-timeline-part="disabled"
          sx={{
            position: "absolute",
            ...along(range.start, range.end),
            bgcolor: "action.disabledBackground",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            typography: "caption",
            fontWeight: 600,
            color: "text.disabled",
            cursor: "default",
          }}
        >
          {range.label}
        </Box>
      ))}
    </>
  );
};
