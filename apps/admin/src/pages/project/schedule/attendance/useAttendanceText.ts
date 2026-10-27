import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useDayOffDateTitle } from "@/hooks/project/schedule/useDayOffDateTitle/useDayOffDateTitle";
import { hoursOf } from "@/lib/project/schedule-attendance";
import { dayKeyOf } from "@/lib/project/schedule-day-offs";
import { localPartsOf } from "@/lib/project/schedule-roster";

interface EntryLike {
  /** 那天(租戶時區 00:00 的時點) */
  date: string;
  startAt: string;
  endAt: string;
  shortName?: string | null;
}

interface PunchLike {
  type: string;
  at: string;
}

export interface AttendanceText {
  timezone: string;
  /** 「11/4(三)」:那天的任一時點(api 的日期是那天 00:00) */
  dateTitle: (date: string) => string;
  /** 「早 08:30–14:30」(未套用範本 =「臨」) */
  entry: (entry: EntryLike) => string;
  /** 「11/4 早 08:30–14:30」 */
  entryOption: (entry: EntryLike) => string;
  /** 「08:41」;沒有 = null */
  time: (value: string | null | undefined) => string | null;
  /** 「11/4(三)09:02 上班」 */
  punchLabel: (punch: PunchLike) => string;
  /** 「09:02 上班」 */
  punchShort: (punch: PunchLike) => string;
  /** 小時一位小數「5.4」;沒有 = null */
  hours: (minutes: number | null | undefined) => string | null;
}

/** 出勤紀錄畫面上的各種文字(時間用租戶時區)。 */
export const useAttendanceText = (): AttendanceText => {
  const t = useTranslations("admin.schedule.attendance");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const dayTitle = useDayOffDateTitle();
  const dateTitle = (date: string) => dayTitle(dayKeyOf(date, timezone));
  const time = (value: string | null | undefined) =>
    value === null || value === undefined
      ? null
      : localPartsOf(value, timezone).time;
  const entry = (item: EntryLike) =>
    `${item.shortName ?? t("temporary")} ${time(item.startAt) ?? ""}–${time(item.endAt) ?? ""}`;
  const typeLabel = (type: string) =>
    type === "in" ? t("types.in") : t("types.out");
  return {
    timezone,
    dateTitle,
    entry,
    entryOption: (item) =>
      `${formatTemporal(item.date, { type: "monthDay", timezone })} ${entry(item)}`,
    time,
    punchLabel: (punch) =>
      `${dateTitle(punch.at)}${time(punch.at) ?? ""} ${typeLabel(punch.type)}`,
    punchShort: (punch) => `${time(punch.at) ?? ""} ${typeLabel(punch.type)}`,
    hours: hoursOf,
  };
};
