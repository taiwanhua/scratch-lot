import { useTranslations } from "use-intl";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import { Box } from "@repo/ui/box";
import type {
  ScheduleTimelineDate,
  ScheduleTimelineDisabledRange,
  ScheduleTimelineGroup,
  ScheduleTimelineSlot,
} from "@repo/ui/schedule-timeline";

import { tagPaletteBackground } from "@/components/project/TagPaletteChip/tag-palette-background";
import {
  autoMarkSx,
  leaderMarkSx,
  multiBadgeSx,
} from "@/components/project/schedule/ScheduleLegend/schedule-legend-styles";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import {
  localPartsOf,
  shiftDay,
  weekdayOf,
} from "@/lib/project/schedule-roster";
import {
  type CountLabels,
  type DemandWording,
  type TimelineGroupPlan,
  type TimelineSlotPlan,
  compareGroupPlans,
  dayGroupTitle,
  timelineGroupPlansOf,
  wallClockMs,
  weekFullTitle,
  weekShortTitle,
} from "@/lib/project/schedule-roster-views";
import { isTagPaletteKey } from "@/lib/project/tag-palettes";

import {
  type EntryPreset,
  type RosterDemand,
  type RosterEntry,
  rosterCellKey,
  useRoster,
} from "../roster-context";

/** 時間軸上一個容器的資料(群組 + 它對應的人力需求)。 */
export interface RosterTimelineGroup extends ScheduleTimelineGroup {
  plan: TimelineGroupPlan<RosterDemand>;
  wording: DemandWording;
}

/** 條的 id = `人力需求 id:執行任務 id`(點擊時找回排班 / 缺額)。 */
export const slotIdOf = (demandId: string, taskId: string): string =>
  `${demandId}:${taskId}`;

export interface RosterTimeline {
  dates: ScheduleTimelineDate[];
  groups: RosterTimelineGroup[];
  disabledRanges: ScheduleTimelineDisabledRange[];
  /** 容器 id → 人力需求(點容器標題) */
  demandOfGroup: (groupId: string) => RosterDemand | undefined;
  /** 長條 id → 排班(點長條) */
  entryOfSlot: (slotId: string) => RosterEntry | undefined;
  /** 缺額 id → 新增排班帶入的人力需求與執行任務(點缺額) */
  vacancyPresetOf: (slotId: string) => EntryPreset | undefined;
  wordingOf: (demand: RosterDemand) => DemandWording;
  plansOf: (date: string) => TimelineGroupPlan<RosterDemand>[];
  labels: CountLabels;
}

/**
 * 週 / 日檢視的時間軸資料(規格 14.5「時間軸的人力需求容器」):每筆人力需求一個容器,
 * 條的順序與缺額、×2、延伸由 `timelineGroupPlansOf` 決定,排版交給底座 `ScheduleTimeline`。
 * 時點先換成租戶時區的牆上時間(`wallClockMs`),時間軸才畫在租戶的時間上。
 */
export const useTimelineGroups = (
  dates: readonly string[],
  mode: "week" | "day",
): RosterTimeline => {
  const t = useTranslations("admin.schedule.roster");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const { data, timezone } = useRoster();
  const positions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.position,
  );
  const tasks = useScheduleFieldOptions(SCHEDULE_FIELD_CATEGORY_KEYS.task);
  const labels: CountLabels = {
    short: { leader: t("count.leader"), helper: t("count.helper") },
    long: { leader: t("cell.roles.leader"), helper: t("cell.roles.helper") },
  };
  const time = (iso: string) => localPartsOf(iso, timezone).time;
  const templateById = new Map(data.templates.map((item) => [item.id, item]));
  const templateIndex = new Map(
    data.templates.map((item, index) => [item.id, index]),
  );
  const positionIndex = new Map(
    positions.options.map((option, index) => [option.value, index]),
  );
  const personIndex = new Map(
    data.people.map((person, index) => [person.userId, index]),
  );
  const nameOf = (userId: string) =>
    data.people.find((person) => person.userId === userId)?.name ?? "";
  const entryById = new Map(data.entries.map((entry) => [entry.id, entry]));
  const demandById = new Map(data.demands.map((demand) => [demand.id, demand]));

  const wordingOf = (demand: RosterDemand): DemandWording => {
    const template =
      demand.templateId === null || demand.templateId === undefined
        ? undefined
        : templateById.get(demand.templateId);
    const position = [
      positions.labelOf(demand.positionKey),
      demand.positionNote,
    ]
      .filter((part) => part !== null && part !== undefined && part !== "")
      .join(" · ");
    return {
      shortName: template?.shortName ?? t("tempRow"),
      name: template?.name ?? t("tempRow"),
      time: t("cell.range", {
        start: time(demand.startAt),
        end: time(demand.endAt),
      }),
      position,
      counts: {
        leaderFilled: 0,
        leaderTotal: 0,
        helperFilled: 0,
        helperTotal: 0,
      },
    };
  };

  const plansOf = (date: string) =>
    timelineGroupPlansOf(
      data.demands.filter((demand) => demand.date === date),
      data.entries,
      {
        positionOrder: (key) =>
          positionIndex.get(key) ?? Number.MAX_SAFE_INTEGER,
        templateOrder: (id) =>
          id === null || id === undefined
            ? null
            : (templateIndex.get(id) ?? null),
        personOrder: (userId) =>
          personIndex.get(userId) ?? Number.MAX_SAFE_INTEGER,
      },
    ).toSorted(compareGroupPlans);

  const roleLabel = (role: string) =>
    t(`cell.roles.${role === "leader" ? "leader" : "helper"}`);

  const barTooltip = (entry: RosterEntry) => {
    const lines = entry.assignments.map((item) => {
      const demand = demandById.get(item.demandId);
      const parts = [
        t("cell.taskLine", {
          role: roleLabel(item.role),
          task: tasks.labelOf(item.taskKey),
        }),
        demand === undefined ? "" : wordingOf(demand).position,
        item.reason ?? "",
      ];
      return parts.filter((part) => part !== "").join(" · ");
    });
    return (
      <Box component="span" sx={{ whiteSpace: "pre-line" }}>
        {[
          t("timeline.barTooltip", {
            name: nameOf(entry.userId),
            start: time(entry.startAt),
            end: time(entry.endAt),
            minutes: entry.breakMinutes,
          }),
          ...lines,
        ].join("\n")}
      </Box>
    );
  };

  const slotPlanOf = (slotId: string) => {
    const [demandId = "", taskId = ""] = slotId.split(":");
    const demand = demandById.get(demandId);
    return demand === undefined ? undefined : { demand, taskId };
  };

  const slotOf = (
    slot: TimelineSlotPlan,
    demand: RosterDemand,
  ): ScheduleTimelineSlot => {
    const vacancyLabel = t(
      slot.role === "leader"
        ? "timeline.missingLeader"
        : "timeline.missingHelper",
    );
    if (slot.kind === "vacancy") {
      return {
        kind: "vacancy",
        id: slotIdOf(demand.id, slot.taskId),
        label: vacancyLabel,
        severity: slot.role === "leader" ? "error" : "warning",
        tooltip: t("timeline.addEntryHint"),
        ariaLabel: t("timeline.vacancyAria", {
          label: vacancyLabel,
          name: wordingOf(demand).name,
        }),
      };
    }
    const entry = entryById.get(slot.entryId);
    const name = nameOf(slot.userId);
    const marks = [
      ...(slot.isAuto
        ? [
            <Box
              key="auto"
              component="span"
              aria-label={t("timeline.auto")}
              sx={[autoMarkSx, { position: "static", display: "inline-block" }]}
            >
              ✦
            </Box>,
          ]
        : []),
      ...(slot.multiCount > 1
        ? [
            <Box key="multi" component="span" sx={multiBadgeSx}>
              {t("timeline.multi", { count: slot.multiCount })}
            </Box>,
          ]
        : []),
    ];
    return {
      kind: "bar",
      id: slotIdOf(demand.id, slot.taskId),
      start: wallClockMs(slot.startAt, timezone),
      end: wallClockMs(slot.endAt, timezone),
      title: (
        <Box
          component="span"
          data-roster-cell={rosterCellKey({
            userId: slot.userId,
            date: demand.date,
          })}
          sx={slot.role === "leader" ? leaderMarkSx : { fontWeight: 600 }}
        >
          {name}
        </Box>
      ),
      ...(entry === undefined
        ? {}
        : {
            subtitle: t("timeline.break", { minutes: entry.breakMinutes }),
            tooltip: barTooltip(entry),
          }),
      marks,
      ariaLabel: t("cell.entryAria", {
        name,
        start: time(slot.startAt),
        end: time(slot.endAt),
      }),
    };
  };

  const shownDates = mode === "day" ? dates.slice(0, 1) : dates;
  const groups = shownDates.flatMap((date) =>
    plansOf(date).map((plan): RosterTimelineGroup => {
      const { demand } = plan;
      const wording = { ...wordingOf(demand), counts: plan.counts };
      const short = weekShortTitle(wording);
      const fullTitle =
        mode === "week"
          ? weekFullTitle(wording, labels.short)
          : dayGroupTitle(wording, labels.long);
      return {
        id: demand.id,
        plan,
        wording,
        start: wallClockMs(demand.startAt, timezone),
        end: wallClockMs(demand.endAt, timezone),
        title: dayGroupTitle(wording, labels.long),
        shortTitle: (
          <Box component="span" sx={{ textAlign: "center" }}>
            {short.shortName}
            <br />
            {short.count}
          </Box>
        ),
        tone: plan.tone,
        slots: plan.slots.map((slot) => slotOf(slot, demand)),
        sortKeys: plan.sortKeys,
        createdAt: plan.createdAt,
        tooltip: fullTitle,
        ariaLabel: fullTitle,
      };
    }),
  );

  const calendarByDate = new Map(
    data.calendarDays.map((day) => [day.date, day]),
  );
  const timelineDates = shownDates.map((date): ScheduleTimelineDate => {
    const day = calendarByDate.get(date);
    const special =
      day?.type === "special" && isTagPaletteKey(day.paletteKey)
        ? day.paletteKey
        : null;
    return {
      date,
      label: (
        <Box component="span" data-roster-cell={rosterCellKey({ date })}>
          {/* 表頭的日期由時間軸畫,這裡只寫星期與特殊日名稱 */}
          {tCalendar(`weekdays.${String(weekdayOf(date))}`)}
          {special !== null && day?.name ? ` ${day.name}` : ""}
        </Box>
      ),
      ...(special === null
        ? {}
        : { background: tagPaletteBackground(special) }),
    };
  });

  const disabledRanges = shownDates.flatMap(
    (date): ScheduleTimelineDisabledRange[] =>
      calendarByDate.get(date)?.type === "closed"
        ? [
            {
              start: new Date(`${date}T00:00:00`).getTime(),
              end: new Date(`${shiftDay(date, 1)}T00:00:00`).getTime(),
              label: t("cell.closed"),
            },
          ]
        : [],
  );

  return {
    dates: timelineDates,
    groups,
    disabledRanges,
    demandOfGroup: (groupId) => demandById.get(groupId),
    entryOfSlot: (slotId) => {
      const found = slotPlanOf(slotId);
      const entryId = found?.demand.tasks.find(
        (task) => task.taskId === found.taskId,
      )?.entryId;
      return entryId === null || entryId === undefined
        ? undefined
        : entryById.get(entryId);
    },
    vacancyPresetOf: (slotId) => {
      const found = slotPlanOf(slotId);
      return found === undefined
        ? undefined
        : {
            date: found.demand.date,
            demandId: found.demand.id,
            taskId: found.taskId,
          };
    },
    wordingOf,
    plansOf,
    labels,
  };
};
