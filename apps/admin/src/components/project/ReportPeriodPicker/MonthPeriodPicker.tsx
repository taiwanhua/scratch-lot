import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import { localMonthText } from "@repo/domain/form";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { IconButton } from "@repo/ui/icon-button";
import { ChevronLeftIcon, ChevronRightIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  periodStartOf,
  shiftPeriod,
} from "@/lib/project/reports/report-period";

import { PeriodShortcut } from "./PeriodShortcut";
import type { PeriodKindPickerProps } from "./period-picker-props";

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

const pad2 = (value: number) => String(value).padStart(2, "0");

const yearOf = (date: string) => Number(date.slice(0, 4));

export interface MonthPeriodPickerProps extends PeriodKindPickerProps {
  /** 月格子下方的註記(`month` 是 `YYYY-MM`) */
  monthCaption?: (month: string) => ReactNode;
}

/** 月:年份切換 + 12 個月格子 + [本月] [上月]。 */
export const MonthPeriodPicker = ({
  value,
  today,
  onSelect,
  monthCaption,
}: MonthPeriodPickerProps) => {
  const t = useTranslations("admin.lotteryReports.periodPicker");
  const thisMonth = periodStartOf("month", today);
  const lastMonth = shiftPeriod("month", today, -1);
  const [shownYear, setShownYear] = useState(yearOf(value));
  const pick = (first: string) => {
    onSelect("month", first);
    setShownYear(yearOf(first));
  };

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <IconButton
          size="small"
          aria-label={t("prevYear")}
          onClick={() => {
            setShownYear((year) => year - 1);
          }}
        >
          <ChevronLeftIcon />
        </IconButton>
        <Typography variant="subtitle2">
          {t("yearTitle", { year: shownYear })}
        </Typography>
        <IconButton
          size="small"
          aria-label={t("nextYear")}
          onClick={() => {
            setShownYear((year) => year + 1);
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      </Stack>
      <Box
        role="group"
        aria-label={t("monthGridAria")}
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 1,
        }}
      >
        {MONTHS.map((month) => {
          const first = `${String(shownYear)}-${pad2(month)}-01`;
          const isSelected = first === value;
          return (
            <Button
              key={first}
              variant={isSelected ? "outlined" : "text"}
              color={isSelected ? "primary" : "inherit"}
              aria-pressed={isSelected}
              onClick={() => {
                pick(first);
              }}
              sx={{
                flexDirection: "column",
                alignItems: "flex-start",
                justifyContent: "flex-start",
                minHeight: 56,
              }}
            >
              <span>{t("monthLabel", { month })}</span>
              {monthCaption?.(localMonthText({ year: shownYear, month }))}
            </Button>
          );
        })}
      </Box>
      <Stack direction="row" spacing={1}>
        <PeriodShortcut
          label={t("thisMonth")}
          isActive={value === thisMonth}
          onClick={() => {
            pick(thisMonth);
          }}
        />
        <PeriodShortcut
          label={t("lastMonth")}
          isActive={value === lastMonth}
          onClick={() => {
            pick(lastMonth);
          }}
        />
      </Stack>
    </Stack>
  );
};
