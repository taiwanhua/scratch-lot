import { useCallback } from "react";
import { useTranslations } from "use-intl";

import {
  DAYS_BEFORE_MAX,
  DAYS_BEFORE_MIN,
  DAY_OF_MONTH_MAX,
  DAY_OF_MONTH_MIN,
  isScheduleTime,
} from "@repo/domain/notification-schedule";
import {
  type NotificationScheduleInput,
  NotificationScheduleKind,
} from "@repo/graphql";

/**
 * 提醒時間的編輯草稿、本地驗證與摘要。範圍常數與寄送時間選項的正本是 `@repo/domain/notification-schedule`
 * (與 api 的 `validateSchedule` 同一份);這裡只把錯誤分到各格,api 擋下時仍以 `path` 標回。
 */

/** api 回的一份提醒時間(`NotificationSchedule`)。 */
export interface NotificationScheduleValue {
  kind: NotificationScheduleKind;
  daysBefore?: readonly number[] | null;
  dayOfMonth?: number | null;
  time: string;
}

/** 編輯中的提醒時間:數字欄位先存輸入的字,送出前才轉數字。 */
export interface ScheduleDraft {
  kind: NotificationScheduleKind;
  daysBefore: string[];
  dayOfMonth: string;
  /** `HH:mm`;時間欄清空或打到一半時是空字串 */
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

/** 本地驗證的問題:`daysBefore[<i>]` / `daysBefore` / `dayOfMonth` / `time` → 原因。 */
export type ScheduleIssueReason =
  | "daysRange"
  | "daysDuplicate"
  | "daysEmpty"
  | "dayOfMonthRange"
  /** 時間沒填、或不在 15 分鐘格子上(鍵盤打得出 09:10) */
  | "timeStep"
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
  if (!isScheduleTime(draft.time)) {
    issues.set("time", "timeStep");
  }
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
