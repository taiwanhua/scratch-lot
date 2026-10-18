import dayjs from "dayjs";
import { type ReactNode, createElement } from "react";

import { Box } from "../Box/Box";
import type {
  ScheduleTimelineBar,
  ScheduleTimelineDate,
  ScheduleTimelineGroup,
  ScheduleTimelineGroupTone,
  ScheduleTimelineSlot,
  ScheduleTimelineVacancy,
} from "./schedule-timeline-types";

/**
 * stories 的示範資料(不是元件):照 Figma 的人員排程(11/1 起一週,週日開頭)。
 * 模組端的「人員排程」說法只在示範資料裡出現,元件本身不知道排程。
 */

export const WEEK = [
  "2026-11-01",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-07",
] as const;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export const weekDates: ScheduleTimelineDate[] = WEEK.map((date, index) => ({
  date,
  label: WEEKDAYS[index],
}));

/** 某一天第幾小時(可超過 24 = 跨午夜到次日)。 */
export const at = (date: string, hours: number): number =>
  dayjs(date).startOf("day").valueOf() + hours * 3_600_000;

/** 自動排入標記(示範:模組自己畫,元件只負責放在右上角)。 */
export const autoMark: ReactNode = createElement(
  Box,
  {
    component: "span",
    "aria-label": "自動排入",
    sx: {
      width: 14,
      height: 14,
      borderRadius: "50%",
      bgcolor: "primary.main",
      color: "primary.contrastText",
      fontSize: 9,
      fontWeight: 600,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
    },
  },
  "✦",
);

/** 「×2」徽章(示範:同一筆排程顧兩台)。 */
export const doubleBadge: ReactNode = createElement(
  Box,
  {
    component: "span",
    sx: {
      px: 0.25,
      borderRadius: 0.5,
      bgcolor: "grey.200",
      typography: "caption",
      fontWeight: 600,
      lineHeight: 1.5,
    },
  },
  "×2",
);

/** 負責人綠標籤 + 姓名(示範:長條標題由模組決定)。 */
const lead = (name: string): ReactNode =>
  createElement(
    Box,
    {
      component: "span",
      sx: {
        px: 0.5,
        borderRadius: 0.5,
        bgcolor: "success.lighter",
        color: "success.darker",
      },
    },
    name,
  );

export const bar = (
  id: string,
  date: string,
  from: number,
  to: number,
  name: string,
  extra: Partial<ScheduleTimelineBar> & { isLead?: boolean } = {},
): ScheduleTimelineBar => {
  const { isLead = false, ...rest } = extra;
  return {
    kind: "bar",
    id,
    start: at(date, from),
    end: at(date, to),
    title: isLead ? lead(name) : name,
    subtitle: "休 30 分",
    ariaLabel: name,
    tooltip: `${name} · ${dayjs(at(date, from)).format("HH:mm")}–${dayjs(at(date, to)).format("HH:mm")}`,
    ...rest,
  };
};

export const vacancy = (
  id: string,
  role: "負責" | "協同",
): ScheduleTimelineVacancy => ({
  kind: "vacancy",
  id,
  label: `缺${role} 1`,
  severity: role === "負責" ? "error" : "warning",
});

/** 容器框色:有缺負責 → error、有缺協同 → warning。 */
const toneOf = (
  missing: readonly ScheduleTimelineVacancy[],
): ScheduleTimelineGroupTone => {
  if (missing.some((slot) => slot.severity === "error")) return "error";
  return missing.length > 0 ? "warning" : "neutral";
};

export const group = (
  id: string,
  date: string,
  from: number,
  to: number,
  name: string,
  short: string,
  slots: ScheduleTimelineSlot[],
  extra: Partial<ScheduleTimelineGroup> = {},
): ScheduleTimelineGroup => {
  const missing = slots.filter(
    (slot): slot is ScheduleTimelineVacancy => slot.kind === "vacancy",
  );
  const filled = slots.length - missing.length;
  const counts = `${String(filled)}/${String(slots.length)}`;
  return {
    id,
    start: at(date, from),
    end: at(date, to),
    title: `${name} ${dayjs(at(date, from)).format("HH:mm")}–${dayjs(at(date, to)).format("HH:mm")} · ${counts}`,
    shortTitle: createElement("span", null, short, createElement("br"), counts),
    tone: toneOf(missing),
    slots,
    sortKeys: [1, 1],
    createdAt: 0,
    ...extra,
  };
};
