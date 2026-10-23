import {
  type ScheduleBreakTier,
  defaultBreakMinutes,
  pickOpenTask,
} from "@repo/domain/project/schedule-settings";

import type { FieldErrorTexts } from "@/lib/base/field-errors";
import {
  instantOfDayTime,
  localPartsOf,
  minutesBetween,
  shiftDay,
  spanOf,
} from "@/lib/project/schedule-roster";

import type { ScheduleReason } from "../../schedule-error";
import { scheduleErrorTextsOf } from "../../schedule-field-errors";
import type {
  EntryPreset,
  RosterData,
  RosterDemand,
  RosterEntry,
} from "./roster-context";

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

/** 帶入 / 改上下班時間時「預設休息」要用的東西。 */
export interface EntryTimeContext {
  timezone: string;
  breakTiers: readonly ScheduleBreakTier[];
  /** 休息已經自己改過(或是編輯既有排班)→ 不再依規則重帶 */
  isBreakEdited: boolean;
}

/**
 * 設上下班時間(手動改、從缺額帶入、疊開新增的人力需求帶回都走這裡):休息還沒自己改過,
 * 就依規則「預設休息」重帶。
 */
export const withTimes = (
  form: EntryFormState,
  startTime: string,
  endTime: string,
  context: EntryTimeContext,
): EntryFormState => {
  const span = spanOf(form.date, startTime, endTime, context.timezone);
  return {
    ...form,
    startTime,
    endTime,
    breakText:
      context.isBreakEdited || span === null
        ? form.breakText
        : String(
            defaultBreakMinutes(
              context.breakTiers,
              minutesBetween(span.startAt, span.endAt),
            ),
          ),
  };
};

/** 上下班時間還沒填好 → 帶入那筆人力需求的時間(已經填了的不動)。 */
const withDemandTimes = (
  form: EntryFormState,
  demand: RosterDemand,
  context: EntryTimeContext,
): EntryFormState =>
  form.startTime !== "" && form.endTime !== ""
    ? form
    : withTimes(
        form,
        localPartsOf(demand.startAt, context.timezone).time,
        localPartsOf(demand.endAt, context.timezone).time,
        context,
      );

/**
 * 排班對話框的初始值:編輯 = 這筆排班;新增 = 帶入的人員 / 日期;從缺額打開時帶好那筆人力需求的時間
 * (休息依規則帶入)、那筆人力需求與執行任務(一列)。
 */
export const initialEntryState = (
  entry: RosterEntry | null,
  preset: EntryPreset,
  presetDemand: RosterDemand | undefined,
  context: Omit<EntryTimeContext, "isBreakEdited">,
): EntryFormState => {
  if (entry !== null) {
    return {
      userId: entry.userId,
      date: entry.date,
      startTime: localPartsOf(entry.startAt, context.timezone).time,
      endTime: localPartsOf(entry.endAt, context.timezone).time,
      breakText: String(entry.breakMinutes),
      rows: entry.assignments.map((item) => ({
        key: nextRowKey(),
        demandId: item.demandId,
        taskId: item.taskId,
      })),
    };
  }
  const base: EntryFormState = {
    userId: preset.userId ?? "",
    date: preset.date ?? presetDemand?.date ?? "",
    startTime: "",
    endTime: "",
    breakText: "",
    rows: [],
  };
  if (presetDemand === undefined) {
    return base;
  }
  return {
    ...withDemandTimes(base, presetDemand, {
      ...context,
      isBreakEdited: false,
    }),
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

/** 執行任務的鍵(`demandId|taskId`)。 */
export const assignmentKeyOf = (demandId: string, taskId: string) =>
  `${demandId}|${taskId}`;

/**
 * 負責人任務誰能填(各入口同一條;api 正本 `schedule-roster-writes.service.ts` `assertAssignable`):
 * `canLead` = 選的人能不能擔任負責人,**還沒選人為 null**(先不擋,選了人再驗);
 * `keptKeys` = 編輯中的排班原本就填著的任務(api 不再檢查,所以這裡也不擋)。
 */
export interface LeaderRule {
  canLead: boolean | null;
  keptKeys: ReadonlySet<string>;
}

export const leaderRuleOf = (
  person: { canLead: boolean } | undefined,
  entry: RosterEntry | null,
): LeaderRule => ({
  canLead: person === undefined ? null : person.canLead,
  keptKeys: new Set(
    (entry?.assignments ?? []).map((item) =>
      assignmentKeyOf(item.demandId, item.taskId),
    ),
  ),
});

/** 這筆任務是負責人任務、而選的人不能擔任負責人(原本就填著的除外)。 */
export const isLeaderBlocked = (
  rule: LeaderRule,
  demandId: string,
  task: { taskId: string; role: string },
): boolean =>
  task.role === "leader" &&
  rule.canLead === false &&
  !rule.keptKeys.has(assignmentKeyOf(demandId, task.taskId));

/** 選了一筆人力需求時自動填的任務(還沒選人 = 先當可以擔任負責人,和從缺額打開一樣)。 */
export const pickTaskOf = (
  demand: RosterDemand,
  entryId: string | null,
  rule: LeaderRule,
): string =>
  pickOpenTask(tasksWithFilled(demand, entryId), rule.canLead !== false) ?? "";

/**
 * 疊開新增的人力需求存好了(SC-04e ③):自動加一列、依規則填第一個空的任務;上下班時間還沒填好 →
 * 帶入那筆人力需求的時間。結果和「從缺額打開」帶入的一樣。
 */
export const withAddedDemand = (
  form: EntryFormState,
  created: RosterDemand,
  rule: LeaderRule,
  context: EntryTimeContext,
): EntryFormState => ({
  ...withDemandTimes(form, created, context),
  rows: [
    ...form.rows,
    {
      key: nextRowKey(),
      demandId: created.id,
      taskId: pickTaskOf(created, null, rule),
    },
  ],
});

/** 送出前就檢查的規則用到的資料(都在排班表的資料裡)。 */
export interface EntryCheckContext {
  calendarDays: readonly RosterData["calendarDays"][number][];
  unavailability: readonly RosterData["unavailability"][number][];
  demands: readonly RosterDemand[];
  rule: LeaderRule;
  timezone: string;
}

const overlaps = (
  span: { startAt: string; endAt: string },
  from: string | null,
  to: string | null,
) =>
  from !== null &&
  to !== null &&
  Date.parse(span.startAt) < Date.parse(to) &&
  Date.parse(span.endAt) > Date.parse(from);

/**
 * 前端已經知道、會被 api 擋下的規則,送出前就標在欄位下(REACT-18;欄位與 api 標的一致):
 * - 店休(這天或跨午夜的隔天)→ 上班欄 `STORE_CLOSED`
 * - 和這個人的畫休重疊(整天 / 時段,頭尾相接不算)→ 上班欄 `DAY_OFF_CONFLICT`
 * - 填了負責人任務、但選的人不能擔任負責人 → 人力需求那一組 `CANNOT_LEAD`
 *
 * 排班表資料沒讀到的日子(選了別的月份)不檢查,存檔時 api 一樣會擋。
 */
export const entryCheckReasonsOf = (
  form: EntryFormState,
  context: EntryCheckContext,
): Partial<Record<EntryField, ScheduleReason>> => {
  const reasons: Partial<Record<EntryField, ScheduleReason>> = {};
  const span = spanOf(
    form.date,
    form.startTime,
    form.endTime,
    context.timezone,
  );
  if (form.date !== "") {
    const lastDay =
      span === null
        ? form.date
        : localPartsOf(
            new Date(Date.parse(span.endAt) - 1).toISOString(),
            context.timezone,
          ).date;
    const isClosed = context.calendarDays.some(
      (day) =>
        day.type === "closed" && day.date >= form.date && day.date <= lastDay,
    );
    if (isClosed) {
      reasons.startTime = "STORE_CLOSED";
    }
  }
  if (span !== null && reasons.startTime === undefined) {
    const isDayOff = context.unavailability.some((day) => {
      if (day.userId !== form.userId) {
        return false;
      }
      if (day.fullDay) {
        return overlaps(
          span,
          instantOfDayTime(day.date, "00:00", context.timezone),
          instantOfDayTime(shiftDay(day.date, 1), "00:00", context.timezone),
        );
      }
      return day.slots.some((slot) =>
        overlaps(
          span,
          instantOfDayTime(day.date, slot.startTime, context.timezone),
          instantOfDayTime(day.date, slot.endTime, context.timezone),
        ),
      );
    });
    if (isDayOff) {
      reasons.startTime = "DAY_OFF_CONFLICT";
    }
  }
  const cannotLead = form.rows.some((row) => {
    const task = context.demands
      .find((demand) => demand.id === row.demandId)
      ?.tasks.find((item) => item.taskId === row.taskId);
    return (
      task !== undefined && isLeaderBlocked(context.rule, row.demandId, task)
    );
  });
  if (cannotLead) {
    reasons.assignments = "CANNOT_LEAD";
  }
  return reasons;
};
