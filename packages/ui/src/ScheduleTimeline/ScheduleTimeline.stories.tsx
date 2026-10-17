import type { Meta, StoryObj } from "@storybook/react-vite";
import dayjs from "dayjs";
import { useState } from "react";

import { Box } from "../Box/Box";
import { Button } from "../Button/Button";
import { IconButton } from "../IconButton/IconButton";
import { Typography } from "../Typography/Typography";
import { ChevronRightIcon } from "../icons/ChevronRightIcon";
import { ScheduleTimeline } from "./ScheduleTimeline";
import {
  WEEK,
  at,
  autoMark,
  bar,
  doubleBadge,
  group,
  vacancy,
  weekDates,
} from "./schedule-timeline-story-data";
import type {
  ScheduleTimelineDate,
  ScheduleTimelineGroup,
  ScheduleTimelineMoreTone,
  ScheduleTimelineSelection,
} from "./schedule-timeline-types";

const [D1, D2, D3, D4, D5, D6, D7] = WEEK;
/** 日模式高度跟著內容長(最多 560 再捲) */
const DAY_SX = { maxHeight: 560 };
/** 示範的「今天」:11/4(三) */
const TODAY = D4;

/** 每一天的早班 / 晚班(11/3 店休不排)。 */
const baseGroups: ScheduleTimelineGroup[] = [
  group("d1-early", D1, 8.5, 14.5, "早班 · 櫃台 A", "早", [
    bar("d1-e1", D1, 8.5, 14.5, "王小明", { isLead: true }),
    vacancy("d1-e2", "協同"),
  ]),
  group(
    "d1-b",
    D1,
    8.5,
    14.5,
    "早班 · 櫃台 B",
    "B",
    [vacancy("d1-b1", "負責")],
    { sortKeys: [1, 2] },
  ),
  group("d1-late", D1, 14.5, 22, "晚班 · 櫃台 A", "晚", [
    bar("d1-l1", D1, 14.5, 22, "陳大文", { isLead: true }),
    bar("d1-l2", D1, 14.5, 22, "林美麗"),
  ]),
  group("d2-early", D2, 8.5, 14.5, "早班 · 櫃台 A", "早", [
    bar("d2-e1", D2, 8.5, 14.5, "林美麗", { isLead: true, marks: [autoMark] }),
    bar("d2-e2", D2, 8.5, 14.5, "王小明"),
  ]),
  group("d2-late", D2, 14.5, 22, "晚班 · 櫃台 A", "晚", [
    bar("d2-l1", D2, 14.5, 22, "陳大文", { isLead: true }),
    vacancy("d2-l2", "協同"),
  ]),
  group("d4-early", D4, 8.5, 14.5, "早班 · 櫃台 A", "早", [
    bar("d4-e1", D4, 8.5, 14.5, "李小華", { isLead: true }),
    bar("d4-e2", D4, 8.5, 14.5, "林美麗"),
  ]),
  group("d4-late", D4, 17, 22, "晚班 · 櫃台 A", "晚", [
    bar("d4-l1", D4, 17, 22, "王小明", { isLead: true, marks: [autoMark] }),
  ]),
  ...[D5, D6, D7].flatMap((date) => [
    group(`${date}-early`, date, 8.5, 14.5, "早班 · 櫃台 A", "早", [
      bar(`${date}-e1`, date, 8.5, 14.5, "王小明", { isLead: true }),
      bar(`${date}-e2`, date, 8.5, 14.5, "張小芳"),
    ]),
    group(`${date}-late`, date, 14.5, 22, "晚班 · 櫃台 A", "晚", [
      bar(`${date}-l1`, date, 14.5, 22, "陳大文", { isLead: true }),
      bar(`${date}-l2`, date, 14.5, 22, "林美麗"),
    ]),
  ]),
];

/** 11/1 多一筆補貨:電腦欄寬 157 放不下 → 整個收進「+N」長條。 */
const restock = group(
  "d1-restock",
  D1,
  13,
  17,
  "補貨 · 補貨區",
  "補",
  [bar("d1-r1", D1, 13, 17, "張小芳"), vacancy("d1-r2", "協同")],
  { sortKeys: [2, 1] },
);
const groupsWithCollapse = [...baseGroups, restock];

/** 11/3 店休整天、11/4 00:00–06:00 未營業(灰色、不能點)。 */
const disabledRanges = [
  { start: at(D3, 0), end: at(D3, 24), label: "店休" },
  { start: at(D4, 0), end: at(D4, 6) },
];
/** 11/3 表頭寫店休、11/5 特殊日(店慶)整欄底色。 */
const dayOverrides: Partial<Record<string, Partial<ScheduleTimelineDate>>> = {
  [D3]: { label: "二 店休" },
  [D5]: { label: "四 店慶", background: "info.lighter" },
};
const datesWithSpecialDay: ScheduleTimelineDate[] = weekDates.map((day) => ({
  ...day,
  ...dayOverrides[day.date],
}));

/** 「+N」框色:被收起的有缺負責 → Error、有缺協同 → Warning。 */
const moreTone = (
  collapsed: readonly ScheduleTimelineGroup[],
): ScheduleTimelineMoreTone => {
  if (collapsed.some((g) => g.tone === "error")) return "error";
  return collapsed.some((g) => g.tone === "warning") ? "warning" : "neutral";
};

const meta = {
  title: "Components/ScheduleTimeline",
  component: ScheduleTimeline,
  parameters: { layout: "padded" },
  args: {
    mode: "week",
    dates: datesWithSpecialDay,
    groups: baseGroups,
    disabledRanges,
    today: TODAY,
    dayWidth: 157,
    getMoreTone: moreTone,
    emptyHint: "+ 人力需求",
    containerSx: { height: 560 },
    "aria-label": "班表時間軸",
  },
} satisfies Meta<typeof ScheduleTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 週模式:每天一欄、時間由上往下;11/4 是今天(表頭主色實心圓)、11/3 店休、11/5 特殊日底色。 */
export const WeekWithoutCollapse: Story = {};

/** 週模式有收起:11/1 補貨放不下,收進最右邊的「+1」長條(有缺協同 → 警告色框)。 */
export const WeekWithCollapse: Story = {
  args: { groups: groupsWithCollapse },
};

/** 日模式:時間由左往右;容器往下排、時間不重疊的共用一列;不收起任何東西(11/1 的補貨也畫出來)。 */
export const DayWithManyGroups: Story = {
  args: {
    mode: "day",
    containerSx: DAY_SX,
    dates: [{ date: D1, label: "日" }],
    groups: groupsWithCollapse,
  },
};

/** 日模式(今天):表頭日期是主色實心圓。 */
export const DayToday: Story = {
  args: {
    mode: "day",
    containerSx: DAY_SX,
    dates: [{ date: D4, label: "三" }],
  },
};

const extensionGroups: ScheduleTimelineGroup[] = [
  group("x-early", D4, 8.5, 14.5, "早班 · 櫃台 A", "早", [
    bar("x-e1", D4, 7.5, 14.5, "王小明", {
      isLead: true,
      subtitle: "提早 1 小時到",
    }),
    bar("x-e2", D4, 8.5, 16, "林美麗", { subtitle: "延後到 16:00" }),
  ]),
  group("x-restock", D4, 13, 17, "補貨 · 補貨區", "補", [
    bar("x-r1", D4, 13, 18, "張小芳", { subtitle: "排到 18:00" }),
  ]),
];

/** 前段 / 後段延伸:長條超出所屬容器的時間畫成淡色底 + 虛線框,和實線段相接;容器大小與排版不變。 */
export const Extensions: Story = {
  args: { groups: extensionGroups, dates: weekDates },
};

export const ExtensionsDay: Story = {
  args: {
    mode: "day",
    containerSx: DAY_SX,
    dates: [{ date: D4, label: "三" }],
    groups: extensionGroups,
  },
};

const vacancyGroups: ScheduleTimelineGroup[] = [
  group("v-early", D4, 8.5, 14.5, "早班 · 櫃台 A", "早", [
    bar("v-e1", D4, 8.5, 14.5, "王小明", { isLead: true }),
    vacancy("v-e2", "協同"),
  ]),
  group("v-late", D4, 14.5, 22, "晚班 · 櫃台 A", "晚", [
    vacancy("v-l1", "負責"),
    bar("v-l2", D4, 14.5, 22, "陳大文"),
  ]),
];

/** 缺額虛線空位:錯誤色(缺負責)/ 警告色(缺協同);容器框色同。 */
export const Vacancies: Story = {
  args: {
    mode: "day",
    containerSx: DAY_SX,
    dates: [{ date: D4, label: "三" }],
    groups: vacancyGroups,
  },
};

export const VacanciesWeek: Story = {
  args: { groups: vacancyGroups, dates: weekDates },
};

/** 不能操作的時間:店休整天、時段不可排(灰色、不能點、游標維持箭頭);長條停用狀態。 */
export const DisabledTime: Story = {
  args: {
    mode: "day",
    containerSx: DAY_SX,
    dates: [{ date: D4, label: "三" }],
    disabledRanges: [{ start: at(D4, 18), end: at(D4, 24), label: "店休" }],
    groups: [
      group("dt-early", D4, 8.5, 14.5, "早班 · 櫃台 A", "早", [
        bar("dt-e1", D4, 8.5, 14.5, "王小明", { isLead: true }),
        bar("dt-e2", D4, 8.5, 14.5, "陳大文", {
          state: "disabled",
          subtitle: "已排於新竹店",
        }),
      ]),
    ],
  },
};

/**
 * 長條狀態:正常(標題 + 副標)/ 較短(只上部分時段;長條放不下副標,副標移到滑過提示)/
 * 停用(灰色、不可點)。滑過「較短」的張小芳看得到副標。
 */
export const BarStates: Story = {
  args: {
    mode: "day",
    containerSx: DAY_SX,
    dates: [{ date: D4, label: "三" }],
    onBarClick: () => {
      // 示範用:可點才有滑過 / 焦點的互動狀態
    },
    groups: [
      group("bs-early", D4, 8.5, 14.5, "早班 · 櫃台 A", "早", [
        bar("bs-normal", D4, 8.5, 14.5, "王小明", {
          isLead: true,
          subtitle: "正常 · 休 30 分",
        }),
        bar("bs-short", D4, 9, 12, "張小芳", {
          state: "short",
          subtitle: "較短 · 只上 09:00–12:00",
        }),
        bar("bs-disabled", D4, 8.5, 14.5, "陳大文", {
          state: "disabled",
          subtitle: "停用 · 已排於新竹店",
        }),
      ]),
    ],
  },
};

/** 週欄寬不指定:依容器寬自動平分(`floor((寬 − 48) / 7)`,量不到時 157)。 */
export const WeekAutoWidth: Story = {
  args: { dayWidth: undefined, groups: groupsWithCollapse },
};

/** 跨午夜:當天畫到 24:00 標「→ 次日」,次日從 00:00 接續標「前日 →」。 */
export const CrossMidnight: Story = {
  args: {
    dates: weekDates,
    groups: [
      group("night", D4, 20, 26, "夜班 · 倉庫", "夜", [
        bar("night-1", D4, 20, 26, "陳大文", { isLead: true }),
      ]),
    ],
  },
};

/** 長條右上角:自動排入標記與「×2」徽章並排(週模式窄長條依序往下排)。 */
export const MarksAndBadges: Story = {
  args: {
    groups: [
      group("m-a", D4, 14, 22, "櫃台 A", "A", [
        bar("m-a1", D4, 14, 22, "王小明", {
          isLead: true,
          marks: [autoMark, doubleBadge],
        }),
      ]),
      group("m-b", D4, 14, 22, "櫃台 B", "B", [
        bar("m-b1", D4, 14, 22, "王小明", {
          isLead: true,
          marks: [autoMark, doubleBadge],
        }),
      ]),
    ],
  },
};

const InteractiveTimeline = (args: Story["args"]) => {
  const [selection, setSelection] = useState<ScheduleTimelineSelection | null>({
    kind: "bar",
    id: "d2-e2",
  });
  const [log, setLog] = useState("(點容器 / 長條 / 缺額 / 空白處 /「+N」)");
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <ScheduleTimeline
        {...meta.args}
        {...args}
        selection={selection}
        onGroupClick={(g, point) => {
          setSelection({ kind: "group", id: g.id });
          setLog(`容器 ${g.id} · ${point.date} ${point.time}`);
        }}
        onBarClick={(b, g, point) => {
          setSelection({ kind: "bar", id: b.id });
          setLog(`長條 ${b.id}(${g.id})· ${point.date} ${point.time}`);
        }}
        onVacancyClick={(v, g, point) => {
          setSelection({ kind: "vacancy", id: v.id });
          setLog(`缺額 ${v.id}(${g.id})· ${point.date} ${point.time}`);
        }}
        onEmptyClick={(point) => {
          setSelection(null);
          setLog(`空白處 · ${point.date} ${point.time}`);
        }}
        onMoreClick={(date, collapsed) => {
          setSelection({ kind: "more", date });
          setLog(`+N · ${date} · ${collapsed.map((g) => g.id).join(", ")}`);
        }}
      />
      <Typography variant="body2" color="text.secondary">
        {log}
      </Typography>
    </Box>
  );
};

/**
 * 互動狀態:滑過疊同色系 main × 8% 並換框色、已選取疊 16% + 1px 框、鍵盤焦點 action.focus 外框;
 * 空白處滑過顯示淡色「+ 人力需求」;不能操作的時間不變色。點了在下方顯示回呼帶出的日期與時間。
 */
export const InteractionStates: Story = {
  args: { groups: groupsWithCollapse },
  render: (args) => <InteractiveTimeline {...args} />,
};

export const InteractionStatesDay: Story = {
  args: {
    mode: "day",
    containerSx: DAY_SX,
    dates: [{ date: D2, label: "一" }],
    groups: groupsWithCollapse,
  },
  render: (args) => <InteractiveTimeline {...args} />,
};

/** 週的第一天(週日開頭)。 */
const weekStartOf = (date: string) =>
  dayjs(date).subtract(dayjs(date).day(), "day").format("YYYY-MM-DD");

const PeriodBarDemo = ({
  showTodayButton,
  ...args
}: Story["args"] & { showTodayButton: boolean }) => {
  const [weekStart, setWeekStart] = useState<string>(D1);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = dayjs(weekStart).add(index, "day").format("YYYY-MM-DD");
    return { date, label: weekDates[index]?.label };
  });
  const todayWeek = weekStartOf(TODAY);
  const move = (days: number) => {
    setWeekStart(dayjs(weekStart).add(days, "day").format("YYYY-MM-DD"));
  };
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {/* 期間切換列由使用的頁面提供(不在元件內);[今天] 是選用設定,預設不顯示 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <IconButton
          variant="outlined"
          size="small"
          aria-label="上一週"
          onClick={() => {
            move(-7);
          }}
        >
          <ChevronRightIcon
            fontSize="small"
            sx={{ transform: "rotate(180deg)" }}
          />
        </IconButton>
        <Typography variant="h6" component="h2">
          {dayjs(weekStart).format("M/D")}–
          {dayjs(weekStart).add(6, "day").format("M/D")}
        </Typography>
        <IconButton
          variant="outlined"
          size="small"
          aria-label="下一週"
          onClick={() => {
            move(7);
          }}
        >
          <ChevronRightIcon fontSize="small" />
        </IconButton>
        {showTodayButton ? (
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            disabled={weekStart === todayWeek}
            onClick={() => {
              setWeekStart(todayWeek);
            }}
            sx={{ ml: "auto", borderColor: "divider", color: "text.primary" }}
          >
            今天
          </Button>
        ) : null}
      </Box>
      <ScheduleTimeline {...meta.args} {...args} dates={dates} />
    </Box>
  );
};

/**
 * 頁面怎麼放期間切換列與 [今天]:灰框小按鈕(和 `MonthCalendar` 的 [今天] 同一個樣式),
 * 頁面以選用設定決定要不要顯示(預設不顯示);顯示的已是今天所在的週時停用。
 */
export const WithPagePeriodBar: StoryObj<
  Story["args"] & { showTodayButton: boolean }
> = {
  args: { ...meta.args, showTodayButton: false },
  render: (args) => <PeriodBarDemo {...args} />,
};

export const WithPagePeriodBarTodayButton: StoryObj<
  Story["args"] & { showTodayButton: boolean }
> = {
  args: { ...meta.args, showTodayButton: true },
  render: (args) => <PeriodBarDemo {...args} />,
};
