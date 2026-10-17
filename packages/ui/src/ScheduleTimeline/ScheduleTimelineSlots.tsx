"use client";

import { ScheduleTimelineBarItem } from "./ScheduleTimelineBarItem";
import { ScheduleTimelineVacancyItem } from "./ScheduleTimelineVacancyItem";
import { TIMELINE_SLOT_WIDTH } from "./layout-timeline";
import { WEEK_BAR_INSET, daySlotTop } from "./timeline-geometry";
import type { TimelineActions } from "./timeline-interaction";
import type { GroupDayModel } from "./timeline-model";

export interface ScheduleTimelineSlotsProps {
  orientation: "day" | "week";
  model: GroupDayModel;
  date: string;
  /** 容器的位置(px):週模式是容器左緣、日模式是容器上緣 */
  origin: number;
  actions: TimelineActions;
}

/**
 * 一個容器裡的條(長條與缺額空位),順序由模組提供:週模式左右並排(每條 28)、
 * 日模式上下排。和容器是兄弟節點(疊在容器上面),各自是獨立的按鈕。
 */
export const ScheduleTimelineSlots = ({
  orientation,
  model,
  date,
  origin,
  actions,
}: ScheduleTimelineSlotsProps) =>
  model.slotModels.map(({ slot, index, bar }) => {
    const crossOffset =
      orientation === "week"
        ? origin + WEEK_BAR_INSET + TIMELINE_SLOT_WIDTH * index
        : origin + daySlotTop(index);
    if (slot.kind === "vacancy") {
      return (
        <ScheduleTimelineVacancyItem
          key={slot.id}
          orientation={orientation}
          vacancy={slot}
          group={model.group}
          groupSpan={model.span}
          date={date}
          crossOffset={crossOffset}
          actions={actions}
        />
      );
    }
    return bar === null ? null : (
      <ScheduleTimelineBarItem
        key={slot.id}
        orientation={orientation}
        bar={slot}
        parts={bar}
        group={model.group}
        groupSpan={model.span}
        date={date}
        crossOffset={crossOffset}
        actions={actions}
      />
    );
  });
