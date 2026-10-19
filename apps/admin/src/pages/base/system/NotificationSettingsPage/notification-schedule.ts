import { useCallback } from "react";
import { useTranslations } from "use-intl";

import {
  type NotificationScheduleInput,
  NotificationScheduleKind,
} from "@repo/graphql";

/**
 * 提醒時間的編輯草稿、本地驗證與摘要(api 正本 `apps/api/src/notifications/notification-schedule.ts`;
 * 範圍對齊它:提前天數 0–365、最多 5 個、不重複;每月第 N 天 1–31;時間 15 分鐘一格)。
 */

/** api 回的一份提醒時間(`NotificationSchedule`)。 */
export interface NotificationScheduleValue {
  kind: NotificationScheduleKind;
  daysBefore?: readonly number[] | null;
  dayOfMonth?: number | null;
  time: string;
}

export const DAYS_BEFORE_MIN = 0;
export const DAYS_BEFORE_MAX = 365;
export const DAYS_BEFORE_MAX_COUNT = 5;
export const DAY_OF_MONTH_MIN = 1;
export const DAY_OF_MONTH_MAX = 31;
const STEP_MINUTES = 15;

const pad = (value: number) => String(value).padStart(2, "0");

/** 寄送時間的選項:00:00、00:15 … 23:45(只有 15 分鐘一格,選不到 09:10)。 */
export const SCHEDULE_TIME_OPTIONS: readonly string[] = Array.from(
  { length: (24 * 60) / STEP_MINUTES },
  (_, index) => {
    const minutes = index * STEP_MINUTES;
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  },
);

/** 編輯中的提醒時間:數字欄位先存輸入的字,送出前才轉數字。 */
export interface ScheduleDraft {
  kind: NotificationScheduleKind;
  daysBefore: string[];
  dayOfMonth: string;
  time: string;
}

export const toScheduleDraft = (
  schedule: NotificationScheduleValue,
): ScheduleDraft => ({
  kind: schedule.kind,
  daysBefore: (schedule.daysBefore ?? []).map(String),
  dayOfMonth:
    schedule.dayOfMonth === null || schedule.dayOfMonth === undefined
      ? ""
      : String(schedule.dayOfMonth),
  time: schedule.time,
});

/** 本地驗證的問題:`daysBefore[<i>]` / `daysBefore` / `dayOfMonth` → 原因。 */
export type ScheduleIssueReason =
  | "daysRange"
  | "daysDuplicate"
  | "daysEmpty"
  | "dayOfMonthRange"
  /** api 擋下(`SCHEDULE_INVALID` 的 `path`) */
  | "invalid";

export type ScheduleIssues = ReadonlyMap<string, ScheduleIssueReason>;

const integerIn = (text: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(text.trim())) {
    return null;
  }
  const value = Number(text.trim());
  return value >= min && value <= max ? value : null;
};

/** 送出前的本地驗證;沒有問題回空 Map。 */
export const validateScheduleDraft = (draft: ScheduleDraft): ScheduleIssues => {
  const issues = new Map<string, ScheduleIssueReason>();
  if (draft.kind === NotificationScheduleKind.Monthly) {
    if (
      integerIn(draft.dayOfMonth, DAY_OF_MONTH_MIN, DAY_OF_MONTH_MAX) === null
    ) {
      issues.set("dayOfMonth", "dayOfMonthRange");
    }
    return issues;
  }
  if (draft.kind !== NotificationScheduleKind.DaysBefore) {
    return issues;
  }
  if (draft.daysBefore.length === 0) {
    issues.set("daysBefore", "daysEmpty");
  }
  const seen = new Set<number>();
  for (const [index, text] of draft.daysBefore.entries()) {
    const value = integerIn(text, DAYS_BEFORE_MIN, DAYS_BEFORE_MAX);
    if (value === null) {
      issues.set(`daysBefore[${String(index)}]`, "daysRange");
    } else if (seen.has(value)) {
      issues.set(`daysBefore[${String(index)}]`, "daysDuplicate");
    } else {
      seen.add(value);
    }
  }
  return issues;
};

/** 草稿 → mutation 的 `schedule`(只帶該寫法的欄位;須先通過 `validateScheduleDraft`)。 */
export const toScheduleInput = (
  draft: ScheduleDraft,
): NotificationScheduleInput => {
  if (draft.kind === NotificationScheduleKind.DaysBefore) {
    return {
      kind: draft.kind,
      daysBefore: draft.daysBefore.map((text) => Number(text.trim())),
      time: draft.time,
    };
  }
  if (draft.kind === NotificationScheduleKind.Monthly) {
    return {
      kind: draft.kind,
      dayOfMonth: Number(draft.dayOfMonth.trim()),
      time: draft.time,
    };
  }
  return { kind: draft.kind, time: draft.time };
};

/** 日期稱呼的訊息 key:`admin.notifications.scheduleDateLabels.<類型 key>`(同類型名稱的覆寫方式)。 */
const DATE_LABEL_PREFIX = "scheduleDateLabels.";

/**
 * 提醒時間的一行摘要(清單「提醒時間」欄、還原預設的確認框共用):
 * 「到期前 30、7 天及當天 09:00」「隔天起每天 09:00」「每月 3 號 09:00」;沒有提醒時間 = 「—(發生時)」。
 * 日期稱呼依類型 key 從 `admin.notifications.scheduleDateLabels.<key>` 取,沒有就用 api 的
 * `scheduleDateLabel`,再沒有就是「日期」。
 */
export const useScheduleSummary = (): ((
  type: string,
  schedule: NotificationScheduleValue | null | undefined,
  dateLabel: string | null | undefined,
) => string) => {
  const t = useTranslations("admin.notificationSettings.scheduleSummary");
  const tNotifications = useTranslations("admin.notifications");
  return useCallback(
    (type, schedule, dateLabel) => {
      if (schedule === null || schedule === undefined) {
        return t("onEvent");
      }
      if (schedule.kind === NotificationScheduleKind.DailyOverdue) {
        return t("dailyOverdue", { time: schedule.time });
      }
      if (schedule.kind === NotificationScheduleKind.Monthly) {
        return t("monthly", {
          day: schedule.dayOfMonth ?? 1,
          time: schedule.time,
        });
      }
      const key = `${DATE_LABEL_PREFIX}${type}`;
      const label = tNotifications.has(key)
        ? tNotifications(key)
        : (dateLabel ?? t("defaultDateLabel"));
      const days = [...(schedule.daysBefore ?? [])].toSorted((a, b) => b - a);
      const ahead = days.filter((day) => day > 0);
      const hasToday = days.includes(0);
      if (ahead.length === 0) {
        return t("today", { label, time: schedule.time });
      }
      return t(hasToday ? "daysBeforeAndToday" : "daysBefore", {
        label,
        days: ahead.join(t("separator")),
        time: schedule.time,
      });
    },
    [t, tNotifications],
  );
};
