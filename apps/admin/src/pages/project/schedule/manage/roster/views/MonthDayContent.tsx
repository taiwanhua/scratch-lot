import type { MouseEvent } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import {
  demandDotSx,
  unmatchedPunchSx,
} from "@/components/project/schedule/ScheduleLegend/schedule-legend-styles";
import { demandToneOf, monthDayOf } from "@/lib/project/schedule-roster";
import {
  type CountLabels,
  type DemandWording,
  monthTagLines,
} from "@/lib/project/schedule-roster-views";

import { type RosterDemand, rosterCellKey, useRoster } from "../roster-context";

const dotToneOf = (tone: string): "grey" | "warning" | "error" => {
  if (tone === "error" || tone === "warning") {
    return tone;
  }
  return "grey";
};

export interface MonthDayItem {
  demand: RosterDemand;
  wording: DemandWording;
  /** 同一天同一範本多筆:標籤上方寫崗位名稱 */
  showPosition: boolean;
  /** 滑過提示:填進的人(月檢視不放人名) */
  names: string[];
}

export interface MonthDayContentProps {
  date: string;
  items: readonly MonthDayItem[];
  device: "desktop" | "tablet" | "mobile";
  labels: CountLabels;
  /** 未對應排班的打卡張數(0 = 不顯示 ⏲) */
  punchCount: number;
}

/**
 * 月檢視一天的內容(SC-43;規格 14.5 月):各人力需求的摘要標籤(三態實心色,寫法見「人數寫法」,
 * 同一天同一範本多筆時上方寫崗位名稱;手機每筆一顆同色實心點)、右上角 ⏲ 未對應排班的打卡。
 * 點標籤 → 人力需求對話框;點空白處 → 新增人力需求(帶入日期;要 `edit`)。點日期數字由月曆本身處理。
 */
export const MonthDayContent = ({
  date,
  items,
  device,
  labels,
  punchCount,
}: MonthDayContentProps) => {
  const t = useTranslations("admin.schedule.roster");
  const { canEdit, openDemand, timezone } = useRoster();
  const punch =
    punchCount > 0 ? (
      <Box
        component="span"
        aria-label={t("timeline.punchAria", { count: punchCount })}
        sx={[unmatchedPunchSx, { position: "absolute", top: 4, right: 4 }]}
      >
        {t("timeline.punch", { count: punchCount })}
      </Box>
    ) : null;

  if (device === "mobile") {
    return (
      <Box data-roster-cell={rosterCellKey({ date })}>
        {punch}
        <Stack
          direction="row"
          spacing={0.25}
          useFlexGap
          sx={{ flexWrap: "wrap" }}
        >
          {items.map(({ demand, wording }) => {
            const tone = demandToneOf(wording.counts);
            return (
              <Box
                key={demand.id}
                component="span"
                data-demand-dot={dotToneOf(tone)}
                sx={demandDotSx(dotToneOf(tone))}
              />
            );
          })}
        </Stack>
      </Box>
    );
  }

  return (
    <Stack
      data-roster-cell={rosterCellKey({ date })}
      spacing={0.5}
      sx={{ flex: 1 }}
    >
      {punch}
      {items.map(({ demand, wording, showPosition, names }) => {
        const lines = monthTagLines(wording, device, labels.short);
        return (
          <Stack key={demand.id} spacing={0.25}>
            {showPosition && (
              <Typography variant="caption" color="textSecondary">
                {wording.position}
              </Typography>
            )}
            <Tooltip
              title={
                names.length === 0 ? t("timeline.nobody") : names.join("、")
              }
            >
              <Tag
                tone={demandToneOf(wording.counts)}
                aria-label={t("demandAria", {
                  position: wording.position,
                  count: lines.join(" "),
                })}
                label={
                  <Box
                    component="span"
                    sx={{ display: "block", textAlign: "left" }}
                  >
                    {lines.map((line) => (
                      <Box
                        key={line}
                        component="span"
                        sx={{ display: "block" }}
                      >
                        {line}
                      </Box>
                    ))}
                  </Box>
                }
                onClick={(event: MouseEvent) => {
                  event.stopPropagation();
                  openDemand(demand);
                }}
                sx={{
                  borderRadius: 1,
                  justifyContent: "flex-start",
                  width: "100%",
                }}
              />
            </Tooltip>
          </Stack>
        );
      })}
      {canEdit && (
        <Box
          role="button"
          tabIndex={0}
          aria-label={t("addDemandAria", { date: monthDayOf(date, timezone) })}
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            openDemand({ date });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              openDemand({ date });
            }
          }}
          sx={{
            flex: 1,
            minHeight: 20,
            borderRadius: 1,
            typography: "caption",
            color: "transparent",
            cursor: "pointer",
            "&:hover, &:focus-visible": {
              color: "text.secondary",
              bgcolor: "action.hover",
            },
          }}
        >
          {t("addDemandHint")}
        </Box>
      )}
    </Stack>
  );
};
