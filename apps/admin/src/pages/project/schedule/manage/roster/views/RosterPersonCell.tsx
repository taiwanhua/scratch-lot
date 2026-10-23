import type { MouseEvent } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import { dayOffHatchSx } from "@/components/project/schedule/DayOffs/day-off-styles";
import {
  autoMarkSx,
  entryBlockSx,
  leaderMarkSx,
  unavailableBlockSx,
  unmatchedPunchSx,
} from "@/components/project/schedule/ScheduleLegend/schedule-legend-styles";
import { entryChipOf, localPartsOf } from "@/lib/project/schedule-roster";

import type { RosterData, RosterDemand, RosterEntry } from "../roster-context";

export interface RosterPersonCellProps {
  entries: readonly RosterEntry[];
  otherStore: readonly RosterData["otherStoreEntries"][number][];
  unavailability: RosterData["unavailability"][number] | undefined;
  isClosed: boolean;
  demandById: ReadonlyMap<string, RosterDemand>;
  shortNameOf: (templateId: string | null | undefined) => string | null;
  timezone: string;
  /** 執行任務 value → 名稱 */
  taskLabelOf: (taskKey: string) => string;
  /** 點一筆排班(編輯 / 唯讀) */
  onEntryClick: (entry: RosterEntry) => void;
  /** 這個人這天在這家店未對應排班的打卡張數(0 = 不顯示時鐘圖示) */
  punchCount?: number;
  /** 點時鐘圖示:有排班 → 那一筆的排班對話框;沒有 → 新增排班(人員、日期帶入) */
  onPunchClick?: () => void;
}

/**
 * 班表檢視的人員格子(規格 14.5 班表):已排的班(範本簡稱、時間、☕ 休息;負責人簡稱套負責人底色、
 * 未套用範本寫「臨」、同一段時間兩筆寫「晚 ×2」、自動排入右上角圖示);店休;別家店的班(灰色區塊,
 * 看不到那家店寫「已排於其他分店」);整天畫休(灰色斜線底「畫休」);時段不可排(灰色區塊);
 * 未對應排班的打卡在右上角顯示時鐘圖示 + 張數(規格 14.5),點了打開排班對話框(有班)或新增排班(沒班)。
 */
export const RosterPersonCell = ({
  entries,
  otherStore,
  unavailability,
  isClosed,
  demandById,
  shortNameOf,
  timezone,
  taskLabelOf,
  onEntryClick,
  punchCount = 0,
  onPunchClick,
}: RosterPersonCellProps) => {
  const t = useTranslations("admin.schedule.roster.cell");
  const tTimeline = useTranslations("admin.schedule.roster.timeline");
  const time = (iso: string) => localPartsOf(iso, timezone).time;
  if (isClosed) {
    return (
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {t("closed")}
      </Typography>
    );
  }
  const fullDay = unavailability?.fullDay === true;
  return (
    <Stack spacing={0.5} sx={{ position: "relative", minHeight: "100%" }}>
      {punchCount > 0 && (
        <Box
          role="button"
          tabIndex={0}
          data-unmatched-punch-count={punchCount}
          aria-label={tTimeline("punchAria", { count: punchCount })}
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            onPunchClick?.();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onPunchClick?.();
            }
          }}
          sx={[unmatchedPunchSx, { alignSelf: "flex-end", cursor: "pointer" }]}
        >
          {tTimeline("punch", { count: punchCount })}
        </Box>
      )}
      {fullDay && (
        <Box sx={{ position: "relative", minHeight: 40, px: 0.75, py: 0.5 }}>
          <Box sx={dayOffHatchSx} />
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {t("dayOff")}
          </Typography>
        </Box>
      )}
      {entries.map((entry) => {
        const chip = entryChipOf(entry, demandById, shortNameOf);
        const names = chip.shortNames
          .map((name) => name ?? t("temp"))
          .join(" + ");
        const label =
          chip.multiCount > 1
            ? t("multi", { name: names, count: chip.multiCount })
            : names;
        const tasks = entry.assignments
          .map((item) =>
            t("taskLine", {
              role: t(`roles.${item.role === "leader" ? "leader" : "helper"}`),
              task: taskLabelOf(item.taskKey),
            }),
          )
          .join("、");
        return (
          <Tooltip key={entry.id} title={tasks}>
            <Box
              role="button"
              tabIndex={0}
              aria-label={t("entryAria", {
                name: label,
                start: time(entry.startAt),
                end: time(entry.endAt),
              })}
              onClick={(event: MouseEvent) => {
                event.stopPropagation();
                onEntryClick(entry);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onEntryClick(entry);
                }
              }}
              sx={[entryBlockSx, { cursor: "pointer" }]}
            >
              {chip.isAuto && (
                <Box component="span" aria-hidden sx={autoMarkSx}>
                  ✦
                </Box>
              )}
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <Box
                  component="span"
                  sx={[
                    { typography: "caption", fontWeight: 600 },
                    chip.isLead ? leaderMarkSx : {},
                  ]}
                >
                  {label}
                </Box>
                <Typography variant="caption" color="textSecondary">
                  {t("break", { minutes: entry.breakMinutes })}
                </Typography>
              </Stack>
              <Typography variant="caption" color="textSecondary">
                {t("range", {
                  start: time(entry.startAt),
                  end: time(entry.endAt),
                })}
              </Typography>
            </Box>
          </Tooltip>
        );
      })}
      {otherStore.map((item) => (
        <Box key={`${item.startAt}-${item.endAt}`} sx={unavailableBlockSx}>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {item.orgName === null || item.orgName === undefined
              ? t("otherStoreUnknown")
              : t("otherStore", { org: item.orgName })}
          </Typography>
          <Typography variant="caption" component="div">
            {t("range", { start: time(item.startAt), end: time(item.endAt) })}
          </Typography>
        </Box>
      ))}
      {!fullDay &&
        (unavailability?.slots ?? []).map((slot) => (
          <Box key={slot.startAt} sx={unavailableBlockSx}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {t("unavailable")}
            </Typography>
            <Typography variant="caption" component="div">
              {t("range", { start: time(slot.startAt), end: time(slot.endAt) })}
            </Typography>
          </Box>
        ))}
    </Stack>
  );
};
