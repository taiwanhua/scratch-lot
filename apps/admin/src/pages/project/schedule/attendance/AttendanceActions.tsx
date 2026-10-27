import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import type { ScheduleAttendanceExportQueryVariables } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";

import { useAttendanceExport } from "./useAttendanceExport";
import { useMakeupPunchHref } from "./useMakeupPunchHref";

export interface AttendanceActionsProps {
  /** 有 `export`(api 的 abilities) */
  canExport: boolean;
  /** 匯出這個範圍(月份、分店、人) */
  exportInput: ScheduleAttendanceExportQueryVariables["input"];
}

/** 出勤紀錄工具列右側:[補打卡申請](`create`)、[匯出 Excel](`export`)。 */
export const AttendanceActions = ({
  canExport,
  exportInput,
}: AttendanceActionsProps) => {
  const t = useTranslations("admin.schedule.attendance");
  const navigate = useNavigate();
  const makeupHref = useMakeupPunchHref();
  const exporter = useAttendanceExport();
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ flexWrap: "wrap", ml: { sm: "auto" } }}
    >
      {makeupHref !== null && (
        <Button
          variant="outlined"
          onClick={() => {
            void navigate(makeupHref());
          }}
        >
          {t("makeupApply")}
        </Button>
      )}
      {canExport && (
        <Button
          variant="outlined"
          disabled={exporter.isPending}
          onClick={() => {
            exporter.run(exportInput);
          }}
        >
          {t("export.button")}
        </Button>
      )}
    </Stack>
  );
};
