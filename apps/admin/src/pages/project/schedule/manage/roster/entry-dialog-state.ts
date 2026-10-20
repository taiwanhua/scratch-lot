import { localPartsOf } from "@/lib/project/schedule-roster";

import type { EntryPreset, RosterDemand, RosterEntry } from "./roster-context";

/** 「加入這天的人力需求」的一列。 */
export interface AssignmentRow {
  key: string;
  demandId: string;
  taskId: string;
}

export interface EntryFormState {
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  breakText: string;
  rows: AssignmentRow[];
}

let rowSequence = 0;

/** 每一列畫面上的 key(新的一列也要有)。 */
export const nextRowKey = (): string => {
  rowSequence += 1;
  return `row-${String(rowSequence)}`;
};

/**
 * 排班對話框的初始值:編輯 = 這筆排班;新增 = 帶入的人員 / 日期;從缺額打開時帶好那筆人力需求的時間、
 * 那筆人力需求與執行任務(一列)。
 */
export const initialEntryState = (
  entry: RosterEntry | null,
  preset: EntryPreset,
  presetDemand: RosterDemand | undefined,
  timezone: string,
): EntryFormState => {
  if (entry !== null) {
    return {
      userId: entry.userId,
      date: entry.date,
      startTime: localPartsOf(entry.startAt, timezone).time,
      endTime: localPartsOf(entry.endAt, timezone).time,
      breakText: String(entry.breakMinutes),
      rows: entry.assignments.map((item) => ({
        key: nextRowKey(),
        demandId: item.demandId,
        taskId: item.taskId,
      })),
    };
  }
  const base = {
    userId: preset.userId ?? "",
    date: preset.date ?? presetDemand?.date ?? "",
    breakText: "",
  };
  if (presetDemand === undefined) {
    return { ...base, startTime: "", endTime: "", rows: [] };
  }
  return {
    ...base,
    startTime: localPartsOf(presetDemand.startAt, timezone).time,
    endTime: localPartsOf(presetDemand.endAt, timezone).time,
    rows:
      preset.taskId === undefined
        ? []
        : [
            {
              key: nextRowKey(),
              demandId: presetDemand.id,
              taskId: preset.taskId,
            },
          ],
  };
};

/** 那筆人力需求的執行任務,別筆排班填了的標起來。 */
export const tasksWithFilled = (demand: RosterDemand, entryId: string | null) =>
  demand.tasks.map((task) => ({
    ...task,
    filled:
      task.entryId !== null &&
      task.entryId !== undefined &&
      task.entryId !== entryId,
  }));
