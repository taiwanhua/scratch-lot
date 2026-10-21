import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type ScheduleAttendanceExportQueryVariables,
  useScheduleAttendanceExportQuery,
} from "@repo/graphql";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { downloadWorkbook } from "@/lib/project/reports/excel";
import { attendanceSheetsOf } from "@/lib/project/schedule-attendance";

import { scheduleErrorOf } from "../schedule-error";
import { useAttendanceText } from "./useAttendanceText";

/**
 * [匯出 Excel](`export`;規格 14.7):按下才向 api 取這個月的資料(一家分店一個工作表),
 * 以輸出報表共用的 Excel 產生器(`buildWorkbook`)存成 `.xlsx`。
 */
export const useAttendanceExport = (): {
  run: (input: ScheduleAttendanceExportQueryVariables["input"]) => void;
  isPending: boolean;
} => {
  const t = useTranslations("admin.schedule.attendance.export");
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const showSnackbar = useSnackbar();
  const text = useAttendanceText();
  const [isPending, setIsPending] = useState(false);

  const run = (input: ScheduleAttendanceExportQueryVariables["input"]) => {
    setIsPending(true);
    const [year = "", month = ""] = input.month.split("-");
    const note = t("note", { year, month: Number(month) });
    void useScheduleAttendanceExportQuery
      .fetcher(session.client, { input })()
      .then(async (data) => {
        const sheets = attendanceSheetsOf(
          data.scheduleAttendanceExport.sheets,
          {
            headers: {
              date: t("columns.date"),
              person: t("columns.person"),
              entry: t("columns.entry"),
              clockIn: t("columns.clockIn"),
              clockOut: t("columns.clockOut"),
              onDutyHours: t("columns.onDutyHours"),
              breakMinutes: t("columns.breakMinutes"),
              workedHours: t("columns.workedHours"),
              scheduledHours: t("columns.scheduledHours"),
              lateMinutes: t("columns.lateMinutes"),
              earlyLeaveMinutes: t("columns.earlyLeaveMinutes"),
              specialDayCategory: t("columns.specialDayCategory"),
              makeupNote: t("columns.makeupNote"),
            },
            temporary: t("temporary"),
            makeup: t("makeup"),
            note,
          },
          text.timezone,
        );
        if (sheets.length === 0) {
          showSnackbar("info", t("empty"));
          return;
        }
        await downloadWorkbook({
          sheets,
          fileName: t("fileName", { month: input.month }),
        });
      })
      .catch((error: unknown) => {
        showSnackbar("error", tErrors(scheduleErrorOf(error).code));
      })
      .finally(() => {
        setIsPending(false);
      });
  };

  return { run, isPending };
};
