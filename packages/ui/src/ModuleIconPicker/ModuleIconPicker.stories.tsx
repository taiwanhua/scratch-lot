import type { Meta, StoryObj } from "@storybook/react-vite";

import { ModuleIconPicker } from "./ModuleIconPicker";

const meta = {
  title: "Components/ModuleIconPicker",
  component: ModuleIconPicker,
  args: {
    label: "圖示",
    value: "people",
    sx: { minWidth: 220 },
  },
} satisfies Meta<typeof ModuleIconPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 模組與權限頁的「圖示」欄:下拉列出白名單 30 個(Foundations / Module Icons 有全圖)。 */
export const Default: Story = {};

/** 未設定 / 舊資料的未知 key:畫預設的 `DotIcon`,文字由呼叫端給(I18N-01)。 */
export const Empty: Story = {
  args: { value: null, emptyLabel: "未設定" },
};

export const UnknownValue: Story = {
  args: { value: "no-such-icon", emptyLabel: "未設定" },
};

/** 與同列的下拉、日期欄對齊時整列給 `small`(#260)。 */
export const Small: Story = {
  args: { size: "small" },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const WithError: Story = {
  args: { value: null, error: true, helperText: "請選圖示" },
};
