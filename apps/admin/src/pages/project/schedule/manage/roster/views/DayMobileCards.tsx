import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { tagPaletteBackgroundVarsSx } from "@repo/ui/theme";
import { Typography } from "@repo/ui/typography";

import {
  calendarMarkBackground,
  calendarMarkOf,
} from "@/components/project/schedule/CalendarMark/calendar-mark";
import { ScheduleLegend } from "@/components/project/schedule/ScheduleLegend/ScheduleLegend";
import { unmatchedCountsByDate } from "@/lib/project/schedule-attendance";
import { demandToneOf } from "@/lib/project/schedule-roster";
import {
  compareGroupPlans,
  dayCardTexts,
} from "@/lib/project/schedule-roster-views";

import { rosterCellKey, useRoster } from "../roster-context";
import { DayCardPerson } from "./DayCardPerson";
import { DayCardVacancy } from "./DayCardVacancy";
import { UnmatchedPunchMark } from "./UnmatchedPunchMark";
import { ROSTER_LEGEND_ITEMS } from "./roster-legend";
import { type RosterTimeline, slotIdOf } from "./useTimelineGroups";

export interface DayMobileCardsProps {
  date: string;
  timeline: RosterTimeline;
}

/** 卡片裡可點的區塊(標題、缺額、[+ 人力需求])。 */
const pressableSx = {
  border: 0,
  bgcolor: "transparent",
  color: "inherit",
  textAlign: "left",
  p: 0,
  cursor: "pointer",
  font: "inherit",
} as const;

/**
 * 手機日檢視(SC-45 手機;規格 14.5 日):人力需求卡片清單,依開始時間排序;卡片標題「班名 時間」、
 * 副標「崗位 · 負責 x/y · 協同 x/y」、右上已填 / 總筆數(有缺時加「缺 N」);每個人一列(負責人套綠底,
 * 上下班和需求不同時加註),缺人用虛線空位;那天有未對應排班的打卡時上方顯示「⏲ N」。點標題 → 人力需求對話框、點人 → 排班對話框、點缺額 → 新增排班。
 * 店休 / 特殊日(同電腦版日期表頭與手機週清單,判斷用 `calendarMarkOf`):卡片清單上方一列,店休停用底色寫「店休」、
 * 特殊日用它的顏色當底並寫名稱,「⏲ N」放在同一列。店休那天沒有 [+ 人力需求](店休日不能建人力需求)。
 */
export const DayMobileCards = ({ date, timeline }: DayMobileCardsProps) => {
  const t = useTranslations("admin.schedule.roster");
  const { data, canEdit, openDemand, openEntry } = useRoster();
  // 未對應排班的打卡:同電腦版日期旁的「⏲ N」(規格 14.5)
  const punchCount =
    unmatchedCountsByDate(data.unmatchedPunches).get(date) ?? 0;
  const groups = timeline.groups.toSorted((left, right) =>
    compareGroupPlans(left.plan, right.plan),
  );
  const mark = calendarMarkOf(
    data.calendarDays.find((day) => day.date === date),
  );

  return (
    <Stack
      spacing={1.5}
      data-roster-cell={rosterCellKey({ date })}
      sx={tagPaletteBackgroundVarsSx}
    >
      {mark.kind === "none" ? (
        <UnmatchedPunchMark
          count={punchCount}
          placement={{ alignSelf: "flex-start" }}
        />
      ) : (
        <Stack
          direction="row"
          spacing={0.5}
          data-calendar-mark={mark.kind}
          sx={{
            alignItems: "center",
            p: 1.5,
            border: 1,
            borderColor: "divider",
            borderRadius: 1.5,
            bgcolor: calendarMarkBackground(mark),
            color: mark.kind === "closed" ? "text.secondary" : "text.primary",
          }}
        >
          <Typography variant="subtitle2">
            {mark.kind === "closed" ? t("cell.closed") : (mark.name ?? "")}
          </Typography>
          <UnmatchedPunchMark count={punchCount} />
        </Stack>
      )}
      {groups.length === 0 && (
        <Typography variant="body2" color="textSecondary">
          {t("timeline.noDemand")}
        </Typography>
      )}
      {groups.map((group) => {
        const { demand } = group.plan;
        const texts = dayCardTexts(group.wording, timeline.labels.long);
        return (
          <Card key={group.id} variant="outlined">
            <Stack spacing={1} sx={{ p: 1.5 }}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "flex-start" }}
              >
                <Box
                  component="button"
                  onClick={() => {
                    openDemand(demand);
                  }}
                  sx={[pressableSx, { flex: 1, minWidth: 0 }]}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {texts.title}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    {texts.subtitle}
                  </Typography>
                </Box>
                <Tag
                  tone={demandToneOf(group.wording.counts)}
                  label={
                    texts.missing > 0
                      ? t("timeline.cardMissing", {
                          count: texts.badge,
                          missing: texts.missing,
                        })
                      : texts.badge
                  }
                />
              </Stack>
              {group.plan.slots.map((slot) =>
                slot.kind === "bar" ? (
                  <DayCardPerson
                    key={slot.taskId}
                    slot={slot}
                    demand={demand}
                    entry={timeline.entryOfSlot(
                      slotIdOf(demand.id, slot.taskId),
                    )}
                    onOpen={openEntry}
                  />
                ) : (
                  <DayCardVacancy
                    key={slot.taskId}
                    role={slot.role}
                    canAdd={canEdit}
                    onAdd={() => {
                      openEntry({
                        date: demand.date,
                        demandId: demand.id,
                        taskId: slot.taskId,
                      });
                    }}
                  />
                ),
              )}
            </Stack>
          </Card>
        );
      })}
      {/* 店休那天不能建人力需求:不放 [+ 人力需求](同月檢視、班表的店休格不給點) */}
      {canEdit && mark.kind !== "closed" && (
        <Box
          component="button"
          onClick={() => {
            openDemand({ date });
          }}
          sx={[
            pressableSx,
            {
              border: 1,
              borderStyle: "dashed",
              borderColor: "divider",
              borderRadius: 1.5,
              py: 1.5,
              textAlign: "center",
              color: "text.secondary",
            },
          ]}
        >
          {t("addDemandHint")}
        </Box>
      )}
      <ScheduleLegend items={ROSTER_LEGEND_ITEMS.dayMobile} />
    </Stack>
  );
};
