import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Box } from "../Box/Box";
import { Typography } from "../Typography/Typography";
import { MonthCalendar, type MonthCalendarProps } from "./MonthCalendar";

/**
 * **一週固定從星期日開始**(《底座規格》第 11 章 B 類):星期列與每一週都是「日 一 二 三 四 五 六」,
 * 不提供改成星期一開始的選項。
 *
 * 月份(`month` + `onMonthChange`)與選取(`selectedDates` + `onSelectedDatesChange`)都是受控值,
 * 元件不自己記;下方示範用 `useState` 扮演使用的頁面。格子寬度由容器七等分,高度電腦大格、手機約 48px。
 */
const meta = {
  title: "Components/MonthCalendar",
  component: MonthCalendar,
  parameters: { layout: "padded" },
  args: { month: "2026-10", today: "2026-10-16" },
  render: (args) => <ControlledCalendar {...args} />,
} satisfies Meta<typeof MonthCalendar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 扮演使用的頁面:持有月份與選取。 */
const ControlledCalendar = (props: MonthCalendarProps) => {
  const [month, setMonth] = useState(props.month);
  const [selected, setSelected] = useState<readonly string[]>(
    props.selectedDates ?? [],
  );
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <MonthCalendar
        {...props}
        month={month}
        onMonthChange={setMonth}
        selectedDates={selected}
        onSelectedDatesChange={setSelected}
      />
      {props.selectionMode && props.selectionMode !== "none" ? (
        <Typography variant="caption" color="text.secondary">
          selectedDates = {JSON.stringify(selected)}
        </Typography>
      ) : null}
    </Box>
  );
};

/** 只顯示(selectionMode 預設 none):今天畫圓底,點日期不選取。 */
export const Default: Story = {};

/** 單選:點一天選定,再點另一天就換成另一天(Figma Draft/MonthCalendar 48:360 的已選格)。 */
export const SingleSelection: Story = {
  args: { selectionMode: "single", selectedDates: ["2026-10-16"] },
};

/** 多選:點一下選取 / 取消;每週左側整週勾選框(Figma BS-23 260:6356)。 */
export const MultipleSelection: Story = {
  args: {
    selectionMode: "multiple",
    selectedDates: ["2026-10-05", "2026-10-06", "2026-10-07"],
  },
};

const closedDays: MonthCalendarProps["days"] = {
  "2026-10-06": { disabled: true, disabledReason: "店休", note: "休息日" },
  "2026-10-13": { disabled: true, disabledReason: "店休", note: "休息日" },
  "2026-10-20": { disabled: true, disabledReason: "店休", note: "休息日" },
  "2026-10-27": { disabled: true, disabledReason: "店休", note: "休息日" },
};

/** 停用日:停用色、點了沒反應、滑過顯示原因;整週勾選跳過停用日。 */
export const DisabledDays: Story = {
  args: { selectionMode: "multiple", days: closedDays },
};

/** 日期註記(特殊日名稱)。 */
export const Notes: Story = {
  args: {
    days: {
      "2026-10-10": { note: "國慶日" },
      "2026-10-11": { note: "特殊日" },
      "2026-10-31": { note: "萬聖節" },
    },
  },
};

/** 角標:右上小圓點(顏色由使用處決定)或 error badge(內容由使用處決定),格內可放自訂內容。 */
export const CornerMarks: Story = {
  args: {
    days: {
      "2026-10-05": {
        corner: { variant: "dot", color: "warning", label: "有異動" },
        content: <Typography variant="caption">09:00–17:00</Typography>,
      },
      "2026-10-08": {
        corner: { variant: "dot", color: "error", label: "缺卡" },
      },
      "2026-10-12": {
        corner: { variant: "badge", content: "缺下班卡" },
        content: <Typography variant="caption">09:00–17:00</Typography>,
      },
    },
  },
};

/** 窄寬(手機 390 扣掉左右留白):格子約 48px,依容器寬度七等分。 */
export const Narrow: Story = {
  args: {
    selectionMode: "multiple",
    days: {
      ...closedDays,
      "2026-10-12": { corner: { variant: "badge", content: "缺卡" } },
      "2026-10-15": {
        corner: { variant: "dot", color: "warning", label: "有異動" },
      },
    },
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 358 }}>
        <Story />
      </Box>
    ),
  ],
};

/** 不顯示內建表頭:換月由使用的頁面自己提供。 */
export const WithoutHeader: Story = { args: { showHeader: false } };

/** 暗色模式:顏色只用主題 token,切換後自動正確。 */
export const DarkMode: Story = {
  args: {
    selectionMode: "multiple",
    selectedDates: ["2026-10-14", "2026-10-15"],
    days: {
      ...closedDays,
      "2026-10-11": { note: "特殊日" },
      "2026-10-12": { corner: { variant: "badge", content: "缺下班卡" } },
      "2026-10-16": {
        corner: { variant: "dot", color: "warning", label: "有異動" },
      },
    },
  },
  globals: { mode: "dark" },
};
