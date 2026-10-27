import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import {
  type ScheduleRosterStatColumn,
  formatWorkMinutes,
} from "@repo/domain/project/schedule-settings";
import { Box } from "@repo/ui/box";
import { useBreakpointDown } from "@repo/ui/media-query";
import type { DataTableColumn } from "@repo/ui/roster-grid";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useRosterColumns } from "@/hooks/project/schedule/useRosterColumns/useRosterColumns";
import { localPartsOf, monthDayOf } from "@/lib/project/schedule-roster";

import type { RosterData, RosterPerson } from "../roster-context";

/** 人員欄寬(設計值,只有班表檢視用到,STYLE-06)。 */
const PERSON_WIDTH = 120;
const MOBILE_PERSON_WIDTH = 72;

/**
 * 班表檢視的左右固定欄:人員欄(姓名、僱用類型 · 可負責)與統計欄(依 [⚙ 顯示欄位];規格 14.5):
 * 班數、負責班數、總工時(到分鐘)、畫休天數(超過上限變色;滑過列整天畫休 / 時段不可排明細,
 * 列出時段、不加總時數)、最長連續上班。
 */
export const useRosterGridColumns = (
  data: RosterData,
): {
  personColumn: DataTableColumn<RosterPerson>;
  statColumns: DataTableColumn<RosterPerson>[];
} => {
  const t = useTranslations("admin.schedule.roster");
  const tEmployment = useTranslations("admin.schedule.employment");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const isMobile = useBreakpointDown("sm");
  const { columns } = useRosterColumns();

  const personColumn: DataTableColumn<RosterPerson> = {
    key: "person",
    header: t("columns.person"),
    width: isMobile ? MOBILE_PERSON_WIDTH : PERSON_WIDTH,
    // 手機欄窄:左右留白縮小(表頭、人力需求區的列名、人員格都套)
    ...(isMobile ? { cellSx: { px: 0.5 }, headerSx: { px: 0.5 } } : {}),
    render: ({ row }) => (
      <Box>
        <Typography variant="subtitle2">{row.name}</Typography>
        <Typography variant="caption" color="textSecondary">
          {[
            typeof row.employmentType === "string"
              ? tEmployment(row.employmentType)
              : null,
            row.canLead ? t("canLead") : null,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </Typography>
      </Box>
    ),
  };

  const dayOffDetail = (stats: RosterPerson["stats"]) => {
    const slots = stats.timeRangeDays.flatMap((day) =>
      day.slots.map(
        (slot) =>
          `${monthDayOf(day.date, timezone)} ${localPartsOf(slot.startAt, timezone).time}–${localPartsOf(slot.endAt, timezone).time}`,
      ),
    );
    const summary = t("dayOffDetail", {
      fullDay: stats.fullDayOffDays,
      timeRange: stats.timeRangeDays.length,
    });
    return slots.length === 0 ? summary : `${summary}(${slots.join("、")})`;
  };

  const max = data.settings.maxMonthlyDayOffs;
  const statRender: Record<
    ScheduleRosterStatColumn,
    (person: RosterPerson) => ReactNode
  > = {
    shiftCount: (person) => person.stats.shiftCount,
    leadShiftCount: (person) => person.stats.leadShiftCount,
    workMinutes: (person) => formatWorkMinutes(person.stats.workMinutes),
    dayOffDays: ({ stats }) => (
      <Tooltip title={dayOffDetail(stats)}>
        <Typography
          variant="body2"
          component="span"
          color={
            typeof max === "number" && stats.dayOffDays > max
              ? "error"
              : undefined
          }
        >
          {t("dayOffDays", { count: stats.dayOffDays })}
        </Typography>
      </Tooltip>
    ),
    longestStreak: (person) =>
      t("streakDays", { count: person.stats.longestStreak }),
  };

  return {
    personColumn,
    statColumns: columns.map((column) => ({
      key: column,
      header: t(`columns.${column}`),
      width: 88,
      render: ({ row }) => statRender[column](row),
    })),
  };
};
