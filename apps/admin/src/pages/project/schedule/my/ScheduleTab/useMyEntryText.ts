import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import type { MyScheduleEntryFieldsFragment } from "@repo/graphql";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useDayOffDateTitle } from "@/hooks/project/schedule/useDayOffDateTitle/useDayOffDateTitle";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import {
  missingKeyOf,
  punchTimeOf,
  timeRangeOf,
} from "@/lib/project/schedule-my";

export type MyEntry = MyScheduleEntryFieldsFragment;

export interface MyEntryText {
  timezone: string;
  /** 「11/5(四)」 */
  dateTitle: (date: string) => string;
  /** 「08:30–14:30」 */
  time: (entry: MyEntry) => string;
  /** 範本簡稱;未套用範本 =「臨」 */
  shortName: (entry: MyEntry) => string;
  /** 主要崗位的名稱;沒有 = 空字串 */
  position: (entry: MyEntry) => string;
  /** 職責 · 任務內容(例「負責 · 店內事務與帳目負責」) */
  taskLine: (task: MyEntry["tasks"][number]) => string;
  /** 打卡時間「08:24」;沒打 = null */
  punchTime: (value: string | null | undefined) => string | null;
  /** 缺卡寫法(缺上班卡 / 缺下班卡 / 缺上下班卡);沒缺 = null */
  missing: (entry: MyEntry) => string | null;
}

/** 我的班表畫面上一筆班的各種文字(時間用租戶時區;崗位、任務內容用欄位管理的名稱)。 */
export const useMyEntryText = (): MyEntryText => {
  const t = useTranslations("admin.schedule.mySchedule");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const dateTitle = useDayOffDateTitle();
  const positions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.position,
  );
  const tasks = useScheduleFieldOptions(SCHEDULE_FIELD_CATEGORY_KEYS.task);
  return {
    timezone,
    dateTitle,
    time: (entry) => timeRangeOf(entry, timezone),
    shortName: (entry) => entry.shortName ?? t("calendar.temp"),
    position: (entry) =>
      entry.positionKey === null || entry.positionKey === undefined
        ? ""
        : positions.labelOf(entry.positionKey),
    taskLine: (task) =>
      `${task.role === "leader" ? t("roleShort.leader") : t("roleShort.helper")} · ${tasks.labelOf(task.taskKey)}`,
    punchTime: (value) => punchTimeOf(value, timezone),
    missing: (entry) => {
      const key = missingKeyOf(entry.missing);
      return key === null ? null : t(`missing.${key}`);
    },
  };
};
