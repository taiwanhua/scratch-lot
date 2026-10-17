import type { Meta, StoryObj } from "@storybook/react-vite";

import { Box } from "../Box/Box";
import { Stack } from "../Stack/Stack";
import { Typography } from "../Typography/Typography";
import { MODULE_ICONS, MODULE_ICON_KEYS } from "./module-icon-registry";

/** 一格的框(圖示 + 短詞 + key);key 是資料庫存的值,列出來才對得起 Figma 的變體名。 */
const cellSx = {
  alignItems: "center",
  gap: 0.5,
  width: 112,
  py: 1.5,
  borderRadius: 1,
  border: 1,
  borderColor: "divider",
} as const;

/**
 * 白名單的全貌(#287):一頁列出 30 個,用來對照 Figma「Icons」頁的
 * `Draft/ModuleIcon` 變體(變體名 `key=<name>`,與這裡的 key 同名同順序)。
 */
const ModuleIconGallery = ({ color }: { color?: string }) => (
  <Box sx={{ color }}>
    <Stack
      direction="row"
      sx={{ flexWrap: "wrap", gap: 1, maxWidth: 720, mb: 2 }}
    >
      {MODULE_ICON_KEYS.map((iconKey) => {
        const { label, Icon } = MODULE_ICONS[iconKey];
        return (
          <Stack key={iconKey} sx={cellSx}>
            <Icon />
            <Typography variant="caption">{label}</Typography>
            <Typography variant="caption" color="text.disabled">
              {iconKey}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
    <Typography variant="caption" color="text.secondary">
      共 {MODULE_ICON_KEYS.length} 個;不在表裡的值(舊資料、未設定)一律畫
      DotIcon。
    </Typography>
  </Box>
);

const meta = {
  title: "Foundations/Module Icons",
  component: ModuleIconGallery,
} satisfies Meta<typeof ModuleIconGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 對照 Figma「Icons」頁的 30 個變體。 */
export const All: Story = {};

/** 圖示一律 `currentColor`:整組跟著父層文字色走(STYLE-04,深色模式自動正確)。 */
export const FollowsTextColor: Story = {
  args: { color: "primary.main" },
};
