import type { Meta, StoryObj } from "@storybook/react-vite";

import { DatePicker } from "./DatePicker";

const meta = {
  title: "Components/DatePicker",
  component: DatePicker,
  args: {
    label: "值",
  },
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 資料範圍規則編輯器的「值」欄(Figma Screen / Admin 資料範圍 167:1819)。 */
export const Default: Story = {
  args: { value: "2026-01-01" },
};

export const Empty: Story = {
  args: { value: null },
};

/** 區間條件(「之間」)= 兩個選擇器,用 min / max 互相夾住。 */
export const RangeStart: Story = {
  args: { label: "起日", value: "2026-01-01", maxDate: "2026-12-31" },
};

export const WithError: Story = {
  args: { value: null, error: true, helperText: "請選日期" },
};

export const Disabled: Story = {
  args: { value: "2026-01-01", disabled: true },
};

/**
 * 與同列的 `TextField select` / `Select` 對齊:
 * 條件列整列都用 `small`,不給的話日期欄會高一截。
 */
export const Small: Story = {
  args: { value: "2026-01-01", size: "small" },
};

/** 日曆語系可切(語系資料,不是 UI 文案 — 文字一律由呼叫端傳入,I18N-01)。 */
export const EnglishCalendar: Story = {
  args: { label: "Value", value: "2026-01-01", locale: "en" },
};
