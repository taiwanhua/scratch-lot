"use client";

import type { Theme } from "@mui/material/styles";

import { Box } from "../Box/Box";
import { Tooltip } from "../Tooltip/Tooltip";
import { stateLayerSx } from "../theme/state-layer";
import { ScheduleTimelineBarContent } from "./ScheduleTimelineBarContent";
import type {
  ScheduleTimelineBar,
  ScheduleTimelineGroup,
  ScheduleTimelinePoint,
} from "./schedule-timeline-types";
import {
  DAY_BAR_HEIGHT,
  WEEK_BAR_WIDTH,
  dayX,
  weekY,
} from "./timeline-geometry";
import {
  type TimelineActions,
  activationProps,
  isSelected,
  pointerOnlyProps,
  pressedOf,
} from "./timeline-interaction";
import {
  type BarDayParts,
  type MinuteRange,
  showsSubtitleInBar,
} from "./timeline-model";
import { barToneColors } from "./timeline-styles";
import { type DaySpan, formatTimeRange } from "./timeline-time";

export interface ScheduleTimelineBarItemProps {
  orientation: "day" | "week";
  bar: ScheduleTimelineBar;
  parts: BarDayParts;
  group: ScheduleTimelineGroup;
  groupSpan: DaySpan;
  date: string;
  /** 和時間垂直方向的位置(px):日模式是上緣、週模式是左緣 */
  crossOffset: number;
  actions: TimelineActions;
}

type PartKind = "before" | "solid" | "after";

/** 實線段碰到容器邊緣、又沒接延伸段的那一側,往內縮一點(容器比長條大一點)。 */
const EDGE_INSET = { day: 4, week: 1 } as const;

/**
 * 時間軸上的一條長條(Figma Draft/ScheduleTimelineBlock 259:4770):實線段 + 選用的前段 / 後段延伸
 * (超出所屬容器的時間,淡色底 + 虛線框,和實線段相接的一側不畫框、不圓角)。延伸段疊在容器底下,
 * 不會蓋到相鄰容器的文字或長條。停用的長條灰色、不可點,游標維持箭頭。
 */
export const ScheduleTimelineBarItem = ({
  orientation,
  bar,
  parts,
  group,
  groupSpan,
  date,
  crossOffset,
  actions,
}: ScheduleTimelineBarItemProps) => {
  const isWeek = orientation === "week";
  // 長條裡放不下的副標(週模式、較短)移到提示的第一行
  const movedSubtitle =
    bar.subtitle !== undefined && !showsSubtitleInBar(orientation, bar);
  const tooltip = movedSubtitle ? (
    <Box component="span" sx={{ display: "flex", flexDirection: "column" }}>
      <span>{bar.subtitle}</span>
      {bar.tooltip === undefined ? null : <span>{bar.tooltip}</span>}
    </Box>
  ) : (
    bar.tooltip
  );
  const disabled = bar.state === "disabled";
  const tone = barToneColors(bar.tone ?? "primary");
  const onBarClick = actions.onBarClick;
  const interactive = !disabled && onBarClick !== undefined;
  const selected = isSelected(actions.selection, "bar", bar.id);
  const onActivate = (point: ScheduleTimelinePoint) => {
    onBarClick?.(bar, group, point);
  };

  const segments = (
    [
      ["before", parts.before],
      ["solid", parts.solid],
      ["after", parts.after],
    ] as const
  ).flatMap(([kind, range]): { kind: PartKind; range: MinuteRange }[] =>
    range === null ? [] : [{ kind, range }],
  );
  // 長條整段落在容器外(少見)時沒有實線段,由第一段承接按鈕與內容
  const primary = parts.solid === null ? segments[0]?.kind : "solid";

  const geometry = (kind: PartKind, range: MinuteRange) => {
    const inset = EDGE_INSET[orientation];
    const startInset =
      kind === "solid" &&
      parts.before === null &&
      range.start === groupSpan.startMinute
        ? inset
        : 0;
    const endInset =
      kind === "solid" &&
      parts.after === null &&
      range.end === groupSpan.endMinute
        ? inset
        : 0;
    const toPx = isWeek ? weekY : dayX;
    const from = toPx(range.start) + startInset;
    const length = toPx(range.end) - endInset - from;
    return isWeek
      ? { top: from, height: length, left: crossOffset, width: WEEK_BAR_WIDTH }
      : { left: from, width: length, top: crossOffset, height: DAY_BAR_HEIGHT };
  };

  /** 和其他段相接的那一側:不圓角(延伸段另外不畫框)。 */
  const joinedSx = (kind: PartKind) => {
    const joinsStart =
      kind === "after" || (kind === "solid" && parts.before !== null);
    const joinsEnd =
      kind === "before" || (kind === "solid" && parts.after !== null);
    const [startCorners, endCorners] = isWeek
      ? [
          ["borderTopLeftRadius", "borderTopRightRadius"],
          ["borderBottomLeftRadius", "borderBottomRightRadius"],
        ]
      : [
          ["borderTopLeftRadius", "borderBottomLeftRadius"],
          ["borderTopRightRadius", "borderBottomRightRadius"],
        ];
    const sides = isWeek
      ? ["borderTop", "borderBottom"]
      : ["borderLeft", "borderRight"];
    return {
      ...(joinsStart &&
        Object.fromEntries(startCorners.map((corner) => [corner, 0]))),
      ...(joinsEnd &&
        Object.fromEntries(endCorners.map((corner) => [corner, 0]))),
      ...(kind !== "solid" && joinsStart && { [sides[0] ?? ""]: 0 }),
      ...(kind !== "solid" && joinsEnd && { [sides[1] ?? ""]: 0 }),
    };
  };

  /** 實線段是按鈕(互動狀態);延伸段只給滑鼠點,游標手指;不可點的游標維持箭頭。 */
  const interactionSx = (theme: Theme, isPrimary: boolean) => {
    if (!interactive) return { cursor: "default" };
    return isPrimary
      ? stateLayerSx(theme, { tone: bar.tone ?? "primary", selected })
      : { cursor: "pointer" };
  };

  return segments.map(({ kind, range }) => {
    const isPrimary = kind === primary;
    const isExtension = kind !== "solid";
    const buttonProps =
      interactive && isPrimary
        ? activationProps({
            label: bar.ariaLabel ?? formatTimeRange(bar.start, bar.end),
            selected: pressedOf(actions, selected),
            date,
            range,
            onActivate,
          })
        : {};
    const clickProps =
      interactive && !isPrimary
        ? pointerOnlyProps({ date, range, onActivate })
        : {};
    const element = (
      <Box
        key={kind}
        data-timeline-part={kind}
        data-state={isPrimary ? (bar.state ?? "normal") : undefined}
        data-selected={(isPrimary && selected) || undefined}
        {...buttonProps}
        {...clickProps}
        sx={(theme) => ({
          position: "absolute",
          ...geometry(kind, range),
          boxSizing: "border-box",
          borderRadius: 1,
          display: "flex",
          flexDirection: isWeek ? "column" : "row",
          alignItems: "center",
          gap: 0.5,
          overflow: "hidden",
          outline: "none",
          ...(isWeek ? { py: 0.5 } : { pl: 1, pr: 0.75 }),
          ...(disabled
            ? { bgcolor: "action.disabledBackground", color: "text.disabled" }
            : { bgcolor: tone.bgcolor, color: tone.text }),
          ...(isExtension
            ? {
                zIndex: 1,
                opacity: 0.7,
                border: 1,
                borderStyle: "dashed",
                borderColor: disabled ? "divider" : tone.border,
                ...(isWeek && { borderLeftWidth: 3 }),
              }
            : {
                zIndex: 3,
                ...(!disabled && {
                  borderLeft: 3,
                  borderLeftStyle: "solid",
                  borderLeftColor: tone.border,
                }),
              }),
          ...joinedSx(kind),
          ...interactionSx(theme, isPrimary),
        })}
      >
        {isPrimary ? (
          <ScheduleTimelineBarContent
            orientation={orientation}
            bar={bar}
            fromPrevDay={parts.span.fromPrevDay}
            toNextDay={parts.span.toNextDay}
            prevDayLabel={actions.prevDayLabel}
            nextDayLabel={actions.nextDayLabel}
          />
        ) : null}
      </Box>
    );
    return isPrimary ? (
      <Tooltip key={kind} title={tooltip}>
        {element}
      </Tooltip>
    ) : (
      element
    );
  });
};
