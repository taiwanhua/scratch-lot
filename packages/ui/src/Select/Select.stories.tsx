import type { Meta, StoryObj } from "@storybook/react-vite";

import { MenuItem } from "../Menu/MenuItem";
import { Select } from "./Select";

const options = [
  { value: "org-1", label: "台北分店" },
  { value: "org-2", label: "高雄分店" },
];

const meta = {
  title: "Components/Select",
  component: Select,
  args: {
    value: "org-1",
    sx: { minWidth: 200 },
    slotProps: { input: { "aria-label": "組織" } },
    children: options.map((option) => (
      <MenuItem key={option.value} value={option.value}>
        {option.label}
      </MenuItem>
    )),
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 表單用(浮動標籤):Figma Draft/Select 的 outlined 變體。 */
export const Outlined: Story = {};

/** 行內無框:AppBar 的組織切換、工具列。 */
export const Standard: Story = { args: { variant: "standard" } };

/** 停用:外框與文字一起反灰,和同列的日期欄、按鈕一致。 */
export const Disabled: Story = { args: { disabled: true } };

export const DisabledStandard: Story = {
  args: { variant: "standard", disabled: true },
};
