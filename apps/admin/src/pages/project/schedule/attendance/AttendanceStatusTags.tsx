import { useTranslations } from "use-intl";

import type { ScheduleAttendanceRowFieldsFragment } from "@repo/graphql";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";

/**
 * 一筆出勤的狀態標籤(SC-12):已到(綠)/ 遲到 N 分(橘,取代已到)/ 未到(紅)/ 未開始(灰);
 * 早退 N 分另外一顆(橘)。
 */
export const AttendanceStatusTags = ({
  row,
}: {
  row: Pick<
    ScheduleAttendanceRowFieldsFragment,
    "status" | "lateMinutes" | "earlyLeaveMinutes"
  >;
}) => {
  const t = useTranslations("admin.schedule.attendance.status");
  let main = <Tag tone="grey" label={t("upcoming")} />;
  if (row.status === "absent") {
    main = <Tag tone="error" label={t("absent")} />;
  } else if (row.status === "arrived") {
    main =
      row.lateMinutes > 0 ? (
        <Tag tone="warning" label={t("late", { minutes: row.lateMinutes })} />
      ) : (
        <Tag tone="success" label={t("arrived")} />
      );
  }
  return (
    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>
      {main}
      {row.earlyLeaveMinutes > 0 && (
        <Tag
          tone="warning"
          label={t("earlyLeave", { minutes: row.earlyLeaveMinutes })}
        />
      )}
    </Stack>
  );
};
