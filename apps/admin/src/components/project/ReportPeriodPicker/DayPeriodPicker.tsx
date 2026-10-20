import { useTranslations } from "use-intl";

import { parseLocalDate } from "@repo/domain/form";
import { DatePicker } from "@repo/ui/date-picker";
import { Stack } from "@repo/ui/stack";

import { shiftPeriod } from "@/lib/project/reports/report-period";

import { PeriodShortcut } from "./PeriodShortcut";
import type { PeriodKindPickerProps } from "./period-picker-props";

/** 日:日期 + [今天] [昨天]。 */
export const DayPeriodPicker = ({
  value,
  today,
  onSelect,
}: PeriodKindPickerProps) => {
  const t = useTranslations("admin.lotteryReports.periodPicker");
  const yesterday = shiftPeriod("day", today, -1);
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <DatePicker
        label={t("date")}
        value={value}
        onChange={(next) => {
          if (parseLocalDate(next) !== null) onSelect("day", next ?? "");
        }}
        size="small"
      />
      <PeriodShortcut
        label={t("today")}
        isActive={value === today}
        onClick={() => {
          onSelect("day", today);
        }}
      />
      <PeriodShortcut
        label={t("yesterday")}
        isActive={value === yesterday}
        onClick={() => {
          onSelect("day", yesterday);
        }}
      />
    </Stack>
  );
};
