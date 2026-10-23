import { type MouseEvent, useState } from "react";
import { useTranslations } from "use-intl";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import { Box } from "@repo/ui/box";
import { IconButton } from "@repo/ui/icon-button";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Menu, MenuItem } from "@repo/ui/menu";
import {
  type RosterDate,
  RosterGrid,
  type RosterTopGroup,
} from "@repo/ui/roster-grid";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import { ScheduleLegend } from "@/components/project/schedule/ScheduleLegend/ScheduleLegend";
import { useFitMainHeight } from "@/hooks/base/useFitMainHeight";
import { useSectionCollapse } from "@/hooks/base/useSectionCollapse";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import {
  datesOfMonth,
  daySummaryOf,
  demandAreaRows,
  demandCountText,
  demandCountsOf,
  demandToneOf,
  monthDayOf,
  weekdayOf,
} from "@/lib/project/schedule-roster";
import { isTagPaletteKey } from "@/lib/project/tag-palettes";

import { ROSTER_CONTENT_SELECTOR } from "../check-panel/RosterCheckLayout";
import { useRosterCheckPanelOpen } from "../check-panel/roster-check-context";
import {
  type RosterDemand,
  type RosterEntry,
  type RosterPerson,
  rosterCellKey,
  useRoster,
} from "../roster-context";
import { RosterPersonCell } from "./RosterPersonCell";
import { useRosterGridColumns } from "./useRosterGridColumns";

const PAGE_ID = "schedule.roster";
const DEMANDS_SECTION = "demands";
const STATS_GROUP = "stats";

/**
 * 手機一次看 2 天(Figma SC-59):日期欄、[統計 ▸] 窄欄都窄一點(設計值,只有班表檢視用到,STYLE-06)。
 * 390 寬扣掉側欄與卡片留白約剩 278px:人員 72 + 日期 74 × 2 + 統計 56。
 */
const MOBILE_DATE_WIDTH = 74;
const MOBILE_STATS_WIDTH = 56;
const DATE_WIDTH = 104;

/**
 * 班表檢視(SC-03;規格 14.5 班表):人 × 日期(底座 `RosterGrid`):人員欄固定左、統計欄固定右、
 * 日期區左右捲動;上方人力需求區(一列一種範本 + 「臨」,可收合、存在這台裝置)。
 *
 * - 點空白格 → 新增排班(人員、日期帶入);點已排的班 → 排班對話框(沒有 `edit` 時唯讀)
 * - 人力需求區:點人數標籤 → 人力需求對話框;點空白格 → 新增人力需求(帶入日期與那一列的範本)
 * - 日期欄 [⋯] → 移除這天所有排班(要 `edit`)
 * - 統計欄依 [⚙ 顯示欄位](個人偏好);手機收成 [統計 ▸] 窄欄
 */
export const RosterGridView = () => {
  const t = useTranslations("admin.schedule.roster");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const { data, timezone, canEdit, openDemand, openEntry, removeDay } =
    useRoster();
  const isMobile = useBreakpointDown("sm");
  // 表格自己捲(sticky 表頭、橫向捲軸看得到),高度上限 = <main> 扣掉工具列與圖例後剩下的
  const [fitHeight, setFitTarget] = useFitMainHeight({
    boundarySelector: ROSTER_CONTENT_SELECTOR,
  });
  const sections = useSectionCollapse(PAGE_ID);
  const positions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.position,
  );
  const tasks = useScheduleFieldOptions(SCHEDULE_FIELD_CATEGORY_KEYS.task);
  const [dayMenu, setDayMenu] = useState<{
    anchor: HTMLElement;
    date: string;
  } | null>(null);

  const demandsCollapsed = sections.isCollapsed(DEMANDS_SECTION, isMobile);
  // 檢核面板開著時統計欄暫時收成 [統計 ▸](點了展開,不記住);面板關上回到原本的狀態(規格 14.5)
  const isCheckOpen = useRosterCheckPanelOpen();
  const [statsDuringCheck, setStatsDuringCheck] = useState({
    isCheckOpen,
    expanded: false,
  });
  if (statsDuringCheck.isCheckOpen !== isCheckOpen) {
    setStatsDuringCheck({ isCheckOpen, expanded: false });
  }
  const statsCollapsed = isCheckOpen
    ? !statsDuringCheck.expanded
    : sections.isCollapsed(STATS_GROUP, isMobile);

  const dates = datesOfMonth(data.month);
  const calendarByDate = new Map(
    data.calendarDays.map((day) => [day.date, day]),
  );
  const templateById = new Map(
    data.templates.map((template) => [template.id, template]),
  );
  const demandById = new Map(data.demands.map((demand) => [demand.id, demand]));
  const shortNameOf = (templateId: string | null | undefined) =>
    templateId === null || templateId === undefined
      ? null
      : (templateById.get(templateId)?.shortName ?? null);
  const countLabels = { leader: t("count.leader"), helper: t("count.helper") };
  const isClosed = (date: string) =>
    calendarByDate.get(date)?.type === "closed";

  const entriesOf = (userId: string, date: string): RosterEntry[] =>
    data.entries.filter(
      (entry) => entry.userId === userId && entry.date === date,
    );
  const punchCountOf = (userId: string, date: string): number =>
    data.unmatchedPunches.filter(
      (punch) => punch.userId === userId && punch.date === date,
    ).length;
  const unavailabilityOf = (userId: string, date: string) =>
    data.unavailability.find(
      (item) => item.userId === userId && item.date === date,
    );

  const rosterDates: RosterDate[] = dates.map((date) => {
    const day = calendarByDate.get(date);
    const closed = day?.type === "closed";
    const special =
      day?.type === "special" && isTagPaletteKey(day.paletteKey)
        ? day.paletteKey
        : null;
    return {
      date,
      disabled: closed,
      header: (
        <Stack
          direction="row"
          sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
        >
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {t("dateHeader", {
                date: monthDayOf(date, timezone),
                weekday: tCalendar(`weekdays.${String(weekdayOf(date))}`),
              })}
            </Typography>
            {closed && (
              <Typography
                variant="caption"
                component="div"
                color="textSecondary"
              >
                {t("cell.closed")}
              </Typography>
            )}
            {special !== null && (
              <TagPaletteChip paletteKey={special} label={day?.name ?? ""} />
            )}
          </Box>
          {canEdit && !closed && (
            <IconButton
              size="small"
              aria-label={t("dayMenu", { date: monthDayOf(date, timezone) })}
              onClick={(event: MouseEvent<HTMLElement>) => {
                setDayMenu({ anchor: event.currentTarget, date });
              }}
            >
              <Box component="span" aria-hidden sx={{ typography: "caption" }}>
                ⋯
              </Box>
            </IconButton>
          )}
        </Stack>
      ),
    };
  });

  const { personColumn, statColumns } = useRosterGridColumns(data);

  // ---- 人力需求區 ----
  const rows = demandAreaRows(
    data.templates.map((template) => template.id),
    data.demands,
  );
  const demandTag = (demand: RosterDemand, showPosition: boolean) => {
    const counts = demandCountsOf(demand.tasks);
    const position = [
      positions.labelOf(demand.positionKey),
      demand.positionNote ?? null,
    ]
      .filter((part) => part !== null && part !== "")
      .join(" · ");
    return (
      <Stack key={demand.id} spacing={0.25}>
        {showPosition && (
          <Typography variant="caption" color="textSecondary">
            {position}
          </Typography>
        )}
        <Tag
          tone={demandToneOf(counts)}
          label={demandCountText(counts, countLabels)}
          aria-label={t("demandAria", {
            position,
            count: demandCountText(counts, countLabels),
          })}
          onClick={() => {
            openDemand(demand);
          }}
          sx={{ alignSelf: "flex-start" }}
        />
      </Stack>
    );
  };
  const availableOn = (date: string) =>
    data.people.filter(
      (person) =>
        person.isCandidate &&
        unavailabilityOf(person.userId, date)?.fullDay !== true &&
        entriesOf(person.userId, date).length === 0 &&
        !data.otherStoreEntries.some(
          (item) => item.userId === person.userId && item.date === date,
        ),
    ).length;
  const topGroup: RosterTopGroup = {
    // 手機人員欄窄:標題用小一號的字,「▸ 人力需求」才不會被切掉
    title: isMobile ? (
      <Box component="span" sx={{ fontSize: "0.6875rem" }}>
        {t("demandArea")}
      </Box>
    ) : (
      t("demandArea")
    ),
    collapsed: demandsCollapsed,
    onCollapsedChange: (collapsed) => {
      sections.setCollapsed(DEMANDS_SECTION, collapsed, isMobile);
    },
    rows: rows.map((row) => ({
      key: row.templateId ?? "temp",
      label:
        row.templateId === null
          ? t("tempRow")
          : (templateById.get(row.templateId)?.name ?? ""),
      cells: Object.fromEntries(
        [...row.byDate.entries()].map(([date, demands]) => [
          date,
          <Stack key={date} spacing={0.5}>
            {demands.map((demand) => demandTag(demand, demands.length > 1))}
          </Stack>,
        ]),
      ),
    })),
    summary: Object.fromEntries(
      dates.flatMap((date) => {
        const summary = daySummaryOf(
          data.demands.filter((demand) => demand.date === date),
          availableOn(date),
        );
        return summary === null
          ? []
          : [
              [
                date,
                {
                  primary: t("summaryPrimary", {
                    need: summary.need,
                    filled: summary.filled,
                  }),
                  secondary: t("summarySecondary", {
                    missing: summary.missing,
                    available: summary.available,
                  }),
                  tone: summary.tone,
                },
              ],
            ];
      }),
    ),
    ...(canEdit
      ? {
          emptyCellHint: t("addDemandHint"),
          onEmptyCellClick: (date: string, rowKey: string) => {
            openDemand({
              date,
              templateId: rowKey === "temp" ? null : rowKey,
            });
          },
        }
      : {}),
  };

  return (
    <Stack spacing={1.5}>
      <Box ref={setFitTarget}>
        <RosterGrid
          aria-label={t("gridLabel")}
          people={data.people}
          getPersonKey={(person) => person.userId}
          dates={rosterDates}
          dateColumnWidth={isMobile ? MOBILE_DATE_WIDTH : DATE_WIDTH}
          leadingColumns={[personColumn]}
          trailingColumns={statColumns}
          columnGroups={[
            {
              id: STATS_GROUP,
              label: t("statsGroup"),
              columnKeys: statColumns.map((column) => column.key),
            },
          ]}
          collapsedColumnGroups={statsCollapsed ? [STATS_GROUP] : []}
          {...(isMobile ? { collapsedGroupWidth: MOBILE_STATS_WIDTH } : {})}
          onCollapsedColumnGroupsChange={(groupIds) => {
            if (isCheckOpen) {
              setStatsDuringCheck({
                isCheckOpen,
                expanded: !groupIds.includes(STATS_GROUP),
              });
              return;
            }
            sections.setCollapsed(
              STATS_GROUP,
              groupIds.includes(STATS_GROUP),
              isMobile,
            );
          }}
          topGroup={topGroup}
          formatCellLabel={(person, date) =>
            t("cellAria", {
              name: person.name,
              date: monthDayOf(date, timezone),
            })
          }
          formatEmptyGroupCellLabel={(date) =>
            t("addDemandAria", { date: monthDayOf(date, timezone) })
          }
          {...(canEdit
            ? {
                onCellClick: (person: RosterPerson, date: string) => {
                  if (unavailabilityOf(person.userId, date)?.fullDay === true) {
                    return;
                  }
                  openEntry({ userId: person.userId, date });
                },
              }
            : {})}
          renderCell={({ person, date }) => (
            <Box
              data-roster-cell={rosterCellKey({ userId: person.userId, date })}
              sx={{ height: "100%" }}
            >
              <RosterPersonCell
                entries={entriesOf(person.userId, date)}
                otherStore={data.otherStoreEntries.filter(
                  (item) => item.userId === person.userId && item.date === date,
                )}
                unavailability={unavailabilityOf(person.userId, date)}
                isClosed={isClosed(date)}
                demandById={demandById}
                shortNameOf={shortNameOf}
                timezone={timezone}
                taskLabelOf={tasks.labelOf}
                onEntryClick={openEntry}
                punchCount={punchCountOf(person.userId, date)}
                onPunchClick={() => {
                  const first = entriesOf(person.userId, date).at(0);
                  openEntry(first ?? { userId: person.userId, date });
                }}
              />
            </Box>
          )}
          containerSx={fitHeight === null ? {} : { maxHeight: fitHeight }}
        />
      </Box>
      <ScheduleLegend
        items={[
          "leader",
          "entry",
          "temp",
          "auto",
          "unavailable",
          "dayOff",
          "missingHelper",
          "missingLeader",
          "breakMinutes",
          "full",
          "multi",
          "unmatchedPunch",
        ]}
      />
      <Menu
        open={dayMenu !== null}
        anchorEl={dayMenu?.anchor ?? null}
        onClose={() => {
          setDayMenu(null);
        }}
      >
        <MenuItem
          onClick={() => {
            if (dayMenu !== null) {
              removeDay(dayMenu.date);
            }
            setDayMenu(null);
          }}
        >
          {t("removeDay.menu")}
        </MenuItem>
      </Menu>
    </Stack>
  );
};
