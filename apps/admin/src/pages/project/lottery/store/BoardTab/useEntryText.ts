import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import type { LotteryStoreEntryOptionFieldsFragment } from "@repo/graphql";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import { localPartsOf } from "@/lib/project/schedule-roster";

type EntryOption = LotteryStoreEntryOptionFieldsFragment;
type EntryTask = EntryOption["tasks"][number];

export interface EntryText {
  /** 一筆排班(例「早 08:00–16:00 · 店內櫃台 · 負責 · 店內事務與帳目負責」);收銀點崗位那一筆優先 */
  entryLabel: (entry: EntryOption) => string;
  /** 一筆任務(職責 + 任務內容,例「店內櫃台 · 負責 · 店內事務與帳目負責」) */
  taskLabel: (task: EntryTask) => string;
  /** 崗位名稱 */
  positionLabel: (positionKey: string) => string;
  /** 時點 → `HH:mm`(租戶時區) */
  timeOf: (value: string) => string;
}

/** 開班 / 班次資訊 / 改對應排班共用的排班文字(崗位、執行任務用欄位管理的名稱)。 */
export const useEntryText = (): EntryText => {
  const t = useTranslations("admin.lotteryStore");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const positions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.position,
  );
  const tasks = useScheduleFieldOptions(SCHEDULE_FIELD_CATEGORY_KEYS.task);
  const timeOf = (value: string) => localPartsOf(value, timezone).time;
  const taskLabel = (task: EntryTask) =>
    t("entry.task", {
      position: positions.labelOf(task.positionKey),
      role:
        task.role === "leader"
          ? t("entry.roles.leader")
          : t("entry.roles.helper"),
      taskName: tasks.labelOf(task.taskKey),
    });
  return {
    timeOf,
    taskLabel,
    positionLabel: positions.labelOf,
    entryLabel: (entry) => {
      const task = entry.snapshot ?? entry.tasks.at(0) ?? null;
      return t("entry.label", {
        shortName: entry.shortName ?? t("entry.noTemplate"),
        start: timeOf(entry.startAt),
        end: timeOf(entry.endAt),
        task: task === null ? t("openShift.noTask") : taskLabel(task),
      });
    },
  };
};
