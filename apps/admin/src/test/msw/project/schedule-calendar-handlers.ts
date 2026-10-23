import { HttpResponse } from "msw";

import type {
  DeleteScheduleCalendarDayMutationVariables,
  SaveScheduleCalendarDayMutationVariables,
  ScheduleCalendarDayFieldsFragment,
  ScheduleCalendarQueryVariables,
} from "@repo/graphql";

import { api } from "../server";
import {
  SCHEDULE_BRANCH,
  SCHEDULE_TENANT,
  type TestCalendarDay,
  sampleScheduleCalendarDays,
} from "./schedule-settings-fixtures";

export interface ScheduleCalendarWorldOptions {
  /** 有 `edit-calendar`:api 回 canEdit = true */
  canEditCalendar?: boolean;
  /** 行事曆預設看的組織(當前組織);預設分店 */
  currentOrg?: { id: string; name: string };
  calendarDays?: TestCalendarDay[];
}

const ORG_NAMES: Record<string, string> = {
  [SCHEDULE_TENANT.id]: SCHEDULE_TENANT.name,
  [SCHEDULE_BRANCH.id]: SCHEDULE_BRANCH.name,
};

const nameOf = (orgId: string): string => ORG_NAMES[orgId] ?? orgId;

/** 分店往上的組織鏈(最上層組織只有自己)。 */
const chainOf = (orgId: string): string[] =>
  orgId === SCHEDULE_TENANT.id ? [orgId] : [orgId, SCHEDULE_TENANT.id];

/** 行事曆的夾具多帶一個 `orgId`(設定那一天的組織);回給前端前拿掉。 */
const withoutOrgId = (
  day: TestCalendarDay,
): ScheduleCalendarDayFieldsFragment => ({
  id: day.id,
  date: day.date,
  type: day.type,
  category: day.category,
  name: day.name,
  note: day.note,
  paletteKey: day.paletteKey,
  ownerOrg: day.ownerOrg,
  canEdit: day.canEdit,
});

let sequence = 0;
const nextId = (): string => {
  sequence += 1;
  return `cal-new-${String(sequence)}`;
};

/**
 * 行事曆的假 api:有狀態;某天以最接近的那一層為準(分店 → 最上層組織),
 * 只有設定那一天的那一層 canEdit(且有 `edit-calendar`)。日期是時點;查詢收 `[from, to)` 時點區間。
 */
export const scheduleCalendarWorld = (
  options: ScheduleCalendarWorldOptions = {},
) => {
  const { canEditCalendar = true, currentOrg = SCHEDULE_BRANCH } = options;
  let calendarDays = [...(options.calendarDays ?? sampleScheduleCalendarDays)];
  const inputs: SaveScheduleCalendarDayMutationVariables["input"][] = [];

  const handlers = [
    api.query("ScheduleCalendar", ({ variables }) => {
      const { input } = variables as ScheduleCalendarQueryVariables;
      const orgId = input.orgId ?? currentOrg.id;
      const chain = chainOf(orgId);
      const from = Date.parse(input.from);
      const to = Date.parse(input.to);
      const byDate = new Map<number, (typeof calendarDays)[number]>();
      for (const day of calendarDays) {
        const rank = chain.indexOf(day.orgId);
        const at = Date.parse(day.date);
        const current = byDate.get(at);
        if (
          rank !== -1 &&
          at >= from &&
          at < to &&
          (current === undefined || rank < chain.indexOf(current.orgId))
        ) {
          byDate.set(at, day);
        }
      }
      const days = [...byDate.values()].map((day) => ({
        ...withoutOrgId(day),
        canEdit: canEditCalendar && day.orgId === orgId,
      }));
      return HttpResponse.json({
        data: {
          scheduleCalendar: {
            orgId,
            orgName: nameOf(orgId),
            from: input.from,
            to: input.to,
            canEdit: canEditCalendar,
            days,
          },
        },
      });
    }),
    api.mutation("SaveScheduleCalendarDay", ({ variables }) => {
      const { input } = variables as SaveScheduleCalendarDayMutationVariables;
      inputs.push(input);
      const orgId = input.orgId ?? currentOrg.id;
      const id = input.id ?? nextId();
      const day = {
        id,
        orgId,
        date: input.date,
        type: input.type,
        category: input.category ?? null,
        name: input.name ?? null,
        note: input.note ?? null,
        paletteKey: input.paletteKey ?? null,
        ownerOrg: { id: orgId, name: nameOf(orgId) },
        canEdit: true,
      };
      calendarDays = [...calendarDays.filter((item) => item.id !== id), day];
      return HttpResponse.json({
        data: { saveScheduleCalendarDay: { item: withoutOrgId(day) } },
      });
    }),
    api.mutation("DeleteScheduleCalendarDay", ({ variables }) => {
      const { input } = variables as DeleteScheduleCalendarDayMutationVariables;
      calendarDays = calendarDays.filter((day) => day.id !== input.id);
      return HttpResponse.json({
        data: { deleteScheduleCalendarDay: { id: input.id } },
      });
    }),
  ];

  return { handlers, inputs };
};
