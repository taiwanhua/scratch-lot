import type { Meta, StoryObj } from "@storybook/react-vite";

import { Section } from "./Section";

const meta = {
  title: "Components/Section",
  component: Section,
  args: {
    title: "基本資料",
    summary: "示範摘要",
    children: "放入欄位、表格或任何內容",
    // Figma `Draft/Section` 的示範寬度
    sx: { width: 560 },
  },
} satisfies Meta<typeof Section>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 展開,摘要不顯示、箭頭朝上。 */
export const Expanded: Story = {};

/** 收合,標題後接摘要、箭頭朝下。 */
export const Collapsed: Story = { args: { defaultCollapsed: true } };

/** 不可收合:標題列不是按鈕、沒有箭頭(表單分區沒勾「可以收合」時的樣子)。 */
export const NotCollapsible: Story = {
  args: { collapsible: false, defaultCollapsed: true },
};
