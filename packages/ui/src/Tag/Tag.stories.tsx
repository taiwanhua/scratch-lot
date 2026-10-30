import type { Meta, StoryObj } from "@storybook/react-vite";

import { Stack } from "../Stack/Stack";
import { TAG_PALETTE_ORDER } from "../theme/tag-palettes";
import { Tag } from "./Tag";

const meta = {
  title: "Components/Tag",
  component: Tag,
  args: { label: "標籤" },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grey: Story = { args: { tone: "grey", label: "停用" } };
export const Primary: Story = { args: { tone: "primary", label: "群組" } };
export const Success: Story = { args: { tone: "success", label: "啟用" } };
export const Warning: Story = { args: { tone: "warning", label: "隱藏頁" } };
export const Danger: Story = { args: { tone: "error", label: "組織外" } };

/** 可關閉:用於已選項目的移除(所屬組織、角色)。 */
export const Deletable: Story = {
  args: {
    tone: "primary",
    label: "客服",
    onDelete: () => {
      // story 只示範外觀,不需要真的移除
    },
  },
};

/** 分類標籤的色票(`palette`):十組,深色模式自動換成深色那一組。 */
export const Palettes: Story = {
  render: () => (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
      {TAG_PALETTE_ORDER.map((key) => (
        <Tag key={key} palette={key} label={key} />
      ))}
    </Stack>
  ),
};

/** 可點的色票標籤(例:色票面板的選項):hover / focus 只加一圈文字色外框。 */
export const PaletteClickable: Story = {
  args: {
    palette: "orange",
    label: "橘",
    onClick: () => {
      // story 只示範外觀
    },
  },
};
