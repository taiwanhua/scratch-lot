import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  autoMarkSx,
  leaderMarkSx,
  multiBadgeSx,
} from "@/components/project/schedule/ScheduleLegend/schedule-legend-styles";
import { localPartsOf } from "@/lib/project/schedule-roster";
import {
  type TimelineSlotPlan,
  entryOffsetsOf,
} from "@/lib/project/schedule-roster-views";

import {
  type RosterDemand,
  type RosterEntry,
  rosterCellKey,
  useRoster,
} from "../roster-context";

export interface DayCardPersonProps {
  slot: Extract<TimelineSlotPlan, { kind: "bar" }>;
  demand: RosterDemand;
  entry: RosterEntry | undefined;
  onOpen: (entry: RosterEntry) => void;
}

/**
 * 手機日檢視卡片裡的一個人(SC-45 手機):名字(負責人套綠底;協同後面寫「協同」)、自動排入、×2;
 * 下一行上下班時間,和人力需求不同時加註 warning 色小字(「比需求早 30 分」「下班比需求晚 30 分」)、☕ 休息。
 * 點了打開排班對話框。
 */
export const DayCardPerson = ({
  slot,
  demand,
  entry,
  onOpen,
}: DayCardPersonProps) => {
  const t = useTranslations("admin.schedule.roster");
  const { data, timezone } = useRoster();
  const name =
    data.people.find((person) => person.userId === slot.userId)?.name ?? "";
  const time = (iso: string) => localPartsOf(iso, timezone).time;
  const offsets = entryOffsetsOf(slot, demand);
  const notes = [
    offsets.start < 0 &&
      t("timeline.earlierStart", { minutes: -offsets.start }),
    offsets.start > 0 && t("timeline.laterStart", { minutes: offsets.start }),
    offsets.end < 0 && t("timeline.earlierEnd", { minutes: -offsets.end }),
    offsets.end > 0 && t("timeline.laterEnd", { minutes: offsets.end }),
  ].filter((note): note is string => typeof note === "string");

  return (
    <Box
      component="button"
      data-roster-cell={rosterCellKey({
        userId: slot.userId,
        date: demand.date,
      })}
      aria-label={t("cell.entryAria", {
        name,
        start: time(slot.startAt),
        end: time(slot.endAt),
      })}
      onClick={() => {
        if (entry !== undefined) {
          onOpen(entry);
        }
      }}
      sx={{
        border: 0,
        bgcolor: "transparent",
        color: "inherit",
        textAlign: "left",
        p: 0,
        cursor: "pointer",
        "&:active": { bgcolor: "action.selected" },
      }}
    >
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
        <Box
          component="span"
          sx={[
            { typography: "body2", fontWeight: 600 },
            slot.role === "leader" ? leaderMarkSx : {},
          ]}
        >
          {name}
        </Box>
        {slot.role === "helper" && (
          <Typography variant="caption" color="textSecondary">
            {t("cell.roles.helper")}
          </Typography>
        )}
        {slot.isAuto && (
          <Box
            component="span"
            aria-label={t("timeline.auto")}
            sx={[autoMarkSx, { position: "static", display: "inline-block" }]}
          >
            ✦
          </Box>
        )}
        {slot.multiCount > 1 && (
          <Box component="span" sx={multiBadgeSx}>
            {t("timeline.multi", { count: slot.multiCount })}
          </Box>
        )}
      </Stack>
      <Stack
        direction="row"
        spacing={0.75}
        useFlexGap
        sx={{ flexWrap: "wrap", alignItems: "center" }}
      >
        <Typography variant="caption" color="textSecondary">
          {t("cell.range", {
            start: time(slot.startAt),
            end: time(slot.endAt),
          })}
        </Typography>
        {notes.map((note) => (
          <Typography
            key={note}
            variant="caption"
            sx={{ color: "warning.darker" }}
          >
            {note}
          </Typography>
        ))}
        {entry !== undefined && (
          <Typography variant="caption" color="textSecondary">
            {t("timeline.break", { minutes: entry.breakMinutes })}
          </Typography>
        )}
      </Stack>
    </Box>
  );
};
