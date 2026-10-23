import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  DEFAULT_TENANT_TIMEZONE,
  localMonthOf,
  localMonthText,
  parseLocalMonth,
} from "@repo/domain/form";
import {
  type ScheduleCalendarDayFieldsFragment,
  useScheduleCalendarQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import {
  MonthCalendar,
  type MonthCalendarDayInfo,
} from "@repo/ui/month-calendar";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { TagPaletteChip } from "@/components/project/TagPaletteChip/TagPaletteChip";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";
import { dayKeyOf, monthRangeOf } from "@/lib/project/schedule-day-offs";
import { isTagPaletteKey } from "@/lib/project/tag-palettes";

import { CalendarDayDialog } from "./CalendarDayDialog";

type Day = ScheduleCalendarDayFieldsFragment;

const orgSchema = z.string().default("");
/** `?month=YYYY-MM`;空字串 / 格式不對 = 這個月(租戶時區)。 */
const monthSchema = z.string().default("");

/** 對話框:新增(可帶入日期鍵)或某一天。 */
type Editing = { mode: "create"; date: string } | { mode: "day"; day: Day };

/**
 * 排班作業 → 行事曆(SC-07;規格 14.5「行事曆」):月曆標出店休(灰)與特殊日(行事曆設定的顏色、顯示名稱)。
 * 上層組織設的往下沿用,本店自設的以本店為準(最接近的那一層)。
 *
 * - 分店選擇器、月份放網址參數
 * - [新增](SC-28)要 `edit-calendar`;沒有時看不到 [新增],點日期只看說明
 * - 點有設定的日子:本層設的 → 編輯;上層設的 → 唯讀說明
 */
export const CalendarTab = () => {
  const t = useTranslations("admin.schedule.calendar");
  const { session } = useSession();
  const [orgId, setOrgId] = useUrlState("org", orgSchema);
  const [monthParam, setMonth] = useUrlState("month", monthSchema);
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  // 這個月以租戶時區判斷(不用瀏覽器時區);「現在」進頁時取一次
  const [now] = useState(Date.now);
  const month =
    parseLocalMonth(monthParam) === null
      ? localMonthText(localMonthOf(now, timezone))
      : monthParam;
  const [editing, setEditing] = useState<Editing | null>(null);
  // 送那個月在租戶時區的時點區間 `[月初 00:00, 下月初 00:00)`
  const range = monthRangeOf(month, timezone) ?? { from: "", to: "" };
  const query = useScheduleCalendarQuery(session.client, {
    input: { ...range, ...(orgId === "" ? {} : { orgId }) },
  });
  const calendar = query.data?.scheduleCalendar;
  const days = calendar?.days ?? [];
  const canEdit = calendar?.canEdit ?? false;

  const labelOf = (day: Day) => {
    const type = day.type === "closed" ? t("closed") : t("special");
    return day.name === null || day.name === undefined
      ? type
      : t("dayLabel", { type, name: day.name });
  };

  const dayInfo: Record<string, MonthCalendarDayInfo> = Object.fromEntries(
    days.map((day) => [
      dayKeyOf(day.date, timezone),
      {
        content:
          day.type === "special" && isTagPaletteKey(day.paletteKey) ? (
            <TagPaletteChip paletteKey={day.paletteKey} label={labelOf(day)} />
          ) : (
            <Tag label={labelOf(day)} />
          ),
      },
    ]),
  );

  const openDate = (date: string) => {
    const day = days.find((item) => dayKeyOf(item.date, timezone) === date);
    if (day !== undefined) {
      setEditing({ mode: "day", day });
    } else if (canEdit) {
      setEditing({ mode: "create", date });
    }
  };

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" } }}
      >
        <OrgTreeSelect
          // 業務頁:可見範圍內的才能選(用法表 ④)
          scope="visible"
          label={t("org")}
          value={calendar === undefined ? [] : [calendar.orgId]}
          size="small"
          onChange={(ids) => {
            setOrgId(ids.at(0) ?? "");
          }}
        />
        <Stack sx={{ flex: 1 }} />
        {canEdit && (
          <Button
            onClick={() => {
              setEditing({ mode: "create", date: "" });
            }}
          >
            {t("add")}
          </Button>
        )}
      </Stack>
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        selectionMode="single"
        selectedDates={[]}
        onSelectedDatesChange={(dates) => {
          const date = dates.at(0);
          if (date !== undefined) {
            openDate(date);
          }
        }}
        days={dayInfo}
        weekdayLabels={[0, 1, 2, 3, 4, 5, 6].map((day) =>
          t(`weekdays.${String(day)}`),
        )}
        formatMonthTitle={(value) => {
          const [year = "", monthNumber = ""] = value.split("-");
          return t("monthTitle", { year, month: Number(monthNumber) });
        }}
        prevMonthLabel={t("prevMonth")}
        nextMonthLabel={t("nextMonth")}
      />
      <Stack
        direction="row"
        spacing={2}
        useFlexGap
        sx={{ flexWrap: "wrap", alignItems: "center" }}
      >
        <Tag label={t("legendClosed")} />
        <TagPaletteChip paletteKey="cyan" label={t("legendSpecial")} />
        <Typography variant="caption" color="textSecondary">
          {t("legendInherit")}
        </Typography>
      </Stack>
      {editing !== null && calendar !== undefined && (
        <CalendarDayDialog
          orgId={calendar.orgId}
          day={editing.mode === "day" ? editing.day : null}
          initialDate={editing.mode === "create" ? editing.date : ""}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </Stack>
  );
};
