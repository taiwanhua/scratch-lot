import type { Meta, StoryObj } from "@storybook/react-vite";

import { Checkbox } from "../Checkbox/Checkbox";
import { MenuItem } from "../Menu/MenuItem";
import { TextField } from "./TextField";

const meta = {
  title: "Components/TextField",
  component: TextField,
  args: { label: "食譜名稱" },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHelper: Story = {
  args: { helperText: "給這道菜取個名字" },
};
export const ErrorState: Story = {
  args: { error: true, helperText: "名稱不可為空" },
};
export const Disabled: Story = { args: { disabled: true } };

/**
 * 有浮動標籤的下拉:`select` + `slotProps.select`(Figma 資料範圍的「欄位 / 條件 / 套用對象」)。
 * 多選用 `multiple` + `renderValue`,選項裡放 `Checkbox` 表示勾選狀態 — 規則編輯器不需要另一個新元件。
 */
export const SelectMultiple: Story = {
  render: (args) => (
    <TextField
      {...args}
      select
      label="套用對象"
      value={["org-1"]}
      slotProps={{
        select: { multiple: true, renderValue: () => "已選 1 個組織" },
      }}
    >
      <MenuItem value="org-1">
        <Checkbox checked />
        台北分店
      </MenuItem>
      <MenuItem value="org-2">
        <Checkbox checked={false} />
        高雄分店
      </MenuItem>
    </TextField>
  ),
};
