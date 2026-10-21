import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useDayOffDateTitle } from "@/hooks/project/schedule/useDayOffDateTitle/useDayOffDateTitle";
import { hoursOf } from "@/lib/project/schedule-attendance";
import { localPartsOf } from "@/lib/project/schedule-roster";

interface EntryLike {
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
  /** 「11/4(三)」 */
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
  const dateTitle = useDayOffDateTitle();
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
      `${String(Number(item.date.slice(5, 7)))}/${String(Number(item.date.slice(8, 10)))} ${entry(item)}`,
    time,
    punchLabel: (punch) =>
      `${dateTitle(localPartsOf(punch.at, timezone).date)}${time(punch.at) ?? ""} ${typeLabel(punch.type)}`,
    punchShort: (punch) => `${time(punch.at) ?? ""} ${typeLabel(punch.type)}`,
    hours: hoursOf,
  };
};
