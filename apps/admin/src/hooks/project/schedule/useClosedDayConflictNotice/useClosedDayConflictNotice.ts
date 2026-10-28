import { useTranslations } from "use-intl";

import type { SaveScheduleCalendarDayMutation } from "@repo/graphql";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";

type ClosedConflict =
  SaveScheduleCalendarDayMutation["saveScheduleCalendarDay"]["closedConflicts"][number];

/**
 * 先有人力需求 / 排班、後設店休(使用者定案:照樣存,但要提醒):行事曆存成店休後,api 回的
 * `closedConflicts` 不是空的,就跳提醒「這天已經有人力需求或排班(中山店 人力需求 2 筆、排班 1 筆),
 * 店休那天不能排,請到排班表刪除」。上層設的店休會列出沿用那天的下層各店。
 * 做法同先排班、後登記畫休的提醒(`useDayOffEntryConflictNotice`)。
 */
export const useClosedDayConflictNotice = (): ((
  conflicts: readonly ClosedConflict[],
) => void) => {
  const t = useTranslations("admin.schedule.calendar.feedback");
  const show = useSnackbar();
  return (conflicts) => {
    if (conflicts.length === 0) {
      return;
    }
    const list = conflicts
      .map((conflict) =>
        t("closedConflictItem", {
          org: conflict.orgName,
          demands: conflict.demandCount,
          entries: conflict.entryCount,
        }),
      )
      .join(";");
    show("warning", t("closedConflict", { list }));
  };
};
