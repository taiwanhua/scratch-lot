import { pickOpenTask } from "@repo/domain/project/schedule-settings";

import type { FieldErrorTexts } from "@/lib/base/field-errors";
import { localPartsOf } from "@/lib/project/schedule-roster";

import { scheduleErrorTextsOf } from "../../schedule-field-errors";
import type { EntryPreset, RosterDemand, RosterEntry } from "./roster-context";

/** 會標回排班對話框的欄位。 */
export type EntryField =
  "userId" | "date" | "startTime" | "endTime" | "breakMinutes" | "assignments";

/** 欄位 → 寫在欄位正下方的原因(REACT-18)。 */
export type EntryFieldErrors = FieldErrorTexts<EntryField>;

const ENTRY_FIELDS: readonly EntryField[] = [
  "userId",
  "date",
  "startTime",
  "endTime",
  "breakMinutes",
  "assignments",
];

/** api 的欄位名 → 對話框的欄位(上下班時間在 api 是時點)。 */
const ENTRY_API_FIELDS: Readonly<Partial<Record<string, EntryField>>> = {
  userId: "userId",
  startAt: "startTime",
  endAt: "endTime",
  breakMinutes: "breakMinutes",
  assignments: "assignments",
};

/**
 * api 錯誤 → 欄位下的原因與對話框提示(REACT-18):重疊、店休、畫休、任務已被填、不能擔任負責人……
 * 寫在指到的欄位下;沒對到欄位的(例:勾選的打卡已被對應)才寫在提示裡。
 */
export const entryErrorTextsOf = (
  error: unknown,
  t: (key: string, values?: Record<string, string>) => string,
) =>
  scheduleErrorTextsOf(
    error,
    ENTRY_FIELDS,
    t,
    (field) => ENTRY_API_FIELDS[field],
  );

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

/** 疊開新增的人力需求存好了:自動加一列,依規則填第一個空的任務(SC-04e ③)。 */
export const withAddedDemand = (
  form: EntryFormState,
  created: RosterDemand,
  canLead: boolean,
): EntryFormState => ({
  ...form,
  rows: [
    ...form.rows,
    {
      key: nextRowKey(),
      demandId: created.id,
      taskId:
        pickOpenTask(
          created.tasks.map((task) => ({ ...task, filled: false })),
          canLead,
        ) ?? "",
    },
  ],
});
