import type { Meta, StoryObj } from "@storybook/react-vite";

import { TimePicker } from "./TimePicker";

const meta = {
  title: "Components/TimePicker",
  component: TimePicker,
  args: {
    label: "開始",
  },
} satisfies Meta<typeof TimePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 值是 24 小時制的 `HH:mm`(時刻,不綁日期)。 */
export const Default: Story = {
  args: { value: "09:30" },
};

export const Empty: Story = {
  args: { value: null },
};

/** 15 分鐘一格:選單的分鐘只有 00 / 15 / 30 / 45,鍵盤打出 09:10 會標紅。 */
export const QuarterHourSteps: Story = {
  args: { label: "寄送時間", value: "09:00", minutesStep: 15 },
};

/** 可選範圍:08:00–18:00 之外的時刻在選單上不可選。 */
export const Range: Story = {
  args: { value: "10:00", minTime: "08:00", maxTime: "18:00" },
};

export const WithError: Story = {
  args: { value: null, error: true, helperText: "請選時間" },
};

export const Disabled: Story = {
  args: { value: "09:30", disabled: true },
};

/** 與同列 `size="small"` 的欄位對齊。 */
export const Small: Story = {
  args: { value: "09:30", size: "small" },
};
