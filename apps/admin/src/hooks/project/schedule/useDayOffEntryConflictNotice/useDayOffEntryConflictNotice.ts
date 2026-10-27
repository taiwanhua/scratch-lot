import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";
import type { ScheduleDayOffEntryConflictFieldsFragment } from "@repo/graphql";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { localPartsOf } from "@/lib/project/schedule-roster";

/**
 * 先排班、後登記畫休(使用者定案:照樣可以登記,但要提醒):登記 / 代改畫休存檔後,api 回的
 * `entryConflicts` 不是空的,就跳提醒「這天已經有排班(…),請通知店長調整班表」。
 * 看不到的分店寫「其他分店」。
 */
export const useDayOffEntryConflictNotice = (): ((
  conflicts: readonly ScheduleDayOffEntryConflictFieldsFragment[],
) => void) => {
  const t = useTranslations("admin.schedule.dayOffs.entryConflict");
  const show = useSnackbar();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  return (conflicts) => {
    if (conflicts.length === 0) {
      return;
    }
    const list = conflicts
      .map((conflict) =>
        t("item", {
          date: formatTemporal(conflict.date, { type: "monthDay", timezone }),
          start: localPartsOf(conflict.startAt, timezone).time,
          end: localPartsOf(conflict.endAt, timezone).time,
          org: conflict.orgName ?? t("otherStore"),
        }),
      )
      .join("、");
    show("warning", t("message", { list }));
  };
};
