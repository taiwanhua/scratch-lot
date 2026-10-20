import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { Button } from "@repo/ui/button";
import { Drawer } from "@repo/ui/drawer";
import { IconButton } from "@repo/ui/icon-button";
import { ChevronLeftIcon, ChevronRightIcon } from "@repo/ui/icons";
import { useBreakpointDown } from "@repo/ui/media-query";
import { MenuItem, MenuList } from "@repo/ui/menu";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  localPartsOf,
  monthDayOf,
  shiftMonthOf,
} from "@/lib/project/schedule-roster";

import type { RosterData } from "./roster-context";
import { ROSTER_TOOLBAR_ACTIONS, ROSTER_TOOLBAR_END } from "./roster-toolbar";
import { ROSTER_VIEWS, type RosterViewEntry } from "./roster-views";

export interface RosterToolbarProps {
  data: RosterData | undefined;
  month: string;
  view: RosterViewEntry;
  onOrgChange: (orgId: string) => void;
  onMonthChange: (month: string) => void;
  onViewChange: (view: string) => void;
  onAddDemand: () => void;
  onAddEntry: () => void;
}

/**
 * 排班表工具列(SC-03 / SC-55 / SC-56;規格 14.5):分店選擇器、狀態(滑過顯示說明)、
 * [+ 人力需求] [+ 新增排班] 與各功能追加的按鈕(`roster-toolbar.ts`);第二列檢視切換、
 * `◀ 2026 年 11 月 ▶`、這個檢視的工具([⚙ 顯示欄位])與檢核按鈕。
 * 手機:[+ 新增 ▾](人力需求 / 排班)與 [⋯](其他按鈕)改成底部選單。沒有 `edit` 看不到新增類按鈕。
 */
export const RosterToolbar = ({
  data,
  month,
  view,
  onOrgChange,
  onMonthChange,
  onViewChange,
  onAddDemand,
  onAddEntry,
}: RosterToolbarProps) => {
  const t = useTranslations("admin.schedule.roster");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const isMobile = useBreakpointDown("sm");
  const { hasPermission } = usePermissions();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const [sheet, setSheet] = useState<"add" | "more" | null>(null);
  const canEdit = data?.canEdit === true;
  const actions = ROSTER_TOOLBAR_ACTIONS.filter((action) =>
    hasPermission(action.permission),
  );
  const isPublished = data?.period.status === "published";
  const [year = "", monthNumber = ""] = month.split("-");
  const closeSheet = () => {
    setSheet(null);
  };
  const { Tools } = view;

  return (
    <Stack spacing={1.5}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" } }}
      >
        <OrgTreeSelect
          // 業務頁:可見範圍內的才能選(用法表 ④)
          scope="visible"
          label={t("org")}
          value={data === undefined ? [] : [data.orgId]}
          size="small"
          onChange={(ids) => {
            onOrgChange(ids.at(0) ?? "");
          }}
        />
        <Stack
          direction="row"
          spacing={1}
          sx={{ flex: 1, alignItems: "center", flexWrap: "wrap" }}
          useFlexGap
        >
          {data !== undefined && (
            <Tooltip
              title={
                isPublished
                  ? t("status.publishedHint")
                  : t("status.unpublishedHint")
              }
            >
              <Tag
                tone={isPublished ? "success" : "grey"}
                label={
                  isPublished
                    ? t("status.published", {
                        date:
                          data.period.publishedAt === null ||
                          data.period.publishedAt === undefined
                            ? ""
                            : monthDayOf(
                                localPartsOf(data.period.publishedAt, timezone)
                                  .date,
                              ),
                        by: data.period.publishedByName ?? "",
                      })
                    : t("status.unpublished")
                }
              />
            </Tooltip>
          )}
          <Stack sx={{ flex: 1 }} />
          {isMobile ? (
            <>
              {canEdit && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    setSheet("add");
                  }}
                >
                  {t("toolbar.addMenu")}
                </Button>
              )}
              {actions.length > 0 && (
                <Button
                  variant="outlined"
                  size="small"
                  aria-label={t("toolbar.more")}
                  onClick={() => {
                    setSheet("more");
                  }}
                >
                  ⋯
                </Button>
              )}
            </>
          ) : (
            <>
              {canEdit && (
                <>
                  <Button variant="outlined" size="small" onClick={onAddDemand}>
                    {t("toolbar.addDemand")}
                  </Button>
                  <Button variant="outlined" size="small" onClick={onAddEntry}>
                    {t("toolbar.addEntry")}
                  </Button>
                </>
              )}
              {actions.map(({ key, Action }) => (
                <Action key={key} variant="toolbar" onDone={closeSheet} />
              ))}
            </>
          )}
        </Stack>
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <SegmentedControl
          aria-label={t("toolbar.views")}
          value={view.value}
          onChange={onViewChange}
          options={ROSTER_VIEWS.map((item) => ({
            value: item.value,
            label: t(`views.${item.labelKey}`),
          }))}
        />
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <IconButton
            size="small"
            aria-label={tCalendar("prevMonth")}
            onClick={() => {
              onMonthChange(shiftMonthOf(month, -1));
            }}
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {tCalendar("monthTitle", { year, month: Number(monthNumber) })}
          </Typography>
          <IconButton
            size="small"
            aria-label={tCalendar("nextMonth")}
            onClick={() => {
              onMonthChange(shiftMonthOf(month, 1));
            }}
          >
            <ChevronRightIcon />
          </IconButton>
        </Stack>
        <Stack sx={{ flex: 1 }} />
        {Tools !== undefined && <Tools />}
        {ROSTER_TOOLBAR_END.map((End, index) => (
          <End key={String(index)} />
        ))}
      </Stack>
      <Drawer
        anchor="bottom"
        open={sheet !== null}
        title={sheet === "add" ? t("toolbar.addSheet") : t("toolbar.moreSheet")}
        closeLabel={t("toolbar.closeSheet")}
        onClose={closeSheet}
      >
        <MenuList>
          {sheet === "add" && [
            <MenuItem
              key="demand"
              onClick={() => {
                closeSheet();
                onAddDemand();
              }}
            >
              {t("toolbar.sheetDemand")}
            </MenuItem>,
            <MenuItem
              key="entry"
              onClick={() => {
                closeSheet();
                onAddEntry();
              }}
            >
              {t("toolbar.sheetEntry")}
            </MenuItem>,
          ]}
          {sheet === "more" &&
            actions.map(({ key, Action }) => (
              <Action key={key} variant="menu" onDone={closeSheet} />
            ))}
        </MenuList>
      </Drawer>
    </Stack>
  );
};
