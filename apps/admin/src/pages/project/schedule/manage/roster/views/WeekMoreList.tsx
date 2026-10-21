import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Popover } from "@repo/ui/popover";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import {
  demandToneOf,
  monthDayOf,
  weekdayOf,
} from "@/lib/project/schedule-roster";
import {
  type CountLabels,
  moreListLine,
} from "@/lib/project/schedule-roster-views";

import { useRoster } from "../roster-context";
import { useShowDay } from "./useRosterDate";
import type { RosterTimelineGroup } from "./useTimelineGroups";

export interface WeekMoreListProps {
  date: string;
  /** 被收起的容器(依完整排序) */
  groups: readonly RosterTimelineGroup[];
  /** 浮層出現的位置(點「+N」的那一點) */
  anchor: { top: number; left: number };
  labels: CountLabels;
  onClose: () => void;
}

/**
 * 「+N」長條的清單浮層(SC-62;規格 14.5「週檢視排版」):依開始時間列出被收起的人力需求
 * (簡稱、時間、人數,三態顏色);點一列 → 那筆人力需求對話框;底部 [看整天(日檢視) ›]。
 */
export const WeekMoreList = ({
  date,
  groups,
  anchor,
  labels,
  onClose,
}: WeekMoreListProps) => {
  const t = useTranslations("admin.schedule.roster");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const { openDemand } = useRoster();
  const showDay = useShowDay();
  const title = t("timeline.moreTitle", {
    date: t("dateTitle", {
      date: monthDayOf(date),
      weekday: tCalendar(`weekdays.${String(weekdayOf(date))}`),
    }),
  });
  return (
    <Popover
      open
      anchorReference="anchorPosition"
      anchorPosition={anchor}
      onClose={onClose}
      slotProps={{ paper: { "aria-label": title, role: "dialog" } }}
    >
      <Stack
        spacing={1}
        sx={{ px: 1.75, py: 1.5, minWidth: 260, maxHeight: 360 }}
      >
        <Typography variant="subtitle2">{title}</Typography>
        <Stack spacing={0.5} sx={{ overflow: "auto" }}>
          {groups.map((group) => {
            const line = moreListLine(group.wording, labels.short);
            const head = `${group.wording.shortName} ${group.wording.time}`;
            return (
              <Box
                key={group.id}
                component="button"
                aria-label={line}
                onClick={() => {
                  onClose();
                  openDemand(group.plan.demand);
                }}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                  border: 0,
                  bgcolor: "transparent",
                  color: "text.primary",
                  textAlign: "left",
                  px: 0.5,
                  py: 0.5,
                  borderRadius: 1,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Typography variant="body2">{head}</Typography>
                <Tag
                  tone={demandToneOf(group.wording.counts)}
                  label={line.slice(head.length + 1)}
                />
              </Box>
            );
          })}
        </Stack>
        <Box>
          <Button
            variant="text"
            size="small"
            onClick={() => {
              onClose();
              showDay(date);
            }}
          >
            {t("timeline.moreShowDay")}
          </Button>
        </Box>
      </Stack>
    </Popover>
  );
};
